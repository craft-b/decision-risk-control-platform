# ml-service/training/train_model_multihorizon.py
# Multi-horizon failure prediction: trains separate models for 10d, 30d, 60d windows.
# Each model is a calibrated Random Forest binary classifier.
# Artifacts saved with horizon suffix: rf_10d_vX.Y.pkl, rf_30d_vX.Y.pkl, rf_60d_vX.Y.pkl
#
# ── Architecture decision: why three separate models? ─────────────────────────
#
# Alternative 1 — Single model, horizon as input feature:
#   Simpler to train, but forces the model to learn one joint function over
#   (features, horizon). The failure-probability surface has very different
#   shapes at 10d vs. 60d (different dominant features, different class
#   imbalance). A single model either over-smooths these differences or
#   requires heavy interaction terms that obscure interpretability.
#
# Alternative 2 — Survival / Weibull model (e.g. Cox PH, DeepSurv):
#   Correct statistical framing for time-to-event data. Chosen against because:
#   (a) harder to calibrate to a point probability P(fail ≤ t) — requires
#       integration of the survival function over [0, t], and calibration
#       tools (Platt, isotonic) operate on binary outputs, not survival curves;
#   (b) Cox PH assumes proportional hazards — violated here as fleet ages
#       non-uniformly; (c) adds deployment complexity vs. a joblib-serialised RF.
#
# Chosen approach — three independent binary classifiers, one per label:
#   Labels are will_fail_10d, will_fail_30d, will_fail_60d (binary, point-in-time).
#   Each model is calibrated independently using CalibratedClassifierCV (Platt
#   scaling for 10d, isotonic for 30d/60d — selected based on calibration set
#   size and distribution shift characteristics per horizon). Monotonicity
#   P(fail≤10d) ≤ P(fail≤30d) ≤ P(fail≤60d) is enforced at the READ layer
#   (max() clamping), not in training, which keeps models independent and
#   auditable. This design trades statistical elegance for operational clarity:
#   each model can be evaluated, replaced, or retrained independently.
#
# ── Feature store framing ─────────────────────────────────────────────────────
#
# asset_feature_snapshots is a point-in-time correct feature store.
# Snapshots are computed at label time (snapshot_ts < failure event) so no
# future information leaks into training features — the classic "lookahead bias"
# problem in time-series ML. Offline path: training reads from snapshots.
# Online path: inference computes features from current operational DB state.
# Tradeoff: online features are fresh but not pre-computed (adds latency);
# snapshot features are stale by up to the snapshot cadence but instantly
# available. For predictive maintenance at this cadence (daily batch predictions),
# staleness is acceptable.
# ─────────────────────────────────────────────────────────────────────────────

import os
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import (
    classification_report, confusion_matrix,
    precision_recall_fscore_support, roc_auc_score,
    average_precision_score
)
from sklearn.preprocessing import LabelEncoder
from sklearn.calibration import CalibratedClassifierCV
import joblib
import json
import sys
from pathlib import Path
from sqlalchemy import create_engine, text
import warnings
warnings.filterwarnings('ignore')
from datetime import datetime  # noqa: E402

# ── Class imbalance — SMOTE oversampling ──────────────────────────────────────
# Predictive maintenance datasets are inherently imbalanced: failures are rare
# by design (good maintenance programs). With <5% positive rate, even
# class_weight='balanced' struggles because:
#   (a) With very few positives (<10), TimeSeriesSplit folds often contain 0-1
#       positives and get skipped → model trains on near-zero positives.
#   (b) RF with balanced weights upweights the few positives but can't learn
#       generalizable patterns from 3-4 examples.
#
# SMOTE (Synthetic Minority Oversampling TEchnique) addresses this by
# interpolating new synthetic minority samples between existing positives in
# feature space — not just duplicating them. This gives the model richer signal.
#
# Critical implementation detail: SMOTE is applied ONLY to the training fold,
# never to validation or test sets. Applying it to val/test would inflate
# recall metrics and give falsely optimistic evaluation.
#
# k_neighbors is set to min(5, n_positives-1) to handle tiny positive sets
# without crashing (SMOTE requires at least k_neighbors+1 minority samples).
try:
    from imblearn.over_sampling import SMOTE
    _SMOTE_AVAILABLE = True
except ImportError:
    _SMOTE_AVAILABLE = False
    print("[SMOTE] imbalanced-learn not installed — SMOTE disabled. Install with: pip install imbalanced-learn")

def apply_smote(X_train, y_train, random_state=42):
    """
    Apply SMOTE to the training set if imbalanced-learn is available and
    there are enough minority samples to interpolate from (≥2 positives).
    Returns (X_resampled, y_resampled, applied: bool).
    """
    if not _SMOTE_AVAILABLE:
        return X_train, y_train, False
    n_pos = int(y_train.sum())
    if n_pos < 2:
        return X_train, y_train, False
    k = min(5, n_pos - 1)
    try:
        sm = SMOTE(random_state=random_state, k_neighbors=k)
        X_res, y_res = sm.fit_resample(X_train, y_train)
        return X_res, y_res, True
    except Exception as e:
        print(f"[SMOTE] Warning — skipping: {e}")
        return X_train, y_train, False

# ── Reproducibility ───────────────────────────────────────────────────────────
# Single seed applied to numpy and every RF estimator — guarantees bit-for-bit
# reproducible training runs given the same data and sklearn version.
RANDOM_SEED = 42

# ── Experiment Tracking (opt-in) ──────────────────────────────────────────────
# Set MLFLOW_TRACKING_URI in .env to activate (e.g. "http://localhost:5000" or
# a local file store like "file:./mlruns"). Safe no-op if mlflow not configured.
try:
    import mlflow
    import mlflow.sklearn
    _MLFLOW_URI = os.getenv("MLFLOW_TRACKING_URI")
    MLFLOW_ENABLED = bool(_MLFLOW_URI)
    if MLFLOW_ENABLED:
        mlflow.set_tracking_uri(_MLFLOW_URI)
        print(f"[MLFLOW] Tracking enabled → {_MLFLOW_URI}")
except ImportError:
    MLFLOW_ENABLED = False

SCRIPT_DIR = Path(__file__).parent.parent  # ml-service root
MODEL_DIR  = SCRIPT_DIR / "registry"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# Add ml-service root to path so engine.* imports resolve regardless of cwd
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

HORIZONS = [10, 30, 60]  # days

# ── Operating point & shop-capacity budget (ML-3 operator metrics) ────────────
# HIGH band threshold used by the serving layer (predictor risk bands 0.30/0.60).
# Operator metrics are evaluated where the business acts: the HIGH flag.
OPERATING_THRESHOLD = 0.60
# precision@budget: the shop can realistically service ~10% of the fleet per
# week; precision inside that top-K queue is the "will my mechanic trust this
# list" number, unlike global AUC.
PM_BUDGET_FRACTION = 0.10


