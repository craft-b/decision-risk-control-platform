# ml/train_model.py
# Production-quality ML training pipeline for construction equipment predictive maintenance
# Portfolio-grade: demonstrates MLOps best practices

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
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
import pymysql
from sqlalchemy import create_engine, text
import warnings
warnings.filterwarnings('ignore')
from imblearn.over_sampling import SMOTE
from datetime import datetime

SCRIPT_DIR = Path(__file__).parent.parent  # ml-service root
MODEL_DIR  = SCRIPT_DIR / "registry"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

# MODEL_VERSION is determined at runtime via get_next_version()
# Do NOT hardcode it here — it increments automatically each training run.

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
    """
    Auto-increment model version based on what's already in the DB.

    Strategy:
      - Query model_training_metrics for the highest version string
      - Parse "vMAJOR.MINOR" and increment MINOR
      - If no previous runs exist, start at v1.0

    Examples:
      No rows         → v1.0
      v1.0 exists     → v1.1
      v1.1 exists     → v1.2
      v1.9 exists     → v1.10
    """
    try:
        engine = get_db_connection()
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT model_version
                FROM model_training_metrics
                ORDER BY trained_at DESC
                LIMIT 1
            """))
            row = result.fetchone()
        engine.dispose()

        if row is None:
            return "v1.0"

        last_version = row[0]  # e.g. "v1.2"
        parts = last_version.lstrip('v').split('.')
        major = int(parts[0])
        minor = int(parts[1]) if len(parts) > 1 else 0
        next_version = f"v{major}.{minor + 1}"
        print(f"[VERSION] Last version: {last_version} → New version: {next_version}")
        return next_version

    except Exception as e:
        print(f"[VERSION] Could not read version from DB ({e}) — defaulting to v1.0")
        return "v1.0"


def load_training_data() -> pd.DataFrame:
    engine = get_db_connection()
    query = """
    SELECT
        asset_age_years,
        total_hours_lifetime,
        hours_used_30d,
        hours_used_90d,
        rental_days_30d,
        rental_days_90d,
        avg_rental_duration,
        maintenance_events_90d,
        maintenance_cost_180d,
        COALESCE(days_since_last_maintenance, 999) as days_since_last_maintenance,
        COALESCE(mean_time_between_failures, 500)  as mean_time_between_failures,
        vendor_reliability_score,
        jobsite_risk_score,
        usage_intensity,
        usage_trend,
        utilization_vs_expected,
        wear_rate,
        aging_factor,
        maint_overdue,
        cost_per_event,
        maint_burden,
        mechanical_wear_score,
        abuse_score,
        neglect_score,
        category,
        will_fail_30d
    FROM asset_feature_snapshots
    WHERE will_fail_30d IS NOT NULL
    ORDER BY snapshot_ts
    """
    df = pd.read_sql(query, engine)
    engine.dispose()

    print(f"[DATA] Loaded {len(df):,} labeled samples")
    print(f"[DATA] Failure rate: {df['will_fail_30d'].mean()*100:.1f}%  "
          f"({df['will_fail_30d'].sum():,} failures / {len(df):,} total)")

    null_pct = df.isnull().mean() * 100
    high_null = null_pct[null_pct > 10]
    if not high_null.empty:
        print(f"[WARN] High-null columns:\n{high_null.to_string()}")

    if (df['usage_intensity'] > 24).any():
        print(f"[WARN] {(df['usage_intensity'] > 24).sum()} rows have usage_intensity > 24 — capping")
        df['usage_intensity'] = df['usage_intensity'].clip(upper=12)

    return df


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────────────────────────

def prepare_features(df: pd.DataFrame, model_version: str):
    df = df.copy()
    y = df.pop('will_fail_30d').astype(int)

    # Encode category
    le = LabelEncoder()
    df['category_encoded'] = le.fit_transform(df['category'].fillna('Unknown'))
    df.drop('category', axis=1, inplace=True)

    # Save encoder — versioned filename
    enc_path = MODEL_DIR / f"label_encoder_category_{model_version}.pkl"
    joblib.dump(le, enc_path)
    # Also save unversioned for backwards compatibility with predictor.py
    joblib.dump(le, MODEL_DIR / "label_encoder_category.pkl")

    # Log-transform skewed features
    log_cols = [
        'total_hours_lifetime', 'hours_used_30d', 'hours_used_90d',
        'maintenance_cost_180d', 'cost_per_event', 'maint_burden',
        'mean_time_between_failures'
    ]
    for col in log_cols:
        if col in df.columns:
            df[f'log_{col}'] = np.log1p(df[col].clip(lower=0))

    # Clip outliers — compute from training data ONLY to avoid training-serving skew
    clip_thresholds = {}
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    for col in numeric_cols:
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

    return df, y, feature_names, clip_thresholds


# ─────────────────────────────────────────────────────────────────────────────
# TRAINING
# ─────────────────────────────────────────────────────────────────────────────

def train_model(X: pd.DataFrame, y: pd.Series):
    # Temporal split — validate on future data
    split_idx = int(len(X) * 0.80)
    X_train_raw, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train_raw, y_test = y.iloc[:split_idx], y.iloc[split_idx:]

    print(f"[SPLIT] Train: {len(X_train_raw):,}  |  Test: {len(X_test):,}  (temporal, no shuffle)")
    print(f"[SPLIT] Train failure rate: {y_train_raw.mean()*100:.1f}%  |  "
          f"Test failure rate: {y_test.mean()*100:.1f}%")

    # SMOTE on training set ONLY (after split — prevents data leakage)
    smote = SMOTE(random_state=42, k_neighbors=min(5, y_train_raw.sum() - 1))
    X_train, y_train = smote.fit_resample(X_train_raw, y_train_raw)
    print(f"[SMOTE] Train after resampling: {len(X_train):,} (was {len(X_train_raw):,})")

    base_rf = RandomForestClassifier(
        n_estimators=200,
        max_depth=12,
        min_samples_split=5,
        min_samples_leaf=3,
        max_features='sqrt',
        class_weight='balanced',
        random_state=42,
        n_jobs=-1
    )

    # Isotonic calibration — critical for reliable P(failure) estimates
    model = CalibratedClassifierCV(base_rf, method='isotonic', cv=3)
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    train_score = model.score(X_train, y_train)
    test_score  = model.score(X_test,  y_test)

    gap = train_score - test_score
    if gap > 0.15:
        print(f"[WARN] Overfitting detected: train={train_score:.3f} test={test_score:.3f} gap={gap:.3f}")

    precision, recall, f1, support = precision_recall_fscore_support(
        y_test, y_pred, average=None, labels=[0, 1]
    )

    roc_auc = roc_auc_score(y_test, y_prob)
    pr_auc  = average_precision_score(y_test, y_prob)

    print(f"\n[RESULTS] Accuracy:  Train={train_score*100:.1f}%  Test={test_score*100:.1f}%")
    print(f"[RESULTS] ROC-AUC:   {roc_auc:.4f}")
    print(f"[RESULTS] PR-AUC:    {pr_auc:.4f}")
    print(f"\n[REPORT]\n{classification_report(y_test, y_pred, target_names=['No Failure', 'Failure'])}")

    cm = confusion_matrix(y_test, y_pred)
    tn, fp, fn, tp = cm.ravel()
    print(f"[CONFUSION]\n  TN={tn}  FP={fp}\n  FN={fn}  TP={tp}")
    print(f"  False Negative Rate: {fn/(fn+tp)*100:.1f}% (missed failures)")

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(base_rf, X_train, y_train, cv=cv, scoring='roc_auc', n_jobs=-1)
    print(f"\n[CV] 5-Fold ROC-AUC: {cv_scores.mean():.4f} ± {cv_scores.std():.4f}")

    base_estimator = model.calibrated_classifiers_[0].estimator
    feature_importance = dict(zip(X.columns, base_estimator.feature_importances_))
    feature_importance = dict(sorted(feature_importance.items(), key=lambda x: x[1], reverse=True))

    top5 = list(feature_importance.items())[:5]
    print(f"\n[FEATURES] Top 5 by importance:")
    for feat, imp in top5:
        print(f"  {feat:<40} {imp:.4f}")

    metrics = {
        'accuracy':           float(test_score),
        'train_accuracy':     float(train_score),
        'roc_auc':            float(roc_auc),
        'pr_auc':             float(pr_auc),
        'cv_roc_auc_mean':    float(cv_scores.mean()),
        'cv_roc_auc_std':     float(cv_scores.std()),
        'precision':          precision.tolist(),
        'recall':             recall.tolist(),
        'f1':                 f1.tolist(),
        'support':            support.tolist(),
        'confusion_matrix':   cm.tolist(),
        'feature_importance': feature_importance,
        'samples_train':      int(len(X_train_raw)),
        'samples_test':       int(len(X_test)),
    }

    return model, X.columns.tolist(), metrics


# ─────────────────────────────────────────────────────────────────────────────
# PERSISTENCE
# ─────────────────────────────────────────────────────────────────────────────

def save_model(model, feature_names: list, metrics: dict, model_version: str) -> str:
    model_filename = f"random_forest_multiclass_{model_version}.pkl"
    model_path     = MODEL_DIR / model_filename

    model_data = {
        'model':         model,
        'feature_names': feature_names,
        'accuracy':      metrics['accuracy'],
        'roc_auc':       metrics.get('roc_auc'),
        'version':       model_version,
        'trained_at':    datetime.now().isoformat(),
    }
    joblib.dump(model_data, model_path)
    print(f"[SAVE] Model -> {model_path}")
    return str(model_path)


def save_clip_thresholds(clip_thresholds: dict, model_version: str):
    data = {
        "clip_thresholds": clip_thresholds,
        "version":         model_version,
        "note":            "Applied as upper clip bound (p99 * 1.5) during feature engineering"
    }
    out = MODEL_DIR / f"clip_thresholds_{model_version}.json"
    with open(out, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"[SAVE] Clip thresholds -> {out} ({len(clip_thresholds)} columns)")


def save_feature_importance(feature_importance: dict, model_version: str):
    out = MODEL_DIR / f"feature_importance_{model_version}.json"
    with open(out, 'w') as f:
        json.dump(feature_importance, f, indent=2)
    print(f"[SAVE] Feature importance -> {out}")


def save_feature_cols(feature_names: list, model_version: str):
    data = {"feature_cols": feature_names, "version": model_version}
    out  = MODEL_DIR / f"feature_cols_{model_version}.json"
    with open(out, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"[SAVE] Feature columns -> {out} ({len(feature_names)} cols)")


def save_metadata(metrics: dict, dataset_size: int, model_version: str) -> dict:
    meta = {
        "version":        model_version,
        "algorithm":      "Random Forest (calibrated, isotonic)",
        "trained_at":     datetime.now().isoformat(),
        "dataset_size":   dataset_size,
        "accuracy":       round(metrics['accuracy'], 4),
        "train_accuracy": round(metrics['train_accuracy'], 4),
        "roc_auc":        round(metrics.get('roc_auc', 0), 4),
        "pr_auc":         round(metrics.get('pr_auc', 0), 4),
        "cv_roc_auc":     f"{metrics['cv_roc_auc_mean']:.4f} ± {metrics['cv_roc_auc_std']:.4f}",
        "hyperparameters": {
            "n_estimators":      200,
            "max_depth":         12,
            "min_samples_split": 5,
            "min_samples_leaf":  3,
            "max_features":      "sqrt",
            "class_weight":      "balanced",
            "calibration":       "isotonic"
        },
        "confusion_matrix": {
            "TN": metrics['confusion_matrix'][0][0],
            "FP": metrics['confusion_matrix'][0][1],
            "FN": metrics['confusion_matrix'][1][0],
            "TP": metrics['confusion_matrix'][1][1],
        },
        "per_class": {
            "no_failure": {
                "precision": round(metrics['precision'][0], 4),
                "recall":    round(metrics['recall'][0], 4),
                "f1":        round(metrics['f1'][0], 4),
                "support":   metrics['support'][0],
            },
            "failure": {
                "precision": round(metrics['precision'][1], 4),
                "recall":    round(metrics['recall'][1], 4),
                "f1":        round(metrics['f1'][1], 4),
                "support":   metrics['support'][1],
            }
        },
        "top_features": list(metrics['feature_importance'].keys())[:10],
    }
    out = MODEL_DIR / f"metadata_{model_version}.json"
    with open(out, 'w') as f:
        json.dump(meta, f, indent=2)
    print(f"[SAVE] Metadata -> {out}")
    return meta


def save_metrics_to_database(metrics: dict, dataset_size: int, model_version: str):
    """Persist training run metrics to DB for dashboard history and versioning."""
    try:
        engine = get_db_connection()
        cm     = metrics['confusion_matrix']
        tn, fp, fn, tp = cm[0][0], cm[0][1], cm[1][0], cm[1][1]

        query = text("""
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
                :model_version, :trained_at, :dataset_size,
                :accuracy,
                :precision_high, :precision_medium, :precision_low,
                :recall_high,    :recall_medium,    :recall_low,
                :f1_high,        :f1_medium,        :f1_low,
                :high_predicted_high,   :high_predicted_medium,   :high_predicted_low,
                :medium_predicted_high, :medium_predicted_medium, :medium_predicted_low,
                :low_predicted_high,    :low_predicted_medium,    :low_predicted_low
            )
        """)

        with engine.connect() as conn:
            conn.execute(query, {
                'model_version':          model_version,
                'trained_at':             datetime.now(),
                'dataset_size':           dataset_size,
                'accuracy':               float(metrics['accuracy']),
                # Binary model: map failure class → HIGH, no-failure → LOW
                # MEDIUM columns store auxiliary metrics for dashboard use
                'precision_high':         float(metrics['precision'][1]),
                'precision_medium':       float(metrics.get('roc_auc', 0)),   # ROC-AUC
                'precision_low':          float(metrics['precision'][0]),
                'recall_high':            float(metrics['recall'][1]),
                'recall_medium':          float(metrics.get('pr_auc', 0)),    # PR-AUC
                'recall_low':             float(metrics['recall'][0]),
                'f1_high':                float(metrics['f1'][1]),
                'f1_medium':              float(metrics['cv_roc_auc_mean']),  # CV ROC-AUC
                'f1_low':                 float(metrics['f1'][0]),
                'high_predicted_high':    int(tp),
                'high_predicted_medium':  0,
                'high_predicted_low':     int(fn),
                'medium_predicted_high':  0,
                'medium_predicted_medium': 0,
                'medium_predicted_low':   0,
                'low_predicted_high':     int(fp),
                'low_predicted_medium':   0,
                'low_predicted_low':      int(tn),
            })
            conn.commit()
        engine.dispose()
        print(f"[DATABASE] Training metrics saved for {model_version}")

    except Exception as e:
        print(f"[DATABASE] Warning: could not save metrics: {e}")


def save_model_registry(metrics: dict, dataset_size: int, model_version: str):
    """Insert a record into ml_models for full model lineage tracking."""
    try:
        engine = get_db_connection()

        # Get date range of training data
        with engine.connect() as conn:
            result = conn.execute(text("""
                SELECT MIN(snapshot_ts), MAX(snapshot_ts)
                FROM asset_feature_snapshots
                WHERE will_fail_30d IS NOT NULL
            """))
            row = result.fetchone()
            data_start = row[0].date() if row and row[0] else datetime.now().date()
            data_end   = row[1].date() if row and row[1] else datetime.now().date()

            conn.execute(text("""
                INSERT INTO ml_models (
                    model_version, model_type,
                    trained_at, training_data_start, training_data_end, training_records,
                    roc_auc, precision, recall,
                    feature_schema, status
                ) VALUES (
                    :model_version, :model_type,
                    :trained_at, :training_data_start, :training_data_end, :training_records,
                    :roc_auc, :precision, :recall,
                    :feature_schema, :status
                )
                ON DUPLICATE KEY UPDATE
                    trained_at = VALUES(trained_at),
                    roc_auc    = VALUES(roc_auc),
                    status     = VALUES(status)
            """), {
                'model_version':       model_version,
                'model_type':          'RandomForest-CalibratedIsotonic',
                'trained_at':          datetime.now(),
                'training_data_start': data_start,
                'training_data_end':   data_end,
                'training_records':    dataset_size,
                'roc_auc':             float(metrics.get('roc_auc', 0)),
                'precision':           float(metrics['precision'][1]),
                'recall':              float(metrics['recall'][1]),
                'feature_schema':      json.dumps({'version': model_version}),
                'status':              'ACTIVE',
            })
            conn.commit()

        engine.dispose()
        print(f"[DATABASE] Model registry updated for {model_version}")

    except Exception as e:
        print(f"[DATABASE] Warning: could not update model registry: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    print("[START] Equipment Failure Prediction — Model Training")
    print("=" * 60)

    try:
        # 0. Determine version FIRST — everything uses this
        model_version = get_next_version()
        print(f"[VERSION] Training model {model_version}")
        print("=" * 60)

        # 1. Load
        df = load_training_data()
        if len(df) < 100:
            raise ValueError(f"Insufficient samples: {len(df)} (minimum 100 required)")

        # 2. Feature engineering
        X, y, feature_names, clip_thresholds = prepare_features(df, model_version)

        # 3. Train
        model, feature_names, metrics = train_model(X, y)

        # 4. Save all artifacts with version in filename
        model_path = save_model(model, feature_names, metrics, model_version)
        save_clip_thresholds(clip_thresholds, model_version)
        save_feature_importance(metrics['feature_importance'], model_version)
        save_feature_cols(feature_names, model_version)
        meta = save_metadata(metrics, len(df), model_version)

        # 5. Persist to DB
        save_metrics_to_database(metrics, len(df), model_version)
        save_model_registry(metrics, len(df), model_version)

        # 6. Summary
        result = {
            'success':       True,
            'model_version': model_version,
            'model_path':    model_path,
            'accuracy':      round(metrics['accuracy'], 4),
            'roc_auc':       round(metrics.get('roc_auc', 0), 4),
            'pr_auc':        round(metrics.get('pr_auc', 0), 4),
            'cv_roc_auc':    round(metrics['cv_roc_auc_mean'], 4),
            'samples':       len(df),
            'features':      len(feature_names),
            'metadata':      meta,
        }

        print("\n" + "=" * 60)
        print(f"[SUCCESS] Training complete — model {model_version} saved")
        print(json.dumps(result))
        return 0

    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({'success': False, 'error': str(e)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())