ALTER TABLE "openmeld"."github_app_webhook_deliveries" ADD COLUMN "pr_head_sha" text;--> statement-breakpoint
ALTER TABLE "openmeld"."github_app_webhook_deliveries" ADD COLUMN "pr_before_sha" text;--> statement-breakpoint
ALTER TABLE "openmeld"."github_app_webhook_deliveries" ADD COLUMN "pr_observed_at_ms" bigint;--> statement-breakpoint
CREATE INDEX "github_app_webhook_deliveries_pr_time_idx" ON "openmeld"."github_app_webhook_deliveries" USING btree ("owner_login","repo","number","pr_observed_at_ms") WHERE "pr_observed_at_ms" IS NOT NULL;