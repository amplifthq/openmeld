CREATE TABLE `openmeld_service_connection_incidents` (
	`owner_user_id` text NOT NULL,
	`incident_id` text NOT NULL,
	`device_id` text NOT NULL,
	`runtime_lane` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`ended_at_ms` integer NOT NULL,
	`received_at_ms` integer NOT NULL,
	`payload_json` text NOT NULL,
	PRIMARY KEY(`owner_user_id`, `incident_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_service_connection_incidents_owner_device` ON `openmeld_service_connection_incidents` (`owner_user_id`,`device_id`,`runtime_lane`,"ended_at_ms" desc);--> statement-breakpoint
CREATE INDEX `idx_service_connection_incidents_retention` ON `openmeld_service_connection_incidents` (`received_at_ms`);