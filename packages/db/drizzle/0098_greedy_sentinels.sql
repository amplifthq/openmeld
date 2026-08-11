PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_organization_document_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`parent_folder_id` text,
	`name` text NOT NULL,
	`name_key` text GENERATED ALWAYS AS (lower("name")) STORED,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_folder_id`) REFERENCES `organization_document_folders`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "organization_document_folders_name_check" CHECK(length(trim("name")) between 1 and 200),
	CONSTRAINT "organization_document_folders_updated_at_check" CHECK("updated_at" >= "created_at"),
	CONSTRAINT "organization_document_folders_parent_check" CHECK("parent_folder_id" is null or "parent_folder_id" != "id")
);
--> statement-breakpoint
INSERT INTO `__new_organization_document_folders`("id", "organization_id", "parent_folder_id", "name", "created_at", "updated_at") SELECT "id", "organization_id", NULL, "name", "created_at", "updated_at" FROM `organization_document_folders`;--> statement-breakpoint
DROP TABLE `organization_document_folders`;--> statement-breakpoint
ALTER TABLE `__new_organization_document_folders` RENAME TO `organization_document_folders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_document_folders_root_name_unique` ON `organization_document_folders` (`organization_id`,`name_key`) WHERE "organization_document_folders"."parent_folder_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `organization_document_folders_sibling_name_unique` ON `organization_document_folders` (`organization_id`,`parent_folder_id`,`name_key`) WHERE "organization_document_folders"."parent_folder_id" is not null;--> statement-breakpoint
CREATE INDEX `organization_document_folders_parent_name_idx` ON `organization_document_folders` (`organization_id`,`parent_folder_id`,`name`);
