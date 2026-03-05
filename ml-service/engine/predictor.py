# ml-service/engine/predictor.py
# Inference engine — loads model artifacts once at startup, serves predictions.
# CRITICAL: all transforms here must exactly mirror prepare_features() in train_model.py

import json
import numpy as np
import pandas as pd
import joblib
from pathlib import Path
from typing import Optional

REGISTRY = Path(__file__).parent.parent / "registry"


class EquipmentPredictor:
    """
    Loads the trained Random Forest + all supporting artifacts from the registry.
    Single instance, loaded once at FastAPI startup via lifespan context.
    """

    def __init__(self):
        self._load_artifacts()

    def _load_artifacts(self):
        # ── Model ────────────────────────────────────────────────────────
        model_files = sorted(REGISTRY.glob("random_forest_multiclass_*.pkl"), reverse=True)
        if not model_files:
            raise FileNotFoundError(f"No model .pkl found in {REGISTRY}")

        model_data = joblib.load(model_files[0])
        self.model = model_data["model"]
        self.feature_names: list[str] = model_data["feature_names"]
        self.version: str = model_data["version"]
        self.trained_at: str = model_data.get("trained_at", "unknown")

        print(f"[PREDICTOR] Loaded model {self.version} ({len(self.feature_names)} features)")

        # ── Label encoder ────────────────────────────────────────────────
        encoder_path = REGISTRY / "label_encoder_category.pkl"
        if not encoder_path.exists():
            raise FileNotFoundError(f"Label encoder not found: {encoder_path}")
        self.label_encoder = joblib.load(encoder_path)

        # ── Feature columns — exact order from training ──────────────────
        feature_cols_files = sorted(REGISTRY.glob("feature_cols_*.json"), reverse=True)
        if feature_cols_files:
            with open(feature_cols_files[0]) as f:
                data = json.load(f)
            self.expected_features: list[str] = data["feature_cols"]
        else:
            self.expected_features = self.feature_names

        # ── Clip thresholds — saved from training distribution ───────────
        # If not present (pre-fix models), clipping is skipped with a warning
        clip_files = sorted(REGISTRY.glob("clip_thresholds_*.json"), reverse=True)
        if clip_files:
            with open(clip_files[0]) as f:
                self.clip_thresholds: Optional[dict] = json.load(f)["clip_thresholds"]
            print(f"[PREDICTOR] Clip thresholds loaded ({len(self.clip_thresholds)} cols)")
        else:
            self.clip_thresholds = None
            print("[PREDICTOR] WARNING: No clip thresholds found — skipping outlier clipping. "
                  "Retrain with updated train_model.py to fix this.")

        # ── Metadata ─────────────────────────────────────────────────────
        meta_files = sorted(REGISTRY.glob("metadata_*.json"), reverse=True)
        self.metadata: dict = {}
        if meta_files:
            with open(meta_files[0]) as f:
                self.metadata = json.load(f)

        # ── Feature importance for driver generation ─────────────────────
        importance_files = sorted(REGISTRY.glob("feature_importance_*.json"), reverse=True)
        self.feature_importance: dict = {}
        if importance_files:
            with open(importance_files[0]) as f:
                self.feature_importance = json.load(f)
            print(f"[PREDICTOR] Feature importance loaded: {len(self.feature_importance)} features from {importance_files[0].name}")
        else:
            print(f"[PREDICTOR] WARNING: No feature importance file found in {REGISTRY}")
    # ─────────────────────────────────────────────────────────────────────
    # PUBLIC API
    # ─────────────────────────────────────────────────────────────────────

    def predict(self, snapshot: dict) -> dict:
        df = pd.DataFrame([snapshot])
        df = self._apply_transforms(df)
        df = df.reindex(columns=self.expected_features, fill_value=0)
        df = df.apply(pd.to_numeric, errors="coerce").fillna(0)

        proba = self.model.predict_proba(df)[0]

        # All current models are multiclass — check model_data loaded at startup
        label_inv = {0: 'LOW', 1: 'MEDIUM', 2: 'HIGH'}
        HIGH_IDX = 2

        MED_IDX, HIGH_IDX = 1, 2

        high_prob = float(proba[HIGH_IDX])
        med_prob  = float(proba[MED_IDX])
        low_prob  = float(proba[0])

        if high_prob >= 0.70:
            predicted_class = HIGH_IDX
        elif med_prob >= 0.35:
            predicted_class = MED_IDX
        else:
            predicted_class = int(np.argmax(proba))  # catches LOW when P(LOW) dominates

        risk_level = label_inv[predicted_class]
        prob_failure = float(proba[2] + 0.5 * proba[1])

        print(f"[PROBA] EQ-{snapshot['equipment_id']}: LOW={proba[0]:.3f} MED={proba[1]:.3f} HIGH={proba[2]:.3f} → {risk_level}")

        return {
            "equipment_id":        snapshot["equipment_id"],
            "failure_probability": round(min(prob_failure, 1.0), 4),
            "predicted_failure":   risk_level == "HIGH",
            "risk_level":          risk_level,
            "model_version":       self.version,
            "top_risk_drivers":    self._get_risk_drivers(snapshot, prob_failure),
            "recommendation":      None,
        }

    def predict_batch(self, snapshots: list[dict]) -> list[dict]:
        """Run inference on multiple snapshots efficiently."""
        return [self.predict(s) for s in snapshots]

    # ─────────────────────────────────────────────────────────────────────
    # PRIVATE — TRANSFORMS
    # Must mirror prepare_features() in train_model.py exactly
    # ─────────────────────────────────────────────────────────────────────

    def _apply_transforms(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()

        # 1. Label-encode category — uses saved encoder from training
        if "category" in df.columns:
            try:
                df["category_encoded"] = self.label_encoder.transform(
                    df["category"].fillna("Unknown")
                )
            except ValueError:
                # Unseen category at inference — default to 0
                print(f"[PREDICTOR] Unknown category: {df['category'].iloc[0]} — defaulting to 0")
                df["category_encoded"] = 0
            df.drop("category", axis=1, inplace=True)

        # 2. Drop non-feature columns passed in snapshot but not used in training
        cols_to_drop = ["equipment_id", "snapshot_ts"]
        df.drop(columns=[c for c in cols_to_drop if c in df.columns], inplace=True)

        # 3. Clip outliers using TRAINING distribution thresholds
        # Critical: never recompute from inference data — use saved values
        if self.clip_thresholds:
            for col, threshold in self.clip_thresholds.items():
                if col in df.columns:
                    df[col] = df[col].clip(upper=threshold)

        # 4. Log-transform skewed features — must match train_model.py log_cols exactly
        log_cols = [
            "total_hours_lifetime",
            "hours_used_30d",
            "hours_used_90d",
            "maintenance_cost_180d",
            "cost_per_event",
            "maint_burden",
            "mean_time_between_failures",
        ]
        for col in log_cols:
            if col in df.columns:
                df[f"log_{col}"] = np.log1p(df[col].clip(lower=0))

        # 5. Fill remaining NaN
        df = df.fillna(0)

        return df

    # ─────────────────────────────────────────────────────────────────────
    # PRIVATE — RISK CLASSIFICATION
    # ─────────────────────────────────────────────────────────────────────

    def _prob_to_risk(self, prob: float) -> str:
        """
        Map failure probability to risk tier.
        Thresholds calibrated for maintenance scheduling:
        - LOW:    act within normal cycle
        - MEDIUM: schedule within 2 weeks
        - HIGH:   prioritize immediately
        """
        if prob < 0.30:
            return "LOW"
        if prob < 0.65:
            return "MEDIUM"
        return "HIGH"

    def _get_risk_drivers(self, snapshot: dict, prob: float) -> dict:
        """
        Returns dict of {driver_description: impact_score} where impact is
        derived from feature importance weights for the triggered features.
        """
        drivers = {}
        fi = self.feature_importance

        days_since = snapshot.get("days_since_last_maintenance") or 0
        maint_overdue = snapshot.get("maint_overdue", 0)
        if maint_overdue:
            drivers[f"⚠️ Maintenance overdue ({int(days_since)} days since last service)"] = fi.get("days_since_last_maintenance", 0.15)
        elif days_since > 60:
            drivers[f"⚠️ Maintenance overdue ({int(days_since)} days since last service)"] = fi.get("days_since_last_maintenance", 0.15)
        elif days_since > 30:
            drivers[f"Approaching maintenance threshold ({int(days_since)} days since last service)"] = fi.get("days_since_last_maintenance", 0.10)

        neglect_score = snapshot.get("neglect_score", 0)
        if neglect_score >= 2.5:
            drivers[f"Maintenance neglect score: {neglect_score:.1f}/10"] = fi.get("neglect_score", 0.25)
        elif neglect_score >= 1.5:
            drivers[f"Moderate maintenance neglect: {neglect_score:.1f}/10"] = fi.get("neglect_score", 0.15)

        wear_score = snapshot.get("mechanical_wear_score", 0)
        if wear_score >= 4:
            drivers[f"High mechanical wear score: {wear_score:.1f}/10"] = fi.get("mechanical_wear_score", 0.18)
        elif wear_score >= 2:
            drivers[f"Moderate mechanical wear: {wear_score:.1f}/10"] = fi.get("mechanical_wear_score", 0.10)

        wear_rate = snapshot.get("wear_rate", 0)
        if wear_rate > 0.05:
            drivers[f"Elevated wear rate: {wear_rate:.3f}"] = fi.get("wear_rate", 0.09)

        age = snapshot.get("asset_age_years", 0)
        if age > 4:
            drivers[f"Asset age: {age:.1f} years (approaching end of useful life)"] = fi.get("asset_age_years", 0.16)
        elif age > 2.5:
            drivers[f"Asset age: {age:.1f} years"] = fi.get("asset_age_years", 0.10)

        abuse_score = snapshot.get("abuse_score", 0)
        if abuse_score >= 3:
            drivers[f"High operational stress score: {abuse_score:.1f}/10"] = fi.get("abuse_score", 0.12)

        hours = snapshot.get("total_hours_lifetime", 0)
        if hours > 3000:
            drivers[f"High lifetime hours: {int(hours):,} hrs"] = fi.get("total_hours_lifetime", 0.13)
        elif hours > 1500:
            drivers[f"Elevated lifetime hours: {int(hours):,} hrs"] = fi.get("total_hours_lifetime", 0.08)

        cost = snapshot.get("cost_per_event", 0)
        if cost > 800:
            drivers[f"High maintenance cost per event: ${int(cost):,}"] = fi.get("cost_per_event", 0.07)

        if not drivers:
            drivers["Low activity, well maintained — within normal operating parameters"] = 0.02

        return dict(sorted(drivers.items(), key=lambda x: x[1], reverse=True)[:5])