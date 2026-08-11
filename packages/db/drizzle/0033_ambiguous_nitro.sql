DROP INDEX `projects_org_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_org_slug_unique` ON `projects` (`organization_id`,`slug`) WHERE "archived_at_ms" is null;