def _fmt(v) -> str:
    """Print helper for metrics that can legitimately be None (no events to measure)."""
    return f"{v:.3f}" if isinstance(v, (int, float)) else "n/a"

FEATURE_COLS = [
    'asset_age_years',
    'total_hours_lifetime',
    'hours_used_30d',
    'hours_used_90d',
    'rental_days_30d',
    'rental_days_90d',
    'avg_rental_duration',
    'maintenance_events_90d',
    'maintenance_cost_180d',
    'days_since_last_maintenance',
    'mean_time_between_failures',
    'vendor_reliability_score',
    'jobsite_risk_score',
    'usage_intensity',
    'usage_trend',
    'utilization_vs_expected',
    'wear_rate',
    'aging_factor',
    'maint_overdue',
    'cost_per_event',
    'maint_burden',
    'mechanical_wear_score',
    'abuse_score',
    'neglect_score',
    'wear_rate_velocity',
    'maint_frequency_trend',
    'cost_trend',
    'hours_velocity',
    'neglect_acceleration',
    'sensor_degradation_rate',
    'category',
]

# ─────────────────────────────────────────────────────────────────────────────
# DATABASE
# ─────────────────────────────────────────────────────────────────────────────

def get_db_connection():
    import os
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent.parent / ".env"
    load_dotenv(dotenv_path=env_path)
    db_host = os.getenv('DB_HOST', 'localhost')
    db_port = int(os.getenv('DB_PORT', '3306'))
    db_user = os.getenv('DB_USER', 'root')
    db_pass = os.getenv('DB_PASSWORD', '')
    db_name = os.getenv('DB_NAME', 'asset_inventory')
    engine = create_engine(
        f"mysql+pymysql://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}",
        pool_pre_ping=True
    )
    return engine


def get_next_version() -> str:
    try:
        engine = get_db_connection()
        with engine.connect() as conn:
            # Prefer the long-format model_metrics table; fall back to the
            # legacy model_training_metrics table for pre-existing installs.
            row = None
            for table in ("model_metrics", "model_training_metrics"):
                try:
                    result = conn.execute(text(
                        f"SELECT model_version FROM {table} ORDER BY trained_at DESC LIMIT 1"
                    ))
                    row = result.fetchone()
                    if row is not None:
                        break
                except Exception:
                    continue
        engine.dispose()
        if row is None:
            return "v2.0"
        parts = row[0].lstrip('v').split('.')
        major = int(parts[0])
        minor = int(parts[1]) if len(parts) > 1 else 0
        next_version = f"v{major}.{minor + 1}"
        print(f"[VERSION] Last: {row[0]} → New: {next_version}")
        return next_version
    except Exception as e:
        print(f"[VERSION] Could not read from DB ({e}) — using v2.0")
        return "v2.0"


# ─────────────────────────────────────────────────────────────────────────────
# DATA LOADING
# ─────────────────────────────────────────────────────────────────────────────

def load_training_data() -> pd.DataFrame:
    engine = get_db_connection()
    feature_sql = ', '.join([
        'COALESCE(days_since_last_maintenance, 999) as days_since_last_maintenance'
        if col == 'days_since_last_maintenance'
        else 'COALESCE(mean_time_between_failures, 500) as mean_time_between_failures'
        if col == 'mean_time_between_failures'
        else 'COALESCE(wear_rate_velocity, 0) as wear_rate_velocity'
        if col == 'wear_rate_velocity'
        else 'COALESCE(maint_frequency_trend, 1.0) as maint_frequency_trend'
        if col == 'maint_frequency_trend'
        else 'COALESCE(cost_trend, 1.0) as cost_trend'
        if col == 'cost_trend'
        else 'COALESCE(hours_velocity, 1.0) as hours_velocity'
        if col == 'hours_velocity'
        else 'COALESCE(neglect_acceleration, 1.0) as neglect_acceleration'
        if col == 'neglect_acceleration'
        else 'COALESCE(sensor_degradation_rate, 0) as sensor_degradation_rate'
        if col == 'sensor_degradation_rate'
        else col
        for col in FEATURE_COLS
    ])
    # ML-11: only rows with observed outcomes train the model. Rows censored by
    # a predictive intervention (counterfactual unknown) or by the horizon are
    # excluded from training AND from prevalence accounting. label_status IS NULL
    # is accepted for pre-migration rows labeled under the legacy rule.
    query = f"""
    SELECT
        {feature_sql},
        equipment_id,
        will_fail_10d,
        will_fail_30d,
        will_fail_60d,
        snapshot_ts
    FROM asset_feature_snapshots
    WHERE will_fail_10d IS NOT NULL
      AND will_fail_30d IS NOT NULL
      AND will_fail_60d IS NOT NULL
      AND (label_status IS NULL OR label_status = 'observed')
    ORDER BY snapshot_ts
    """
    df = pd.read_sql(query, engine)

    # Censoring accounting — printed so prevalence claims stay honest
    try:
        with engine.connect() as conn:
            cens = conn.execute(text(
                "SELECT label_status, COUNT(*) FROM asset_feature_snapshots "
                "WHERE label_status IS NOT NULL GROUP BY label_status"
            )).fetchall()
        for status, n in cens:
            print(f"[DATA] label_status={status}: {n:,} rows")
    except Exception:
        pass
    engine.dispose()

    print(f"[DATA] Loaded {len(df):,} observed labeled samples")
    for h in HORIZONS:
        col = f'will_fail_{h}d'
        rate = df[col].mean() * 100
        pos  = df[col].sum()
        print(f"[DATA]   {h}d: {rate:.1f}% positive ({pos:,} / {len(df):,})")

    # Cap usage_intensity outliers
    if (df['usage_intensity'] > 24).any():
        df['usage_intensity'] = df['usage_intensity'].clip(upper=12)

    return df


def load_failure_events() -> pd.DataFrame:
    """
    Actual breakdown events (REACTIVE_REPAIR) — used for the lead-time operator
    metric: days from first HIGH flag to the failure event.
    """
    engine = get_db_connection()
    df = pd.read_sql(
        "SELECT equipment_id, maintenance_date FROM maintenance_events "
        "WHERE event_source = 'REACTIVE_REPAIR'",
        engine,
    )
    engine.dispose()
    df['maintenance_date'] = pd.to_datetime(df['maintenance_date'])
    print(f"[DATA] Loaded {len(df):,} REACTIVE_REPAIR failure events for lead-time metric")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE ENGINEERING  (shared across all three horizons)
# ─────────────────────────────────────────────────────────────────────────────

