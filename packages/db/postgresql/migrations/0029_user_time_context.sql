CREATE TABLE "openmeld"."user_time_contexts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"time_zone" text NOT NULL,
	"source" text NOT NULL,
	"observed_at_ms" bigint NOT NULL,
	CONSTRAINT "user_time_contexts_source_check" CHECK ("openmeld"."user_time_contexts"."source" in ('web', 'desktop', 'service')),
	CONSTRAINT "user_time_contexts_time_zone_check" CHECK (length(trim("openmeld"."user_time_contexts"."time_zone")) between 1 and 128),
	CONSTRAINT "user_time_contexts_observed_at_check" CHECK ("openmeld"."user_time_contexts"."observed_at_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "openmeld"."user_time_contexts" ADD CONSTRAINT "user_time_contexts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "openmeld"."users"("id") ON DELETE cascade ON UPDATE no action;