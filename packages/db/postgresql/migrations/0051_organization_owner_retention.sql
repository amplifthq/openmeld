-- Membership writes already acquire the Organization lock installed by 0018.
-- Check after the statement so a stale concurrent Owner demotion cannot remove
-- the last Owner. Empty membership sets remain available to native Organization
-- deletion; Auth separately guards a last Owner's ordinary leave operation.
CREATE FUNCTION "openmeld"."require_retained_organization_owner"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE closing_at bigint;
BEGIN
  IF NOT ('owner' = ANY(string_to_array(OLD.role, ','))) THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id = OLD.organization_id
      AND 'owner' = ANY(string_to_array(NEW.role, ',')) THEN
      RETURN NULL;
    END IF;
  END IF;
  SELECT deletion_requested_at INTO closing_at
    FROM "openmeld"."organizations" WHERE id = OLD.organization_id FOR UPDATE;
  IF NOT FOUND OR closing_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "openmeld"."members" WHERE organization_id = OLD.organization_id
  ) AND NOT EXISTS (
    SELECT 1 FROM "openmeld"."members"
      WHERE organization_id = OLD.organization_id
        AND 'owner' = ANY(string_to_array(role, ','))
  ) THEN
    RAISE EXCEPTION 'An organization must keep at least one Owner.'
      USING ERRCODE = '23514', CONSTRAINT = 'organization_requires_owner';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organization_owner_retention
AFTER UPDATE OF role, organization_id OR DELETE ON "openmeld"."members"
FOR EACH ROW EXECUTE FUNCTION "openmeld"."require_retained_organization_owner"();
