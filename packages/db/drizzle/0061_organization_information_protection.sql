CREATE TABLE `organization_information_protection_policies` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`protected_information` text NOT NULL,
	`updated_by_user_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "organization_information_protection_org_non_empty_check" CHECK(length(trim("organization_id")) > 0),
	CONSTRAINT "organization_information_protection_content_non_empty_check" CHECK(length(trim("protected_information")) > 0),
	CONSTRAINT "organization_information_protection_content_length_check" CHECK(length("protected_information") <= 2000)
);
