# ml-service/tests/test_ml_engine.py
# Core tests for the ML inference engine.
# Run from ml-service/ directory: python -m pytest tests/ -v

import json
import sys
import pytest
import numpy as np
from pathlib import Path

# Ensure ml-service root is on path
sys.path.insert(0, str(Path(__file__).parent.parent))

from api.schemas.prediction import SnapshotInput, RiskLevel
from engine.predictor import EquipmentPredictor


# ─────────────────────────────────────────────────────────────────────────────
# FIXTURES
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def predictor():
    """Load predictor once for all tests — mirrors production startup."""
    return EquipmentPredictor()


@pytest.fixture
def low_risk_snapshot():
    return {
        "equipment_id": 1,
        "asset_age_years": 1.5,
        "category": "Excavator",
        "total_hours_lifetime": 800.0,
        "hours_used_30d": 80.0,
        "hours_used_90d": 240.0,
        "rental_days_30d": 10,
        "rental_days_90d": 30,
        "avg_rental_duration": 3.0,
        "maintenance_events_90d": 1,
        "maintenance_cost_180d": 300.0,
        "avg_downtime_per_event": 1.0,
        "days_since_last_maintenance": 20.0,
        "mean_time_between_failures": 500.0,
        "vendor_reliability_score": 0.95,
        "jobsite_risk_score": 0.30,
        "usage_intensity": 6.0,
        "usage_trend": 0.9,
        "utilization_vs_expected": 0.75,
        "wear_rate": 0.01,
        "aging_factor": 0.10,
        "maint_overdue": 0,
        "cost_per_event": 300.0,
        "maint_burden": 0.5,
        "mechanical_wear_score": 1.5,
        "abuse_score": 0.8,
        "neglect_score": 0.5,
    }


@pytest.fixture
def high_risk_snapshot():
    return {
        "equipment_id": 2,
        "asset_age_years": 9.0,
        "category": "Excavator",
        "total_hours_lifetime": 5800.0,
        "hours_used_30d": 240.0,
        "hours_used_90d": 720.0,
        "rental_days_30d": 28,
        "rental_days_90d": 85,
        "avg_rental_duration": 3.0,
        "maintenance_events_90d": 4,
        "maintenance_cost_180d": 4500.0,
        "avg_downtime_per_event": 3.0,
        "days_since_last_maintenance": 210.0,
        "mean_time_between_failures": 150.0,
        "vendor_reliability_score": 0.60,
        "jobsite_risk_score": 0.85,
        "usage_intensity": 11.5,
        "usage_trend": 1.8,
        "utilization_vs_expected": 1.4,
        "wear_rate": 0.09,
        "aging_factor": 0.60,
        "maint_overdue": 1,
        "cost_per_event": 1125.0,
        "maint_burden": 6.25,
        "mechanical_wear_score": 8.5,
        "abuse_score": 7.2,
        "neglect_score": 8.8,
        "warning_count": 15,
        "error_code_count": 3,
    }


# ─────────────────────────────────────────────────────────────────────────────
# ARTIFACT TESTS
# ─────────────────────────────────────────────────────────────────────────────

class TestArtifacts:
    """Verify all required model artifacts are present and valid."""

    def test_registry_exists(self):
        registry = Path(__file__).parent.parent / "registry"
        assert registry.exists(), f"Registry directory not found: {registry}"

    def test_model_pkl_exists(self):
        registry = Path(__file__).parent.parent / "registry"
        models = list(registry.glob("random_forest_multiclass_*.pkl"))
        assert len(models) > 0, "No model .pkl found in registry"

    def test_feature_cols_exists(self):
        registry = Path(__file__).parent.parent / "registry"
        cols_files = list(registry.glob("feature_cols_*.json"))
        assert len(cols_files) > 0, "No feature_cols JSON found in registry"

    def test_clip_thresholds_exists(self):
        registry = Path(__file__).parent.parent / "registry"
        threshold_files = list(registry.glob("clip_thresholds_*.json"))
        assert len(threshold_files) > 0, (
            "No clip_thresholds JSON found — retrain with updated train-model.py"
        )

    def test_label_encoder_exists(self):
        registry = Path(__file__).parent.parent / "registry"
        assert (registry / "label_encoder_category.pkl").exists()

    def test_feature_cols_valid(self):
        registry = Path(__file__).parent.parent / "registry"
        cols_file = sorted(registry.glob("feature_cols_*.json"))[-1]
        with open(cols_file) as f:
            data = json.load(f)
        assert "feature_cols" in data
        assert len(data["feature_cols"]) > 0
        assert "version" in data

    def test_clip_thresholds_valid(self):
        registry = Path(__file__).parent.parent / "registry"
        threshold_file = sorted(registry.glob("clip_thresholds_*.json"))[-1]
        with open(threshold_file) as f:
            data = json.load(f)
        assert "clip_thresholds" in data
        assert len(data["clip_thresholds"]) > 0


# ─────────────────────────────────────────────────────────────────────────────
# PREDICTOR LOADING TESTS
# ─────────────────────────────────────────────────────────────────────────────

