CREATE TABLE "openmeld"."ai_free_grants" (
	"user_id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"created_at_ms" bigint NOT NULL,
	CONSTRAINT "ai_free_grants_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "openmeld"."organization_ai_credentials" (
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"provider_key_hash" text,
	"key_suffix" text NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "organization_ai_credentials_organization_id_source_pk" PRIMARY KEY("organization_id","source")
);
--> statement-breakpoint
ALTER TABLE "openmeld"."ai_free_grants" ADD CONSTRAINT "ai_free_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "openmeld"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."ai_free_grants" ADD CONSTRAINT "ai_free_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."organization_ai_credentials" ADD CONSTRAINT "organization_ai_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;