CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`repository_fingerprint` text,
	`created_by_user_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`archived_at_ms` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "projects_id_non_empty_check" CHECK(length(trim("id")) > 0),
	CONSTRAINT "projects_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "projects_name_non_empty_check" CHECK(length(trim("name")) > 0),
	CONSTRAINT "projects_slug_shape_check" CHECK(length("slug") > 0
        and "slug" = lower("slug")
        and "slug" not glob '*[^a-z0-9-]*'
        and "slug" not like '-%'
        and "slug" not like '%-'
        and "slug" not like '%--%'),
	CONSTRAINT "projects_repository_fingerprint_shape_check" CHECK("repository_fingerprint" is null or (
        length("repository_fingerprint") = 71
        and substr("repository_fingerprint", 1, 7) = 'sha256:'
        and substr("repository_fingerprint", 8) not glob '*[^0-9a-f]*'
      )),
	CONSTRAINT "projects_creator_non_empty_check" CHECK(length(trim("created_by_user_id")) > 0),
	CONSTRAINT "projects_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms"),
	CONSTRAINT "projects_archived_at_valid_check" CHECK("archived_at_ms" is null or "archived_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_org_slug_unique` ON `projects` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `projects_org_archived_updated_idx` ON `projects` (`organization_id`,`archived_at_ms`,"updated_at_ms" desc);--> statement-breakpoint
CREATE INDEX `projects_repository_fingerprint_idx` ON `projects` (`repository_fingerprint`);
