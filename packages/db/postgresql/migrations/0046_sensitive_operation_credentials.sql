CREATE TABLE "openmeld"."sensitive_operation_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"agent_profile_id" text,
	"operation" text NOT NULL,
	"source_kind" text NOT NULL,
	"chain_root_profile_id" text,
	"task_execution_id" text,
	"outcome" text NOT NULL,
	"reason_code" text,
	"confirmation_id" text,
	"created_at_ms" bigint NOT NULL,
	CONSTRAINT "sensitive_operation_audit_events_source_kind_check" CHECK ("source_kind" in ('task_credential', 'web_session', 'cli_credential', 'center_agent')),
	CONSTRAINT "sensitive_operation_audit_events_outcome_check" CHECK ("outcome" in ('succeeded', 'failed', 'rejected', 'confirmation_required', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "openmeld"."sensitive_operation_confirmations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"operation" text NOT NULL,
	"agent_profile_id" text,
	"request_digest" text NOT NULL,
	"blocking_root_profile_id" text,
	"status" text NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"expires_at_ms" bigint NOT NULL,
	"decided_at_ms" bigint,
	"consumed_at_ms" bigint,
	CONSTRAINT "sensitive_operation_confirmations_status_check" CHECK ("status" in ('pending', 'approved', 'declined', 'consumed', 'expired')),
	CONSTRAINT "sensitive_operation_confirmations_decision_check" CHECK (("status" = 'pending' and "decided_at_ms" is null)
        or ("status" = 'expired')
        or ("status" in ('approved', 'declined', 'consumed') and "decided_at_ms" is not null)),
	CONSTRAINT "sensitive_operation_confirmations_consumed_check" CHECK (("status" = 'consumed') = ("consumed_at_ms" is not null))
);
--> statement-breakpoint
ALTER TABLE "openmeld"."inbox_items" DROP CONSTRAINT "inbox_items_kind_check";--> statement-breakpoint
ALTER TABLE "openmeld"."inbox_items" DROP CONSTRAINT "inbox_items_source_kind_check";--> statement-breakpoint
ALTER TABLE "openmeld"."sessions" ADD COLUMN "cli_credential_at" bigint;--> statement-breakpoint
ALTER TABLE "openmeld"."sensitive_operation_audit_events" ADD CONSTRAINT "sensitive_operation_audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."sensitive_operation_confirmations" ADD CONSTRAINT "sensitive_operation_confirmations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."sensitive_operation_confirmations" ADD CONSTRAINT "sensitive_operation_confirmations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "openmeld"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."sensitive_operation_confirmations" ADD CONSTRAINT "sensitive_operation_confirmations_agent_profile_id_openmeld_profiles_profile_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "openmeld"."openmeld_profiles"("profile_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sensitive_operation_audit_events_profile_idx" ON "openmeld"."sensitive_operation_audit_events" USING btree ("agent_profile_id","created_at_ms");--> statement-breakpoint
CREATE INDEX "sensitive_operation_audit_events_actor_idx" ON "openmeld"."sensitive_operation_audit_events" USING btree ("organization_id","actor_user_id","created_at_ms");--> statement-breakpoint
CREATE INDEX "sensitive_operation_confirmations_owner_digest_idx" ON "openmeld"."sensitive_operation_confirmations" USING btree ("owner_user_id","organization_id","request_digest");--> statement-breakpoint
ALTER TABLE "openmeld"."inbox_items" ADD CONSTRAINT "inbox_items_kind_check" CHECK ("kind" in ('space_joined', 'space_message', 'space_reference', 'space_mention', 'agent_reply', 'agent_interaction', 'wake_outcome', 'center_agent_update', 'center_agent_task', 'document_review', 'organization_request', 'agent_access_request', 'agent_space_request', 'credential_confirmation', 'system_issue', 'computer_connection', 'desktop_update'));--> statement-breakpoint
ALTER TABLE "openmeld"."inbox_items" ADD CONSTRAINT "inbox_items_source_kind_check" CHECK ("source_kind" in ('space_signal', 'runtime_coordinator_interaction', 'remote_agent_native_delivery', 'remote_agent_native_interaction', 'center_agent_task_event', 'organization_document_draft', 'organization_opportunity', 'organization_member_request', 'agent_profile_work_recovery', 'agent_access_request', 'credential_confirmation', 'system_attention_event', 'computer_connection', 'desktop_update'));