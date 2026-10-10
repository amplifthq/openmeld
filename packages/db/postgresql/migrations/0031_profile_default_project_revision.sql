-- Historical values and inserts from old Auth writers have unknown Project
-- history. Only the supporting Auth insert owner explicitly writes revision 0.
ALTER TABLE "openmeld"."openmeld_profiles" ADD COLUMN "default_project_revision" integer;--> statement-breakpoint
ALTER TABLE "openmeld"."openmeld_profiles" ADD CONSTRAINT "openmeld_profiles_default_project_revision_check" CHECK ("openmeld"."openmeld_profiles"."default_project_revision" is null or "openmeld"."openmeld_profiles"."default_project_revision" >= 0);--> statement-breakpoint
-- Actual old Auth SQL writes pass through this guard. Business-layer no-op
-- writes do not; their unknown revision remains null. UPDATE OF records an
-- explicit clear even when null; name/avatar writes do not advance it.
CREATE FUNCTION "openmeld"."advance_profile_default_project_revision"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.default_project_revision := COALESCE(OLD.default_project_revision, 0) + 1;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER profile_default_project_revision
BEFORE UPDATE OF default_project_id ON "openmeld"."openmeld_profiles"
FOR EACH ROW EXECUTE FUNCTION "openmeld"."advance_profile_default_project_revision"();
