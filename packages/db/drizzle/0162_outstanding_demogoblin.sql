PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_openMeldDaemon_agent_profile_bindings` (
	`binding_id` text PRIMARY KEY NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`agent_profile_id` text NOT NULL,
	`openmeld_service_runtime_id` text NOT NULL,
	`runtime_kind` text DEFAULT 'openmeld_service' NOT NULL,
	`hosted_runtime_identity_json` text,
	`agent_controller_ref` text NOT NULL,
	`agent_controller_conversation_id` text,
	`model_id` text,
	`reasoning_level` text,
	`agent_controller_permission_mode` text,
	`agent_controller_collaboration_mode` text,
	`opencode_permission` text,
	`configuration_revision` integer DEFAULT 1 NOT NULL,
	`binding_state` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`disabled_at_ms` integer,
	`created_by_profile_id` text,
	`reason_code` text,
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_binding_id_non_empty_check" CHECK(length(trim("binding_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_owner_kind_check" CHECK(("owner_kind" = 'owner_account' and ("runtime_kind" != 'hosted_center_agent' or ("binding_state" = 'disabled_historical' and coalesce("reason_code", '') = 'agent_profile_binding.profile_deleted'))) or ("owner_kind" = 'organization' and "runtime_kind" = 'hosted_center_agent')),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_owner_id_non_empty_check" CHECK(length(trim("owner_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_agent_profile_id_non_empty_check" CHECK(length(trim("agent_profile_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_openmeld_service_runtime_id_non_empty_check" CHECK(length(trim("openmeld_service_runtime_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_runtime_kind_check" CHECK("runtime_kind" in ('openmeld_service', 'hosted_center_agent', 'hosted_remote_agent')),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_hosted_identity_check" CHECK((("runtime_kind" = 'openmeld_service' and "hosted_runtime_identity_json" is null) or ("runtime_kind" in ('hosted_center_agent', 'hosted_remote_agent') and "hosted_runtime_identity_json" is not null and json_valid("hosted_runtime_identity_json")))),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_agent_controller_ref_non_empty_check" CHECK(length(trim("agent_controller_ref")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_agent_controller_conversation_id_non_empty_check" CHECK("agent_controller_conversation_id" is null or length(trim("agent_controller_conversation_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_state_check" CHECK("binding_state" in ('enabled_primary', 'disabled_historical')),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_created_at_positive_check" CHECK("created_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_updated_at_valid_check" CHECK("updated_at_ms" >= "created_at_ms"),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_disabled_at_positive_check" CHECK("disabled_at_ms" is null or "disabled_at_ms" > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_lifecycle_check" CHECK((("binding_state" = 'enabled_primary' and "disabled_at_ms" is null) or ("binding_state" = 'disabled_historical' and "disabled_at_ms" is not null))),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_created_by_non_empty_check" CHECK("created_by_profile_id" is null or length(trim("created_by_profile_id")) > 0),
	CONSTRAINT "openMeldDaemon_agent_profile_bindings_reason_code_check" CHECK("reason_code" is null or (length(trim("reason_code")) > 0 and length("reason_code") <= 160))
);
--> statement-breakpoint
-- focused-fixture-requires: openmeld_profiles
-- Deleted Profile history has no Organization to resolve. Preserve its original
-- attribution only for explicitly disabled profile_deleted records; unresolved
-- active or otherwise disabled hosted bindings must still fail migration.
INSERT INTO `__new_openMeldDaemon_agent_profile_bindings`("binding_id", "owner_kind", "owner_id", "agent_profile_id", "openmeld_service_runtime_id", "runtime_kind", "hosted_runtime_identity_json", "agent_controller_ref", "agent_controller_conversation_id", "model_id", "reasoning_level", "agent_controller_permission_mode", "agent_controller_collaboration_mode", "opencode_permission", "configuration_revision", "binding_state", "created_at_ms", "updated_at_ms", "disabled_at_ms", "created_by_profile_id", "reason_code") SELECT "binding_id", CASE WHEN "runtime_kind" = 'hosted_center_agent' AND NOT ("binding_state" = 'disabled_historical' AND coalesce("reason_code", '') = 'agent_profile_binding.profile_deleted' AND NOT EXISTS (SELECT 1 FROM openmeld_profiles p WHERE p.profile_id = agent_profile_id)) THEN 'organization' ELSE "owner_kind" END, CASE WHEN "runtime_kind" = 'hosted_center_agent' AND NOT ("binding_state" = 'disabled_historical' AND coalesce("reason_code", '') = 'agent_profile_binding.profile_deleted' AND NOT EXISTS (SELECT 1 FROM openmeld_profiles p WHERE p.profile_id = agent_profile_id)) THEN (SELECT organization_id FROM openmeld_profiles p WHERE p.profile_id = agent_profile_id AND p.managed_role = 'center_agent') ELSE "owner_id" END, "agent_profile_id", "openmeld_service_runtime_id", "runtime_kind", "hosted_runtime_identity_json", "agent_controller_ref", "agent_controller_conversation_id", "model_id", "reasoning_level", "agent_controller_permission_mode", "agent_controller_collaboration_mode", "opencode_permission", "configuration_revision", "binding_state", "created_at_ms", "updated_at_ms", "disabled_at_ms", "created_by_profile_id", "reason_code" FROM `openMeldDaemon_agent_profile_bindings`;--> statement-breakpoint
DROP TABLE `openMeldDaemon_agent_profile_bindings`;--> statement-breakpoint
ALTER TABLE `__new_openMeldDaemon_agent_profile_bindings` RENAME TO `openMeldDaemon_agent_profile_bindings`;--> statement-breakpoint
--> statement-breakpoint
CREATE UNIQUE INDEX `openMeldDaemon_agent_profile_bindings_enabled_primary_unique` ON `openMeldDaemon_agent_profile_bindings` (`owner_kind`,`owner_id`,`agent_profile_id`) WHERE "binding_state" = 'enabled_primary';--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_agent_profile_bindings_openmeld_service_runtime_agent_controller` ON `openMeldDaemon_agent_profile_bindings` (`openmeld_service_runtime_id`,`agent_controller_ref`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_agent_profile_bindings_owner_profile_state` ON `openMeldDaemon_agent_profile_bindings` (`owner_kind`,`owner_id`,`agent_profile_id`,`binding_state`);--> statement-breakpoint
CREATE INDEX `idx_openMeldDaemon_agent_profile_bindings_profile_enabled_owner` ON `openMeldDaemon_agent_profile_bindings` (`agent_profile_id`,`owner_kind`,`owner_id`) WHERE "binding_state" = 'enabled_primary';--> statement-breakpoint
-- full-shared-schema-only
-- D1 keeps foreign keys enabled: preserve every dependent row before rebuilding identity.
DROP TRIGGER IF EXISTS openmeld_profiles_deletion_outbox_insert;--> statement-breakpoint
-- full-shared-schema-only
CREATE TABLE __center_owner_backup_openmeld_profile_space_history AS SELECT * FROM openmeld_profile_space_history;--> statement-breakpoint
-- full-shared-schema-only
CREATE TABLE __center_owner_backup_center_agent_audit_journal AS SELECT * FROM center_agent_audit_journal;--> statement-breakpoint
-- full-shared-schema-only
CREATE TABLE __center_owner_backup_center_agent_project_operations AS SELECT * FROM center_agent_project_operations;--> statement-breakpoint
-- full-shared-schema-only
CREATE TABLE __center_owner_backup_center_agent_project_remove_confirmations AS SELECT * FROM center_agent_project_remove_confirmations;--> statement-breakpoint
-- full-shared-schema-only
CREATE TABLE __center_owner_backup_center_agent_organization_document_operations AS SELECT * FROM center_agent_organization_document_operations;--> statement-breakpoint
-- full-shared-schema-only
CREATE TABLE __center_owner_backup_center_agent_designations AS SELECT * FROM center_agent_designations;--> statement-breakpoint
-- full-shared-schema-only
CREATE TABLE __center_owner_backup_center_agent_connector_action_operations AS SELECT * FROM center_agent_connector_action_operations;--> statement-breakpoint
-- full-shared-schema-only
CREATE TABLE __center_owner_backup_center_agent_context_manifests AS SELECT * FROM center_agent_context_manifests;--> statement-breakpoint
-- full-shared-schema-only
CREATE TABLE __center_owner_backup_center_agent_context_load_receipts AS SELECT * FROM center_agent_context_load_receipts;--> statement-breakpoint
-- full-shared-schema-only
CREATE TABLE __center_owner_backup_center_agent_context_manifest_materializations AS SELECT * FROM center_agent_context_manifest_materializations;--> statement-breakpoint
-- full-shared-schema-only
CREATE TABLE __center_owner_backup_center_agent_publication_operations AS SELECT * FROM center_agent_publication_operations;--> statement-breakpoint
CREATE TABLE `__new_openmeld_profiles` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`profile_name` text NOT NULL,
	`profile_handle` text NOT NULL,
	`profile_kind` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`organization_id` text DEFAULT null,
	`owner_user_id` text,
	`created_by_user_id` text,
	`creator_profile_id` text,
	`creation_actor_profile_id` text,
	`source` text NOT NULL,
	`managed_role` text,
	`creation_idempotency_key` text,
	`default_project_id` text,
	`last_used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "openmeld_profiles_profile_kind_check" CHECK("profile_kind" in ('human', 'agent', 'system')),
	CONSTRAINT "openmeld_profiles_status_check" CHECK("status" in ('active', 'disabled')),
	CONSTRAINT "openmeld_profiles_source_check" CHECK("source" in ('auth_bootstrap', 'web_create', 'cli_create', 'local_agent_create', 'center_agent_create', 'migration')),
	CONSTRAINT "openmeld_profiles_ownership_check" CHECK(("managed_role" = 'center_agent' and "organization_id" is not null and "owner_user_id" is null) or (coalesce("managed_role", '') != 'center_agent' and "owner_user_id" is not null)),
	CONSTRAINT "openmeld_profiles_managed_role_check" CHECK("managed_role" is null or ("profile_kind" = 'agent' and "managed_role" in ('openmeld_assistant', 'center_agent'))),
	CONSTRAINT "openmeld_profiles_default_project_check" CHECK("default_project_id" is null or (length(trim("default_project_id")) > 0 and "profile_kind" = 'agent' and "managed_role" is null and "organization_id" is not null)),
	CONSTRAINT "openmeld_profiles_default_profile_check" CHECK("is_default" = 0 or "profile_kind" = 'human'),
	CONSTRAINT "openmeld_profiles_profile_handle_check" CHECK(length(trim("profile_handle")) > 0 and "profile_handle" not glob '*[^A-Za-z0-9._-]*' and substr(trim("profile_handle"), 1, 1) glob '[A-Za-z0-9]' and length(trim("profile_handle")) <= 128),
	CONSTRAINT "openmeld_profiles_profile_id_format_check" CHECK(( ("profile_kind" = 'agent' and length("profile_id") = 40 and substr("profile_id", 1, 4) = 'agt_' and length(substr("profile_id", 5)) = 36 and substr("profile_id", 5) not glob '*[^0-9a-f-]*' and length(replace(substr("profile_id", 5), '-', '')) = 32 and substr(substr("profile_id", 5), 9, 1) = '-' and substr(substr("profile_id", 5), 14, 1) = '-' and substr(substr("profile_id", 5), 19, 1) = '-' and substr(substr("profile_id", 5), 24, 1) = '-') or ("profile_kind" in ('human', 'system') and length("profile_id") = 36 and "profile_id" not glob '*[^0-9a-f-]*' and length(replace("profile_id", '-', '')) = 32 and substr("profile_id", 9, 1) = '-' and substr("profile_id", 14, 1) = '-' and substr("profile_id", 19, 1) = '-' and substr("profile_id", 24, 1) = '-') )),
	CONSTRAINT "openmeld_profiles_organization_profile_kind_check" CHECK((("profile_kind" = 'agent' and "organization_id" is not null) or ("profile_kind" in ('human', 'system') and "organization_id" is null)))
);
--> statement-breakpoint
INSERT INTO `__new_openmeld_profiles`("profile_id", "profile_name", "profile_handle", "profile_kind", "is_default", "status", "organization_id", "owner_user_id", "created_by_user_id", "creator_profile_id", "creation_actor_profile_id", "source", "managed_role", "creation_idempotency_key", "default_project_id", "last_used_at", "created_at", "updated_at") SELECT "profile_id", "profile_name", "profile_handle", "profile_kind", "is_default", "status", "organization_id", CASE WHEN "managed_role" = 'center_agent' THEN NULL ELSE "owner_user_id" END, "created_by_user_id", "creator_profile_id", "creation_actor_profile_id", "source", "managed_role", "creation_idempotency_key", "default_project_id", "last_used_at", "created_at", "updated_at" FROM `openmeld_profiles`;--> statement-breakpoint
DROP TABLE `openmeld_profiles`;--> statement-breakpoint
ALTER TABLE `__new_openmeld_profiles` RENAME TO `openmeld_profiles`;--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_user_id_idx` ON `openmeld_profiles` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_kind_idx` ON `openmeld_profiles` (`owner_user_id`,`profile_kind`);--> statement-breakpoint
CREATE INDEX `openmeld_profiles_organization_kind_idx` ON `openmeld_profiles` (`organization_id`,`profile_kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_handle_uq_idx` ON `openmeld_profiles` (`owner_user_id`,`profile_handle`);--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_default_idx` ON `openmeld_profiles` (`owner_user_id`,`is_default`);--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_default_human_uq_idx` ON `openmeld_profiles` (`owner_user_id`) WHERE "profile_kind" = 'human' and "is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_managed_role_uq_idx` ON `openmeld_profiles` (`owner_user_id`,`managed_role`) WHERE "managed_role" is not null and "managed_role" != 'center_agent' and "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_org_center_agent_uq_idx` ON `openmeld_profiles` (`organization_id`,`managed_role`) WHERE "managed_role" = 'center_agent' and "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `openmeld_profiles_owner_creation_idempotency_uq_idx` ON `openmeld_profiles` (`owner_user_id`,`creation_idempotency_key`) WHERE "creation_idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX `openmeld_profiles_owner_status_idx` ON `openmeld_profiles` (`owner_user_id`,`status`);--> statement-breakpoint
-- full-shared-schema-only
INSERT OR REPLACE INTO openmeld_profile_space_history SELECT * FROM __center_owner_backup_openmeld_profile_space_history;--> statement-breakpoint
-- full-shared-schema-only
DROP TABLE __center_owner_backup_openmeld_profile_space_history;--> statement-breakpoint
-- full-shared-schema-only
INSERT OR REPLACE INTO center_agent_audit_journal SELECT * FROM __center_owner_backup_center_agent_audit_journal;--> statement-breakpoint
-- full-shared-schema-only
DROP TABLE __center_owner_backup_center_agent_audit_journal;--> statement-breakpoint
-- full-shared-schema-only
INSERT OR REPLACE INTO center_agent_project_operations SELECT * FROM __center_owner_backup_center_agent_project_operations;--> statement-breakpoint
-- full-shared-schema-only
DROP TABLE __center_owner_backup_center_agent_project_operations;--> statement-breakpoint
-- full-shared-schema-only
INSERT OR REPLACE INTO center_agent_project_remove_confirmations SELECT * FROM __center_owner_backup_center_agent_project_remove_confirmations;--> statement-breakpoint
-- full-shared-schema-only
DROP TABLE __center_owner_backup_center_agent_project_remove_confirmations;--> statement-breakpoint
-- full-shared-schema-only
INSERT OR REPLACE INTO center_agent_organization_document_operations SELECT * FROM __center_owner_backup_center_agent_organization_document_operations;--> statement-breakpoint
-- full-shared-schema-only
DROP TABLE __center_owner_backup_center_agent_organization_document_operations;--> statement-breakpoint
-- full-shared-schema-only
INSERT OR REPLACE INTO center_agent_designations SELECT * FROM __center_owner_backup_center_agent_designations;--> statement-breakpoint
-- full-shared-schema-only
DROP TABLE __center_owner_backup_center_agent_designations;--> statement-breakpoint
-- full-shared-schema-only
INSERT OR REPLACE INTO center_agent_connector_action_operations SELECT * FROM __center_owner_backup_center_agent_connector_action_operations;--> statement-breakpoint
-- full-shared-schema-only
DROP TABLE __center_owner_backup_center_agent_connector_action_operations;--> statement-breakpoint
-- full-shared-schema-only
INSERT OR REPLACE INTO center_agent_context_manifests SELECT * FROM __center_owner_backup_center_agent_context_manifests;--> statement-breakpoint
-- full-shared-schema-only
DROP TABLE __center_owner_backup_center_agent_context_manifests;--> statement-breakpoint
-- full-shared-schema-only
INSERT OR REPLACE INTO center_agent_context_load_receipts SELECT * FROM __center_owner_backup_center_agent_context_load_receipts;--> statement-breakpoint
-- full-shared-schema-only
DROP TABLE __center_owner_backup_center_agent_context_load_receipts;--> statement-breakpoint
-- full-shared-schema-only
INSERT OR REPLACE INTO center_agent_context_manifest_materializations SELECT * FROM __center_owner_backup_center_agent_context_manifest_materializations;--> statement-breakpoint
-- full-shared-schema-only
DROP TABLE __center_owner_backup_center_agent_context_manifest_materializations;--> statement-breakpoint
-- full-shared-schema-only
INSERT OR REPLACE INTO center_agent_publication_operations SELECT * FROM __center_owner_backup_center_agent_publication_operations;--> statement-breakpoint
-- full-shared-schema-only
DROP TABLE __center_owner_backup_center_agent_publication_operations;--> statement-breakpoint
-- focused-fixture-requires: openmeld_profiles
CREATE TRIGGER `openMeldDaemon_agent_profile_bindings_canonical_enabled_insert_check`
BEFORE INSERT ON `openMeldDaemon_agent_profile_bindings`
FOR EACH ROW
WHEN NEW.`binding_state` = 'enabled_primary'
  AND (
    NOT EXISTS (
      SELECT 1
      FROM `openmeld_profiles` profile
      WHERE profile.`profile_id` = NEW.`agent_profile_id`
        AND ((NEW.owner_kind = 'owner_account' AND profile.owner_user_id = NEW.owner_id AND coalesce(profile.managed_role, '') != 'center_agent') OR (NEW.owner_kind = 'organization' AND profile.organization_id = NEW.owner_id AND profile.managed_role = 'center_agent' AND NEW.runtime_kind = 'hosted_center_agent'))
    )
    OR EXISTS (
      SELECT 1
      FROM `openMeldDaemon_agent_profile_bindings` existing
      WHERE existing.`agent_profile_id` = NEW.`agent_profile_id`
        AND existing.`binding_state` = 'enabled_primary'
        AND (
          existing.`owner_kind` != NEW.`owner_kind`
          OR existing.`owner_id` != NEW.`owner_id`
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'agent_profile_binding_canonical_enabled_check');
END;--> statement-breakpoint
-- focused-fixture-requires: openmeld_profiles
CREATE TRIGGER `openMeldDaemon_agent_profile_bindings_canonical_enabled_update_check`
BEFORE UPDATE ON `openMeldDaemon_agent_profile_bindings`
FOR EACH ROW
WHEN NEW.`binding_state` = 'enabled_primary'
  AND (
    NOT EXISTS (
      SELECT 1
      FROM `openmeld_profiles` profile
      WHERE profile.`profile_id` = NEW.`agent_profile_id`
        AND ((NEW.owner_kind = 'owner_account' AND profile.owner_user_id = NEW.owner_id AND coalesce(profile.managed_role, '') != 'center_agent') OR (NEW.owner_kind = 'organization' AND profile.organization_id = NEW.owner_id AND profile.managed_role = 'center_agent' AND NEW.runtime_kind = 'hosted_center_agent'))
    )
    OR EXISTS (
      SELECT 1
      FROM `openMeldDaemon_agent_profile_bindings` existing
      WHERE existing.`agent_profile_id` = NEW.`agent_profile_id`
        AND existing.`binding_state` = 'enabled_primary'
        AND (
          existing.`owner_kind` != NEW.`owner_kind`
          OR existing.`owner_id` != NEW.`owner_id`
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'agent_profile_binding_canonical_enabled_check');
END;
--> statement-breakpoint
-- full-shared-schema-only
UPDATE space_index_memberships SET owner_user_id_snapshot = NULL, owner_name_snapshot = NULL WHERE profile_id IN (SELECT profile_id FROM openmeld_profiles WHERE managed_role = 'center_agent');--> statement-breakpoint
-- full-shared-schema-only
UPDATE space_index_spaces SET creator_owner_user_id = NULL WHERE creator_profile_id IN (SELECT profile_id FROM openmeld_profiles WHERE managed_role = 'center_agent');--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;
