-- openmeld-projections baseline 0000 (faithful DDL from the frozen source schema, 2026-06-13)
-- 3 tables; CDT and retired start_* tables omitted. Do not hand-edit.
CREATE TABLE `space_index_spaces` (
	`space_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`space_name` text,
	`space_purpose` text,
	`creator_profile_id` text,
	`creator_kind` text,
	`creator_owner_user_id` text,
	`creator_profile_name` text,
	`space_created_at_ms` integer,
	`space_updated_at_ms` integer,
	`deleted_at_ms` integer,
	`deleted_by_profile_id` text,
	`deleted_by_owner_user_id` text,
	`deleted_by_profile_name` text,
	`source_updated_at_ms` integer NOT NULL,
	`projected_at_ms` integer NOT NULL,
	`projection_event_id` text NOT NULL
);
CREATE TABLE `space_index_memberships` (
	`space_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`profile_kind_snapshot` text NOT NULL,
	`profile_name_snapshot` text NOT NULL,
	`owner_user_id_snapshot` text,
	`owner_name_snapshot` text,
	`controller_ref_snapshot` text,
	`status` text NOT NULL,
	`member_source` text NOT NULL,
	`added_at_ms` integer NOT NULL,
	`removed_at_ms` integer,
	`added_by_profile_id` text,
	`added_by_owner_user_id` text,
	`added_by_display_name_snapshot` text,
	`removed_by_profile_id` text,
	`removed_by_owner_user_id` text,
	`removal_reason` text,
	`first_entered_at_ms` integer,
	`last_entered_at_ms` integer,
	`source_updated_at_ms` integer NOT NULL,
	`projected_at_ms` integer NOT NULL,
	`projection_event_id` text NOT NULL, `overlay_gateway_host` text, `overlay_pinned_at_ms` integer, `overlay_last_joined_at_ms` integer, `overlay_last_seen_ts` integer, `overlay_updated_at_ms` integer,
	PRIMARY KEY(`space_id`, `profile_id`)
);
CREATE TABLE `space_index_projection_events` (
	`projection_event_id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`event_type` text NOT NULL,
	`source_updated_at_ms` integer NOT NULL,
	`projected_at_ms` integer NOT NULL,
	`payload_json` text NOT NULL
);
CREATE INDEX `idx_space_index_spaces_creator_owner` ON `space_index_spaces` (`creator_owner_user_id`,`status`,"source_updated_at_ms" desc);
CREATE INDEX `idx_space_index_spaces_projection_event` ON `space_index_spaces` (`projection_event_id`);
CREATE INDEX `idx_space_index_spaces_status_updated` ON `space_index_spaces` (`status`,"source_updated_at_ms" desc);
CREATE INDEX `idx_space_index_memberships_owner_status_updated` ON `space_index_memberships` (`owner_user_id_snapshot`,`status`,"source_updated_at_ms" desc);
CREATE INDEX `idx_space_index_memberships_profile_status_updated` ON `space_index_memberships` (`profile_id`,`status`,"source_updated_at_ms" desc);
CREATE INDEX `idx_space_index_memberships_projection_event` ON `space_index_memberships` (`projection_event_id`);
CREATE INDEX `idx_space_index_memberships_space_status` ON `space_index_memberships` (`space_id`,`status`);
CREATE INDEX `idx_space_index_projection_events_space_source` ON `space_index_projection_events` (`space_id`,"source_updated_at_ms" desc);
CREATE INDEX `idx_space_index_projection_events_type_source` ON `space_index_projection_events` (`event_type`,"source_updated_at_ms" desc);
