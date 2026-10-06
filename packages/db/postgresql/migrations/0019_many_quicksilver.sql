ALTER TABLE "openmeld"."routine_runs" ADD COLUMN "source_signal_id" text;--> statement-breakpoint
ALTER TABLE "openmeld"."routines" ADD COLUMN "scope" text DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."routines" ADD COLUMN "executor_kind" text DEFAULT 'center_agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."routines" ADD CONSTRAINT "routines_scope_check" CHECK ("scope" in ('personal', 'team'));--> statement-breakpoint
ALTER TABLE "openmeld"."routines" ADD CONSTRAINT "routines_executor_kind_check" CHECK ("executor_kind" in ('center_agent', 'remote_agent', 'local_agent'));
--> statement-breakpoint
UPDATE "openmeld"."routines" SET "scope" = 'personal', "executor_kind" = 'remote_agent' WHERE "agent_profile_id" IS NOT NULL;