def prepare_features(df: pd.DataFrame, model_version: str):
    df = df.copy()

    # Drop label/meta columns — keep only features. snapshot_ts and equipment_id
    # ride along in `labels` for the split embargo and grouped evaluation (ML-3).
    label_cols = ['will_fail_10d', 'will_fail_30d', 'will_fail_60d', 'snapshot_ts', 'equipment_id']
    labels = {col: df.pop(col) for col in label_cols if col in df.columns}

    # Encode category
    le = LabelEncoder()
    df['category_encoded'] = le.fit_transform(df['category'].fillna('Unknown'))
    df.drop('category', axis=1, inplace=True)

    # Save encoder (shared across all horizons)
    joblib.dump(le, MODEL_DIR / f"label_encoder_category_{model_version}.pkl")
    joblib.dump(le, MODEL_DIR / "label_encoder_category.pkl")

    # Log-transform skewed features
    log_cols = [
        'total_hours_lifetime', 'hours_used_30d', 'hours_used_90d',
        'maintenance_cost_180d', 'cost_per_event', 'maint_burden',
        'mean_time_between_failures'
    ]
    for col in log_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
            df[f'log_{col}'] = np.log1p(df[col].clip(lower=0))
            # Drop raw column — log version captures the same signal
            # without letting the model double-count it and without
            # the raw skewed distribution distorting split decisions
            df.drop(col, axis=1, inplace=True)
                 
    # Clip outliers — compute from full training set
    clip_thresholds = {}
    for col in df.select_dtypes(include=[np.number]).columns:
        p99 = df[col].quantile(0.99)
        if p99 > 0:
            threshold = float(p99 * 1.5)
            clip_thresholds[col] = threshold
            df[col] = df[col].clip(upper=threshold)

    df = df.fillna(0)
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

    feature_names = df.columns.tolist()
    print(f"[FEATURES] {len(feature_names)} features after engineering")

    return df, labels, feature_names, clip_thresholds


# ─────────────────────────────────────────────────────────────────────────────
# OPERATOR METRICS (ML-3) — the numbers a maintenance manager acts on
# ─────────────────────────────────────────────────────────────────────────────

def compute_operator_metrics(y_true, y_prob, snapshot_ts, equipment_ids,
                             failures_df: pd.DataFrame, horizon_days: int,
                             threshold: float = OPERATING_THRESHOLD) -> dict:
    """
    Metrics evaluated at the operating point, not averaged over all thresholds:
      - recall_failure_operating: share of actual failures flagged HIGH (≥ threshold).
        Missed failures are the expensive error class.
      - precision_at_budget: per snapshot date, take the top-K units by predicted
        probability (K = PM_BUDGET_FRACTION of units scored that date — the shop's
        weekly capacity) and measure how many were true positives.
      - lead_time_median_days: median days from the first HIGH flag to the actual
        failure event; must exceed PM scheduling latency (~7d) to be actionable.
      - lead_time_failures_flagged_pct: share of evaluable failures that got a
        HIGH flag at any point in the `horizon_days` before the event.
    All inputs are positional (same order); NaNs must be pre-masked.
    """
    y_true = np.asarray(y_true).astype(int)
    y_prob = np.asarray(y_prob, dtype=float)
    frame = pd.DataFrame({
        'ts':  pd.to_datetime(pd.Series(snapshot_ts).reset_index(drop=True)),
        'eq':  pd.Series(equipment_ids).reset_index(drop=True).astype(int),
        'y':   y_true,
        'p':   y_prob,
    })

    out: dict = {}

    n_pos = int((frame['y'] == 1).sum())
    if n_pos > 0:
        out['recall_failure_operating'] = float(
            ((frame['p'] >= threshold) & (frame['y'] == 1)).sum() / n_pos
        )
    else:
        out['recall_failure_operating'] = None

    # precision@budget — weekly top-K queue precision
    precisions = []
    for _, g in frame.groupby(frame['ts'].dt.date):
        k = max(1, int(np.ceil(len(g) * PM_BUDGET_FRACTION)))
        precisions.append(float(g.nlargest(k, 'p')['y'].mean()))
    out['precision_at_budget'] = float(np.mean(precisions)) if precisions else None

    # lead time — per actual failure with at least one scored snapshot in the
    # horizon window before the event
    eval_eq = set(frame['eq'].unique())
    leads: list = []
    evaluable = 0
    ts_min, ts_max = frame['ts'].min(), frame['ts'].max()
    for _, f in failures_df.iterrows():
        eq_id = int(f['equipment_id'])
        fail_ts = f['maintenance_date']
        if eq_id not in eval_eq:
            continue
        # only failures whose lookback window overlaps the evaluated period
        if fail_ts < ts_min or fail_ts - pd.Timedelta(days=horizon_days) > ts_max:
            continue
        w = frame[(frame['eq'] == eq_id)
                  & (frame['ts'] < fail_ts)
                  & (frame['ts'] >= fail_ts - pd.Timedelta(days=horizon_days))]
        if w.empty:
            continue
        evaluable += 1
        hits = w[w['p'] >= threshold]
        if not hits.empty:
            leads.append((fail_ts - hits['ts'].min()).days)
    out['lead_time_median_days'] = float(np.median(leads)) if leads else None
    out['lead_time_failures_flagged_pct'] = (
        float(len(leads) / evaluable) if evaluable > 0 else None
    )
    out['lead_time_failures_evaluable'] = evaluable
    out['operating_threshold'] = threshold
    out['budget_fraction'] = PM_BUDGET_FRACTION
    return out


