CREATE TABLE "openmeld"."agent_access_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"space_id" text NOT NULL,
	"source_signal_id" text,
	"agent_profile_id" text NOT NULL,
	"member_agent_id" text,
	"owner_user_id" text NOT NULL,
	"requester_user_id" text NOT NULL,
	"requester_profile_id" text NOT NULL,
	"requester_kind" text NOT NULL,
	"status" text NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"decided_at_ms" bigint,
	"decided_by_user_id" text,
	"applied_at_ms" bigint,
	CONSTRAINT "agent_access_requests_kind_check" CHECK ("kind" in ('direct_message', 'external_message', 'space_join')),
	CONSTRAINT "agent_access_requests_status_check" CHECK ("status" in ('pending', 'allowed', 'declined', 'withdrawn', 'voided', 'joined', 'replied_by_dm', 'ignored')),
	CONSTRAINT "agent_access_requests_requester_kind_check" CHECK ("requester_kind" in ('member', 'external')),
	CONSTRAINT "agent_access_requests_identity_check" CHECK (length(trim("id")) > 0 and length(trim("space_id")) > 0
        and "requester_user_id" <> "owner_user_id"),
	CONSTRAINT "agent_access_requests_shape_check" CHECK (("kind" = 'space_join' and "requester_kind" = 'member')
        or ("kind" = 'direct_message' and "source_signal_id" is not null)
        or ("kind" = 'external_message' and "requester_kind" = 'external'
          and "source_signal_id" is not null)),
	CONSTRAINT "agent_access_requests_decision_check" CHECK (("status" = 'pending' and "decided_at_ms" is null and "applied_at_ms" is null)
        or ("status" <> 'pending' and "decided_at_ms" is not null))
);
--> statement-breakpoint
CREATE TABLE "openmeld"."agent_profile_access_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"grantee_user_id" text NOT NULL,
	"grantee_kind" text NOT NULL,
	"scope" text NOT NULL,
	"request_id" text,
	"space_id" text,
	"source_signal_id" text,
	"granted_by_user_id" text NOT NULL,
	"granted_at_ms" bigint NOT NULL,
	"revoked_at_ms" bigint,
	"revoked_by_user_id" text,
	CONSTRAINT "agent_profile_access_grants_kind_check" CHECK ("grantee_kind" in ('member', 'external') and "scope" in ('always', 'once')),
	CONSTRAINT "agent_profile_access_grants_external_once_check" CHECK ("grantee_kind" = 'member' or "scope" = 'once'),
	CONSTRAINT "agent_profile_access_grants_once_shape_check" CHECK ("scope" = 'always' or ("request_id" is not null and "space_id" is not null)),
	CONSTRAINT "agent_profile_access_grants_revoked_check" CHECK ("revoked_at_ms" is null or "revoked_at_ms" >= "granted_at_ms")
);
--> statement-breakpoint
ALTER TABLE "openmeld"."inbox_items" DROP CONSTRAINT "inbox_items_kind_check";--> statement-breakpoint
ALTER TABLE "openmeld"."inbox_items" DROP CONSTRAINT "inbox_items_source_kind_check";--> statement-breakpoint
ALTER TABLE "openmeld"."agent_access_requests" ADD CONSTRAINT "agent_access_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."agent_access_requests" ADD CONSTRAINT "agent_access_requests_agent_profile_id_openmeld_profiles_profile_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "openmeld"."openmeld_profiles"("profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."agent_access_requests" ADD CONSTRAINT "agent_access_requests_member_agent_id_member_agents_id_fk" FOREIGN KEY ("member_agent_id") REFERENCES "openmeld"."member_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."agent_access_requests" ADD CONSTRAINT "agent_access_requests_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "openmeld"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."agent_access_requests" ADD CONSTRAINT "agent_access_requests_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "openmeld"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."agent_access_requests" ADD CONSTRAINT "agent_access_requests_requester_profile_id_openmeld_profiles_profile_id_fk" FOREIGN KEY ("requester_profile_id") REFERENCES "openmeld"."openmeld_profiles"("profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."agent_access_requests" ADD CONSTRAINT "agent_access_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "openmeld"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."agent_profile_access_grants" ADD CONSTRAINT "agent_profile_access_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."agent_profile_access_grants" ADD CONSTRAINT "agent_profile_access_grants_profile_id_openmeld_profiles_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "openmeld"."openmeld_profiles"("profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."agent_profile_access_grants" ADD CONSTRAINT "agent_profile_access_grants_grantee_user_id_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "openmeld"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."agent_profile_access_grants" ADD CONSTRAINT "agent_profile_access_grants_request_id_agent_access_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "openmeld"."agent_access_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."agent_profile_access_grants" ADD CONSTRAINT "agent_profile_access_grants_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "openmeld"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."agent_profile_access_grants" ADD CONSTRAINT "agent_profile_access_grants_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "openmeld"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_access_requests_message_target_uq_idx" ON "openmeld"."agent_access_requests" USING btree ("space_id","source_signal_id","agent_profile_id") WHERE "openmeld"."agent_access_requests"."source_signal_id" is not null;--> statement-breakpoint
CREATE INDEX "agent_access_requests_owner_status_idx" ON "openmeld"."agent_access_requests" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "agent_access_requests_requester_status_idx" ON "openmeld"."agent_access_requests" USING btree ("requester_user_id","status");--> statement-breakpoint
CREATE INDEX "agent_access_requests_space_idx" ON "openmeld"."agent_access_requests" USING btree ("space_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_profile_access_grants_active_always_uq_idx" ON "openmeld"."agent_profile_access_grants" USING btree ("profile_id","grantee_user_id") WHERE "openmeld"."agent_profile_access_grants"."scope" = 'always' and "openmeld"."agent_profile_access_grants"."revoked_at_ms" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_profile_access_grants_request_uq_idx" ON "openmeld"."agent_profile_access_grants" USING btree ("request_id") WHERE "openmeld"."agent_profile_access_grants"."request_id" is not null;--> statement-breakpoint
CREATE INDEX "agent_profile_access_grants_grantee_idx" ON "openmeld"."agent_profile_access_grants" USING btree ("grantee_user_id","profile_id");--> statement-breakpoint
CREATE INDEX "agent_profile_access_grants_profile_idx" ON "openmeld"."agent_profile_access_grants" USING btree ("profile_id");--> statement-breakpoint
ALTER TABLE "openmeld"."inbox_items" ADD CONSTRAINT "inbox_items_kind_check" CHECK ("kind" in ('space_joined', 'space_message', 'space_reference', 'space_mention', 'agent_reply', 'agent_interaction', 'wake_outcome', 'center_agent_update', 'center_agent_task', 'document_review', 'organization_request', 'agent_access_request', 'agent_space_request', 'system_issue', 'computer_connection', 'desktop_update'));--> statement-breakpoint
ALTER TABLE "openmeld"."inbox_items" ADD CONSTRAINT "inbox_items_source_kind_check" CHECK ("source_kind" in ('space_signal', 'runtime_coordinator_interaction', 'remote_agent_native_delivery', 'remote_agent_native_interaction', 'center_agent_task_event', 'organization_document_draft', 'organization_opportunity', 'organization_member_request', 'agent_profile_work_recovery', 'agent_access_request', 'system_attention_event', 'computer_connection', 'desktop_update'));