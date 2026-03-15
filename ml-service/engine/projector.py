# ml-service/engine/projector.py
# Forward projection engine — given a feature snapshot, projects failure
# probability forward day-by-day by analytically aging features.
#
# Answers: "If this unit is NOT serviced, when does it cross HIGH threshold?"
#
# Aging strategy per feature:
#   INCREMENT each step: asset_age_years, days_since_last_maintenance,
#                        aging_factor, maint_overdue, neglect_score,
#                        neglect_acceleration, sensor_degradation_rate,
#                        log_total_hours_lifetime (via hours_velocity)
#   FIXED throughout:    all rolling-window features (maintenance_events_90d,
#                        maintenance_cost_180d, rental_days, etc.) — conservative
#                        assumption: no new maintenance occurs during projection

import copy
import math
import numpy as np
from typing import Optional

from engine.predictor_multihorizon import MultiHorizonPredictor, RISK_THRESHOLDS

STEP_DAYS   = 7    # project in 7-day increments
MAX_DAYS    = 60   # maximum projection horizon
HIGH_THRESHOLD_DEFAULT = 0.60  # fallback if not in RISK_THRESHOLDS


def _age_snapshot(base: dict, step: int) -> dict:
    """
    Return a new snapshot dict with time-dependent features advanced by `step` days.
    All other features are held fixed (conservative: assumes no maintenance).
    """
    s = copy.deepcopy(base)

    # ── Core age / time features ──────────────────────────────────────────────
    s["asset_age_years"]           = base["asset_age_years"] + step / 365.25
    s["days_since_last_maintenance"] = (base.get("days_since_last_maintenance") or 0) + step

    # ── Derived from age ──────────────────────────────────────────────────────
    s["aging_factor"]   = min(s["asset_age_years"] / 10.0, 1.0)
    s["maint_overdue"]  = max(s["days_since_last_maintenance"] - 90, 0) / 365.0
    s["neglect_score"]  = max(
        s["maint_overdue"] + (base.get("cost_per_event", 0) > 5000 and 0.3 or 0), 0
    )
    s["neglect_acceleration"] = (
        s["neglect_score"] * (1 + s["aging_factor"])
        if s["maint_overdue"] > 0 else 0
    )
    s["sensor_degradation_rate"] = (
        0.05 + s["aging_factor"] * 0.1 if s["aging_factor"] > 0.5 else 0.05
    )

    # ── Hours accumulation ────────────────────────────────────────────────────
    # hours_velocity is hours/day — advance lifetime hours accordingly
    daily_hours = base.get("hours_velocity", 0)
    if daily_hours > 0:
        raw_hours_base = math.expm1(base.get("log_total_hours_lifetime", 0))  # inverse log1p
        raw_hours_aged = raw_hours_base + daily_hours * step
        s["log_total_hours_lifetime"] = math.log1p(max(raw_hours_aged, 0))

        # Recompute wear_rate from aged hours
        if s["asset_age_years"] > 0:
            s["wear_rate"] = raw_hours_aged / s["asset_age_years"]
        else:
            s["wear_rate"] = base.get("wear_rate", 0)

        # Recompute mechanical_wear_score from aged wear_rate
        maint_burden = math.expm1(base.get("log_maint_burden", 0))
        s["mechanical_wear_score"] = min(
            (s["wear_rate"] / 2000) + (maint_burden / 10), 1.0
        )

    return s


def project(
    snapshot: dict,
    predictor: MultiHorizonPredictor,
    step_days: int = STEP_DAYS,
    max_days:  int = MAX_DAYS,
) -> dict:
    """
    Project failure probability forward from the current snapshot.

    Returns:
        {
          "equipment_id": int,
          "step_days": int,
          "curve": [
            {"day": 0,  "10d": 0.23, "30d": 0.41, "60d": 0.67},
            {"day": 7,  "10d": 0.27, ...},
            ...
          ],
          "threshold_crossings": {
            "10d": 14,   # day on which P crosses HIGH threshold (null if never)
            "30d": 28,
            "60d": null
          },
          "days_until_high": int | null   # earliest crossing across all horizons
        }
    """
    equipment_id = snapshot.get("equipment_id")
    curve        = []
    crossings    = {"10d": None, "30d": None, "60d": None}

    steps = list(range(0, max_days + step_days, step_days))

    for day in steps:
        aged = _age_snapshot(snapshot, day)
        if day in (0, 63):
            print(f"[PROJ DEBUG] day={day} age={aged['asset_age_years']:.3f} dsm={aged['days_since_last_maintenance']} neglect={aged['neglect_score']:.4f} aging_factor={aged['aging_factor']:.4f}")
        result = predictor.predict_multi_horizon(aged)
        preds  = result["predictions"]

        point = {"day": day}
        for h in [10, 30, 60]:
            key   = f"{h}d"
            prob  = preds[key]["failure_probability"]
            point[key] = round(prob, 4)

            # Record first crossing of HIGH threshold
            threshold = RISK_THRESHOLDS[h].get("HIGH", HIGH_THRESHOLD_DEFAULT)
            if crossings[key] is None and prob >= threshold:
                crossings[key] = day

        curve.append(point)

    # Earliest crossing across all three horizons
    crossing_values = [v for v in crossings.values() if v is not None]
    days_until_high: Optional[int] = min(crossing_values) if crossing_values else None

    return {
        "equipment_id":      equipment_id,
        "step_days":         step_days,
        "max_days":          max_days,
        "curve":             curve,
        "threshold_crossings": crossings,
        "days_until_high":   days_until_high,
    }