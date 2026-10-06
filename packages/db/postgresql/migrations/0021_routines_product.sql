ALTER TABLE "openmeld"."routine_runs" DROP CONSTRAINT "routine_runs_execution_engine_check";--> statement-breakpoint
ALTER TABLE "openmeld"."routine_runs" ADD COLUMN "scope_snapshot" text;--> statement-breakpoint
ALTER TABLE "openmeld"."routine_runs" ADD COLUMN "created_by_user_id_snapshot" text;--> statement-breakpoint
ALTER TABLE "openmeld"."routine_runs" ADD COLUMN "source_signal_id" text;--> statement-breakpoint
ALTER TABLE "openmeld"."routine_runs" ADD COLUMN "local_submission_json" text;--> statement-breakpoint
ALTER TABLE "openmeld"."routine_runs" ADD COLUMN "local_last_checked_at_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."routines" ADD COLUMN "scope" text DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."routines" ADD COLUMN "executor_kind" text DEFAULT 'center_agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."routine_runs" ADD CONSTRAINT "routine_runs_execution_engine_check" CHECK ("execution_engine" is null or "execution_engine" in ('legacy', 'workflow', 'local'));--> statement-breakpoint
ALTER TABLE "openmeld"."routines" ADD CONSTRAINT "routines_scope_check" CHECK ("scope" in ('personal', 'team'));--> statement-breakpoint
ALTER TABLE "openmeld"."routines" ADD CONSTRAINT "routines_executor_kind_check" CHECK ("executor_kind" in ('center_agent', 'remote_agent', 'local_agent'));
--> statement-breakpoint
UPDATE "openmeld"."routines"
SET "scope" = 'personal', "executor_kind" = 'remote_agent'
WHERE "agent_profile_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "openmeld"."routine_runs" AS run
SET "scope_snapshot" = routine.scope,
    "created_by_user_id_snapshot" = routine.created_by_user_id
FROM "openmeld"."routines" AS routine
WHERE run.routine_id = routine.id
  AND run.organization_id = routine.organization_id;
