-- Extend native runtime admission without rebuilding Bindings or removing ownership triggers.
DROP TRIGGER `openMeldDaemon_agent_profile_bindings_runtime_kind_insert_check`;
--> statement-breakpoint
CREATE TRIGGER `openMeldDaemon_agent_profile_bindings_runtime_kind_insert_check`
BEFORE INSERT ON `openMeldDaemon_agent_profile_bindings`
WHEN NEW.runtime_kind NOT IN ('openmeld_service', 'hosted_center_agent', 'hosted_remote_agent')
BEGIN
  SELECT RAISE(ABORT, 'openMeldDaemon_agent_profile_bindings_runtime_kind_check');
END;
--> statement-breakpoint
DROP TRIGGER `openMeldDaemon_agent_profile_bindings_runtime_kind_update_check`;
--> statement-breakpoint
CREATE TRIGGER `openMeldDaemon_agent_profile_bindings_runtime_kind_update_check`
BEFORE UPDATE ON `openMeldDaemon_agent_profile_bindings`
WHEN NEW.runtime_kind NOT IN ('openmeld_service', 'hosted_center_agent', 'hosted_remote_agent')
BEGIN
  SELECT RAISE(ABORT, 'openMeldDaemon_agent_profile_bindings_runtime_kind_check');
END;
--> statement-breakpoint
DROP TRIGGER `openMeldDaemon_agent_profile_bindings_hosted_identity_insert_check`;
--> statement-breakpoint
CREATE TRIGGER `openMeldDaemon_agent_profile_bindings_hosted_identity_insert_check`
BEFORE INSERT ON `openMeldDaemon_agent_profile_bindings`
WHEN NOT (
  (NEW.runtime_kind = 'openmeld_service' AND NEW.hosted_runtime_identity_json IS NULL)
  OR (
    NEW.runtime_kind IN ('hosted_center_agent', 'hosted_remote_agent')
    AND NEW.hosted_runtime_identity_json IS NOT NULL
    AND json_valid(NEW.hosted_runtime_identity_json)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'openMeldDaemon_agent_profile_bindings_hosted_identity_check');
END;
--> statement-breakpoint
DROP TRIGGER `openMeldDaemon_agent_profile_bindings_hosted_identity_update_check`;
--> statement-breakpoint
CREATE TRIGGER `openMeldDaemon_agent_profile_bindings_hosted_identity_update_check`
BEFORE UPDATE ON `openMeldDaemon_agent_profile_bindings`
WHEN NOT (
  (NEW.runtime_kind = 'openmeld_service' AND NEW.hosted_runtime_identity_json IS NULL)
  OR (
    NEW.runtime_kind IN ('hosted_center_agent', 'hosted_remote_agent')
    AND NEW.hosted_runtime_identity_json IS NOT NULL
    AND json_valid(NEW.hosted_runtime_identity_json)
  )
)
BEGIN
  SELECT RAISE(ABORT, 'openMeldDaemon_agent_profile_bindings_hosted_identity_check');
END;
--> statement-breakpoint
