CREATE TABLE "openmeld"."first_work_experiences" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"space_id" text NOT NULL,
	"prepared" integer DEFAULT 0 NOT NULL,
	"guide_dismissed" integer DEFAULT 0 NOT NULL,
	"created_at_ms" bigint NOT NULL,
	CONSTRAINT "first_work_experiences_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "openmeld"."first_work_experiences" ADD CONSTRAINT "first_work_experiences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."first_work_experiences" ADD CONSTRAINT "first_work_experiences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "openmeld"."users"("id") ON DELETE cascade ON UPDATE no action;