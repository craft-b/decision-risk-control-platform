"""What is the best AUC anyone could score on this simulated data?

The fleet simulator draws failures from a closed-form hazard over three
variables — asset age, lifetime hours, and days since maintenance — and the
model receives all three, plus features derived from them and counts of prior
draws from the same hazard. So the learning task is to recover a known monotone
function of its own inputs.

Labels are Bernoulli draws from that probability, which caps AUC well below 1.0
even for an oracle that knows the probability exactly. This script computes
that cap. If the trained model scores at it, the metric is saturated: it
verifies the pipeline wires up correctly and cannot distinguish model quality.

Hazard reproduced verbatim from `server/routes.ts` (the Weibull-inspired block
in the seed simulator). Keep the two in sync — a drift check lives in
`tests/test_qa_guards.py`.

Usage:
    python -m analysis.bayes_ceiling
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import roc_auc_score

HORIZONS = (10, 30, 60)
N_ASSETS = 200_000
SEED = 7

#: What the trained model reports on the temporal holdout, for comparison.
REPORTED_AUC = {10: 0.9272, 30: 0.8823, 60: 0.8024}

#: Fleet spreads to test. The simulator's exact asset distribution is not
#: recorded, so the ceiling is reported as a range rather than a point.
FLEET_PROFILES = {
    "baseline": {"max_age_years": 10.0, "hours_per_year": 900.0},
    "younger": {"max_age_years": 6.0, "hours_per_year": 700.0},
    "older": {"max_age_years": 14.0, "hours_per_year": 1100.0},
}


def daily_failure_probability(
    age_years: np.ndarray,
    total_hours: np.ndarray,
    days_since_maint: np.ndarray,
    stressed: np.ndarray,
) -> np.ndarray:
    """The simulator's hazard, verbatim from server/routes.ts."""
    age_hazard = np.minimum(
        0.01 * np.exp(0.55 * np.maximum(0.0, age_years - 1.5)), 0.25
    )
    hours_hazard = np.minimum(
        0.005 * np.exp(0.0004 * np.maximum(0.0, total_hours - 3000.0)), 0.20
    )
    neglect_hazard = np.where(
        days_since_maint > 120,
        np.minimum(
            0.002 * np.power(np.maximum(days_since_maint - 90.0, 0.0), 1.4), 0.15
        ),
        0.0,
    )
    daily = np.minimum(age_hazard + hours_hazard + neglect_hazard, 0.30)
    return np.minimum(daily * np.where(stressed, 1.8, 1.0), 0.35)


def sample_fleet(profile: dict, rng: np.random.Generator) -> np.ndarray:
    age = rng.uniform(0.0, profile["max_age_years"], N_ASSETS)
    hours = np.maximum(0.0, age * rng.normal(profile["hours_per_year"], 250.0, N_ASSETS))
    days_since_maint = rng.gamma(2.0, 45.0, N_ASSETS)
    stressed = rng.random(N_ASSETS) < 0.25
    return daily_failure_probability(age, hours, days_since_maint, stressed)


def ceiling_for(p_daily: np.ndarray, horizon: int, rng: np.random.Generator):
    """AUC of an oracle scoring by the true probability."""
    p_horizon = 1.0 - (1.0 - p_daily) ** horizon
    outcome = rng.random(len(p_horizon)) < p_horizon
    if outcome.all() or not outcome.any():
        return float("nan"), float(outcome.mean())
    return float(roc_auc_score(outcome, p_horizon)), float(outcome.mean())


def main() -> int:
    rng = np.random.default_rng(SEED)

    print("Bayes-optimal AUC — an oracle that knows the exact failure probability")
    print(f"{N_ASSETS:,} simulated assets per profile\n")
    print(f"{'horizon':>8}{'profile':>12}{'base rate':>12}{'ceiling':>10}{'reported':>10}")
    print("-" * 52)

    ceilings: dict[int, list[float]] = {h: [] for h in HORIZONS}
    for name, profile in FLEET_PROFILES.items():
        p_daily = sample_fleet(profile, rng)
        for horizon in HORIZONS:
            auc, base = ceiling_for(p_daily, horizon, rng)
            ceilings[horizon].append(auc)
            reported = REPORTED_AUC[horizon] if name == "baseline" else None
            print(f"{horizon:>7}d{name:>12}{base:>11.1%}{auc:>10.4f}"
                  f"{f'{reported:.4f}' if reported else '':>10}")

    print("-" * 52)
    print("\nVerdict per horizon:")
    for horizon in HORIZONS:
        low, high = min(ceilings[horizon]), max(ceilings[horizon])
        reported = REPORTED_AUC[horizon]
        if reported >= low:
            verdict = "inside the band — saturated, metric cannot rank quality"
        else:
            verdict = "below the band — genuine headroom remains"
        print(f"  {horizon:2d}d  ceiling {low:.2f}-{high:.2f}  reported {reported:.4f}"
              f"  ->  {verdict}")

    print(
        "\nReading this correctly matters. No model can beat an oracle that knows\n"
        "the true probability, so a reported AUC above the estimated ceiling means\n"
        "the assumed fleet risk spread is too narrow — not that the model won.\n"
        "What the comparison establishes is whether a horizon sits in the\n"
        "saturated regime: inside the band, the metric confirms the pipeline\n"
        "wires up and cannot distinguish a good model from an adequate one.\n"
        "Below the band, there is signal the model has not captured."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