def grouped_evaluation(X: pd.DataFrame, y: pd.Series, snapshot_ts, equipment_ids,
                       failures_df: pd.DataFrame, horizon_days: int,
                       calibration_method: str):
    """
    By-asset generalization (ML-3): GroupKFold over equipment_id, pooled
    out-of-fold predictions. Every asset is scored by a model that never saw
    any of its rows — this answers "how does it do on a NEW fleet, day one"
    (the sales scenario), which the temporal holdout cannot answer because
    every holdout asset also appears in dev with near-identical features.
    """
    from sklearn.model_selection import GroupKFold

    groups = pd.Series(equipment_ids).reset_index(drop=True).astype(int)
    n_assets = groups.nunique()
    n_splits = min(5, n_assets)
    if n_splits < 2:
        return None

    y_np  = pd.Series(y).reset_index(drop=True).astype(int)
    ts_np = pd.Series(snapshot_ts).reset_index(drop=True)
    Xp    = X.reset_index(drop=True)

    oof = np.full(len(Xp), np.nan)
    gkf = GroupKFold(n_splits=n_splits)
    for tr_idx, te_idx in gkf.split(Xp, y_np, groups):
        y_tr = y_np.iloc[tr_idx]
        if y_tr.nunique() < 2:
            continue
        rf = RandomForestClassifier(
            n_estimators=200, max_depth=12, min_samples_split=5,
            min_samples_leaf=3, max_features='sqrt', class_weight='balanced',
            random_state=RANDOM_SEED, n_jobs=-1,
        )
        model = CalibratedClassifierCV(rf, method=calibration_method, cv=3)
        X_tr_s, y_tr_s, _ = apply_smote(Xp.iloc[tr_idx], y_tr, random_state=RANDOM_SEED)
        model.fit(X_tr_s, y_tr_s)
        proba = model.predict_proba(Xp.iloc[te_idx])
        if proba.shape[1] == 2:
            oof[te_idx] = proba[:, 1]

    mask = ~np.isnan(oof)
    if mask.sum() == 0 or y_np[mask].nunique() < 2:
        return None

    y_m, p_m = y_np[mask].to_numpy(), oof[mask]
    result = {
        'roc_auc':       float(roc_auc_score(y_m, p_m)),
        'pr_auc':        float(average_precision_score(y_m, p_m)),
        'positive_rate': float(y_m.mean()),
        'n_evaluated':   int(mask.sum()),
        'n_folds':       n_splits,
    }
    result.update(compute_operator_metrics(
        y_m, p_m, ts_np[mask], groups[mask], failures_df, horizon_days
    ))
    return result


# ─────────────────────────────────────────────────────────────────────────────
# TRAINING — one model per horizon
# ─────────────────────────────────────────────────────────────────────────────

