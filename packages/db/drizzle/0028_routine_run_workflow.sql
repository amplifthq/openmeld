ALTER TABLE `routine_runs`
ADD COLUMN `execution_engine` text
CONSTRAINT "routine_runs_execution_engine_check"
CHECK(`execution_engine` is null or `execution_engine` in ('legacy', 'workflow'));--> statement-breakpoint
UPDATE `routine_runs`
SET `execution_engine` = 'legacy'
WHERE `status` != 'skipped';--> statement-breakpoint
CREATE INDEX `routine_runs_engine_status_started_idx`
ON `routine_runs` (`execution_engine`, `status`, `started_at_ms`);
