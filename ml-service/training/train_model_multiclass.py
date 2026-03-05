# ml-service/training/train_model_multiclass.py
# Retrains as a TRUE 3-class model: LOW / MEDIUM / HIGH
# Labels are derived from composite feature thresholds (no 30d binary label)
# This replaces the binary failure model with a directly interpretable risk classifier.

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.metrics import classification_report, confusion_matrix, precision_recall_fscore_support
from sklearn.preprocessing import LabelEncoder
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

LABEL_MAP = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
LABEL_INV = {0: "LOW", 1: "MEDIUM", 2: "HIGH"}


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
# LABELING — core of the multiclass approach
# Rules derived from domain knowledge + feature importance from v1.1
# ─────────────────────────────────────────────────────────────────────────────

def assign_risk_label(row) -> str:
    """
    Assign HIGH/MEDIUM/LOW based on composite feature thresholds.
    Priority: HIGH > MEDIUM > LOW (first match wins).
    """
    wear         = row.get('mechanical_wear_score', 0) or 0
    neglect      = row.get('neglect_score', 0) or 0
    days_maint   = row.get('days_since_last_maintenance', 0) or 0
    overdue      = row.get('maint_overdue', 0) or 0
    age          = row.get('asset_age_years', 0) or 0
    will_fail    = row.get('will_fail_30d', 0) or 0
    maint_burden = row.get('maint_burden', 0) or 0
    hours        = row.get('total_hours_lifetime', 0) or 0

    # HIGH
    if will_fail == 1 and wear >= 2.0:                return 'HIGH'
    if wear >= 3.5:                                   return 'HIGH'
    if neglect >= 3.0 and days_maint > 60:            return 'HIGH'
    if days_maint > 120 and overdue:                  return 'HIGH'
    if wear >= 2.5 and neglect >= 2.0 and age >= 3.0: return 'HIGH'
    if hours > 4000 and wear >= 2.5:                  return 'HIGH'
    if maint_burden > 3.5 and wear >= 2.0:            return 'HIGH'

    # LOW
    if age < 1.5 and days_maint < 30 and wear < 1.0:     return 'LOW'
    if days_maint < 20 and wear < 0.8 and neglect < 0.5: return 'LOW'
    if hours < 500 and age < 2.0 and neglect < 1.0:      return 'LOW'
    if wear < 0.5 and neglect < 0.5 and not overdue:     return 'LOW'

    return 'MEDIUM'


# ─────────────────────────────────────────────────────────────────────────────
# DATA LOADING
# ─────────────────────────────────────────────────────────────────────────────

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
    return df


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────────────────────────

def prepare_features(df: pd.DataFrame, model_version: str):
    df = df.copy()

    # Assign multiclass labels
    df['risk_label'] = df.apply(assign_risk_label, axis=1)
    
    dist = df['risk_label'].value_counts()
    print(f"[LABELS] Distribution: HIGH={dist.get('HIGH',0):,}  MEDIUM={dist.get('MEDIUM',0):,}  LOW={dist.get('LOW',0):,}")
    
    y = df.pop('risk_label').map(LABEL_MAP)
    df.drop('will_fail_30d', axis=1, inplace=True)

    # Encode category
    le = LabelEncoder()
    df['category_encoded'] = le.fit_transform(df['category'].fillna('Unknown'))
    df.drop('category', axis=1, inplace=True)
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
            df[f'log_{col}'] = np.log1p(df[col].clip(lower=0))

    # Clip outliers
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

    print(f"[FEATURES] {len(df.columns)} features after engineering")
    return df, y, df.columns.tolist(), clip_thresholds


# ─────────────────────────────────────────────────────────────────────────────
# TRAINING
# ─────────────────────────────────────────────────────────────────────────────

