CREATE TABLE "openmeld"."account_deletion_requests" (
	"user_id" text PRIMARY KEY NOT NULL,
	"plan_json" text NOT NULL,
	"pending_connections_json" text DEFAULT '[]' NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"completed_at_ms" bigint,
	"next_attempt_at_ms" bigint NOT NULL,
	"attempt_count" bigint DEFAULT 0 NOT NULL,
	"private_root_index" bigint DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "openmeld"."organizations" ADD COLUMN "deletion_requested_at" bigint;--> statement-breakpoint
ALTER TABLE "openmeld"."users" ADD COLUMN "deleted_at" bigint;--> statement-breakpoint
CREATE INDEX "account_deletion_requests_due_idx" ON "openmeld"."account_deletion_requests" USING btree ("completed_at_ms","next_attempt_at_ms");