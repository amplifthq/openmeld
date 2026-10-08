import { createAuthDatabase } from "@openmeld/db/auth";
import { withPostgresRequest } from "@openmeld/db/postgresql";
import { expect, it } from "vitest";
import { createPostgresHarness } from "../../../tooling/postgresql/test-harness";
import { createDrizzleOpenMeldProfileRepository } from "../src/profiles/profile-repository";

it("persists an avatar and its appearance together, rejecting a stale or cross-organization replacement", async () => {
  const harness = await createPostgresHarness();
  const profileId = `agt_${crypto.randomUUID()}`;
  try {
    await harness.query(
      "INSERT INTO openmeld.organizations (id,name,slug,created_at) VALUES ('avatar-org','Avatar','avatar-org',1700000000000)"
    );
    await withPostgresRequest(harness.binding, async () => {
      const repository = createDrizzleOpenMeldProfileRepository(
        createAuthDatabase()
      );
      await repository.insertAgentProfile({
        profileId,
        profileName: "Center Agent",
        profileHandle: "center-agent",
        organizationId: "avatar-org",
        ownerUserId: null,
        managedRole: "center_agent",
        source: "center_agent_create",
      });
      await repository.updateAgentAvatarStyle(profileId, "mech", {
        organizationId: "avatar-org",
        avatarOptions: { palette: "balanced" },
        expectedAvatarOptions: null,
      });
      expect(await repository.findByProfileId(profileId)).toMatchObject({
        avatarStyle: "mech",
        avatarOptions: { palette: "balanced" },
      });
      await expect(
        repository.updateAgentAvatarStyle(profileId, "fluid", {
          organizationId: "avatar-org",
          avatarOptions: { color: "rose" },
          expectedAvatarOptions: null,
        })
      ).rejects.toThrow("This avatar changed");
      await expect(
        repository.updateAgentAvatarStyle(profileId, "fluid", {
          organizationId: "other-org",
          avatarOptions: { color: "rose" },
        })
      ).rejects.toThrow();
      await repository.updateAgentAvatarStyle(profileId, "custom", {
        organizationId: "avatar-org",
        avatarOptions: {
          imageUrl:
            "https://gateway.openmeld.invalid/v1/profile-avatars/avatar.webp",
        },
        expectedAvatarOptions: { palette: "balanced" },
      });
      expect(await repository.findByProfileId(profileId)).toMatchObject({
        avatarStyle: "custom",
        avatarOptions: {
          imageUrl:
            "https://gateway.openmeld.invalid/v1/profile-avatars/avatar.webp",
        },
      });
      await repository.updateAgentAvatarStyle(profileId, "fluid", {
        organizationId: "avatar-org",
        avatarOptions: { color: "sage" },
      });
      expect(await repository.findByProfileId(profileId)).toMatchObject({
        avatarStyle: "fluid",
        avatarOptions: { color: "sage" },
      });
    });
  } finally {
    await harness.close();
  }
});
