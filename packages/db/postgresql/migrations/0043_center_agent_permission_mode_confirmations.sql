CREATE TABLE "openmeld"."center_agent_permission_mode_confirmations" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_profile_id" text NOT NULL,
	"represented_user_id" text NOT NULL,
	"represented_profile_id" text NOT NULL,
	"agent_profile_id" text NOT NULL,
	"agent_controller_permission_mode" text NOT NULL,
	"issued_native_delivery_id" text NOT NULL,
	"expires_at_ms" bigint NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"consumed_at_ms" bigint,
	"consumed_native_delivery_id" text,
	CONSTRAINT "center_agent_permission_mode_confirmations_token_shape_check" CHECK (length("token_hash") = 64
        and "token_hash" !~ '^.*[^0-9a-f].*$'),
	CONSTRAINT "center_agent_permission_mode_confirmations_identity_check" CHECK (length(trim("agent_controller_permission_mode")) > 0
        and length(trim("issued_native_delivery_id")) > 0),
	CONSTRAINT "center_agent_permission_mode_confirmations_expiry_check" CHECK ("expires_at_ms" > "created_at_ms"),
	CONSTRAINT "center_agent_permission_mode_confirmations_consumed_check" CHECK ((
        "consumed_at_ms" is null and "consumed_native_delivery_id" is null
      ) or (
        "consumed_at_ms" is not null
        and "consumed_native_delivery_id" is not null
        and "consumed_native_delivery_id" <> "issued_native_delivery_id"
      ))
);
--> statement-breakpoint
ALTER TABLE "openmeld"."center_agent_permission_mode_confirmations" ADD CONSTRAINT "center_agent_permission_mode_confirmations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."center_agent_permission_mode_confirmations" ADD CONSTRAINT "center_agent_permission_mode_confirmations_actor_profile_id_openmeld_profiles_profile_id_fk" FOREIGN KEY ("actor_profile_id") REFERENCES "openmeld"."openmeld_profiles"("profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."center_agent_permission_mode_confirmations" ADD CONSTRAINT "center_agent_permission_mode_confirmations_represented_user_id_users_id_fk" FOREIGN KEY ("represented_user_id") REFERENCES "openmeld"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."center_agent_permission_mode_confirmations" ADD CONSTRAINT "center_agent_permission_mode_confirmations_represented_profile_id_openmeld_profiles_profile_id_fk" FOREIGN KEY ("represented_profile_id") REFERENCES "openmeld"."openmeld_profiles"("profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."center_agent_permission_mode_confirmations" ADD CONSTRAINT "center_agent_permission_mode_confirmations_agent_profile_id_openmeld_profiles_profile_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "openmeld"."openmeld_profiles"("profile_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "center_agent_permission_mode_confirmations_org_expiry_idx" ON "openmeld"."center_agent_permission_mode_confirmations" USING btree ("organization_id","expires_at_ms");--> statement-breakpoint
CREATE INDEX "center_agent_permission_mode_confirmations_profile_idx" ON "openmeld"."center_agent_permission_mode_confirmations" USING btree ("agent_profile_id");