class TestPredictorLoading:
    """Verify predictor loads correctly."""

    def test_predictor_loads(self, predictor):
        assert predictor is not None

    def test_model_version_set(self, predictor):
        assert predictor.version is not None
        assert predictor.version.startswith("v")

    def test_feature_names_loaded(self, predictor):
        assert len(predictor.feature_names) > 0
        assert len(predictor.expected_features) > 0

    def test_clip_thresholds_loaded(self, predictor):
        assert predictor.clip_thresholds is not None, (
            "Clip thresholds not loaded — predictor will warn about this"
        )
        assert len(predictor.clip_thresholds) > 0

    def test_label_encoder_loaded(self, predictor):
        assert predictor.label_encoder is not None

    def test_feature_importance_loaded(self, predictor):
        assert len(predictor.feature_importance) > 0


# ─────────────────────────────────────────────────────────────────────────────
# INFERENCE TESTS
# ─────────────────────────────────────────────────────────────────────────────

class TestInference:
    """Verify predictions are correct shape, type, and range."""

    def test_predict_returns_dict(self, predictor, low_risk_snapshot):
        result = predictor.predict(low_risk_snapshot)
        assert isinstance(result, dict)

    def test_predict_required_keys(self, predictor, low_risk_snapshot):
        result = predictor.predict(low_risk_snapshot)
        required_keys = [
            "equipment_id", "failure_probability", "predicted_failure",
            "risk_level", "model_version", "top_risk_drivers"
        ]
        for key in required_keys:
            assert key in result, f"Missing key: {key}"

    def test_failure_probability_range(self, predictor, low_risk_snapshot):
        result = predictor.predict(low_risk_snapshot)
        prob = result["failure_probability"]
        assert 0.0 <= prob <= 1.0, f"Probability out of range: {prob}"

    def test_risk_level_valid(self, predictor, low_risk_snapshot):
        result = predictor.predict(low_risk_snapshot)
        assert result["risk_level"] in ["LOW", "MEDIUM", "HIGH"]

    def test_predicted_failure_is_bool(self, predictor, low_risk_snapshot):
        result = predictor.predict(low_risk_snapshot)
        assert isinstance(result["predicted_failure"], bool)

    def test_risk_drivers_is_list(self, predictor, low_risk_snapshot):
        result = predictor.predict(low_risk_snapshot)
        assert isinstance(result["top_risk_drivers"], list)
        assert len(result["top_risk_drivers"]) > 0

    def test_equipment_id_preserved(self, predictor, low_risk_snapshot):
        result = predictor.predict(low_risk_snapshot)
        assert result["equipment_id"] == low_risk_snapshot["equipment_id"]


# ─────────────────────────────────────────────────────────────────────────────
# RISK ORDERING TESTS
# ─────────────────────────────────────────────────────────────────────────────

class TestRiskOrdering:
    """
    High risk equipment should score higher than low risk.
    These tests catch training-serving skew — if features are being
    transformed differently at inference vs training, ordering breaks.
    """

    def test_high_risk_scores_higher_than_low_risk(
        self, predictor, low_risk_snapshot, high_risk_snapshot
    ):
        low_result = predictor.predict(low_risk_snapshot)
        high_result = predictor.predict(high_risk_snapshot)

        assert high_result["failure_probability"] > low_result["failure_probability"], (
            f"High risk equipment ({high_result['failure_probability']:.3f}) should score "
            f"higher than low risk ({low_result['failure_probability']:.3f}). "
            f"This may indicate training-serving skew."
        )

    def test_low_risk_is_not_high(self, predictor, low_risk_snapshot):
        result = predictor.predict(low_risk_snapshot)
        assert result["risk_level"] != "HIGH", (
            f"Well-maintained new equipment should not be HIGH risk. "
            f"Got: {result['risk_level']} ({result['failure_probability']:.3f})"
        )

    def test_high_risk_is_not_low(self, predictor, high_risk_snapshot):
        result = predictor.predict(high_risk_snapshot)
        assert result["risk_level"] != "LOW", (
            f"Neglected aging equipment should not be LOW risk. "
            f"Got: {result['risk_level']} ({result['failure_probability']:.3f})"
        )


# ─────────────────────────────────────────────────────────────────────────────
# SCHEMA TESTS
# ─────────────────────────────────────────────────────────────────────────────

class TestSchema:
    """Verify Pydantic schema validates correctly."""

    def test_valid_snapshot_passes(self, low_risk_snapshot):
        snapshot = SnapshotInput(**low_risk_snapshot)
        assert snapshot.equipment_id == low_risk_snapshot["equipment_id"]

    def test_usage_intensity_capped(self):
        """usage_intensity must be <= 12 — physical maximum."""
        with pytest.raises(Exception):
            SnapshotInput(
                equipment_id=1,
                asset_age_years=1.0,
                category="Excavator",
                total_hours_lifetime=100.0,
                hours_used_30d=10.0,
                hours_used_90d=30.0,
                rental_days_30d=5,
                rental_days_90d=15,
                avg_rental_duration=3.0,
                maintenance_events_90d=0,
                maintenance_cost_180d=0.0,
                usage_intensity=25.0,  # ← invalid, exceeds 12
                usage_trend=1.0,
                utilization_vs_expected=1.0,
                wear_rate=0.01,
                aging_factor=0.1,
                maint_overdue=0,
                cost_per_event=0.0,
                maint_burden=0.0,
                mechanical_wear_score=1.0,
                abuse_score=1.0,
                neglect_score=1.0,
            )

    def test_optional_sensor_fields(self, low_risk_snapshot):
        """Sensor fields are optional — snapshot without them is valid."""
        snapshot = SnapshotInput(**low_risk_snapshot)
        assert snapshot.avg_vibration is None
        assert snapshot.error_code_count is None