# ml-service/training/calibration_report.py
#
# ML-5 before/after: score the observed-label holdout with a given model version
# and report calibration quality (mean predicted prob vs actual rate, Brier, ECE).
# Demonstrates that dropping SMOTE-before-calibration de-inflates the probabilities.
#
# Batch-scores through the raw calibrated model + the shared transform (no per-row
# SHAP), so it runs in seconds.
#
#   python -m training.calibration_report v1.15   # before (SMOTE)
#   python -m training.calibration_report v1.16   # after (no SMOTE)
import sys
import json
from pathlib import Path
import joblib

SCRIPT_DIR = Path(__file__).parent.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from training.train_model_multihorizon import load_training_data, expected_calibration_error  # noqa: E402
from engine.feature_transform import transform_features  # noqa: E402
from sklearn.metrics import brier_score_loss  # noqa: E402

REGISTRY = SCRIPT_DIR / "registry"
HORIZONS = [10, 30, 60]


def main(version: str):
    df = load_training_data().sort_values("snapshot_ts").reset_index(drop=True)
    cut = int(len(df) * 0.80)
    hold = df.iloc[cut:].reset_index(drop=True)

    # Load this version's encoder + clip thresholds and build the model-space frame
    le = joblib.load(REGISTRY / f"label_encoder_category_{version}.pkl")
    with open(REGISTRY / f"clip_thresholds_{version}.json") as f:
        clip = json.load(f)["clip_thresholds"]
    with open(REGISTRY / f"feature_cols_{version}.json") as f:
        cols = json.load(f)["feature_cols"]

    feats = hold.drop(columns=[c for c in ("will_fail_10d", "will_fail_30d", "will_fail_60d") if c in hold.columns])
    X, _ = transform_features(feats, label_encoder=le, clip_thresholds=clip, fit=False)
    X = X.reindex(columns=cols, fill_value=0).apply(lambda s: s.astype(float))

    print(f"\n=== Calibration for {version} on {len(hold)} observed holdout rows ===")
    print(f"{'Horizon':<8}{'mean_pred':>11}{'actual_rate':>13}{'inflation':>11}{'Brier':>9}{'ECE':>8}{'gate':>8}")
    for h in HORIZONS:
        model = joblib.load(REGISTRY / f"rf_{h}d_{version}.pkl")["model"]
        p = model.predict_proba(X)[:, 1]
        y = hold[f"will_fail_{h}d"].to_numpy().astype(float)
        brier = brier_score_loss(y, p)
        ece = expected_calibration_error(y, p, n_bins=10)
        infl = p.mean() - y.mean()
        print(f"{h}d{'':<6}{p.mean():>11.3f}{y.mean():>13.3f}{infl:>+11.3f}{brier:>9.4f}{ece:>8.4f}"
              f"{'PASS' if ece < 0.05 else 'REVIEW':>8}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "v1.15")
