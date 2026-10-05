-- Serialize credential/profile admission with irreversible account closure.
CREATE FUNCTION "openmeld"."require_live_account_reference"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_id text := to_jsonb(NEW) ->> TG_ARGV[0];
BEGIN
  IF account_id IS NOT NULL THEN
    PERFORM 1 FROM "openmeld"."users" WHERE id = account_id AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account_unavailable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['sessions', 'accounts', 'passkeys', 'device_codes', 'members'] LOOP
    EXECUTE format('CREATE TRIGGER live_account_reference BEFORE INSERT OR UPDATE ON openmeld.%I FOR EACH ROW EXECUTE FUNCTION openmeld.require_live_account_reference(''user_id'')', table_name);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER live_account_reference BEFORE INSERT OR UPDATE ON "openmeld"."openmeld_profiles"
FOR EACH ROW EXECUTE FUNCTION "openmeld"."require_live_account_reference"('owner_user_id');
--> statement-breakpoint
-- Membership mutations must use the same Organization lock as deletion acceptance.
-- Deletes remain possible for the lifecycle cleanup and Organization cascades.
CREATE FUNCTION "openmeld"."lock_account_deletion_organization"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE closing_at bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM "openmeld"."organizations" WHERE id = OLD.organization_id FOR UPDATE;
    RETURN OLD;
  END IF;
  IF NEW.organization_id IS NOT NULL THEN
    SELECT deletion_requested_at INTO closing_at FROM "openmeld"."organizations"
      WHERE id = NEW.organization_id FOR UPDATE;
    IF closing_at IS NOT NULL THEN
      RAISE EXCEPTION 'organization_closing' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_deletion_organization_lock BEFORE INSERT OR UPDATE OR DELETE ON "openmeld"."members"
FOR EACH ROW EXECUTE FUNCTION "openmeld"."lock_account_deletion_organization"();
--> statement-breakpoint
CREATE TRIGGER account_deletion_organization_lock BEFORE INSERT OR UPDATE ON "openmeld"."openmeld_profiles"
FOR EACH ROW EXECUTE FUNCTION "openmeld"."lock_account_deletion_organization"();
--> statement-breakpoint
CREATE FUNCTION "openmeld"."preserve_deleted_account"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'account_unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER preserve_deleted_account BEFORE UPDATE ON "openmeld"."users"
FOR EACH ROW EXECUTE FUNCTION "openmeld"."preserve_deleted_account"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "openmeld"."require_live_connector_owner"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scope = 'member' OR TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.access_revision > OLD.access_revision THEN
    PERFORM 1 FROM "openmeld"."users" WHERE id = NEW.user_id AND deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'account_unavailable' USING ERRCODE = '23514'; END IF;
  END IF;
  PERFORM 1 FROM "openmeld"."organizations" WHERE id = NEW.organization_id AND deletion_requested_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization_unavailable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "connector_owner_admission" BEFORE INSERT OR UPDATE ON "openmeld"."connector_connections" FOR EACH ROW EXECUTE FUNCTION "openmeld"."require_live_connector_owner"();

--> statement-breakpoint
CREATE TRIGGER live_account_reference BEFORE INSERT OR UPDATE ON "openmeld"."cloud_computers"
FOR EACH ROW EXECUTE FUNCTION "openmeld"."require_live_account_reference"('owner_user_id');
