import { describe, expect, it } from "vitest";
import { readActiveRepresentedHumanSender } from "../src/remote-agent/application/turn-envelope";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("Remote Agent continuation requester resolution", () => {
  it("resolves an active Organization member through their account-scoped Human Profile", async () => {
    const harness = await createHarness();
    try {
      await seedMemberAndHumanProfile(harness, {
        organizationId: "org_1",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileOrganizationId: null,
        userId: "user_1",
      });

      await expect(
        readActiveRepresentedHumanSender({
          db: harness.db,
          organizationId: "org_1",
          profileId: "11111111-1111-4111-8111-111111111111",
          userId: "user_1",
        })
      ).resolves.toMatchObject({
        member_id: "member_1",
        owner_user_id: "user_1",
        profile_id: "11111111-1111-4111-8111-111111111111",
        profile_kind: "human",
        profile_name: "Felix",
        role: "owner",
      });
    } finally {
      await harness.close();
    }
  });

  it("does not resolve a Human Profile owned by another user", async () => {
    const harness = await createHarness();
    try {
      await seedMemberAndHumanProfile(harness, {
        organizationId: "org_1",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileOrganizationId: null,
        userId: "user_2",
      });

      await expect(
        readActiveRepresentedHumanSender({
          db: harness.db,
          organizationId: "org_1",
          profileId: "11111111-1111-4111-8111-111111111111",
          userId: "user_1",
        })
      ).resolves.toBeNull();
    } finally {
      await harness.close();
    }
  });
});

async function createHarness() {
  const harness = await createPostgresHarness();
  await harness.query({
    text: `INSERT INTO "openmeld"."users" (id,name,email) VALUES ('user_1','Felix','user1@example.test'), ('user_2','Other','user2@example.test')`,
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."organizations" (id,name,slug,created_at) VALUES ('org_1','Organization','org-1',1000)`,
  });

  return harness;
}

async function seedMemberAndHumanProfile(
  harness: Awaited<ReturnType<typeof createHarness>>,
  input: {
    organizationId: string;
    profileId: string;
    profileOrganizationId: string | null;
    userId: string;
  }
) {
  await harness.query({
    values: ["member_1", input.organizationId, "user_1", "owner"],
    text: `
      INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, "created_at")
      VALUES ($1, $2, $3, $4, 1700000000000)
    `,
  });
  await harness.query({
    values: [
      input.profileId,
      "human",
      "Felix",
      input.userId,
      input.profileOrganizationId,
      "active",
    ],
    text: `
      INSERT INTO "openmeld"."openmeld_profiles" (
        profile_id,
        profile_kind,
        profile_name,
        owner_user_id,
        organization_id,
        status, profile_handle, source
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'felix', 'auth_bootstrap')
    `,
  });
}
