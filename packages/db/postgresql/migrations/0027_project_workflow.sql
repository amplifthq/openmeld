CREATE TABLE "openmeld"."space_task_project_links" (
	"space_id" text NOT NULL,
	"task_id" text NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"task_revision" integer NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "space_task_project_links_space_id_task_id_project_id_pk" PRIMARY KEY("space_id","task_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "openmeld"."space_task_project_projection_states" (
	"space_id" text NOT NULL,
	"task_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"task_revision" integer NOT NULL,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "space_task_project_projection_states_space_id_task_id_pk" PRIMARY KEY("space_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "openmeld"."center_agent_connector_action_operations" ADD COLUMN "linear_issue_receipt_json" text;--> statement-breakpoint
ALTER TABLE "openmeld"."projects" ADD COLUMN "issue_destination_json" text;--> statement-breakpoint
ALTER TABLE "openmeld"."projects" ADD COLUMN "issue_destination_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."projects" ADD COLUMN "issue_destination_updated_by_user_id" text;--> statement-breakpoint
ALTER TABLE "openmeld"."projects" ADD COLUMN "issue_destination_updated_at_ms" bigint;--> statement-breakpoint
ALTER TABLE "openmeld"."projects" ADD COLUMN "additional_repository_urls_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."projects" ADD COLUMN "repository_settings_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."projects" ADD COLUMN "repository_settings_updated_by_user_id" text;--> statement-breakpoint
ALTER TABLE "openmeld"."projects" ADD COLUMN "repository_settings_updated_at_ms" bigint;--> statement-breakpoint
ALTER TABLE "openmeld"."projects" ADD COLUMN "common_agent_profile_ids_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."projects" ADD COLUMN "common_agents_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "openmeld"."projects" ADD COLUMN "common_agents_updated_by_user_id" text;--> statement-breakpoint
ALTER TABLE "openmeld"."projects" ADD COLUMN "common_agents_updated_at_ms" bigint;--> statement-breakpoint
ALTER TABLE "openmeld"."space_task_project_links" ADD CONSTRAINT "space_task_project_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openmeld"."space_task_project_projection_states" ADD CONSTRAINT "space_task_project_projection_states_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_task_project_links_project_updated_idx" ON "openmeld"."space_task_project_links" USING btree ("organization_id","project_id","updated_at_ms");