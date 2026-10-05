CREATE TABLE "openmeld"."cloud_computers" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"provider" text NOT NULL,
	"created_at_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_computers_owner_unique" ON "openmeld"."cloud_computers" USING btree ("owner_user_id");