CREATE TABLE `organization_document_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_document_folders_name_check" CHECK(length(trim("name")) between 1 and 200),
	CONSTRAINT "organization_document_folders_updated_at_check" CHECK("updated_at" >= "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_document_folders_org_name_unique` ON `organization_document_folders` (`organization_id`,`name`);--> statement-breakpoint
ALTER TABLE `organization_documents` ADD `folder_id` text REFERENCES organization_document_folders(id) ON DELETE SET NULL;