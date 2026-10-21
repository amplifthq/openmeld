CREATE TABLE "openmeld"."member_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"harness_kind" text NOT NULL,
	"default_profile_id" text,
	"source" text NOT NULL,
	"archived_at" bigint,
	"created_at" bigint DEFAULT floor(extract(epoch from clock_timestamp()) * 1000)::bigint NOT NULL,
	"updated_at" bigint DEFAULT floor(extract(epoch from clock_timestamp()) * 1000)::bigint NOT NULL,
	CONSTRAINT "member_agents_id_check" CHECK (length(trim("id")) > 0 and length("id") <= 128),
	CONSTRAINT "member_agents_harness_kind_check" CHECK ("harness_kind" in ('claude-code', 'codex', 'grok-build', 'grok-bot', 'cursor', 'opencode', 'antigravity', 'openclaw', 'hosted')),
	CONSTRAINT "member_agents_source_check" CHECK ("source" in ('detected', 'migrated', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "openmeld"."openmeld_profiles" DROP CONSTRAINT "openmeld_profiles_source_check";--> statement-breakpoint
ALTER TABLE "openmeld"."openmeld_profiles" ADD COLUMN "member_agent_id" text;--> statement-breakpoint
ALTER TABLE "openmeld"."member_agents" ADD CONSTRAINT "member_agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."member_agents" ADD CONSTRAINT "member_agents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "openmeld"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_agents_owner_harness_uq_idx" ON "openmeld"."member_agents" USING btree ("organization_id","owner_user_id","harness_kind");--> statement-breakpoint
CREATE INDEX "member_agents_owner_user_id_idx" ON "openmeld"."member_agents" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_agents_owner_scope_uq_idx" ON "openmeld"."member_agents" USING btree ("id","organization_id","owner_user_id");--> statement-breakpoint
ALTER TABLE "openmeld"."openmeld_profiles" ADD CONSTRAINT "openmeld_profiles_member_agent_fk" FOREIGN KEY ("member_agent_id","organization_id","owner_user_id") REFERENCES "openmeld"."member_agents"("id","organization_id","owner_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "openmeld_profiles_member_agent_profile_uq_idx" ON "openmeld"."openmeld_profiles" USING btree ("member_agent_id","profile_id");--> statement-breakpoint
ALTER TABLE "openmeld"."openmeld_profiles" ADD CONSTRAINT "openmeld_profiles_member_agent_check" CHECK ("member_agent_id" is null or ("profile_kind" = 'agent' and "managed_role" is null and "organization_id" is not null and "owner_user_id" is not null));--> statement-breakpoint
ALTER TABLE "openmeld"."openmeld_profiles" ADD CONSTRAINT "openmeld_profiles_source_check" CHECK ("source" in ('auth_bootstrap', 'web_create', 'cli_create', 'local_agent_create', 'center_agent_create', 'migration', 'auto_detected'));