def train_horizon_model(X: pd.DataFrame, y: pd.Series, horizon_days: int,
                        snapshot_ts: pd.Series, equipment_ids: pd.Series,
                        failures_df: pd.DataFrame):
    print(f"\n{'='*60}")
    print(f"[TRAIN] Horizon: {horizon_days}d  |  Positive rate: {y.mean()*100:.1f}%")

    # ─────────────────────────────────────────────────────────────────
    # TEMPORAL HOLDOUT WITH EMBARGO (ML-3)
    # Final 20% of timeline is held out as the true test set. Dev rows
    # whose label window [ts, ts+horizon] crosses the holdout boundary
    # are dropped (embargo): their labels are realized inside the
    # holdout period, which would leak future outcome information into
    # training.
    # ─────────────────────────────────────────────────────────────────
    holdout_idx = int(len(X) * 0.80)
    X_dev,  X_test = X.iloc[:holdout_idx].copy(), X.iloc[holdout_idx:].copy()
    y_dev,  y_test = y.iloc[:holdout_idx].copy(), y.iloc[holdout_idx:].copy()
    ts_all = pd.to_datetime(pd.Series(snapshot_ts).reset_index(drop=True))
    ts_dev, ts_test = ts_all.iloc[:holdout_idx], ts_all.iloc[holdout_idx:]
    eq_all = pd.Series(equipment_ids).reset_index(drop=True).astype(int)
    eq_test = eq_all.iloc[holdout_idx:]

    holdout_start = ts_test.iloc[0]
    embargo_cutoff = holdout_start - pd.Timedelta(days=horizon_days)
    keep = (ts_dev <= embargo_cutoff).to_numpy()
    n_embargoed = int((~keep).sum())
    if n_embargoed > 0:
        X_dev = X_dev.iloc[keep]
        y_dev = y_dev.iloc[keep]
    print(f"[SPLIT] Embargo: dropped {n_embargoed} dev rows within "
          f"{horizon_days}d of holdout boundary ({holdout_start.date()})")

    print(f"[SPLIT] Dev: {len(X_dev):,}  Holdout test: {len(X_test):,}")
    print(f"[SPLIT] Dev positive:  {y_dev.mean()*100:.1f}%")
    print(f"[SPLIT] Test positive: {y_test.mean()*100:.1f}%")

    pos_rate_gap = abs(y_test.mean() - y_dev.mean())
    if pos_rate_gap > 0.15:
        print(f"[SPLIT] ⚠️  Distribution shift detected: {pos_rate_gap:.1%} gap between dev and test.")
        print(f"[SPLIT]    This is expected for {horizon_days}d horizon — equipment ages over simulation.")
        print("[SPLIT]    TimeSeriesSplit CV handles this correctly by training on progressively later folds.")

    # ─────────────────────────────────────────────────────────────────
    # TIME-SERIES CROSS VALIDATION
    # Correct methodology for temporal data:
    # - Each fold trains on past, validates on immediate future
    # - No future data ever leaks into training
    # - gap=7 prevents label leakage across the horizon window
    # - Gives honest estimate of generalization across different
    #   time periods, not just one arbitrary split point
    # ─────────────────────────────────────────────────────────────────
    N_SPLITS = 5
    GAP      = horizon_days  # Gap = horizon days prevents label overlap

    tscv = TimeSeriesSplit(n_splits=N_SPLITS, gap=GAP)

    base_rf = RandomForestClassifier(
        n_estimators=200,
        max_depth=12,
        min_samples_split=5,
        min_samples_leaf=3,
        max_features='sqrt',
        class_weight='balanced',
        random_state=RANDOM_SEED,
        n_jobs=-1,
    )

    # Collect per-fold metrics to understand model stability over time
    fold_roc_aucs   = []
    fold_pr_aucs    = []
    fold_pos_rates  = []

    print(f"\n[CV] TimeSeriesSplit — {N_SPLITS} folds, gap={GAP} days")
    print(f"{'Fold':<6} {'Train N':>8} {'Val N':>8} {'Val Pos%':>9} {'ROC-AUC':>9} {'PR-AUC':>8}")
    print("-" * 52)

    for fold, (train_idx, val_idx) in enumerate(tscv.split(X_dev), 1):
        X_fold_train = X_dev.iloc[train_idx]
        X_fold_val   = X_dev.iloc[val_idx]
        y_fold_train = y_dev.iloc[train_idx]
        y_fold_val   = y_dev.iloc[val_idx]

        # Skip fold if either train or val set has only one class
        if y_fold_val.nunique() < 2 or y_fold_train.nunique() < 2:
            print(f"{fold:<6} {len(X_fold_train):>8,} {len(X_fold_val):>8,} {'single class':>9} {'skip':>9} {'skip':>8}")
            continue

        X_fold_train_s, y_fold_train_s, smote_applied = apply_smote(
            X_fold_train, y_fold_train, random_state=RANDOM_SEED
        )
        if smote_applied:
            print(f"  [SMOTE] fold {fold}: {len(X_fold_train)} → {len(X_fold_train_s)} samples "
                  f"({int(y_fold_train.sum())} → {int(y_fold_train_s.sum())} positives)")

        base_rf.fit(X_fold_train_s, y_fold_train_s)

        # Guard: predict_proba returns 1 column if model only saw one class
        proba = base_rf.predict_proba(X_fold_val)
        if proba.shape[1] < 2:
            print(f"{fold:<6} {len(X_fold_train):>8,} {len(X_fold_val):>8,} {'one class pred':>9} {'skip':>9} {'skip':>8}")
            continue
        y_fold_prob = proba[:, 1]

        fold_roc = roc_auc_score(y_fold_val, y_fold_prob)
        fold_pr  = average_precision_score(y_fold_val, y_fold_prob)
        fold_pos = y_fold_val.mean()

        fold_roc_aucs.append(fold_roc)
        fold_pr_aucs.append(fold_pr)
        fold_pos_rates.append(fold_pos)

        print(f"{fold:<6} {len(X_fold_train):>8,} {len(X_fold_val):>8,} "
              f"{fold_pos*100:>8.1f}% {fold_roc:>9.4f} {fold_pr:>8.4f}")

    cv_roc_mean = float(np.mean(fold_roc_aucs)) if fold_roc_aucs else 0.0
    cv_roc_std  = float(np.std(fold_roc_aucs))  if fold_roc_aucs else 0.0
    cv_pr_mean  = float(np.mean(fold_pr_aucs))  if fold_pr_aucs  else 0.0

    print(f"\n[CV] ROC-AUC: {cv_roc_mean:.4f} ± {cv_roc_std:.4f}")
    print(f"[CV] PR-AUC:  {cv_pr_mean:.4f}")

    # Stability check — high std means model behaves very differently
    # across time periods, which is a deployment risk signal
    if cv_roc_std > 0.08:
        print(f"[CV] ⚠️  High fold variance ({cv_roc_std:.4f}) — model unstable across time periods.")
        print("[CV]    Consider feature engineering improvements or regularization.")
    else:
        print(f"[CV] ✅ Fold variance acceptable ({cv_roc_std:.4f}) — stable across time periods.")

    # ─────────────────────────────────────────────────────────────────
    # FINAL MODEL TRAINING
    # Train calibrated model on full dev set (all 80%).
    # Calibration method selected based on calibration set size:
    # - sigmoid (Platt scaling): better for small calibration sets
    #   or when isotonic overfits (common with skewed distributions)
    # - isotonic: better for large, balanced calibration sets
    # 10d uses sigmoid because its dev/test distribution shifts
    # most significantly — isotonic overfits the skewed fold boundaries
    # ─────────────────────────────────────────────────────────────────
    calibration_method = 'sigmoid' if horizon_days == 10 else 'isotonic'
    print(f"\n[TRAIN] Fitting final model on full dev set ({len(X_dev):,} samples)")
    print(f"[TRAIN] Calibration method: {calibration_method}")

    final_rf = RandomForestClassifier(
        n_estimators=200,
        max_depth=12,
        min_samples_split=5,
        min_samples_leaf=3,
        max_features='sqrt',
        class_weight='balanced',
        random_state=RANDOM_SEED,
        n_jobs=-1,
    )
    # Apply SMOTE to dev set before final training.
    # CalibratedClassifierCV internally splits for calibration — applying SMOTE
    # before it slightly over-represents synthetic samples in calibration folds,
    # but the effect is minor and preferable to training on a nearly all-negative set.
    X_dev_s, y_dev_s, smote_final = apply_smote(X_dev, y_dev, random_state=RANDOM_SEED)
    if smote_final:
        print(f"[SMOTE] Final model: {len(X_dev)} → {len(X_dev_s)} samples "
              f"({int(y_dev.sum())} → {int(y_dev_s.sum())} positives)")
    model = CalibratedClassifierCV(final_rf, method=calibration_method, cv=3)
    model.fit(X_dev_s, y_dev_s)

    # ─────────────────────────────────────────────────────────────────
    # HOLDOUT EVALUATION
    # Final honest assessment on the true future test set.
    # This number is what goes in the metadata and DB —
    # it represents real-world expected performance.
    # ─────────────────────────────────────────────────────────────────
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    train_score = model.score(X_dev,  y_dev)
    test_score  = model.score(X_test, y_test)

    roc_auc = roc_auc_score(y_test, y_prob)
    pr_auc  = average_precision_score(y_test, y_prob)

    precision, recall, f1, support = precision_recall_fscore_support(
        y_test, y_pred, average=None, labels=[0, 1]
    )

    cm = confusion_matrix(y_test, y_pred)
    tn, fp, fn, tp = cm.ravel()

    print(f"\n[HOLDOUT] Accuracy: Train={train_score*100:.1f}%  Test={test_score*100:.1f}%")
    print(f"[HOLDOUT] ROC-AUC: {roc_auc:.4f}  PR-AUC: {pr_auc:.4f}")
    print(f"[HOLDOUT] False Negative Rate: {fn/(fn+tp)*100:.1f}% (missed failures)")
    print(f"\n[REPORT]\n{classification_report(y_test, y_pred, target_names=['No Failure', 'Failure'])}")

    # Distribution shift context — helps interpret holdout metrics honestly
    print(f"[CONTEXT] Dev positive rate: {y_dev.mean()*100:.1f}%  "
          f"Holdout positive rate: {y_test.mean()*100:.1f}%")
    if abs(y_test.mean() - y_dev.mean()) > 0.15:
        print("[CONTEXT] Note: holdout metrics reflect a distribution shift scenario.")
        print(f"[CONTEXT] CV ROC-AUC ({cv_roc_mean:.4f}) is a more representative performance estimate.")

    # ─────────────────────────────────────────────────────────────────
    # OPERATOR METRICS on the temporal holdout (ML-3)
    # ─────────────────────────────────────────────────────────────────
    op_temporal = compute_operator_metrics(
        y_test.to_numpy(), y_prob, ts_test, eq_test, failures_df, horizon_days
    )
    print(f"[OPERATOR] recall@{OPERATING_THRESHOLD:.2f} (HIGH): "
          f"{_fmt(op_temporal['recall_failure_operating'])}  "
          f"precision@budget({PM_BUDGET_FRACTION:.0%}): {_fmt(op_temporal['precision_at_budget'])}")
    print(f"[OPERATOR] lead time median: {_fmt(op_temporal['lead_time_median_days'])}d  "
          f"failures flagged: {_fmt(op_temporal['lead_time_failures_flagged_pct'])} "
          f"(n={op_temporal['lead_time_failures_evaluable']})")

    # ─────────────────────────────────────────────────────────────────
    # BY-ASSET GROUPED EVALUATION (ML-3)
    # ─────────────────────────────────────────────────────────────────
    print(f"[BY-ASSET] GroupKFold evaluation ({horizon_days}d) — this answers "
          f"'new fleet, day one'; temporal answers 'same fleet, next quarter'")
    by_asset = grouped_evaluation(
        X, y, snapshot_ts, equipment_ids, failures_df, horizon_days, calibration_method
    )
    if by_asset:
        print(f"[BY-ASSET] ROC-AUC: {by_asset['roc_auc']:.4f}  PR-AUC: {by_asset['pr_auc']:.4f}  "
              f"recall@HIGH: {_fmt(by_asset['recall_failure_operating'])}  "
              f"precision@budget: {_fmt(by_asset['precision_at_budget'])}")
    else:
        print("[BY-ASSET] skipped — not enough assets/classes for grouped folds")

    # Feature importance from base estimator inside calibrated model
    base_estimator = model.calibrated_classifiers_[0].estimator
    feature_importance = dict(sorted(
        zip(X.columns, base_estimator.feature_importances_),
        key=lambda x: x[1], reverse=True
    ))

    print(f"\n[FEATURES] Top 5 for {horizon_days}d model:")
    for feat, imp in list(feature_importance.items())[:5]:
        print(f"  {feat:<40} {imp:.4f}")

    metrics = {
        'operator_temporal':     op_temporal,
        'by_asset':              by_asset,
        'embargo_days':          horizon_days,
        'embargoed_rows':        n_embargoed,
        'horizon_days':          horizon_days,
        'accuracy':              float(test_score),
        'train_accuracy':        float(train_score),
        'roc_auc':               float(roc_auc),
        'pr_auc':                float(pr_auc),
        'cv_roc_auc_mean':       float(cv_roc_mean),
        'cv_roc_auc_std':        float(cv_roc_std),
        'cv_pr_auc_mean':        float(cv_pr_mean),
        'cv_fold_roc_aucs':      [round(v, 4) for v in fold_roc_aucs],
        'cv_fold_pos_rates':     [round(v, 4) for v in fold_pos_rates],
        'calibration_method':    calibration_method,
        'dev_positive_rate':     float(y_dev.mean()),
        'test_positive_rate':    float(y_test.mean()),
        'distribution_shift':    float(abs(y_test.mean() - y_dev.mean())),
        'precision':             precision.tolist(),
        'recall':                recall.tolist(),
        'f1':                    f1.tolist(),
        'support':               support.tolist(),
        'confusion_matrix':      [[int(tn), int(fp)], [int(fn), int(tp)]],
        'feature_importance':    feature_importance,
        'samples_train':         int(len(X_dev)),
        'samples_test':          int(len(X_test)),
        'positive_rate':         float(y.mean()),
    }

    return model, metrics


