ALTER TABLE `routine_runs` ADD `routine_name_snapshot` text;--> statement-breakpoint
ALTER TABLE `routine_runs` ADD `target_space_id_snapshot` text;--> statement-breakpoint
UPDATE `routine_runs`
SET
  `routine_name_snapshot` = (
    SELECT `name` FROM `routines` WHERE `routines`.`id` = `routine_runs`.`routine_id`
  ),
  `target_space_id_snapshot` = (
    SELECT `target_space_id` FROM `routines` WHERE `routines`.`id` = `routine_runs`.`routine_id`
  )
WHERE `routine_name_snapshot` IS NULL
   OR `target_space_id_snapshot` IS NULL;--> statement-breakpoint
ALTER TABLE `routine_runs` ADD `failure_publication_attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `routine_runs` ADD `next_failure_publication_attempt_at_ms` integer;--> statement-breakpoint
CREATE INDEX `routine_runs_status_started_idx` ON `routine_runs` (`status`,`started_at_ms`);--> statement-breakpoint
CREATE INDEX `routine_runs_failure_publication_due_idx` ON `routine_runs` (`status`,`published_signal_id`,`next_failure_publication_attempt_at_ms`,`finished_at_ms`);--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `routine_run_id` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `routine_name_snapshot` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `worker_submit_request_json` text;--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `deadline_probe_enqueued_at_ms` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldRemoteAgent_native_delivery_routine_run_unique` ON `openMeldRemoteAgent_native_delivery_ledger` (`routine_run_id`);--> statement-breakpoint
CREATE INDEX `idx_openMeldRemoteAgent_native_delivery_routine_recovery` ON `openMeldRemoteAgent_native_delivery_ledger` (`status`,`deadline_probe_enqueued_at_ms`,`updated_at_ms`);--> statement-breakpoint
CREATE INDEX `routines_status_next_due_idx` ON `routines` (`status`,`next_due_at`);
