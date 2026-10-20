CREATE TABLE "openmeld"."agent_profile_permission_mode_advisories" (
	"agent_profile_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"suggestion_id" text NOT NULL,
	"last_suggested_at_ms" bigint NOT NULL,
	"suggested_dispatch_id" text NOT NULL,
	"advisory_json" text NOT NULL,
	"current_permission_mode" text NOT NULL,
	"suggested_permission_mode" text NOT NULL,
	"waiting_approval_count" bigint NOT NULL,
	"card_status" text,
	"card_space_id" text,
	"card_offered_at_ms" bigint,
	"card_resolved_at_ms" bigint,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "agent_profile_permission_mode_advisories_identity_check" CHECK (length(trim("agent_profile_id")) > 0 and length(trim("organization_id")) > 0 and length(trim("owner_user_id")) > 0 and length(trim("suggestion_id")) > 0 and length(trim("suggested_dispatch_id")) > 0),
	CONSTRAINT "agent_profile_permission_mode_advisories_count_check" CHECK ("waiting_approval_count" > 0),
	CONSTRAINT "agent_profile_permission_mode_advisories_card_check" CHECK (("card_status" is null and "card_space_id" is null and "card_offered_at_ms" is null and "card_resolved_at_ms" is null)
        or ("card_status" = 'pending' and "card_space_id" is not null and "card_offered_at_ms" is not null and "card_resolved_at_ms" is null)
        or ("card_status" in ('applied', 'dismissed') and "card_space_id" is not null and "card_offered_at_ms" is not null and "card_resolved_at_ms" is not null))
);
--> statement-breakpoint
CREATE INDEX "agent_profile_permission_mode_advisories_owner_card_idx" ON "openmeld"."agent_profile_permission_mode_advisories" USING btree ("owner_user_id","card_status","card_space_id");