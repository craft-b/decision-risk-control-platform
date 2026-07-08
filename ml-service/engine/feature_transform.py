# ml-service/engine/feature_transform.py
#
# ML-6: single source of truth for model-space feature transforms.
#
# Both the training pipeline (fit=True) and the inference predictor (fit=False)
# call transform_features() so the exact ordered pipeline — usage-intensity cap,
# category encoding, log-transform, outlier clipping — is byte-for-byte identical
# at train and serve time.
#
# The bug this closes: training computed log features and THEN clipped (thresholds
# keyed on log_* names), while the predictor clipped FIRST and created log_* columns
# afterward — so log features were never clipped at inference, and the
# usage_intensity cap was skipped entirely. Same function name, different function.
# Now there is one function, one order.

import numpy as np
import pandas as pd

# Skewed features that get a log1p transform. The raw column is DROPPED and
# replaced by log_<col>: the log captures the same signal without the raw skew
# distorting tree split points, and prevents the model double-counting both.
LOG_COLS = [
    "total_hours_lifetime",
    "hours_used_30d",
    "hours_used_90d",
    "maintenance_cost_180d",
    "cost_per_event",
    "maint_burden",
    "mean_time_between_failures",
]

# usage_intensity is hours/day. The source feature already caps at 12
# (feature-engineering-enhanced.ts) and the DQ gate bounds it to [0, 12].
# Cap here too so an out-of-range serve input can never diverge from training.
USAGE_INTENSITY_CAP = 12.0

# Identifier / label columns — never model features.
NON_FEATURE_COLS = [
    "equipment_id",
    "snapshot_ts",
    "will_fail_10d",
    "will_fail_30d",
    "will_fail_60d",
]

# p99 × this multiplier is the per-column upper clip threshold (fit on dev only).
CLIP_P99_MULTIPLIER = 1.5


def _fit_clip_thresholds(df: pd.DataFrame) -> dict:
    """Compute per-column upper clip thresholds (p99 × 1.5) and apply them in place."""
    thresholds: dict = {}
    for col in df.select_dtypes(include=[np.number]).columns:
        p99 = df[col].quantile(0.99)
        if p99 > 0:
            t = float(p99 * CLIP_P99_MULTIPLIER)
            thresholds[col] = t
            df[col] = df[col].clip(upper=t)
    return thresholds


def transform_features(
    df: pd.DataFrame,
    *,
    label_encoder,
    clip_thresholds: dict | None = None,
    fit: bool = False,
    drop_non_features: bool = True,
):
    """
    Apply the canonical ordered model-space transform.

    Order (identical for train and serve):
      1. usage_intensity cap
      2. category → category_encoded (fit_transform in fit mode, transform in serve;
         unseen categories map to 0)
      3. drop identifier/label columns
      4. log-transform LOG_COLS: create log_<col>, drop the raw column
      5. clip outliers — thresholds now key on the post-log column set
      6. numeric coercion + fillna

    fit=True  (training): fits clip thresholds from this frame and returns them;
                          the passed label_encoder is fit here (caller serializes it).
    fit=False (serving):  applies the provided clip_thresholds and a pre-fit encoder.

    Returns (df_transformed, clip_thresholds).
    """
    df = df.copy()

    # 1. usage_intensity cap
    if "usage_intensity" in df.columns:
        df["usage_intensity"] = (
            pd.to_numeric(df["usage_intensity"], errors="coerce").clip(upper=USAGE_INTENSITY_CAP)
        )

    # 2. category encoding
    if "category" in df.columns:
        cats = df["category"].fillna("Unknown").astype(str)
        if fit:
            df["category_encoded"] = label_encoder.fit_transform(cats)
        else:
            known = set(label_encoder.classes_)
            unknown_mask = ~cats.isin(known)
            # transform() rejects unseen labels — substitute a known placeholder
            # then force those rows to 0 (the legacy serve fallback for unknowns).
            safe = cats.where(~unknown_mask, other=label_encoder.classes_[0])
            encoded = label_encoder.transform(safe)
            df["category_encoded"] = encoded
            if unknown_mask.any():
                df.loc[unknown_mask, "category_encoded"] = 0
        df.drop("category", axis=1, inplace=True)

    # 3. drop identifier / label columns
    if drop_non_features:
        df.drop(columns=[c for c in NON_FEATURE_COLS if c in df.columns], inplace=True)

    # 4. log-transform: create log_<col>, drop raw
    for col in LOG_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
            df[f"log_{col}"] = np.log1p(df[col].clip(lower=0))
            df.drop(col, axis=1, inplace=True)

    # 5. clip outliers (post-log column set)
    if fit:
        clip_thresholds = _fit_clip_thresholds(df)
    elif clip_thresholds:
        for col, t in clip_thresholds.items():
            if col in df.columns:
                df[col] = df[col].clip(upper=t)

    # 6. numeric coercion + fillna
    df = df.fillna(0)
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    return df, clip_thresholds
