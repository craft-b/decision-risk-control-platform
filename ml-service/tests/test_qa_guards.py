# ml-service/tests/test_qa_guards.py
# QA-1 — the tests that guard where the risk actually lives:
#   1. Leakage canary       — shuffled labels must collapse holdout ROC-AUC to ~0.5.
#   2. Calibration guard     — the calibrated probability tracks the real rate,
#                              and Brier/ECE are emitted (ML-5).
#   3. Cross-language contract — the pydantic SnapshotInput covers every training
#                              FEATURE_COL, so Node payload ↔ schema ↔ trainer agree.
# All run in-memory (no DB) so they are CI-safe.

import sys
from pathlib import Path
import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from training.train_model_multihorizon import (  # noqa: E402
    FEATURE_COLS, HORIZONS, prepare_features, train_horizon_model, RANDOM_SEED,
)
from tests.test_train_smoke import make_synthetic_df  # noqa: E402


def _empty_failures():
    return pd.DataFrame({
        "equipment_id": pd.Series(dtype=int),
        "maintenance_date": pd.Series(dtype="datetime64[ns]"),
    })


@pytest.fixture(scope="module")
def prepared(tmp_path_factory):
    import training.train_model_multihorizon as tm
    tmp = tmp_path_factory.mktemp("qa_registry")
    original, tm.MODEL_DIR = tm.MODEL_DIR, tmp
    tmp.mkdir(parents=True, exist_ok=True)
    df = make_synthetic_df(n_samples=800)
    X, labels, feature_names, clip = prepare_features(df, "v0.qa")
    tm.MODEL_DIR = original
    return X, labels, feature_names


# ─────────────────────────────────────────────────────────────────────────────
# 1. LEAKAGE CANARY
# If labels are shuffled, no honest pipeline can predict them — holdout ROC-AUC
# must sit at chance. A canary that fails (AUC ≫ 0.5 on shuffled labels) means
# information is leaking from the label into the features or the split.
# ─────────────────────────────────────────────────────────────────────────────

class TestLeakageCanary:
    @pytest.mark.parametrize("horizon", HORIZONS)
    def test_shuffled_labels_collapse_auc(self, prepared, horizon, tmp_path_factory):
        import training.train_model_multihorizon as tm
        X, labels, _ = prepared
        y = labels[f"will_fail_{horizon}d"].astype(int).reset_index(drop=True)

        rng = np.random.default_rng(RANDOM_SEED)
        y_shuffled = pd.Series(rng.permutation(y.to_numpy()), index=y.index)

        original, tm.MODEL_DIR = tm.MODEL_DIR, tmp_path_factory.mktemp("canary")
        try:
            _, metrics = train_horizon_model(
                X, y_shuffled, horizon,
                snapshot_ts=labels["snapshot_ts"],
                equipment_ids=labels["equipment_id"],
                failures_df=_empty_failures(),
            )
        finally:
            tm.MODEL_DIR = original

        assert 0.35 <= metrics["roc_auc"] <= 0.65, (
            f"{horizon}d shuffled-label ROC-AUC={metrics['roc_auc']:.3f} — expected ~0.5. "
            "A value well above 0.5 means label information is leaking into features/split."
        )


# ─────────────────────────────────────────────────────────────────────────────
# 2. CALIBRATION GUARD (ML-5)
# ─────────────────────────────────────────────────────────────────────────────

class TestCalibration:
    @pytest.mark.parametrize("horizon", HORIZONS)
    def test_calibration_metrics_present_and_sane(self, prepared, horizon, tmp_path_factory):
        import training.train_model_multihorizon as tm
        X, labels, _ = prepared
        y = labels[f"will_fail_{horizon}d"].astype(int)

        original, tm.MODEL_DIR = tm.MODEL_DIR, tmp_path_factory.mktemp("calib")
        try:
            model, metrics = train_horizon_model(
                X, y, horizon,
                snapshot_ts=labels["snapshot_ts"],
                equipment_ids=labels["equipment_id"],
                failures_df=_empty_failures(),
            )
        finally:
            tm.MODEL_DIR = original

        # Brier + ECE are emitted and finite
        assert "brier" in metrics and 0.0 <= metrics["brier"] <= 1.0
        assert "ece" in metrics and 0.0 <= metrics["ece"] <= 1.0
        # No resampling: the training-set probability shouldn't be wildly inflated
        # vs the real rate (loose bound — 800 synthetic rows).
        import numpy as _np
        p = model.predict_proba(X)[:, 1]
        assert abs(_np.mean(p) - y.mean()) < 0.20, (
            f"{horizon}d mean predicted {_np.mean(p):.3f} vs actual {y.mean():.3f} — "
            "probability looks inflated (calibration/resampling regression)."
        )


# ─────────────────────────────────────────────────────────────────────────────
# 3. CROSS-LANGUAGE CONTRACT
# The Node payload is validated against the pydantic SnapshotInput; the trainer
# reads FEATURE_COLS. If the schema stops covering a training column, the three
# have silently diverged. (The Node → pydantic direction is guarded by a vitest.)
# ─────────────────────────────────────────────────────────────────────────────

class TestContract:
    def test_snapshot_input_covers_feature_cols(self):
        from api.schemas.prediction import SnapshotInput
        fields = set(SnapshotInput.model_fields.keys())
        missing = [c for c in FEATURE_COLS if c not in fields]
        assert not missing, (
            f"pydantic SnapshotInput is missing training feature columns: {missing}. "
            "Node payload, pydantic schema, and trainer FEATURE_COLS have diverged."
        )

    def test_imputation_defaults_match_trainer(self):
        # MTBF/days_since defaults in the schema must match the trainer COALESCE.
        from api.schemas.prediction import SnapshotInput
        f = SnapshotInput.model_fields
        assert f["mean_time_between_failures"].default == 500.0
        assert f["days_since_last_maintenance"].default == 999.0