def train_model(X: pd.DataFrame, y: pd.Series):
    split_idx = int(len(X) * 0.80)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]

    print(f"[SPLIT] Train: {len(X_train):,}  |  Test: {len(X_test):,}")
    print(f"[SPLIT] Train dist: {y_train.value_counts().to_dict()}")
    print(f"[SPLIT] Test dist:  {y_test.value_counts().to_dict()}")

    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=15,
        min_samples_split=5,
        min_samples_leaf=2,
        max_features='sqrt',
        class_weight='balanced',
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)

    train_score = model.score(X_train, y_train)
    test_score  = model.score(X_test, y_test)

    target_names = ['LOW', 'MEDIUM', 'HIGH']
    print(f"\n[RESULTS] Accuracy: Train={train_score*100:.1f}%  Test={test_score*100:.1f}%")
    print(f"\n[REPORT]\n{classification_report(y_test, y_pred, target_names=target_names)}")

    cm = confusion_matrix(y_test, y_pred, labels=[0, 1, 2])
    print(f"[CONFUSION MATRIX] (rows=actual, cols=predicted)")
    print(f"           LOW  MED  HIGH")
    for i, row_label in enumerate(['LOW', 'MED', 'HIGH']):
        print(f"  {row_label:>5}:  {cm[i][0]:4d} {cm[i][1]:4d}  {cm[i][2]:4d}")

    precision, recall, f1, support = precision_recall_fscore_support(
        y_test, y_pred, labels=[0, 1, 2], average=None
    )

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(model, X_train, y_train, cv=cv, scoring='accuracy', n_jobs=-1)
    print(f"\n[CV] 5-Fold Accuracy: {cv_scores.mean():.4f} ± {cv_scores.std():.4f}")

    feature_importance = dict(sorted(
        zip(X.columns, model.feature_importances_),
        key=lambda x: x[1], reverse=True
    ))

    print(f"\n[FEATURES] Top 5:")
    for feat, imp in list(feature_importance.items())[:5]:
        print(f"  {feat:<40} {imp:.4f}")

    metrics = {
        'accuracy':           float(test_score),
        'train_accuracy':     float(train_score),
        'cv_accuracy_mean':   float(cv_scores.mean()),
        'cv_accuracy_std':    float(cv_scores.std()),
        'precision':          precision.tolist(),   # [LOW, MEDIUM, HIGH]
        'recall':             recall.tolist(),
        'f1':                 f1.tolist(),
        'support':            support.tolist(),
        'confusion_matrix':   cm.tolist(),
        'feature_importance': feature_importance,
        'samples_train':      int(len(X_train)),
        'samples_test':       int(len(X_test)),
    }

    return model, X.columns.tolist(), metrics


# ─────────────────────────────────────────────────────────────────────────────
# PERSISTENCE
# ─────────────────────────────────────────────────────────────────────────────

