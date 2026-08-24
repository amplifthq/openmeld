CREATE INDEX `idx_openMeldDaemon_agent_profile_bindings_profile_enabled_owner` ON `openMeldDaemon_agent_profile_bindings` (`agent_profile_id`,`owner_kind`,`owner_id`) WHERE "binding_state" = 'enabled_primary';--> statement-breakpoint
-- full-shared-schema-only
CREATE TRIGGER `openMeldDaemon_agent_profile_bindings_canonical_enabled_insert_check`
BEFORE INSERT ON `openMeldDaemon_agent_profile_bindings`
FOR EACH ROW
WHEN NEW.`binding_state` = 'enabled_primary'
  AND (
    NEW.`owner_kind` != 'owner_account'
    OR NOT EXISTS (
      SELECT 1
      FROM `openmeld_profiles` profile
      WHERE profile.`profile_id` = NEW.`agent_profile_id`
        AND profile.`owner_user_id` = NEW.`owner_id`
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
-- full-shared-schema-only
CREATE TRIGGER `openMeldDaemon_agent_profile_bindings_canonical_enabled_update_check`
BEFORE UPDATE ON `openMeldDaemon_agent_profile_bindings`
FOR EACH ROW
WHEN NEW.`binding_state` = 'enabled_primary'
  AND (
    NEW.`owner_kind` != 'owner_account'
    OR NOT EXISTS (
      SELECT 1
      FROM `openmeld_profiles` profile
      WHERE profile.`profile_id` = NEW.`agent_profile_id`
        AND profile.`owner_user_id` = NEW.`owner_id`
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
