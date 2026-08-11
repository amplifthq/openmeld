PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP INDEX `openMeldDaemon_space_diagnostic_report_wake_pointer_unique`;--> statement-breakpoint
DROP INDEX `idx_openMeldDaemon_space_diagnostic_report_wake_pointers_report`;--> statement-breakpoint
DROP INDEX `idx_openMeldDaemon_space_diagnostic_report_wake_pointers_client`;--> statement-breakpoint
DROP INDEX `idx_openMeldDaemon_space_diagnostic_report_wake_pointers_target`;--> statement-breakpoint
CREATE TABLE `__new_openMeldDaemon_space_diagnostic_report_wake_pointers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`diagnostic_report_id` text NOT NULL,
	`space_id` text NOT NULL,
	`client_message_id` text,
	`source_signal_id` text NOT NULL,
	`target_profile_id` text NOT NULL,
	`created_at_ms` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_openMeldDaemon_space_diagnostic_report_wake_pointers`("id", "diagnostic_report_id", "space_id", "client_message_id", "source_signal_id", "target_profile_id", "created_at_ms") SELECT "id", "diagnostic_report_id", "space_id", "client_message_id", "source_signal_id", "target_profile_id", "created_at_ms" FROM `openMeldDaemon_space_diagnostic_report_wake_pointers`;--> statement-breakpoint
DROP TABLE `openMeldDaemon_space_diagnostic_report_wake_pointers`;--> statement-breakpoint
ALTER TABLE `__new_openMeldDaemon_space_diagnostic_report_wake_pointers` RENAME TO `openMeldDaemon_space_diagnostic_report_wake_pointers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_space_diagnostic_report_wake_pointer_unique` ON `openMeldDaemon_space_diagnostic_report_wake_pointers` (`diagnostic_report_id`,`source_signal_id`,`target_profile_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_report_wake_pointers_report` ON `openMeldDaemon_space_diagnostic_report_wake_pointers` (`diagnostic_report_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_report_wake_pointers_client` ON `openMeldDaemon_space_diagnostic_report_wake_pointers` (`space_id`,`client_message_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_space_diagnostic_report_wake_pointers_target` ON `openMeldDaemon_space_diagnostic_report_wake_pointers` (`space_id`,`target_profile_id`,"created_at_ms" desc);
