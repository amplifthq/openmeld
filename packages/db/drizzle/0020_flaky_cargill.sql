CREATE TABLE `space_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`space_id` text NOT NULL,
	`uploader_user_id` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`file_name` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "space_attachments_id_non_empty_check" CHECK(length(trim("id")) > 0),
	CONSTRAINT "space_attachments_organization_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "space_attachments_space_non_empty_check" CHECK(length(trim("space_id")) > 0),
	CONSTRAINT "space_attachments_uploader_non_empty_check" CHECK(length(trim("uploader_user_id")) > 0),
	CONSTRAINT "space_attachments_mime_type_check" CHECK("mime_type" in ('image/jpeg', 'image/png')),
	CONSTRAINT "space_attachments_size_range_check" CHECK("size_bytes" between 1 and 5242880),
	CONSTRAINT "space_attachments_width_range_check" CHECK("width" is null or "width" between 1 and 20000),
	CONSTRAINT "space_attachments_height_range_check" CHECK("height" is null or "height" between 1 and 20000),
	CONSTRAINT "space_attachments_file_name_length_check" CHECK("file_name" is null or (length(trim("file_name")) > 0 and length("file_name") <= 255))
);
--> statement-breakpoint
CREATE INDEX `space_attachments_space_created_idx` ON `space_attachments` (`space_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `space_attachments_organization_idx` ON `space_attachments` (`organization_id`);