-- A MemberAgent's default Profile must be one of its own Profiles. Drizzle's
-- table snapshot cannot express ON DELETE SET NULL with a column list, so the
-- reference lives only in the immutable journal: deleting the default Profile
-- clears default_profile_id and never the MemberAgent id.
ALTER TABLE "openmeld"."member_agents" ADD CONSTRAINT "member_agents_default_profile_fk"
FOREIGN KEY ("id", "default_profile_id")
REFERENCES "openmeld"."openmeld_profiles" ("member_agent_id", "profile_id")
ON DELETE SET NULL ("default_profile_id") ON UPDATE NO ACTION;
