ALTER TABLE "openmeld"."routine_runs" ADD COLUMN "scope_snapshot" text;--> statement-breakpoint
ALTER TABLE "openmeld"."routine_runs" ADD COLUMN "created_by_user_id_snapshot" text;
--> statement-breakpoint
UPDATE "openmeld"."routine_runs" AS run
SET scope_snapshot = routine.scope, created_by_user_id_snapshot = routine.created_by_user_id
FROM "openmeld"."routines" AS routine
WHERE run.routine_id = routine.id AND run.organization_id = routine.organization_id;
