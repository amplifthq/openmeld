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
