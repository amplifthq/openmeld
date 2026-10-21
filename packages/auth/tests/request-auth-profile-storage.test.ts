import { createAuthDatabase } from "@openmeld/db/auth";
import { withPostgresRequest } from "@openmeld/db/postgresql";
import { expect, it } from "vitest";
import { createPostgresHarness } from "../../../tooling/postgresql/test-harness";
import { createDrizzleOpenMeldProfileRepository } from "../src/profiles/profile-repository";

const OWNER_PRIMARY_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_SECOND_HUMAN_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PRIMARY_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_AGENT_ID = "agt_44444444-4444-4444-8444-444444444444";
const OWNER_DISABLED_AGENT_ID = "agt_55555555-5555-4555-8555-555555555555";
const OTHER_AGENT_ID = "agt_66666666-6666-4666-8666-666666666666";
const MISSING_AGENT_ID = "agt_77777777-7777-4777-8777-777777777777";

it("reads the default Human Profile and an owned Profile with the separate-read filters", async () => {
  const harness = await createPostgresHarness();
  try {
    await harness.query(
      "INSERT INTO openmeld.organizations (id,name,slug,created_at) VALUES ('auth-org','Auth','auth-org',1700000000000)"
    );
    await harness.query(
      "INSERT INTO openmeld.users (id,name,email,email_verified,created_at,updated_at) VALUES ('owner','Owner','owner@example.invalid',1,1700000000000,1700000000000), ('other','Other','other@example.invalid',1,1700000000000,1700000000000), ('fresh','Fresh','fresh@example.invalid',1,1700000000000,1700000000000)"
    );
    await withPostgresRequest(harness.binding, async () => {
      const repository = createDrizzleOpenMeldProfileRepository(
        createAuthDatabase()
      );
      await repository.insertPrimaryHumanProfile({
        profileId: OWNER_PRIMARY_ID,
        profileName: "Owner",
        profileHandle: "owner",
        ownerUserId: "owner",
      });
      await repository.insertHumanProfile({
        profileId: OWNER_SECOND_HUMAN_ID,
        profileName: "Owner Second",
        profileHandle: "owner-second",
        ownerUserId: "owner",
      });
      await repository.insertPrimaryHumanProfile({
        profileId: OTHER_PRIMARY_ID,
        profileName: "Other",
        profileHandle: "other",
        ownerUserId: "other",
      });
      for (const [profileId, ownerUserId, profileHandle] of [
        [OWNER_AGENT_ID, "owner", "agent"],
        [OWNER_DISABLED_AGENT_ID, "owner", "disabled-agent"],
        [OTHER_AGENT_ID, "other", "other-agent"],
      ] as const) {
        await repository.insertAgentProfile({
          profileId,
          profileName: profileHandle,
          profileHandle,
          organizationId: "auth-org",
          ownerUserId,
        });
      }
      await harness.query(
        "UPDATE openmeld.openmeld_profiles SET status = 'disabled' WHERE profile_id = $1",
        [OWNER_DISABLED_AGENT_ID]
      );

      for (const [ownerUserId, profileId] of [
        ["owner", OWNER_PRIMARY_ID],
        ["owner", OWNER_SECOND_HUMAN_ID],
        ["owner", OWNER_AGENT_ID],
        ["owner", OWNER_DISABLED_AGENT_ID],
        ["owner", OTHER_AGENT_ID],
        ["owner", OTHER_PRIMARY_ID],
        ["owner", MISSING_AGENT_ID],
        ["other", OWNER_AGENT_ID],
        ["fresh", OWNER_AGENT_ID],
      ] as const) {
        const combined = await repository.findDefaultHumanAndOwnedProfile(
          ownerUserId,
          profileId
        );
        expect(combined).toEqual({
          defaultHumanProfile:
            await repository.findDefaultHumanByOwner(ownerUserId),
          ownedProfile: await repository.findByOwnerAndProfileId(
            ownerUserId,
            profileId
          ),
        });
      }

      expect(
        await repository.findDefaultHumanAndOwnedProfile(
          "owner",
          OWNER_DISABLED_AGENT_ID
        )
      ).toMatchObject({
        defaultHumanProfile: { profileId: OWNER_PRIMARY_ID },
        ownedProfile: {
          profileId: OWNER_DISABLED_AGENT_ID,
          status: "disabled",
        },
      });
      expect(
        await repository.findDefaultHumanAndOwnedProfile(
          "owner",
          OTHER_AGENT_ID
        )
      ).toMatchObject({
        defaultHumanProfile: { profileId: OWNER_PRIMARY_ID },
        ownedProfile: null,
      });
      expect(
        await repository.findDefaultHumanAndOwnedProfile(
          "fresh",
          OWNER_AGENT_ID
        )
      ).toEqual({ defaultHumanProfile: null, ownedProfile: null });
    });
  } finally {
    await harness.close();
  }
});
