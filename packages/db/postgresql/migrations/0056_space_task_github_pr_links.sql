CREATE TABLE "openmeld"."space_task_github_pr_links" (
	"space_id" text NOT NULL,
	"task_id" text NOT NULL,
	"owner_login" text NOT NULL,
	"repo" text NOT NULL,
	"number" bigint NOT NULL,
	"url" text NOT NULL,
	"organization_id" text NOT NULL,
	"attached_at_ms" bigint NOT NULL,
	"detached_at_ms" bigint,
	"updated_at_ms" bigint NOT NULL,
	CONSTRAINT "space_task_github_pr_links_space_id_task_id_owner_login_repo_number_pk" PRIMARY KEY("space_id","task_id","owner_login","repo","number"),
	CONSTRAINT "space_task_github_pr_links_ids_check" CHECK (length(trim("space_id")) > 0 and "task_id" ~ '^tsk_.*$' and length(trim("owner_login")) > 0 and length(trim("repo")) > 0 and "number" > 0),
	CONSTRAINT "space_task_github_pr_links_url_check" CHECK (length(trim("url")) > 0),
	CONSTRAINT "space_task_github_pr_links_time_check" CHECK ("attached_at_ms" >= 0 and "updated_at_ms" >= "attached_at_ms" and ("detached_at_ms" is null or "detached_at_ms" >= "attached_at_ms"))
);
--> statement-breakpoint
ALTER TABLE "openmeld"."space_task_github_pr_links" ADD CONSTRAINT "space_task_github_pr_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "openmeld"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "space_task_github_pr_links_identity_idx" ON "openmeld"."space_task_github_pr_links" USING btree ("owner_login","repo","number","detached_at_ms");