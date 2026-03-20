# ml-service/engine/drift_detector.py
# PSI (Population Stability Index) drift detection on monitored features.
#
# Design rationale:
#   PSI is computed on RAW feature values (pre-transformation), matching the
#   input space that operators and domain experts can reason about. Log-
#   transformed variants are model-internal — PSI on them conflates model
#   preprocessing with real-world distribution shift.
#
# PSI interpretation:
#   < 0.10  STABLE  — no action needed
#   < 0.20  WARNING — monitor; consider scheduled retrain
#   ≥ 0.20  ALERT   — significant shift; investigate and likely retrain
#
# Reference distribution:
#   Saved as drift_reference_<version>.json in registry/ after each training
#   run (sampled from the full training dataset at label time). Loaded at
#   predictor startup. Bootstrap via POST /drift/compute-reference if no
#   retrain has been run yet.

import json
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Optional

REGISTRY = Path(__file__).parent.parent / "registry"

# Features to monitor — chosen for: (a) high model importance, (b) most
# likely to shift as the simulated fleet ages or usage patterns change.
# Features to monitor — requirements for PSI:
#   (a) non-degenerate distribution in training data (p25 ≠ p75)
#   (b) no severe zero-inflation (would collapse quantile bins)
#   (c) meaningful covariate to monitor for operational shift
#
# Excluded due to simulation-data artifacts:
#   asset_age_years         — 52% negative values (computed vs. a future date in sim)
#   days_since_last_maintenance — 100% zero in training sample (default on initialization)
#   total_hours_lifetime    — 72% zero in training sample
#   jobsite_risk_score      — constant 0.30 in training (all jobs assigned same default)
#   vendor_reliability_score — bi-modal at {0.40, 0.95} only; works but low signal
#   wear_rate_velocity      — 72% zero
#
# In production: reference distribution would be built from a stable live-traffic
# window rather than from initialization-heavy training snapshots.
MONITORED_FEATURES = [
    "mean_time_between_failures",   # reliability signal — shifts as fleet ages
    "vendor_reliability_score",     # external dependency — shifts if vendor mix changes
]

PSI_WARNING_THRESHOLD = 0.10
PSI_ALERT_THRESHOLD   = 0.20
# Bin count: PSI requires ≥5 observations/bin to be reliable.
# For fleet-scale batches (~68 items), 5 bins gives adequate coverage.
# The thresholds 0.1/0.2 are calibrated for these bin counts.
N_BINS         = 5
MIN_BATCH_SIZE = 20  # PSI is unreliable below this


# ─────────────────────────────────────────────────────────────────────────────
# CORE MATH
# ─────────────────────────────────────────────────────────────────────────────

def compute_psi(reference: np.ndarray, current: np.ndarray, n_bins: int = N_BINS) -> float:
    """
    PSI between reference (training) and current (inference) distributions.

    Bins are defined by reference quantiles so that each bin has roughly equal
    expected mass — this is more robust than fixed-width bins for skewed
    features like total_hours_lifetime.
    """
    # Principled smoothing: one phantom observation per distribution.
    # 1e-6 would make log(cur/ref) ≈ 13 whenever a bin is empty — inflating
    # PSI badly on skewed distributions with small batches. 1/n is more
    # principled: empty bins contribute at most ~log(n) per bin.
    smooth = 1.0 / min(len(reference), len(current))

    # Build bin edges from reference quantiles
    breaks = np.nanquantile(reference, np.linspace(0, 1, n_bins + 1))
    breaks[0]  -= smooth
    breaks[-1] += smooth
    breaks = np.unique(breaks)   # deduplicate (can happen with low-variance features)
    if len(breaks) < 3:
        return 0.0               # can't compute meaningful PSI

    ref_counts, _ = np.histogram(reference, bins=breaks)
    cur_counts, _ = np.histogram(current,   bins=breaks)

    ref_pct = ref_counts / max(len(reference), 1)
    cur_pct = cur_counts / max(len(current),   1)

    # Additive smoothing — prevents log(0), keeps magnitude bounded
    ref_pct = np.where(ref_pct == 0, smooth, ref_pct)
    cur_pct = np.where(cur_pct == 0, smooth, cur_pct)

    psi = float(np.sum((cur_pct - ref_pct) * np.log(cur_pct / ref_pct)))
    return round(max(psi, 0.0), 6)   # PSI is non-negative by construction


