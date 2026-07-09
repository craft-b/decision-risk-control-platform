# ml-service/engine/projector.py
# Forward projection engine — given a feature snapshot, projects failure
# probability forward day-by-day by aging the RAW snapshot fields and letting
# the predictor's shared transform derive the model-space features.
#
# Answers: "If this unit is NOT serviced, when does it cross HIGH threshold?"
#
# ML-8: the previous version re-derived features with formulas that didn't match
# the TypeScript feature engineering — it made `maint_overdue` continuous (trained
# binary), recomputed the 0–10 composite scores on a 0–1 scale, and read
# `log_total_hours_lifetime` from the raw snapshot (which has no log_* columns),
# so hours aging always started from 0. Every projected point was fed
# out-of-distribution inputs. This version ages only the genuinely
# time-dependent RAW inputs (age, days-since-service, lifetime hours) and
# re-derives the handful of features that have exact closed-form definitions in
# feature-engineering-enhanced.ts, on the correct scale and type. Composite
# scores that depend on operational data we don't have during projection
# (abuse, sensor, usage, cost, rental) are held fixed — the conservative
# "no new activity" assumption.

from typing import Optional

from engine.predictor_multihorizon import MultiHorizonPredictor, RISK_THRESHOLDS

STEP_DAYS   = 7    # project in 7-day increments
MAX_DAYS    = 60   # maximum projection horizon
HIGH_THRESHOLD_DEFAULT = 0.60  # fallback if not in RISK_THRESHOLDS

# maintenance_config.recommended_interval_days effective default. Kept as a
# constant because the projection has no access to the per-category config row;
# used only to advance the binary maint_overdue flag and neglect_acceleration.
MAINT_INTERVAL_DAYS = 90


# ── Closed-form feature derivations — mirror feature-engineering-enhanced.ts ──
# Kept tiny and exact so an aged raw input maps to the same value the TS layer
# would have produced (keeps projected snapshots in-distribution).

def _mechanical_wear_score(total_hours: float, age_years: float) -> float:
    hours_factor = min(total_hours / 5000, 1)
    age_factor = min(age_years / 8, 1)
    return min(hours_factor * 5 + age_factor * 5, 10)


def _aging_factor(age_years: float) -> float:
    return min(age_years / 10.0, 1.0)


def _wear_rate(total_hours: float, age_years: float, fallback: float) -> float:
    return total_hours / (age_years * 8760) if age_years > 0 else fallback


def _neglect_score(days_since: float, maint_overdue: int) -> float:
    neglect_days_factor = min(days_since / 120, 1) if days_since is not None else 0.5
    return min(max(0, neglect_days_factor * 7 + (3 if maint_overdue else 0)), 10)


def _neglect_acceleration(days_since: float) -> float:
    if days_since is None or MAINT_INTERVAL_DAYS <= 0:
        return 1.0
    return min(days_since / MAINT_INTERVAL_DAYS, 3.0)


def _age_snapshot(base: dict, step: int) -> dict:
    """
    Advance the time-dependent RAW fields by `step` days and re-derive the
    closed-form features. Day 0 returns the snapshot unchanged, so a day-0
    projection is bit-identical to a live prediction (property-tested).
    """
    if step == 0:
        return dict(base)

    s = dict(base)

    # ── Raw time-dependent inputs ─────────────────────────────────────────────
    age = base["asset_age_years"] + step / 365.25
    days_since = (base.get("days_since_last_maintenance") or 0) + step
    # Advance lifetime hours by the observed daily operating rate (hours/day).
    daily_hours = (base.get("hours_used_30d") or 0) / 30.0
    total_hours = (base.get("total_hours_lifetime") or 0) + daily_hours * step

    s["asset_age_years"] = age
    s["days_since_last_maintenance"] = days_since
    s["total_hours_lifetime"] = total_hours

    # ── Closed-form derivations (correct scale + type) ────────────────────────
    s["aging_factor"] = _aging_factor(age)
    s["wear_rate"] = _wear_rate(total_hours, age, base.get("wear_rate", 0))
    s["maint_overdue"] = 1 if days_since > MAINT_INTERVAL_DAYS else int(base.get("maint_overdue", 0))
    s["mechanical_wear_score"] = _mechanical_wear_score(total_hours, age)
    s["neglect_score"] = _neglect_score(days_since, s["maint_overdue"])
    s["neglect_acceleration"] = _neglect_acceleration(days_since)

    # Everything else (abuse_score, sensor_degradation_rate, usage_*, cost_*,
    # maintenance_*, rental_*, vendor/jobsite scores) is held fixed — projection
    # assumes no new operational activity, so those inputs don't change.
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

    # 0, step, 2·step, … up to and including max_days — no overshoot past max_days.
    steps = list(range(0, max_days, step_days))
    if steps[-1] != max_days:
        steps.append(max_days)

    for day in steps:
        aged   = _age_snapshot(snapshot, day)
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
