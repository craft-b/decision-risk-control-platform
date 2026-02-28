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
        """
        Run inference on a single feature snapshot.
        Returns failure probability, risk level, and top risk drivers.
        """
        df = pd.DataFrame([snapshot])
        df = self._apply_transforms(df)

        # Align to exact training feature order — fills missing cols with 0
        df = df.reindex(columns=self.expected_features, fill_value=0)

        # Ensure all numeric
        df = df.apply(pd.to_numeric, errors="coerce").fillna(0)

        prob_failure: float = float(self.model.predict_proba(df)[0][1])
        predicted_failure: bool = prob_failure >= 0.5

        return {
            "equipment_id": snapshot["equipment_id"],
            "failure_probability": round(prob_failure, 4),
            "predicted_failure": predicted_failure,
            "risk_level": self._prob_to_risk(prob_failure),
            "model_version": self.version,
            "top_risk_drivers": self._get_risk_drivers(snapshot, prob_failure),
            "recommendation": None,  # filled by genai_advisor after this call
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

        # Feature importance lookup (normalized 0-1)
        fi = self.feature_importance  # {feature_name: importance_score}

        days_since = snapshot.get("days_since_last_maintenance", 999)
        maint_overdue = snapshot.get("maint_overdue", 0)
        if maint_overdue:
            drivers[f"⚠️ Maintenance overdue ({int(days_since)} days since last service)"] = fi.get("days_since_last_maintenance", 0.15)
        elif days_since > 90:
            drivers[f"Approaching maintenance threshold ({int(days_since)} days since last service)"] = fi.get("days_since_last_maintenance", 0.10)

        wear_score = snapshot.get("mechanical_wear_score", 0)
        if wear_score >= 7:
            drivers[f"High mechanical wear score: {wear_score:.1f}/10"] = fi.get("mechanical_wear_score", 0.18)
        elif wear_score >= 5:
            drivers[f"Moderate mechanical wear: {wear_score:.1f}/10"] = fi.get("mechanical_wear_score", 0.10)

        abuse_score = snapshot.get("abuse_score", 0)
        if abuse_score >= 6:
            drivers[f"High operational stress score: {abuse_score:.1f}/10"] = fi.get("abuse_score", 0.12)

        neglect_score = snapshot.get("neglect_score", 0)
        if neglect_score >= 6:
            drivers[f"Maintenance neglect score: {neglect_score:.1f}/10"] = fi.get("neglect_score", 0.12)

        intensity = snapshot.get("usage_intensity", 0)
        if intensity > 10:
            drivers[f"High usage intensity: {intensity:.1f} hrs/day"] = fi.get("usage_intensity", 0.14)
        elif intensity > 8:
            drivers[f"Above-average usage intensity: {intensity:.1f} hrs/day"] = fi.get("usage_intensity", 0.09)

        age = snapshot.get("asset_age_years", 0)
        if age > 8:
            drivers[f"Asset age: {age:.1f} years (approaching end of useful life)"] = fi.get("asset_age_years", 0.16)
        elif age > 5:
            drivers[f"Asset age: {age:.1f} years"] = fi.get("asset_age_years", 0.10)

        hours = snapshot.get("total_hours_lifetime", 0)
        if hours > 5000:
            drivers[f"High lifetime hours: {int(hours):,} hrs (major rebuild territory)"] = fi.get("total_hours_lifetime", 0.13)
        elif hours > 3000:
            drivers[f"Elevated lifetime hours: {int(hours):,} hrs"] = fi.get("total_hours_lifetime", 0.08)

        if not drivers:
            drivers["Low activity, well maintained — within normal operating parameters"] = 0.02

        # Sort by impact descending, cap at 5
        top = dict(sorted(drivers.items(), key=lambda x: x[1], reverse=True)[:5])
        return top