def _psi_status(psi: float) -> str:
    if psi >= PSI_ALERT_THRESHOLD:
        return "ALERT"
    if psi >= PSI_WARNING_THRESHOLD:
        return "WARNING"
    return "STABLE"


# ─────────────────────────────────────────────────────────────────────────────
# DETECTOR
# ─────────────────────────────────────────────────────────────────────────────

class DriftDetector:
    """
    Loads reference distributions at startup and computes PSI post-batch-
    prediction. Results are written to the drift_metrics table so the ops
    team can query trend over time.
    """

    def __init__(self):
        self.reference: dict[str, np.ndarray] = {}
        self.ref_model_version: Optional[str] = None
        self._load_reference()
        self._ensure_table()

    # ── Startup ──────────────────────────────────────────────────────────────

    def _load_reference(self):
        def _mtime(p: Path): return p.stat().st_mtime

        ref_files = sorted(REGISTRY.glob("drift_reference_*.json"), key=_mtime, reverse=True)
        # Also check unversioned fallback (written by compute_reference_from_db)
        fallback  = REGISTRY / "drift_reference.json"

        target = ref_files[0] if ref_files else (fallback if fallback.exists() else None)
        if target is None:
            print("[DRIFT] No reference file found — drift detection inactive. "
                  "Call POST /drift/compute-reference to bootstrap.")
            return

        with open(target) as f:
            data = json.load(f)

        for feat, values in data.get("features", {}).items():
            arr = np.array(values, dtype=float)
            if len(arr) >= MIN_BATCH_SIZE:
                self.reference[feat] = arr

        self.ref_model_version = data.get("model_version")
        print(f"[DRIFT] Reference loaded — {len(self.reference)} features, "
              f"n={data.get('n_samples','?')}, model={self.ref_model_version}")

    def _ensure_table(self):
        """Auto-provision drift_metrics if it doesn't exist."""
        try:
            from sqlalchemy import text as sqla_text
            engine = self._get_engine()
            with engine.connect() as conn:
                conn.execute(sqla_text("""
                    CREATE TABLE IF NOT EXISTS drift_metrics (
                        id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                        checked_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        model_version VARCHAR(50),
                        batch_size    INT NOT NULL,
                        feature       VARCHAR(100) NOT NULL,
                        psi           DECIMAL(10, 6) NOT NULL,
                        status        ENUM('STABLE','WARNING','ALERT') NOT NULL,
                        ref_mean      DECIMAL(14, 4),
                        cur_mean      DECIMAL(14, 4),
                        ref_std       DECIMAL(14, 4),
                        cur_std       DECIMAL(14, 4),
                        INDEX idx_checked_at (checked_at),
                        INDEX idx_feature    (feature)
                    )
                """))
                conn.commit()
            engine.dispose()
            print("[DRIFT] drift_metrics table ready")
        except Exception as e:
            print(f"[DRIFT] Table init warning: {e}")

    # ── Public API ────────────────────────────────────────────────────────────

    def check(self, snapshots: list, model_version: str = "unknown") -> dict:
        """
        Compute PSI for each monitored feature against the training reference.
        Persists results to drift_metrics.
        Returns a summary dict — safe to include in the batch prediction response.
        """
        if not self.reference:
            return {"status": "inactive", "reason": "no reference distribution loaded"}
        if len(snapshots) < MIN_BATCH_SIZE:
            return {"status": "skipped",
                    "reason": f"batch too small ({len(snapshots)} < {MIN_BATCH_SIZE})"}

        df  = pd.DataFrame(snapshots)
        results: dict[str, dict] = {}
        alerts: list[str] = []

        for feat in MONITORED_FEATURES:
            if feat not in self.reference or feat not in df.columns:
                continue

            ref_arr = self.reference[feat]
            cur_arr = pd.to_numeric(df[feat], errors="coerce").dropna().values
            if len(cur_arr) < 5:
                continue

            psi    = compute_psi(ref_arr, cur_arr)
            status = _psi_status(psi)

            if status == "ALERT":
                alerts.append(feat)

            results[feat] = {
                "psi":      psi,
                "status":   status,
                "ref_mean": round(float(np.mean(ref_arr)), 4),
                "cur_mean": round(float(np.mean(cur_arr)), 4),
                "ref_std":  round(float(np.std(ref_arr)),  4),
                "cur_std":  round(float(np.std(cur_arr)),  4),
            }

        overall = (
            "ALERT"   if alerts else
            "WARNING" if any(v["status"] == "WARNING" for v in results.values()) else
            "STABLE"
        )

        if alerts:
            print(f"[DRIFT] ALERT — significant shift detected in: {alerts}")
        else:
            print(f"[DRIFT] {overall} (batch_size={len(snapshots)})")

        self._persist(results, len(snapshots), model_version)

        return {
            "status":        overall,
            "batch_size":    len(snapshots),
            "model_version": model_version,
            "alerts":        alerts,
            "features":      results,
        }

    def get_latest(self, n_features: int = 20) -> list[dict]:
        """Return the most recent PSI row per feature from drift_metrics."""
        try:
            from sqlalchemy import text as sqla_text
            engine = self._get_engine()
            with engine.connect() as conn:
                rows = conn.execute(sqla_text("""
                    SELECT d1.*
                    FROM drift_metrics d1
                    INNER JOIN (
                        SELECT feature, MAX(checked_at) AS latest
                        FROM drift_metrics
                        GROUP BY feature
                    ) d2 ON d1.feature = d2.feature AND d1.checked_at = d2.latest
                    ORDER BY d1.psi DESC
                    LIMIT :n
                """), {"n": n_features}).fetchall()
            engine.dispose()
            return [dict(r._mapping) for r in rows]
        except Exception as e:
            print(f"[DRIFT] get_latest error: {e}")
            return []

    def compute_reference_from_db(self, model_version: str = "bootstrap") -> dict:
        """
        Build reference distribution directly from asset_feature_snapshots.
        Used to bootstrap drift detection without triggering a full retrain.
        Saves drift_reference.json to registry/.
        """
        try:
            from sqlalchemy import text as sqla_text
            engine = self._get_engine()
            cols   = ", ".join(MONITORED_FEATURES)
            df = pd.read_sql(
                f"SELECT {cols} FROM asset_feature_snapshots ORDER BY snapshot_ts",
                engine
            )
            engine.dispose()
        except Exception as e:
            return {"success": False, "error": str(e)}

        sample = df.sample(min(5000, len(df)), random_state=42)
        features = {}
        for feat in MONITORED_FEATURES:
            if feat in sample.columns:
                vals = pd.to_numeric(sample[feat], errors="coerce").dropna().tolist()
                features[feat] = [round(v, 6) for v in vals]
                self.reference[feat] = np.array(features[feat])

        ref_data = {
            "model_version": model_version,
            "n_samples":     len(sample),
            "features":      features,
            "saved_at":      pd.Timestamp.now().isoformat(),
        }

        out = REGISTRY / "drift_reference.json"
        with open(out, "w") as f:
            json.dump(ref_data, f, indent=2)

        self.ref_model_version = model_version
        print(f"[DRIFT] Reference computed from DB — {len(features)} features, n={len(sample)}")
        return {"success": True, "n_samples": len(sample), "features": list(features.keys())}

    # ── Internal ──────────────────────────────────────────────────────────────

    def _get_engine(self):
        import os
        from dotenv import load_dotenv
        from sqlalchemy import create_engine
        env_path = Path(__file__).parent.parent.parent / ".env"
        load_dotenv(dotenv_path=env_path)
        url = (
            f"mysql+pymysql://{os.getenv('DB_USER','root')}:{os.getenv('DB_PASSWORD','')}"
            f"@{os.getenv('DB_HOST','localhost')}:{os.getenv('DB_PORT','3306')}"
            f"/{os.getenv('DB_NAME','asset_inventory')}"
        )
        return create_engine(url, pool_pre_ping=True)

    def _persist(self, results: dict, batch_size: int, model_version: str):
        try:
            from sqlalchemy import text as sqla_text
            engine = self._get_engine()
            with engine.connect() as conn:
                for feat, r in results.items():
                    conn.execute(sqla_text("""
                        INSERT INTO drift_metrics
                            (model_version, batch_size, feature, psi, status,
                             ref_mean, cur_mean, ref_std, cur_std)
                        VALUES
                            (:mv, :bs, :feat, :psi, :status, :rm, :cm, :rs, :cs)
                    """), {
                        "mv":     model_version,
                        "bs":     batch_size,
                        "feat":   feat,
                        "psi":    r["psi"],
                        "status": r["status"],
                        "rm":     r["ref_mean"],
                        "cm":     r["cur_mean"],
                        "rs":     r["ref_std"],
                        "cs":     r["cur_std"],
                    })
                conn.commit()
            engine.dispose()
        except Exception as e:
            print(f"[DRIFT] DB persist warning: {e}")
