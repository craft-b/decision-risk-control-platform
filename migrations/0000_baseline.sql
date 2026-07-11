CREATE TABLE `asset_feature_snapshots` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`equipment_id` bigint unsigned NOT NULL,
	`snapshot_ts` timestamp NOT NULL,
	`asset_age_years` decimal(10,2),
	`category` varchar(100),
	`total_hours_lifetime` decimal(10,2),
	`hours_used_30d` decimal(10,2),
	`hours_used_90d` decimal(10,2),
	`rental_days_30d` int,
	`rental_days_90d` int,
	`avg_rental_duration` decimal(10,2),
	`maintenance_events_90d` int,
	`maintenance_cost_180d` decimal(10,2),
	`avg_downtime_per_event` decimal(10,2),
	`days_since_last_maintenance` int,
	`mean_time_between_failures` int,
	`vendor_reliability_score` decimal(3,2),
	`jobsite_risk_score` decimal(3,2),
	`usage_intensity` decimal(8,4),
	`usage_trend` decimal(8,4),
	`utilization_vs_expected` decimal(8,4),
	`wear_rate` decimal(8,4),
	`aging_factor` decimal(8,4),
	`maint_overdue` decimal(8,4),
	`cost_per_event` decimal(10,2),
	`maint_burden` decimal(8,4),
	`mechanical_wear_score` decimal(5,2),
	`abuse_score` decimal(5,2),
	`neglect_score` decimal(5,2),
	`wear_rate_velocity` decimal(8,4),
	`maint_frequency_trend` decimal(8,4),
	`cost_trend` decimal(8,4),
	`hours_velocity` decimal(8,4),
	`neglect_acceleration` decimal(8,4),
	`sensor_degradation_rate` decimal(8,4),
	`will_fail_10d` int,
	`will_fail_30d` int,
	`will_fail_60d` int,
	`label_status` enum('observed','censored_intervention','censored_horizon'),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `asset_feature_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `asset_risk_predictions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`equipment_id` bigint unsigned NOT NULL,
	`snapshot_ts` timestamp NOT NULL,
	`failure_probability` decimal(5,4) NOT NULL,
	`risk_band` enum('LOW','MEDIUM','HIGH') NOT NULL,
	`top_driver_1` varchar(100),
	`top_driver_1_impact` decimal(5,4),
	`top_driver_2` varchar(100),
	`top_driver_2_impact` decimal(5,4),
	`top_driver_3` varchar(100),
	`top_driver_3_impact` decimal(5,4),
	`recommendation` text,
	`model_version` varchar(50) NOT NULL,
	`predicted_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `asset_risk_predictions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bias_drift_metrics` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`checked_at` timestamp NOT NULL DEFAULT (now()),
	`model_version` varchar(50),
	`batch_size` int NOT NULL,
	`category` varchar(100) NOT NULL,
	`horizon` smallint NOT NULL,
	`mean_score` decimal(8,6),
	`high_pct` decimal(5,4),
	`ref_high_pct` decimal(5,4),
	`deviation` decimal(5,4),
	`alert` tinyint DEFAULT 0,
	CONSTRAINT `bias_drift_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `drift_metrics` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`checked_at` timestamp NOT NULL DEFAULT (now()),
	`model_version` varchar(50),
	`batch_size` int NOT NULL,
	`feature` varchar(100) NOT NULL,
	`psi` decimal(10,6) NOT NULL,
	`status` enum('STABLE','WARNING','ALERT') NOT NULL,
	`ref_mean` decimal(14,4),
	`cur_mean` decimal(14,4),
	`ref_std` decimal(14,4),
	`cur_std` decimal(14,4),
	CONSTRAINT `drift_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `equipment` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`equipment_id` varchar(100) NOT NULL,
	`name` varchar(255) NOT NULL,
	`category` varchar(100) NOT NULL,
	`make` varchar(100),
	`model` varchar(100),
	`serial_number` varchar(100),
	`status` varchar(50) NOT NULL DEFAULT 'AVAILABLE',
	`daily_rate` decimal(10,2) NOT NULL,
	`weekly_rate` decimal(10,2),
	`monthly_rate` decimal(10,2),
	`location` varchar(255),
	`year_manufactured` int,
	`purchase_date` date,
	`current_mileage` decimal(10,2),
	`initial_mileage` decimal(10,2),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `equipment_id` PRIMARY KEY(`id`),
	CONSTRAINT `equipment_equipment_id_unique` UNIQUE(`equipment_id`),
	CONSTRAINT `equipment_serial_number_unique` UNIQUE(`serial_number`)
);
--> statement-breakpoint
CREATE TABLE `equipment_failure_predictions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`equipment_id` int NOT NULL,
	`predicted_at` timestamp NOT NULL DEFAULT (now()),
	`model_version` varchar(50) NOT NULL,
	`risk_trend` enum('INCREASING','DECREASING','STABLE') NOT NULL DEFAULT 'STABLE',
	`prob_10d` decimal(5,4) NOT NULL,
	`risk_level_10d` enum('LOW','MEDIUM','HIGH') NOT NULL,
	`prob_30d` decimal(5,4) NOT NULL,
	`risk_level_30d` enum('LOW','MEDIUM','HIGH') NOT NULL,
	`prob_60d` decimal(5,4) NOT NULL,
	`risk_level_60d` enum('LOW','MEDIUM','HIGH') NOT NULL,
	`top_drivers_10d` text,
	`top_drivers_30d` text,
	`top_drivers_60d` text,
	`recommendation` text,
	CONSTRAINT `equipment_failure_predictions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `equipment_risk_scores` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`equipment_id` int NOT NULL,
	`risk_score` int NOT NULL,
	`risk_level` varchar(20) NOT NULL,
	`drivers` text NOT NULL,
	`model_version` varchar(50) NOT NULL DEFAULT 'v1.0',
	`scored_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `equipment_risk_scores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `equipment_swaps` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`rental_id` int NOT NULL,
	`original_equipment_id` int NOT NULL,
	`replacement_equipment_id` int NOT NULL,
	`swap_date` date NOT NULL,
	`reason` text,
	`swapped_by` varchar(255),
	`notes` text,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `equipment_swaps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`rental_id` int NOT NULL,
	`invoice_number` varchar(100) NOT NULL,
	`invoice_date` date NOT NULL,
	`period_from` date NOT NULL,
	`period_to` date NOT NULL,
	`amount` decimal(10,2) NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoices_invoice_number_unique` UNIQUE(`invoice_number`)
);
--> statement-breakpoint
CREATE TABLE `job_sites` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`job_id` varchar(100) NOT NULL,
	`name` varchar(255) NOT NULL,
	`address` text,
	`contact_person` varchar(255),
	`contact_phone` varchar(50),
	`distance_miles` decimal(6,1) DEFAULT '25.0',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `job_sites_id` PRIMARY KEY(`id`),
	CONSTRAINT `job_sites_job_id_unique` UNIQUE(`job_id`)
);
--> statement-breakpoint
CREATE TABLE `maintenance_config` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`equipment_category` varchar(100) NOT NULL,
	`recommended_interval_days` int NOT NULL DEFAULT 180,
	`inspection_reset_factor` decimal(3,2) DEFAULT '0.90',
	`minor_service_reset_factor` decimal(3,2) DEFAULT '0.60',
	`major_service_reset_factor` decimal(3,2) DEFAULT '0.20',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `maintenance_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `maintenance_config_equipment_category_unique` UNIQUE(`equipment_category`)
);
--> statement-breakpoint
CREATE TABLE `maintenance_events` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`equipment_id` int NOT NULL,
	`maintenance_date` date NOT NULL,
	`maintenance_type` varchar(50) NOT NULL,
	`event_source` enum('SCHEDULED_PM','PREDICTIVE_INTERVENTION','REACTIVE_REPAIR','PRE_DISPATCH_INSPECTION') NOT NULL DEFAULT 'SCHEDULED_PM',
	`description` text,
	`performed_by` varchar(255),
	`cost` decimal(10,2),
	`next_due_date` date,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `maintenance_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `maintenance_overrides` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`equipment_id` bigint unsigned NOT NULL,
	`prediction_id` bigint unsigned,
	`overridden_by` bigint unsigned NOT NULL,
	`original_risk_band` varchar(20),
	`override_risk_band` varchar(20) NOT NULL,
	`reason` text,
	`action_taken` text,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `maintenance_overrides_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ml_models` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`model_version` varchar(50) NOT NULL,
	`model_type` varchar(50) NOT NULL,
	`trained_at` timestamp NOT NULL,
	`training_data_start` date NOT NULL,
	`training_data_end` date NOT NULL,
	`training_records` int NOT NULL,
	`roc_auc` decimal(5,4),
	`precision` decimal(5,4),
	`recall` decimal(5,4),
	`feature_schema` text,
	`status` enum('ACTIVE','ARCHIVED','TESTING') NOT NULL DEFAULT 'ACTIVE',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `ml_models_id` PRIMARY KEY(`id`),
	CONSTRAINT `ml_models_model_version_unique` UNIQUE(`model_version`)
);
--> statement-breakpoint
CREATE TABLE `model_metrics` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`model_version` varchar(50) NOT NULL,
	`horizon_days` int NOT NULL,
	`split` varchar(20) NOT NULL DEFAULT 'temporal',
	`metric` varchar(60) NOT NULL,
	`value` decimal(14,6) NOT NULL,
	`trained_at` timestamp NOT NULL,
	`dataset_size` int,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `model_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `model_training_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`model_version` varchar(50) NOT NULL,
	`trained_at` timestamp NOT NULL,
	`dataset_size` int NOT NULL,
	`accuracy` decimal(5,4) NOT NULL,
	`precision_high` decimal(5,4) NOT NULL,
	`recall_high` decimal(5,4) NOT NULL,
	`f1_high` decimal(5,4) NOT NULL,
	`precision_medium` decimal(5,4) NOT NULL,
	`recall_medium` decimal(5,4) NOT NULL,
	`f1_medium` decimal(5,4) NOT NULL,
	`precision_low` decimal(5,4) NOT NULL,
	`recall_low` decimal(5,4) NOT NULL,
	`f1_low` decimal(5,4) NOT NULL,
	`high_predicted_high` int NOT NULL,
	`high_predicted_medium` int NOT NULL,
	`high_predicted_low` int NOT NULL,
	`medium_predicted_high` int NOT NULL,
	`medium_predicted_medium` int NOT NULL,
	`medium_predicted_low` int NOT NULL,
	`low_predicted_high` int NOT NULL,
	`low_predicted_medium` int NOT NULL,
	`low_predicted_low` int NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `model_training_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prediction_drift_metrics` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`checked_at` timestamp NOT NULL DEFAULT (now()),
	`model_version` varchar(50),
	`batch_size` int NOT NULL,
	`horizon` smallint NOT NULL,
	`score_psi` decimal(10,6) NOT NULL,
	`score_status` enum('STABLE','WARNING','ALERT') NOT NULL,
	`high_pct` decimal(5,4),
	`medium_pct` decimal(5,4),
	`low_pct` decimal(5,4),
	`ref_high_pct` decimal(5,4),
	`ref_medium_pct` decimal(5,4),
	`ref_low_pct` decimal(5,4),
	CONSTRAINT `prediction_drift_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rentals` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`equipment_id` int NOT NULL,
	`job_site_id` int NOT NULL,
	`vendor_id` int,
	`po_number` varchar(100),
	`receive_date` date NOT NULL,
	`receive_hours` decimal(10,2),
	`receive_document` varchar(255),
	`return_date` date,
	`return_hours` decimal(10,2),
	`return_document` varchar(255),
	`buy_rent` varchar(10) NOT NULL DEFAULT 'RENT',
	`status` varchar(50) NOT NULL DEFAULT 'ACTIVE',
	`notes` text,
	`operator_name` varchar(255),
	`delivery_method` varchar(30) NOT NULL DEFAULT 'CUSTOMER_PICKUP',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `rentals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sensor_data_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`equipment_id` int NOT NULL,
	`timestamp` timestamp NOT NULL,
	`engine_rpm` int,
	`engine_temp` int,
	`oil_pressure` int,
	`coolant_temp` int,
	`fuel_consumption` decimal(10,2),
	`hydraulic_pressure` int,
	`hydraulic_temp` int,
	`hydraulic_flow_rate` int,
	`vibration_x` decimal(6,3),
	`vibration_y` decimal(6,3),
	`vibration_z` decimal(6,3),
	`operating_hours` decimal(10,2),
	`load_percentage` int,
	`idle_time` decimal(10,2),
	`ambient_temp` int,
	`error_codes` text,
	`warning_count` int,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `sensor_data_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `simulation_state` (
	`id` int AUTO_INCREMENT NOT NULL,
	`cursor_date` varchar(10) NOT NULL,
	`total_days_run` int NOT NULL DEFAULT 0,
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `simulation_state_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`username` varchar(255) NOT NULL,
	`password` varchar(255) NOT NULL,
	`role` varchar(50) NOT NULL DEFAULT 'VIEWER',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`vendor_id` varchar(100) NOT NULL,
	`name` varchar(255) NOT NULL,
	`address` text,
	`sales_person` varchar(255),
	`contact` varchar(255),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `vendors_id` PRIMARY KEY(`id`),
	CONSTRAINT `vendors_vendor_id_unique` UNIQUE(`vendor_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_checked_at` ON `bias_drift_metrics` (`checked_at`);--> statement-breakpoint
CREATE INDEX `idx_category` ON `bias_drift_metrics` (`category`);--> statement-breakpoint
CREATE INDEX `idx_checked_at` ON `drift_metrics` (`checked_at`);--> statement-breakpoint
CREATE INDEX `idx_feature` ON `drift_metrics` (`feature`);--> statement-breakpoint
CREATE INDEX `idx_checked_at` ON `prediction_drift_metrics` (`checked_at`);--> statement-breakpoint
CREATE INDEX `idx_horizon` ON `prediction_drift_metrics` (`horizon`);--> statement-breakpoint
CREATE INDEX `idx_equipment_ts` ON `sensor_data_logs` (`equipment_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_timestamp` ON `sensor_data_logs` (`timestamp`);