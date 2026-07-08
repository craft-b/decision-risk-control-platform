-- ML-2 / ML-11: correct event_source provenance on legacy simulated breakdowns.
--
-- Context: the event_source column was added after most historical data was
-- generated, with a blanket default of SCHEDULED_PM. The legacy simulation
-- engine (since deleted) generated MAJOR_SERVICE events from an age/hours
-- hazard process — these events model unplanned breakdowns, not planned
-- overhauls, and are identifiable by their description prefix
-- "Simulated major service — age X.Xy / NNNNh".
--
-- Labeling v2 derives failure labels from event_source = 'REACTIVE_REPAIR'
-- only (so scheduled PM and model-driven interventions can never become
-- positive labels). That definition requires the hazard-generated breakdown
-- events to carry their true provenance.
--
-- Scope guard: only rows still carrying the backfill default are touched.
UPDATE maintenance_events
SET event_source = 'REACTIVE_REPAIR'
WHERE maintenance_type = 'MAJOR_SERVICE'
  AND event_source = 'SCHEDULED_PM'
  AND description LIKE 'Simulated major service — age%';
