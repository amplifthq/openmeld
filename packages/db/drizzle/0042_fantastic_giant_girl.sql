CREATE TABLE `openMeldRemoteAgent_daily_admissions` (
	`organization_id` text NOT NULL,
	`day_utc` text NOT NULL,
	`admitted_count` integer NOT NULL,
	`last_admission_idempotency_key` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `day_utc`),
	CONSTRAINT "openMeldRemoteAgent_daily_admissions_day_utc_check" CHECK(length("day_utc") = 10),
	CONSTRAINT "openMeldRemoteAgent_daily_admissions_count_positive_check" CHECK("admitted_count" > 0),
	CONSTRAINT "openMeldRemoteAgent_daily_admissions_idempotency_key_non_empty_check" CHECK(length(trim("last_admission_idempotency_key")) > 0),
	CONSTRAINT "openMeldRemoteAgent_daily_admissions_updated_after_created_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
ALTER TABLE `openMeldRemoteAgent_native_delivery_ledger` ADD `daily_admission_day_utc` text;