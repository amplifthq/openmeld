CREATE TABLE "openmeld"."organization_dashboards" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"creator_user_id" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"repository" text,
	"artifact" jsonb,
	"created_at_ms" bigint NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	"archived_at_ms" bigint,
	CONSTRAINT "organization_dashboards_kind_check" CHECK ("openmeld"."organization_dashboards"."kind" IN ('github_issues', 'ugc', 'traffic')),
	CONSTRAINT "organization_dashboards_source_check" CHECK (("openmeld"."organization_dashboards"."kind" = 'github_issues' AND "openmeld"."organization_dashboards"."repository" IS NOT NULL AND "openmeld"."organization_dashboards"."artifact" IS NULL) OR ("openmeld"."organization_dashboards"."kind" <> 'github_issues' AND "openmeld"."organization_dashboards"."repository" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "openmeld"."organization_dashboards" ADD CONSTRAINT "organization_dashboards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."organization_dashboards" ADD CONSTRAINT "organization_dashboards_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "openmeld"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_dashboards_active_idx" ON "openmeld"."organization_dashboards" USING btree ("organization_id","updated_at_ms") WHERE "openmeld"."organization_dashboards"."archived_at_ms" IS NULL;