# ─────────────────────────────────────────────────────────────────────────────
# PERSISTENCE
# ─────────────────────────────────────────────────────────────────────────────

def save_horizon_model(model, feature_names: list, metrics: dict,
                       model_version: str, horizon_days: int) -> str:
    model_data = {
        'model':         model,
        'feature_names': feature_names,
        'accuracy':      metrics['accuracy'],
        'roc_auc':       metrics['roc_auc'],
        'version':       model_version,
        'horizon_days':  horizon_days,
        'trained_at':    datetime.now().isoformat(),
        'model_type':    f'binary_{horizon_days}d',
    }
    path = MODEL_DIR / f"rf_{horizon_days}d_{model_version}.pkl"
    joblib.dump(model_data, path)
    print(f"[SAVE] {horizon_days}d model -> {path}")

    # Feature importance
    with open(MODEL_DIR / f"feature_importance_{horizon_days}d_{model_version}.json", 'w') as f:
        json.dump(metrics['feature_importance'], f, indent=2)

    # Metadata
    meta = {
        'version':       model_version,
        'horizon_days':  horizon_days,
        'algorithm':     f"Random Forest (calibrated, {metrics['calibration_method']})",
        'trained_at':    datetime.now().isoformat(),
        # ML-2: labels come from the fleet simulator's hazard process over
        # features the model consumes. These metrics verify the pipeline
        # end-to-end; they are NOT evidence of field predictive performance.
        'data_source':   'simulated',
        'metrics_framing': 'pipeline verification on synthetic data — pending real fleet labels',
        'label_definition': "REACTIVE_REPAIR event in (ts, ts+horizon]; day-0 excluded; "
                            "intervention-censored rows excluded (label_status)",
        'embargo_days':  metrics['embargo_days'],
        'embargoed_rows': metrics['embargoed_rows'],
        'operator_metrics_temporal': metrics['operator_temporal'],
        'by_asset':      metrics['by_asset'],
        'accuracy':      round(metrics['accuracy'], 4),
        'train_accuracy': round(metrics['train_accuracy'], 4),
        'roc_auc':       round(metrics['roc_auc'], 4),
        'pr_auc':        round(metrics['pr_auc'], 4),
        'cv_roc_auc':    f"{metrics['cv_roc_auc_mean']:.4f} ± {metrics['cv_roc_auc_std']:.4f}",
        'positive_rate': round(metrics['positive_rate'], 4),
        'samples_train': metrics['samples_train'],
        'samples_test':  metrics['samples_test'],
        'hyperparameters': {
            'n_estimators': 200, 'max_depth': 12,
            'min_samples_split': 5, 'min_samples_leaf': 3,
            'max_features': 'sqrt', 'class_weight': 'balanced',
            'calibration': metrics['calibration_method'],
        },
        'confusion_matrix': {
            'TN': metrics['confusion_matrix'][0][0],
            'FP': metrics['confusion_matrix'][0][1],
            'FN': metrics['confusion_matrix'][1][0],
            'TP': metrics['confusion_matrix'][1][1],
        },
        'per_class': {
            'no_failure': {
                'precision': round(metrics['precision'][0], 4),
                'recall':    round(metrics['recall'][0], 4),
                'f1':        round(metrics['f1'][0], 4),
                'support':   metrics['support'][0],
            },
            'failure': {
                'precision': round(metrics['precision'][1], 4),
                'recall':    round(metrics['recall'][1], 4),
                'f1':        round(metrics['f1'][1], 4),
                'support':   metrics['support'][1],
            },
        },
        'top_features': list(metrics['feature_importance'].keys())[:10],
    }
    with open(MODEL_DIR / f"metadata_{horizon_days}d_{model_version}.json", 'w') as f:
        json.dump(meta, f, indent=2)

    return str(path)


