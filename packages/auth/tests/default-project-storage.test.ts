import { createAuthDatabase } from "@openmeld/db/auth";
import { withPostgresRequest } from "@openmeld/db/postgresql";
import { expect, it } from "vitest";
import { createPostgresHarness } from "../../../tooling/postgresql/test-harness";
import { createDrizzleOpenMeldProfileRepository } from "../src/profiles/profile-repository";
import { createOpenMeldProfileService } from "../src/profiles/profile-service";

it.each([
  false,
  true,
])("preserves an explicit clear during creation recovery, including before first initialization: %s", async (initializeFirst) => {
  const harness = await createPostgresHarness();
  const profileId = `agt_${crypto.randomUUID()}`;
  try {
    await harness.query(
      "INSERT INTO openmeld.organizations (id,name,slug,created_at) VALUES ('folder-org','Folders','folder-org',1700000000000)"
    );
    await harness.query(
      "INSERT INTO openmeld.users (id,name,email,email_verified,created_at,updated_at) VALUES ('folder-owner','Owner','folder@example.invalid',1,1700000000000,1700000000000)"
    );
    await withPostgresRequest(harness.binding, async () => {
      const repository = createDrizzleOpenMeldProfileRepository(
        createAuthDatabase()
      );
      await repository.insertAgentProfile({
        profileId,
        profileName: "Project Agent",
        profileHandle: "project-agent",
        organizationId: "folder-org",
        ownerUserId: "folder-owner",
      });
      const service = createOpenMeldProfileService(repository);
      const selector = {
        organizationId: "folder-org",
        ownerUserId: "folder-owner",
        profileId,
      };
      await service.updateProfileForOwner({
        ownerUserId: selector.ownerUserId,
        profileId,
        profileName: "Renamed Project Agent",
      });
      await service.updateAgentAvatarStyleForOwner({
        ownerUserId: selector.ownerUserId,
        profileId,
        avatarStyle: "fluid",
      });
      expect(await repository.findByProfileId(profileId)).toMatchObject({
        defaultProjectRevision: 0,
        profileName: "Renamed Project Agent",
        avatarStyle: "fluid",
      });
      if (initializeFirst) {
        const initialized =
          await service.updateAgentProfileDefaultProjectForOwner({
            ...selector,
            defaultProjectId: "project-alpha",
            onlyIfUnmodified: true,
          });
        expect(initialized.defaultProjectId).toBe("project-alpha");
        expect(
          await service.updateAgentProfileDefaultProjectForOwner({
            ...selector,
            defaultProjectId: "project-alpha",
            onlyIfUnmodified: true,
          })
        ).toEqual(initialized);
      }
      const cleared = await service.updateAgentProfileDefaultProjectForOwner({
        ...selector,
        defaultProjectId: null,
      });
      expect(cleared.updatedAt.getTime()).toBeGreaterThan(
        cleared.createdAt.getTime()
      );
      expect(cleared.defaultProjectRevision).toBe(initializeFirst ? 2 : 1);
      expect(
        await service.updateAgentProfileDefaultProjectForOwner({
          ...selector,
          defaultProjectId: "project-alpha",
          onlyIfUnmodified: true,
        })
      ).toEqual(cleared);
      expect(await repository.findByProfileId(profileId)).toEqual(cleared);
      expect(
        await service.updateAgentProfileDefaultProjectForOwner({
          ...selector,
          defaultProjectId: "project-beta",
        })
      ).toMatchObject({ defaultProjectId: "project-beta" });
    });
  } finally {
    await harness.close();
  }
});

it("keeps concurrent explicit Project choices and requires confirmation for historical unknown settings", async () => {
  const harness = await createPostgresHarness();
  try {
    await harness.query(
      "INSERT INTO openmeld.organizations (id,name,slug,created_at) VALUES ('race-org','Folders','race-org',1700000000000)"
    );
    await harness.query(
      "INSERT INTO openmeld.users (id,name,email,email_verified,created_at,updated_at) VALUES ('race-owner','Owner','race@example.invalid',1,1700000000000,1700000000000)"
    );
    const profileId = `agt_${crypto.randomUUID()}`;
    const selector = {
      organizationId: "race-org",
      ownerUserId: "race-owner",
      profileId,
    };
    const run = async (
      defaultProjectId: string | null,
      onlyIfUnmodified = false,
      targetProfileId = profileId
    ) =>
      await withPostgresRequest(harness.binding, async () => {
        const service = createOpenMeldProfileService(
          createDrizzleOpenMeldProfileRepository(createAuthDatabase())
        );
        return await service.updateAgentProfileDefaultProjectForOwner({
          ...selector,
          profileId: targetProfileId,
          defaultProjectId,
          onlyIfUnmodified,
        });
      });
    await withPostgresRequest(harness.binding, async () => {
      await createDrizzleOpenMeldProfileRepository(
        createAuthDatabase()
      ).insertAgentProfile({
        ...selector,
        profileName: "Concurrent Agent",
        profileHandle: "concurrent-agent",
      });
    });
    await Promise.all([run("creation-project", true), run("owner-project")]);
    expect((await run("creation-project", true)).defaultProjectId).toBe(
      "owner-project"
    );
    // An old Auth writer omits the marker. Its same-null setter returns before
    // SQL, so the trigger cannot upgrade that unknown history to "unset".
    const legacyProfileId = `agt_${crypto.randomUUID()}`;
    await harness.query({
      text: `INSERT INTO openmeld.openmeld_profiles
        (profile_id,profile_name,profile_handle,profile_kind,is_default,status,organization_id,owner_user_id,source)
        VALUES ($1,'Legacy Agent','legacy-agent','agent',0,'active','race-org','race-owner','cli_create')`,
      values: [legacyProfileId],
    });
    const oldSetterNoop = await withPostgresRequest(
      harness.binding,
      async () =>
        await createDrizzleOpenMeldProfileRepository(
          createAuthDatabase()
        ).findByProfileId(legacyProfileId)
    );
    expect(oldSetterNoop).toMatchObject({
      defaultProjectId: null,
      defaultProjectRevision: null,
    });
    await expect(
      run("creation-project", true, legacyProfileId)
    ).rejects.toMatchObject({
      code: "profile.default_project_confirmation_required",
    });
    await run(null, false, legacyProfileId);
    expect(await run("creation-project", true, legacyProfileId)).toMatchObject({
      defaultProjectId: null,
      defaultProjectRevision: 1,
    });
  } finally {
    await harness.close();
  }
});
