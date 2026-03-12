# ml-service/training/train_model_multihorizon.py
# Multi-horizon failure prediction: trains separate models for 10d, 30d, 60d windows.
# Each model is a calibrated Random Forest binary classifier.
# Artifacts saved with horizon suffix: rf_10d_vX.Y.pkl, rf_30d_vX.Y.pkl, rf_60d_vX.Y.pkl

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, TimeSeriesSplit, cross_val_score
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
from datetime import datetime

SCRIPT_DIR = Path(__file__).parent.parent  # ml-service root
MODEL_DIR  = SCRIPT_DIR / "registry"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

HORIZONS = [10, 30, 60]  # days

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
            result = conn.execute(text(
                "SELECT model_version FROM model_training_metrics ORDER BY trained_at DESC LIMIT 1"
            ))
            row = result.fetchone()
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
        f'COALESCE(days_since_last_maintenance, 999) as days_since_last_maintenance'
        if col == 'days_since_last_maintenance'
        else f'COALESCE(mean_time_between_failures, 500) as mean_time_between_failures'
        if col == 'mean_time_between_failures'
        else f'COALESCE(wear_rate_velocity, 0) as wear_rate_velocity'
        if col == 'wear_rate_velocity'
        else f'COALESCE(maint_frequency_trend, 1.0) as maint_frequency_trend'
        if col == 'maint_frequency_trend'
        else f'COALESCE(cost_trend, 1.0) as cost_trend'
        if col == 'cost_trend'
        else f'COALESCE(hours_velocity, 1.0) as hours_velocity'
        if col == 'hours_velocity'
        else f'COALESCE(neglect_acceleration, 1.0) as neglect_acceleration'
        if col == 'neglect_acceleration'
        else f'COALESCE(sensor_degradation_rate, 0) as sensor_degradation_rate'
        if col == 'sensor_degradation_rate'
        else col
        for col in FEATURE_COLS
    ])
    query = f"""
    SELECT
        {feature_sql},
        will_fail_10d,
        will_fail_30d,
        will_fail_60d,
        snapshot_ts
    FROM asset_feature_snapshots
    WHERE will_fail_10d IS NOT NULL
      AND will_fail_30d IS NOT NULL
      AND will_fail_60d IS NOT NULL
    ORDER BY snapshot_ts
    """
    df = pd.read_sql(query, engine)
    engine.dispose()

    print(f"[DATA] Loaded {len(df):,} fully labeled samples")
    for h in HORIZONS:
        col = f'will_fail_{h}d'
        rate = df[col].mean() * 100
        pos  = df[col].sum()
        print(f"[DATA]   {h}d: {rate:.1f}% positive ({pos:,} / {len(df):,})")

    # Cap usage_intensity outliers
    if (df['usage_intensity'] > 24).any():
        df['usage_intensity'] = df['usage_intensity'].clip(upper=12)

    return df


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE ENGINEERING  (shared across all three horizons)
# ─────────────────────────────────────────────────────────────────────────────

def prepare_features(df: pd.DataFrame, model_version: str):
    df = df.copy()

    # Drop label columns and timestamp — keep only features
    label_cols = ['will_fail_10d', 'will_fail_30d', 'will_fail_60d', 'snapshot_ts']
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
# TRAINING — one model per horizon
# ─────────────────────────────────────────────────────────────────────────────

def train_horizon_model(X: pd.DataFrame, y: pd.Series, horizon_days: int):
    print(f"\n{'='*60}")
    print(f"[TRAIN] Horizon: {horizon_days}d  |  Positive rate: {y.mean()*100:.1f}%")

    # ─────────────────────────────────────────────────────────────────
    # TEMPORAL HOLDOUT
    # Final 20% of timeline is held out as the true test set.
    # This data is never seen during training or CV — it simulates
    # deploying the model and evaluating on genuinely future data.
    # ─────────────────────────────────────────────────────────────────
    holdout_idx = int(len(X) * 0.80)
    X_dev,  X_test = X.iloc[:holdout_idx].copy(), X.iloc[holdout_idx:].copy()
    y_dev,  y_test = y.iloc[:holdout_idx].copy(), y.iloc[holdout_idx:].copy()

    print(f"[SPLIT] Dev: {len(X_dev):,}  Holdout test: {len(X_test):,}")
    print(f"[SPLIT] Dev positive:  {y_dev.mean()*100:.1f}%")
    print(f"[SPLIT] Test positive: {y_test.mean()*100:.1f}%")

    pos_rate_gap = abs(y_test.mean() - y_dev.mean())
    if pos_rate_gap > 0.15:
        print(f"[SPLIT] ⚠️  Distribution shift detected: {pos_rate_gap:.1%} gap between dev and test.")
        print(f"[SPLIT]    This is expected for {horizon_days}d horizon — equipment ages over simulation.")
        print(f"[SPLIT]    TimeSeriesSplit CV handles this correctly by training on progressively later folds.")

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
        random_state=42,
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

        base_rf.fit(X_fold_train, y_fold_train)

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
        print(f"[CV]    Consider feature engineering improvements or regularization.")
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
        random_state=42,
        n_jobs=-1,
    )
    model = CalibratedClassifierCV(final_rf, method=calibration_method, cv=3)
    model.fit(X_dev, y_dev)

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
        print(f"[CONTEXT] Note: holdout metrics reflect a distribution shift scenario.")
        print(f"[CONTEXT] CV ROC-AUC ({cv_roc_mean:.4f}) is a more representative performance estimate.")

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
        'algorithm':     'Random Forest (calibrated, isotonic)',
        'trained_at':    datetime.now().isoformat(),
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
            'calibration': 'isotonic',
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