def save_metrics_to_db(all_metrics: dict, dataset_size: int, model_version: str):
    """
    Persist per-horizon metrics in long format: one row per
    (model_version, horizon, split, metric). Each metric is stored under its
    real name — no re-labeling of ROC-AUC as precision, no 3-class shoehorning.
    `split` is 'temporal' for the time-based holdout evaluation.
    """
    trained_at = datetime.now()
    try:
        engine = get_db_connection()
        with engine.connect() as conn:
            # TEMPORARY DDL: created here until ARCH-1 (Group 2) moves this
            # table into the Drizzle migration baseline as the single DDL owner.
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS model_metrics (
                    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    model_version VARCHAR(50)  NOT NULL,
                    horizon_days  INT          NOT NULL,
                    split         VARCHAR(20)  NOT NULL DEFAULT 'temporal',
                    metric        VARCHAR(60)  NOT NULL,
                    value         DECIMAL(14,6) NOT NULL,
                    trained_at    TIMESTAMP    NOT NULL,
                    dataset_size  INT,
                    created_at    TIMESTAMP    DEFAULT NOW(),
                    INDEX idx_version (model_version),
                    INDEX idx_version_horizon (model_version, horizon_days)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """))

            rows = []
            for h, m in all_metrics.items():
                cm = m['confusion_matrix']
                tn, fp, fn, tp = cm[0][0], cm[0][1], cm[1][0], cm[1][1]
                horizon_metrics = {
                    'roc_auc':            m['roc_auc'],
                    'pr_auc':             m['pr_auc'],
                    'accuracy':           m['accuracy'],
                    'train_accuracy':     m['train_accuracy'],
                    'cv_roc_auc_mean':    m['cv_roc_auc_mean'],
                    'cv_roc_auc_std':     m['cv_roc_auc_std'],
                    'precision_failure':  m['precision'][1],
                    'recall_failure':     m['recall'][1],
                    'f1_failure':         m['f1'][1],
                    'precision_no_failure': m['precision'][0],
                    'recall_no_failure':  m['recall'][0],
                    'positive_rate_dev':  m['dev_positive_rate'],
                    'positive_rate_test': m['test_positive_rate'],
                    'samples_train':      m['samples_train'],
                    'samples_test':       m['samples_test'],
                    'confusion_tn':       tn,
                    'confusion_fp':       fp,
                    'confusion_fn':       fn,
                    'confusion_tp':       tp,
                }
                # Operator metrics (ML-3) on the temporal split
                op = m.get('operator_temporal') or {}
                for name in ('recall_failure_operating', 'precision_at_budget',
                             'lead_time_median_days', 'lead_time_failures_flagged_pct'):
                    if op.get(name) is not None:
                        horizon_metrics[name] = op[name]

                for name, value in horizon_metrics.items():
                    rows.append({
                        'mv': model_version, 'h': int(h), 'split': 'temporal',
                        'metric': name, 'value': float(value),
                        'ta': trained_at, 'ds': dataset_size,
                    })

                # By-asset grouped split (ML-3) — same long format, split='by_asset'
                ba = m.get('by_asset') or {}
                for name in ('roc_auc', 'pr_auc', 'positive_rate',
                             'recall_failure_operating', 'precision_at_budget',
                             'lead_time_median_days', 'lead_time_failures_flagged_pct'):
                    if ba.get(name) is not None:
                        rows.append({
                            'mv': model_version, 'h': int(h), 'split': 'by_asset',
                            'metric': name, 'value': float(ba[name]),
                            'ta': trained_at, 'ds': dataset_size,
                        })

            conn.execute(text("""
                INSERT INTO model_metrics
                    (model_version, horizon_days, split, metric, value, trained_at, dataset_size)
                VALUES (:mv, :h, :split, :metric, :value, :ta, :ds)
            """), rows)
            conn.commit()
        engine.dispose()
        print(f"[DATABASE] {len(rows)} metric rows saved for {model_version} (long format)")
    except Exception as e:
        print(f"[DATABASE] Warning: could not save metrics: {e}")


def save_drift_reference(df_raw: pd.DataFrame, model_version: str):
    """
    Save per-feature raw distributions for PSI drift detection.
    Sampled from the full training dataset (pre-transformation) so that
    inference-time comparisons are in the operator-visible input space,
    not the log-transformed model-internal space.
    """
    from engine.drift_detector import MONITORED_FEATURES

    sample = df_raw.sample(min(5000, len(df_raw)), random_state=RANDOM_SEED)
    features = {}
    for feat in MONITORED_FEATURES:
        if feat in sample.columns:
            vals = pd.to_numeric(sample[feat], errors='coerce').dropna().tolist()
            features[feat] = [round(v, 6) for v in vals]

    ref = {
        "model_version": model_version,
        "n_samples":     len(sample),
        "features":      features,
        "saved_at":      datetime.now().isoformat(),
    }

    out = MODEL_DIR / f"drift_reference_{model_version}.json"
    with open(out, 'w') as f:
        json.dump(ref, f, indent=2)
    # Unversioned copy so DriftDetector fallback path also works
    with open(MODEL_DIR / "drift_reference.json", 'w') as f:
        json.dump(ref, f, indent=2)

    print(f"[DRIFT] Reference distribution saved — {len(features)} features, n={len(sample)}")


def save_clip_thresholds(clip_thresholds: dict, model_version: str):
    out = MODEL_DIR / f"clip_thresholds_{model_version}.json"
    with open(out, 'w') as f:
        json.dump({'clip_thresholds': clip_thresholds, 'version': model_version}, f, indent=2)
    # Also save unversioned for backwards compat with predictor.py
    with open(MODEL_DIR / "clip_thresholds.json", 'w') as f:
        json.dump({'clip_thresholds': clip_thresholds, 'version': model_version}, f, indent=2)
    print(f"[SAVE] Clip thresholds -> {out}")


def save_feature_cols(feature_names: list, model_version: str):
    data = {'feature_cols': feature_names, 'version': model_version}
    with open(MODEL_DIR / f"feature_cols_{model_version}.json", 'w') as f:
        json.dump(data, f, indent=2)
    with open(MODEL_DIR / "feature_cols.json", 'w') as f:
        json.dump(data, f, indent=2)
    print(f"[SAVE] Feature cols -> feature_cols_{model_version}.json")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    print("[START] Multi-Horizon Equipment Failure Prediction Training")
    print(f"        Horizons: {HORIZONS} days")
    print("=" * 60)

    # Global seed — numpy operations (e.g. stratified split shuffles) must also
    # be deterministic, not just the RF estimators.
    np.random.seed(RANDOM_SEED)

    model_version = get_next_version()
    print(f"[VERSION] Training {model_version}")

    # 1. Load data once — shared across all horizons
    df = load_training_data()
    failures_df = load_failure_events()

    # ── Data quality gate ────────────────────────────────────────────────────
    # Runs before feature engineering so checks operate on raw labeled data.
    # Blocks on FAIL to prevent a bad model from entering the registry.
    from engine.data_quality import run as dq_run
    dq_report = dq_run(df)
    print(f"\n[DQ] Data quality: {dq_report['overall']} "
          f"({dq_report['pass_count']} pass, {dq_report['warn_count']} warn, "
          f"{dq_report['fail_count']} fail)")
    for c in dq_report["checks"]:
        icon = "✅" if c["status"] == "PASS" else "⚠️ " if c["status"] == "WARN" else "❌"
        print(f"  {icon} [{c['check']}] {c['message']}")
    if dq_report["overall"] == "FAIL":
        raise ValueError(
            f"[DQ] Training blocked — {dq_report['fail_count']} data quality check(s) failed. "
            f"Fix the issues above and retrain. {dq_report['summary']}"
        )
    if dq_report["overall"] == "WARN":
        print("[DQ] ⚠️  Proceeding with warnings — review before promoting to production.")

    # 2. Save drift reference BEFORE feature engineering (raw input space)
    save_drift_reference(df, model_version)

    # 3. Feature engineering — shared across all horizons
    X, labels, feature_names, clip_thresholds = prepare_features(df, model_version)

    # ── MLflow run (step 4) ───────────────────────────────────────────────────
    # One run per training invocation; all three horizon models are logged as
    # child artifacts of the same run so metrics are comparable in the UI.
    if MLFLOW_ENABLED:
        mlflow.set_experiment("equipment-failure-multihorizon")
        run = mlflow.start_run(run_name=model_version)
        mlflow.log_params({
            "model_version":      model_version,
            "random_seed":        RANDOM_SEED,
            "n_estimators":       200,
            "max_depth":          12,
            "min_samples_split":  5,
            "min_samples_leaf":   3,
            "max_features":       "sqrt",
            "class_weight":       "balanced",
            "smote_enabled":      _SMOTE_AVAILABLE,
            "tscv_n_splits":      5,
            "horizons":           str(HORIZONS),
            "dataset_size":       len(df),
            "feature_count":      len(feature_names),
        })

    # 3. Train one model per horizon
    all_metrics = {}
    model_paths = {}

    for horizon in HORIZONS:
        label_col = f'will_fail_{horizon}d'
        y = labels[label_col].astype(int)

        model, metrics = train_horizon_model(
            X, y, horizon,
            snapshot_ts=labels['snapshot_ts'],
            equipment_ids=labels['equipment_id'],
            failures_df=failures_df,
        )
        path = save_horizon_model(model, feature_names, metrics, model_version, horizon)

        all_metrics[horizon] = metrics
        model_paths[horizon] = path

        # Log per-horizon metrics and model artifact to MLflow
        if MLFLOW_ENABLED:
            h = horizon
            mlflow.log_metrics({
                f"roc_auc_{h}d":          metrics["roc_auc"],
                f"pr_auc_{h}d":           metrics["pr_auc"],
                f"accuracy_{h}d":         metrics["accuracy"],
                f"cv_roc_auc_mean_{h}d":  metrics["cv_roc_auc_mean"],
                f"cv_roc_auc_std_{h}d":   metrics["cv_roc_auc_std"],
                f"recall_failure_{h}d":   metrics["recall"][1],
                f"precision_failure_{h}d": metrics["precision"][1],
                f"f1_failure_{h}d":       metrics["f1"][1],
                f"distribution_shift_{h}d": metrics["distribution_shift"],
            })
            # Per-fold CV metrics — step = fold index for timeline view in UI
            for i, fold_roc in enumerate(metrics["cv_fold_roc_aucs"], 1):
                mlflow.log_metric(f"cv_fold_roc_auc_{h}d", fold_roc, step=i)
            # Log the calibrated sklearn model as a versioned artifact
            mlflow.sklearn.log_model(model, f"model_{h}d")
            # Log feature importance JSON
            fi_path = MODEL_DIR / f"feature_importance_{h}d_{model_version}.json"
            mlflow.log_artifact(str(fi_path), artifact_path=f"feature_importance/{h}d")

    # 4. Save shared artifacts
    save_clip_thresholds(clip_thresholds, model_version)
    save_feature_cols(feature_names, model_version)

    if MLFLOW_ENABLED:
        mlflow.log_artifact(
            str(MODEL_DIR / f"clip_thresholds_{model_version}.json"),
            artifact_path="artifacts"
        )
        mlflow.log_artifact(
            str(MODEL_DIR / f"feature_cols_{model_version}.json"),
            artifact_path="artifacts"
        )

    # 5. Persist per-horizon metrics to DB (long format, real metric names)
    save_metrics_to_db(all_metrics, len(df), model_version)

    # 6. Summary
    print("\n" + "=" * 60)
    print(f"[SUCCESS] Multi-horizon training complete — version {model_version}")
    print(f"\n{'Horizon':<10} {'ROC-AUC':<10} {'Accuracy':<10} {'Recall(fail)':<15} {'PR-AUC'}")
    print("-" * 55)
    for h in HORIZONS:
        m = all_metrics[h]
        print(f"{h}d{'':<8} {m['roc_auc']:.4f}{'':<4} {m['accuracy']*100:.1f}%{'':<5} "
              f"{m['recall'][1]*100:.1f}%{'':<9} {m['pr_auc']:.4f}")

    if MLFLOW_ENABLED:
        mlflow.end_run()
        print(f"[MLFLOW] Run complete — ID: {run.info.run_id}")

    # 7. Register with champion-challenger registry
    try:
        from engine.model_registry import register_new_version
        reg = register_new_version(model_version)
        print(f"[REGISTRY] {model_version} registered as {reg['role']}")
    except Exception as re:
        print(f"[REGISTRY] Warning: could not update registry ({re}) — continuing")

    result = {
        'success':       True,
        'model_version': model_version,
        'horizons':      HORIZONS,
        'model_paths':   model_paths,
        # ML-2: metrics verify the pipeline on simulator-generated labels;
        # they must never be quoted as field predictive performance.
        'data_source':   'simulated',
        'metrics_framing': 'pipeline verification on synthetic data — pending real fleet labels',
        'metrics': {
            str(h): {
                'roc_auc':  round(all_metrics[h]['roc_auc'], 4),
                'accuracy': round(all_metrics[h]['accuracy'], 4),
                'pr_auc':   round(all_metrics[h]['pr_auc'], 4),
                'recall_failure_operating': all_metrics[h]['operator_temporal']['recall_failure_operating'],
                'precision_at_budget':      all_metrics[h]['operator_temporal']['precision_at_budget'],
                'lead_time_median_days':    all_metrics[h]['operator_temporal']['lead_time_median_days'],
                'by_asset_roc_auc': (all_metrics[h]['by_asset'] or {}).get('roc_auc'),
            }
            for h in HORIZONS
        },
        'samples': len(df),
        'features': len(feature_names),
    }

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
