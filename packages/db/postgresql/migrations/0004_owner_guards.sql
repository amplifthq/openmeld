-- Cross-table ownership and deletion effects are not represented by Drizzle's
-- table snapshot. Keep these native PostgreSQL triggers in the immutable journal.
CREATE FUNCTION "openmeld"."check_enabled_agent_profile_binding"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.binding_state = 'enabled_primary' THEN
    PERFORM 1 FROM "openmeld"."openmeld_profiles" AS profile
    WHERE profile.profile_id = NEW.agent_profile_id
      AND (
        (NEW.owner_kind = 'owner_account'
          AND profile.owner_user_id = NEW.owner_id
          AND coalesce(profile.managed_role, '') <> 'center_agent')
        OR
        (NEW.owner_kind = 'organization'
          AND profile.organization_id = NEW.owner_id
          AND profile.managed_role = 'center_agent'
          AND NEW.runtime_kind = 'hosted_center_agent')
      )
    FOR SHARE;
    IF NOT FOUND OR EXISTS (
      SELECT 1 FROM "openmeld"."openMeldDaemon_agent_profile_bindings" AS existing
      WHERE existing.agent_profile_id = NEW.agent_profile_id
        AND existing.binding_state = 'enabled_primary'
        AND (existing.owner_kind <> NEW.owner_kind OR existing.owner_id <> NEW.owner_id)
    ) THEN
      RAISE EXCEPTION 'agent_profile_binding_canonical_enabled_check'
        USING ERRCODE = '23514', CONSTRAINT = 'agent_profile_binding_canonical_enabled_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "openMeldDaemon_agent_profile_bindings_canonical_enabled_check"
BEFORE INSERT OR UPDATE ON "openmeld"."openMeldDaemon_agent_profile_bindings"
FOR EACH ROW EXECUTE FUNCTION "openmeld"."check_enabled_agent_profile_binding"();
--> statement-breakpoint
CREATE FUNCTION "openmeld"."enqueue_deleted_profile"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  INSERT INTO "openmeld"."openmeld_profile_deletion_outbox" (
    profile_id, owner_user_id, organization_id, profile_kind,
    attempt_count, next_attempt_at_ms, created_at_ms, updated_at_ms
  ) VALUES (
    OLD.profile_id, OLD.owner_user_id, OLD.organization_id, OLD.profile_kind,
    0, now_ms, now_ms, now_ms
  ) ON CONFLICT (profile_id) DO UPDATE SET
    owner_user_id = excluded.owner_user_id,
    organization_id = excluded.organization_id,
    profile_kind = excluded.profile_kind,
    attempt_count = 0,
    next_attempt_at_ms = excluded.next_attempt_at_ms,
    last_attempt_at_ms = NULL,
    last_error = NULL,
    updated_at_ms = excluded.updated_at_ms;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "openmeld_profiles_deletion_outbox_insert"
AFTER DELETE ON "openmeld"."openmeld_profiles"
FOR EACH ROW WHEN (OLD.profile_kind IN ('agent', 'human'))
EXECUTE FUNCTION "openmeld"."enqueue_deleted_profile"();
