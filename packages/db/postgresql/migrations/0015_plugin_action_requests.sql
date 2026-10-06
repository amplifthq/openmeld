CREATE TABLE "openmeld"."plugin_action_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"actor_profile_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"source_request_key" text,
	"request_digest" text NOT NULL,
	"request_json" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"expires_at_ms" bigint NOT NULL,
	"decided_at_ms" bigint
);
--> statement-breakpoint
ALTER TABLE "openmeld"."center_agent_connector_action_operations" ADD COLUMN "connection_updated_at_ms" bigint;--> statement-breakpoint
ALTER TABLE "openmeld"."plugin_action_requests" ADD CONSTRAINT "plugin_action_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_action_requests_operation_idx" ON "openmeld"."plugin_action_requests" USING btree ("organization_id","user_id","actor_profile_id","operation_id");--> statement-breakpoint
CREATE INDEX "plugin_action_requests_recipient_idx" ON "openmeld"."plugin_action_requests" USING btree ("organization_id","user_id","state");