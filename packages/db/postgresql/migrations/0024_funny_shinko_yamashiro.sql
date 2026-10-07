ALTER TABLE "openmeld"."first_work_experiences" ADD COLUMN "run_id" text DEFAULT gen_random_uuid()::text NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."first_work_experiences" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."first_work_experiences" ADD COLUMN "iteration" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."first_work_experiences" ADD COLUMN "step" text DEFAULT 'create-space' NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."first_work_experiences" ADD COLUMN "paused" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."first_work_experiences" DROP COLUMN "prepared";--> statement-breakpoint
ALTER TABLE "openmeld"."first_work_experiences" DROP COLUMN "guide_dismissed";