def save_multihorizon_metrics_to_db(all_metrics: dict, dataset_size: int, model_version: str):
    """Save a summary row to model_training_metrics using the 30d model as the primary."""
    try:
        engine = get_db_connection()
        m30 = all_metrics[30]
        cm  = m30['confusion_matrix']
        tn, fp, fn, tp = cm[0][0], cm[0][1], cm[1][0], cm[1][1]

        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO model_training_metrics (
                    model_version, trained_at, dataset_size,
                    accuracy,
                    precision_high, precision_medium, precision_low,
                    recall_high,    recall_medium,    recall_low,
                    f1_high,        f1_medium,        f1_low,
                    high_predicted_high,   high_predicted_medium,   high_predicted_low,
                    medium_predicted_high, medium_predicted_medium, medium_predicted_low,
                    low_predicted_high,    low_predicted_medium,    low_predicted_low
                ) VALUES (
                    :mv, :ta, :ds, :acc,
                    :ph, :pm, :pl,
                    :rh, :rm, :rl,
                    :fh, :fm, :fl,
                    :hhh, :hhm, :hhl,
                    :hmh, :hmm, :hml,
                    :hlh, :hlm, :hll
                )
            """), {
                'mv':  model_version,
                'ta':  datetime.now(),
                'ds':  dataset_size,
                'acc': float(m30['accuracy']),
                # Store ROC-AUC per horizon in precision/recall/f1 slots
                'ph':  float(m30['roc_auc']),
                'pm':  float(all_metrics[10]['roc_auc']),
                'pl':  float(all_metrics[60]['roc_auc']),
                'rh':  float(m30['recall'][1]),
                'rm':  float(all_metrics[10]['recall'][1]),
                'rl':  float(all_metrics[60]['recall'][1]),
                'fh':  float(m30['f1'][1]),
                'fm':  float(all_metrics[10]['f1'][1]),
                'fl':  float(all_metrics[60]['f1'][1]),
                'hhh': int(tp),  'hhm': 0,  'hhl': int(fn),
                'hmh': 0,        'hmm': 0,  'hml': 0,
                'hlh': int(fp),  'hlm': 0,  'hll': int(tn),
            })
            conn.commit()
        engine.dispose()
        print(f"[DATABASE] Multi-horizon metrics saved for {model_version}")
    except Exception as e:
        print(f"[DATABASE] Warning: could not save metrics: {e}")


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

    model_version = get_next_version()
    print(f"[VERSION] Training {model_version}")

    # 1. Load data once — shared across all horizons
    df = load_training_data()
    if len(df) < 500:
        raise ValueError(f"Insufficient samples: {len(df)} (minimum 500 required)")

    # 2. Feature engineering — shared across all horizons
    X, labels, feature_names, clip_thresholds = prepare_features(df, model_version)

    # 3. Train one model per horizon
    all_metrics = {}
    model_paths = {}

    for horizon in HORIZONS:
        label_col = f'will_fail_{horizon}d'
        y = labels[label_col].astype(int)

        model, metrics = train_horizon_model(X, y, horizon)
        path = save_horizon_model(model, feature_names, metrics, model_version, horizon)

        all_metrics[horizon] = metrics
        model_paths[horizon] = path

    # 4. Save shared artifacts
    save_clip_thresholds(clip_thresholds, model_version)
    save_feature_cols(feature_names, model_version)

    # 5. Persist summary to DB (uses 30d model as primary)
    save_multihorizon_metrics_to_db(all_metrics, len(df), model_version)

    # 6. Summary
    print("\n" + "=" * 60)
    print(f"[SUCCESS] Multi-horizon training complete — version {model_version}")
    print(f"\n{'Horizon':<10} {'ROC-AUC':<10} {'Accuracy':<10} {'Recall(fail)':<15} {'PR-AUC'}")
    print("-" * 55)
    for h in HORIZONS:
        m = all_metrics[h]
        print(f"{h}d{'':<8} {m['roc_auc']:.4f}{'':<4} {m['accuracy']*100:.1f}%{'':<5} "
              f"{m['recall'][1]*100:.1f}%{'':<9} {m['pr_auc']:.4f}")

    result = {
        'success':       True,
        'model_version': model_version,
        'horizons':      HORIZONS,
        'model_paths':   model_paths,
        'metrics': {
            str(h): {
                'roc_auc':  round(all_metrics[h]['roc_auc'], 4),
                'accuracy': round(all_metrics[h]['accuracy'], 4),
                'pr_auc':   round(all_metrics[h]['pr_auc'], 4),
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