def save_all(model, feature_names, metrics, dataset_size, model_version, clip_thresholds):
    # Model pkl
    model_data = {
        'model':         model,
        'feature_names': feature_names,
        'accuracy':      metrics['accuracy'],
        'version':       model_version,
        'trained_at':    datetime.now().isoformat(),
        'model_type':    'multiclass',   # flag for predictor.py
        'label_map':     LABEL_MAP,
        'label_inv':     LABEL_INV,
    }
    model_path = MODEL_DIR / f"random_forest_multiclass_{model_version}.pkl"
    joblib.dump(model_data, model_path)
    print(f"[SAVE] Model -> {model_path}")

    # Clip thresholds
    with open(MODEL_DIR / f"clip_thresholds_{model_version}.json", 'w') as f:
        json.dump({"clip_thresholds": clip_thresholds, "version": model_version}, f, indent=2)

    # Feature importance
    with open(MODEL_DIR / f"feature_importance_{model_version}.json", 'w') as f:
        json.dump(metrics['feature_importance'], f, indent=2)

    # Feature cols
    with open(MODEL_DIR / f"feature_cols_{model_version}.json", 'w') as f:
        json.dump({"feature_cols": feature_names, "version": model_version}, f, indent=2)

    # Metadata
    cm = metrics['confusion_matrix']
    meta = {
        "version":        model_version,
        "algorithm":      "Random Forest (multiclass: LOW/MEDIUM/HIGH)",
        "trained_at":     datetime.now().isoformat(),
        "dataset_size":   dataset_size,
        "accuracy":       round(metrics['accuracy'], 4),
        "train_accuracy": round(metrics['train_accuracy'], 4),
        "cv_accuracy":    f"{metrics['cv_accuracy_mean']:.4f} ± {metrics['cv_accuracy_std']:.4f}",
        "hyperparameters": {
            "n_estimators": 300, "max_depth": 15,
            "min_samples_split": 5, "min_samples_leaf": 2,
            "max_features": "sqrt", "class_weight": "balanced",
        },
        "confusion_matrix": {
            "LOW":    {"predictedLOW": cm[0][0], "predictedMEDIUM": cm[0][1], "predictedHIGH": cm[0][2]},
            "MEDIUM": {"predictedLOW": cm[1][0], "predictedMEDIUM": cm[1][1], "predictedHIGH": cm[1][2]},
            "HIGH":   {"predictedLOW": cm[2][0], "predictedMEDIUM": cm[2][1], "predictedHIGH": cm[2][2]},
        },
        "per_class": {
            "LOW":    {"precision": round(metrics['precision'][0], 4), "recall": round(metrics['recall'][0], 4), "f1": round(metrics['f1'][0], 4), "support": metrics['support'][0]},
            "MEDIUM": {"precision": round(metrics['precision'][1], 4), "recall": round(metrics['recall'][1], 4), "f1": round(metrics['f1'][1], 4), "support": metrics['support'][1]},
            "HIGH":   {"precision": round(metrics['precision'][2], 4), "recall": round(metrics['recall'][2], 4), "f1": round(metrics['f1'][2], 4), "support": metrics['support'][2]},
        },
        "top_features": list(metrics['feature_importance'].keys())[:10],
    }
    with open(MODEL_DIR / f"metadata_{model_version}.json", 'w') as f:
        json.dump(meta, f, indent=2)
    print(f"[SAVE] Metadata -> metadata_{model_version}.json")

    # DB
    try:
        engine = get_db_connection()
        with engine.connect() as conn:
            conn.execute(text("""
                INSERT INTO model_training_metrics (
                    model_version, trained_at, dataset_size, accuracy,
                    precision_high, precision_medium, precision_low,
                    recall_high, recall_medium, recall_low,
                    f1_high, f1_medium, f1_low,
                    high_predicted_high, high_predicted_medium, high_predicted_low,
                    medium_predicted_high, medium_predicted_medium, medium_predicted_low,
                    low_predicted_high, low_predicted_medium, low_predicted_low
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
                'mv': model_version, 'ta': datetime.now(), 'ds': dataset_size,
                'acc': float(metrics['accuracy']),
                'ph': float(metrics['precision'][2]), 'pm': float(metrics['precision'][1]), 'pl': float(metrics['precision'][0]),
                'rh': float(metrics['recall'][2]),    'rm': float(metrics['recall'][1]),    'rl': float(metrics['recall'][0]),
                'fh': float(metrics['f1'][2]),        'fm': float(metrics['f1'][1]),        'fl': float(metrics['f1'][0]),
                'hhh': cm[2][2], 'hhm': cm[2][1], 'hhl': cm[2][0],
                'hmh': cm[1][2], 'hmm': cm[1][1], 'hml': cm[1][0],
                'hlh': cm[0][2], 'hlm': cm[0][1], 'hll': cm[0][0],
            })
            conn.commit()
        engine.dispose()
        print(f"[DATABASE] Metrics saved for {model_version}")
    except Exception as e:
        print(f"[DATABASE] Warning: {e}")

    return str(model_path)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    print("[START] Multiclass Risk Model Training — LOW / MEDIUM / HIGH")
    print("=" * 60)

    model_version = get_next_version()
    print(f"[VERSION] Training {model_version}")

    df = load_training_data()
    if len(df) < 100:
        raise ValueError(f"Insufficient samples: {len(df)}")

    X, y, feature_names, clip_thresholds = prepare_features(df, model_version)
    model, feature_names, metrics = train_model(X, y)
    model_path = save_all(model, feature_names, metrics, len(df), model_version, clip_thresholds)

    print("\n" + "=" * 60)
    print(f"[SUCCESS] Model {model_version} saved to {model_path}")
    print(f"[SUCCESS] Accuracy: {metrics['accuracy']*100:.1f}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())