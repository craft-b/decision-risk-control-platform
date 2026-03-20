# ml-service/engine/predictor_multihorizon.py
# Multi-horizon inference engine — loads 10d, 30d, 60d models at startup.
# Serves predictions with risk level and failure probability per horizon.
# Transforms mirror prepare_features() in train_model_multihorizon.py exactly.

import json
import numpy as np
import pandas as pd
import joblib
from pathlib import Path
from typing import Optional

try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False

REGISTRY = Path(__file__).parent.parent / "registry"
HORIZONS = [10, 30, 60]

# Uniform thresholds across all horizons.
# Monotonic enforcement (p10 ≤ p30 ≤ p60) guarantees risk levels are also
# non-decreasing — no separate per-horizon compensation needed.
RISK_THRESHOLDS = {
    10: {"HIGH": 0.60, "MEDIUM": 0.30},
    30: {"HIGH": 0.60, "MEDIUM": 0.30},
    60: {"HIGH": 0.60, "MEDIUM": 0.30},
}

# Confidence labels for UI display
MODEL_CONFIDENCE = {
    10: "moderate",   # ROC-AUC 0.72
    30: "high",       # ROC-AUC 0.96
    60: "very high",  # ROC-AUC 0.997
}


class MultiHorizonPredictor:
    """
    Loads all three horizon models at startup.
    Serves predictions with risk levels for 10d, 30d, 60d windows.
    """

    def __init__(self):
        self._load_artifacts()

    def _load_artifacts(self):
        self.models = {}
        self.versions = {}
        self.shap_explainers = {}

        for h in HORIZONS:
            def _version_key(p):
                import re
                m = re.search(r'v(\d+)\.(\d+)', p.stem)
                return (int(m.group(1)), int(m.group(2))) if m else (0, 0)

            model_files = sorted(REGISTRY.glob(f"rf_{h}d_*.pkl"), key=_version_key, reverse=True)
            if not model_files:
                raise FileNotFoundError(f"No {h}d model found in {REGISTRY}. Run train_model_multihorizon.py first.")
            model_data = joblib.load(model_files[0])
            self.models[h] = model_data["model"]
            self.versions[h] = model_data["version"]
            print(f"[MH-PREDICTOR] Loaded {h}d model {model_data['version']} ({len(model_data['feature_names'])} features)")

            # SHAP TreeExplainer — operates on the base RF inside the calibrated wrapper.
            # We use calibrated_classifiers_[0].estimator (first CV fold's estimator) as a
            # representative tree for attribution. SHAP values are in log-odds space from
            # the uncalibrated RF; the sign and ranking are reliable, the magnitude is not
            # a calibrated probability — communicate this in interviews.
            if SHAP_AVAILABLE:
                try:
                    base_rf = self.models[h].calibrated_classifiers_[0].estimator
                    self.shap_explainers[h] = shap.TreeExplainer(base_rf)
                    print(f"[MH-PREDICTOR] SHAP TreeExplainer ready for {h}d")
                except Exception as e:
                    print(f"[MH-PREDICTOR] SHAP init failed for {h}d: {e}")

        # Use 30d model's feature names as canonical (all horizons share same features)
        model_data_30 = joblib.load(sorted(REGISTRY.glob("rf_30d_*.pkl"), key=_version_key, reverse=True)[0])
        self.feature_names: list = model_data_30["feature_names"]
        self.version: str = model_data_30["version"]

        # Label encoder (shared)
        encoder_path = REGISTRY / "label_encoder_category.pkl"
        if not encoder_path.exists():
            raise FileNotFoundError(f"Label encoder not found: {encoder_path}")
        self.label_encoder = joblib.load(encoder_path)

        # Feature columns (shared)
        feature_cols_files = sorted(REGISTRY.glob("feature_cols_*.json"), key=_version_key, reverse=True)
        if feature_cols_files:
            with open(feature_cols_files[0]) as f:
                self.expected_features: list = json.load(f)["feature_cols"]
        else:
            self.expected_features = self.feature_names

        # Clip thresholds (shared)
        clip_files = sorted(REGISTRY.glob("clip_thresholds_*.json"), key=_version_key, reverse=True)
        if clip_files:
            with open(clip_files[0]) as f:
                self.clip_thresholds: Optional[dict] = json.load(f)["clip_thresholds"]
            print(f"[MH-PREDICTOR] Clip thresholds loaded ({len(self.clip_thresholds)} cols)")
        else:
            self.clip_thresholds = None
            print("[MH-PREDICTOR] WARNING: No clip thresholds — skipping outlier clipping")

        # Feature importance per horizon
        self.feature_importance = {}
        for h in HORIZONS:
            fi_files = sorted(REGISTRY.glob(f"feature_importance_{h}d_*.json"), key=_version_key, reverse=True)
            if fi_files:
                with open(fi_files[0]) as f:
                    self.feature_importance[h] = json.load(f)
            else:
                self.feature_importance[h] = {}

        print(f"[MH-PREDICTOR] Ready — horizons: {HORIZONS}d, version: {self.version}")
    
    

    # ─────────────────────────────────────────────────────────────────────
    # PUBLIC API
    # ─────────────────────────────────────────────────────────────────────

    def predict_multi_horizon(self, snapshot: dict) -> dict:
        """
        Run inference across all three horizon models for a single snapshot.
        Returns predictions dict with 10d, 30d, 60d results.
        """
        df = pd.DataFrame([snapshot])
        df = self._apply_transforms(df)
        df = df.reindex(columns=self.expected_features, fill_value=0)
        df = df.apply(pd.to_numeric, errors="coerce").fillna(0)

        # ── Step 1: raw probabilities from each independent model ────────────────
        raw = {}
        for h in HORIZONS:
            proba = self.models[h].predict_proba(df)[0]
            raw[h] = float(proba[1])

        # Pre-compute SHAP attributions for all horizons (done once on aligned df)
        shap_by_horizon = {h: self._get_shap_attribution(df, h) for h in HORIZONS}

        # ── Step 2: enforce isotonic monotonicity ─────────────────────────────
        # Labels are cumulative: will_fail_Xd = "fails within X days".
        # Therefore P(fail≤10d) ≤ P(fail≤30d) ≤ P(fail≤60d) is a mathematical
        # identity — the 30d window strictly contains the 10d window.
        # Independent calibrated classifiers violate this; fix it here.
        p10 = raw[10]
        p30 = max(raw[30], p10)   # 30d ⊇ 10d
        p60 = max(raw[60], p30)   # 60d ⊇ 30d
        enforced = {10: p10, 30: p30, 60: p60}

        if raw[30] < p10 or raw[60] < p30:
            print(
                f"[MH] EQ-{snapshot['equipment_id']} monotonicity enforced: "
                f"raw=({raw[10]:.3f},{raw[30]:.3f},{raw[60]:.3f}) -> "
                f"({p10:.3f},{p30:.3f},{p60:.3f})"
            )

        # ── Step 3: build predictions dict from enforced probabilities ────────
        predictions = {}
        for h in HORIZONS:
            failure_prob = enforced[h]
            thresholds = RISK_THRESHOLDS[h]
            if failure_prob >= thresholds["HIGH"]:
                risk_level = "HIGH"
            elif failure_prob >= thresholds["MEDIUM"]:
                risk_level = "MEDIUM"
            else:
                risk_level = "LOW"

            predictions[f"{h}d"] = {
                "failure_probability": round(failure_prob, 4),
                "risk_level":          risk_level,
                "risk_score":          round(failure_prob * 100),
                "model_confidence":    MODEL_CONFIDENCE[h],
                "top_risk_drivers":    self._get_risk_drivers(snapshot, failure_prob, h),
                # Per-prediction SHAP attribution: feature → contribution to failure probability.
                # Positive = pushes toward failure; negative = protective.
                # Ranked by |SHAP value|, top 5 features shown.
                "shap_attribution":    shap_by_horizon[h],
            }

            print(f"[MH] EQ-{snapshot['equipment_id']} {h}d: P={failure_prob:.3f} -> {risk_level}")

        # ── Step 4: trend — how steeply does risk escalate without intervention?
        # DECREASING is impossible for cumulative probabilities (p60 ≥ p10 always).
        # INCREASING = notable escalation across the horizon span (equipment is
        #              deteriorating — risk will be materially worse if untreated).
        # STABLE     = flat curve (already high everywhere, or genuinely low risk).
        delta = p60 - p10
        if delta > 0.10:
            trend = "INCREASING"
        else:
            trend = "STABLE"

        # Recommendation based on worst horizon
        worst_risk = max(
            predictions.items(),
            key=lambda x: x[1]["failure_probability"]
        )
        recommendation = self._generate_recommendation(
            snapshot,
            worst_risk[1]["risk_level"],
            worst_risk[0]
        )

        return {
            "equipment_id":  snapshot["equipment_id"],
            "model_version": self.version,
            "risk_trend":    trend,
            "predictions":   predictions,
            "recommendation": recommendation,
        }

    def predict_multi_horizon_batch(self, snapshots: list) -> list:
        """Run multi-horizon inference on multiple snapshots efficiently."""
        return [self.predict_multi_horizon(s) for s in snapshots]

    # ─────────────────────────────────────────────────────────────────────
    # PRIVATE — TRANSFORMS
    # Must mirror prepare_features() in train_model_multihorizon.py exactly
    # ─────────────────────────────────────────────────────────────────────

    def _apply_transforms(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()

        # 1. Label-encode category
        if "category" in df.columns:
            try:
                df["category_encoded"] = self.label_encoder.transform(
                    df["category"].fillna("Unknown")
                )
            except ValueError:
                print(f"[MH-PREDICTOR] Unknown category: {df['category'].iloc[0]} — defaulting to 0")
                df["category_encoded"] = 0
            df.drop("category", axis=1, inplace=True)

        # 2. Drop non-feature columns
        cols_to_drop = ["equipment_id", "snapshot_ts"]
        df.drop(columns=[c for c in cols_to_drop if c in df.columns], inplace=True)

        # 3. Clip outliers using training distribution thresholds
        if self.clip_thresholds:
            for col, threshold in self.clip_thresholds.items():
                if col in df.columns:
                    df[col] = df[col].clip(upper=threshold)

        # 4. Log-transform skewed features — must match train_model_multihorizon.py
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

        # 5. Fill NaN
        df = df.fillna(0)

        return df

    # ─────────────────────────────────────────────────────────────────────
    # PRIVATE — SHAP ATTRIBUTION
    # Per-prediction feature contributions using TreeExplainer on base RF.
    # Values are in log-odds space (uncalibrated) — sign and rank are
    # reliable; magnitude should not be compared to failure_probability.
    # ─────────────────────────────────────────────────────────────────────

    def _get_shap_attribution(self, df_aligned: pd.DataFrame, horizon: int) -> dict:
        if not SHAP_AVAILABLE or horizon not in self.shap_explainers:
            return {}
        try:
            explainer = self.shap_explainers[horizon]
            explanation = explainer(df_aligned)

            # shap >= 0.40 returns an Explanation object: shape (n_samples, n_features, n_classes)
            # We want class-1 (failure) SHAP values for the single sample.
            if hasattr(explanation, "values"):
                vals = explanation.values
                if vals.ndim == 3:
                    shap_vals = vals[0, :, 1]      # (n_features,), class=failure
                else:
                    shap_vals = vals[0]            # fallback for 2-D output
            else:
                # Older shap API: returns list of arrays per class
                raw = explainer.shap_values(df_aligned)
                shap_vals = raw[1][0] if isinstance(raw, list) else raw[0]

            feature_names = df_aligned.columns.tolist()
            top5 = sorted(
                zip(feature_names, shap_vals),
                key=lambda x: abs(x[1]),
                reverse=True
            )[:5]
            return {feat: round(float(val), 4) for feat, val in top5}
        except Exception as e:
            print(f"[SHAP] Attribution failed for {horizon}d: {e}")
            return {}

    # ─────────────────────────────────────────────────────────────────────
    # PRIVATE — RISK DRIVERS
    # Uses horizon-specific feature importance
    # ─────────────────────────────────────────────────────────────────────

    def _get_risk_drivers(self, snapshot: dict, prob: float, horizon: int) -> dict:
        drivers = {}
        fi = self.feature_importance.get(horizon, {})

        days_since = snapshot.get("days_since_last_maintenance") or 0
        maint_overdue = snapshot.get("maint_overdue", 0)
        if maint_overdue or days_since > 60:
            drivers[f"⚠️ Maintenance overdue ({int(days_since)}d since last service)"] = fi.get("days_since_last_maintenance", 0.15)
        elif days_since > 30:
            drivers[f"Approaching maintenance threshold ({int(days_since)}d since last service)"] = fi.get("days_since_last_maintenance", 0.10)

        neglect = snapshot.get("neglect_score", 0)
        if neglect >= 2.5:
            drivers[f"High neglect score: {neglect:.1f}/10"] = fi.get("neglect_score", 0.20)
        elif neglect >= 1.5:
            drivers[f"Moderate neglect: {neglect:.1f}/10"] = fi.get("neglect_score", 0.12)

        wear = snapshot.get("mechanical_wear_score", 0)
        if wear >= 4:
            drivers[f"High mechanical wear: {wear:.1f}/10"] = fi.get("mechanical_wear_score", 0.18)
        elif wear >= 2:
            drivers[f"Moderate mechanical wear: {wear:.1f}/10"] = fi.get("mechanical_wear_score", 0.10)

        wear_rate = snapshot.get("wear_rate", 0)
        if wear_rate > 0.05:
            drivers[f"Elevated wear rate: {wear_rate:.3f}"] = fi.get("wear_rate", 0.09)

        age = snapshot.get("asset_age_years", 0)
        if age > 4:
            drivers[f"Asset age: {age:.1f} years (end of useful life approaching)"] = fi.get("asset_age_years", 0.16)
        elif age > 2.5:
            drivers[f"Asset age: {age:.1f} years"] = fi.get("asset_age_years", 0.10)

        hours = snapshot.get("total_hours_lifetime", 0)
        if hours > 3000:
            drivers[f"High lifetime hours: {int(hours):,} hrs"] = fi.get("total_hours_lifetime", 0.13)
        elif hours > 1500:
            drivers[f"Elevated lifetime hours: {int(hours):,} hrs"] = fi.get("total_hours_lifetime", 0.08)

        abuse = snapshot.get("abuse_score", 0)
        if abuse >= 3:
            drivers[f"High operational stress: {abuse:.1f}/10"] = fi.get("abuse_score", 0.12)

        if not drivers:
            drivers["Well maintained — within normal operating parameters"] = 0.02

        return dict(sorted(drivers.items(), key=lambda x: x[1], reverse=True)[:5])

    # ─────────────────────────────────────────────────────────────────────
    # PRIVATE — RECOMMENDATION
    # ─────────────────────────────────────────────────────────────────────

    def _generate_recommendation(self, snapshot: dict, worst_risk: str, horizon: str) -> str:
        age   = snapshot.get("asset_age_years", 0)
        hours = snapshot.get("total_hours_lifetime", 0)
        days  = snapshot.get("days_since_last_maintenance", 0) or 0

        if worst_risk == "HIGH":
            return (
                f"Equipment shows HIGH failure probability within {horizon}. "
                f"Schedule immediate inspection — {int(days)} days since last service, "
                f"{age:.1f} year old unit with {int(hours):,} lifetime hours. "
                f"Prioritize before next rental assignment."
            )
        elif worst_risk == "MEDIUM":
            return (
                f"Equipment shows MEDIUM failure risk within {horizon}. "
                f"Schedule preventive maintenance within 2 weeks. "
                f"Monitor for wear escalation before next rental."
            )
        else:
            return (
                f"Equipment is within normal operating parameters across all prediction horizons. "
                f"Continue standard maintenance schedule."
            )