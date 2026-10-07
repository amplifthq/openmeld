ALTER TABLE "openmeld"."slack_installation_welcome_preparations" DROP CONSTRAINT "slack_installation_welcome_preparation_shape_check";--> statement-breakpoint
ALTER TABLE "openmeld"."slack_installation_welcome_preparations" ADD CONSTRAINT "slack_installation_welcome_preparation_shape_check" CHECK ((
        ("status" = 'queued' AND "claim_id" IS NULL AND "research_task_id" IS NULL AND "failure_code" IS NULL)
        OR ("status" = 'researching' AND length(trim("claim_id")) > 0 AND "failure_code" IS NULL)
        OR ("status" = 'ready' AND length(trim("claim_id")) > 0 AND length(trim("research_task_id")) > 0 AND ("failure_code" IS NULL OR "failure_code" = 'slack_delivery_retry_authorized'))
        OR ("status" = 'completed' AND length(trim("claim_id")) > 0 AND length(trim("research_task_id")) > 0 AND "failure_code" IS NULL)
        OR ("status" = 'failed' AND length(trim("claim_id")) > 0 AND length(trim("failure_code")) > 0)
      ));