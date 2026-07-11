-- ML-11: label integrity — censoring status on feature snapshots.
-- NULL = not yet evaluated by the labeler.
--   observed              : outcome window fully elapsed; labels are ground truth
--   censored_intervention : a PREDICTIVE_INTERVENTION landed in the label window
--                           before any failure; counterfactual unknowable — row is
--                           excluded from training and prevalence accounting
--   censored_horizon      : 60d outcome window hasn't elapsed yet
ALTER TABLE asset_feature_snapshots
  ADD COLUMN label_status ENUM('observed', 'censored_intervention', 'censored_horizon')
    NULL DEFAULT NULL
    AFTER will_fail_60d;
