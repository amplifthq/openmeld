CREATE TABLE `openmeld_profile_deletion_outbox` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`profile_kind` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at_ms` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_attempt_at_ms` integer,
	`last_error` text,
	`created_at_ms` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at_ms` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "openmeld_profile_deletion_outbox_profile_kind_check" CHECK("profile_kind" in ('agent', 'human')),
	CONSTRAINT "openmeld_profile_deletion_outbox_attempt_count_check" CHECK("attempt_count" >= 0),
	CONSTRAINT "openmeld_profile_deletion_outbox_last_error_check" CHECK("last_error" is null or length("last_error") <= 500),
	CONSTRAINT "openmeld_profile_deletion_outbox_updated_at_check" CHECK("updated_at_ms" >= "created_at_ms")
);
--> statement-breakpoint
CREATE INDEX `openmeld_profile_deletion_outbox_due_idx` ON `openmeld_profile_deletion_outbox` (`next_attempt_at_ms`,`created_at_ms`);
--> statement-breakpoint
-- full-shared-schema-only
INSERT INTO `openmeld_profile_deletion_outbox` (
	`profile_id`,
	`owner_user_id`,
	`profile_kind`,
	`attempt_count`,
	`next_attempt_at_ms`,
	`created_at_ms`,
	`updated_at_ms`
)
SELECT
	binding.`agent_profile_id`,
	binding.`owner_id`,
	'agent',
	0,
	cast(unixepoch('subsecond') * 1000 as integer),
	cast(unixepoch('subsecond') * 1000 as integer),
	cast(unixepoch('subsecond') * 1000 as integer)
FROM `openMeldDaemon_agent_profile_bindings` binding
LEFT JOIN `openmeld_profiles` profile
	ON profile.`profile_id` = binding.`agent_profile_id`
WHERE binding.`owner_kind` = 'owner_account'
	AND binding.`binding_state` = 'enabled_primary'
	AND profile.`profile_id` IS NULL
ON CONFLICT (`profile_id`) DO NOTHING;
--> statement-breakpoint
-- focused-fixture-requires: openmeld_profile_deletion_outbox
CREATE TRIGGER `openmeld_profiles_deletion_outbox_insert`
AFTER DELETE ON `openmeld_profiles`
FOR EACH ROW
WHEN OLD.`profile_kind` IN ('agent', 'human')
BEGIN
	INSERT INTO `openmeld_profile_deletion_outbox` (
		`profile_id`,
		`owner_user_id`,
		`profile_kind`,
		`attempt_count`,
		`next_attempt_at_ms`,
		`created_at_ms`,
		`updated_at_ms`
	)
	VALUES (
		OLD.`profile_id`,
		OLD.`owner_user_id`,
		OLD.`profile_kind`,
		0,
		cast(unixepoch('subsecond') * 1000 as integer),
		cast(unixepoch('subsecond') * 1000 as integer),
		cast(unixepoch('subsecond') * 1000 as integer)
	)
	ON CONFLICT (`profile_id`) DO UPDATE SET
		`owner_user_id` = excluded.`owner_user_id`,
		`profile_kind` = excluded.`profile_kind`,
		`attempt_count` = 0,
		`next_attempt_at_ms` = excluded.`next_attempt_at_ms`,
		`last_attempt_at_ms` = NULL,
		`last_error` = NULL,
		`updated_at_ms` = excluded.`updated_at_ms`;
END;
