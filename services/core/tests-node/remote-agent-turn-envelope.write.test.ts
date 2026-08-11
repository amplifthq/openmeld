import { describe, expect, it } from "vitest";
import { readActiveRepresentedHumanSender } from "../src/remote-agent/application/turn-envelope";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

describe("Remote Agent continuation requester resolution", () => {
  it("resolves an active Organization member through their account-scoped Human Profile", async () => {
    const harness = createHarness();
    try {
      seedMemberAndHumanProfile(harness, {
        organizationId: "org_1",
        profileId: "human_1",
        profileOrganizationId: null,
        userId: "user_1",
      });

      await expect(
        readActiveRepresentedHumanSender({
          db: harness.db,
          organizationId: "org_1",
          profileId: "human_1",
          userId: "user_1",
        })
      ).resolves.toMatchObject({
        member_id: "member_1",
        owner_user_id: "user_1",
        profile_id: "human_1",
        profile_kind: "human",
        profile_name: "Felix",
        role: "owner",
      });
    } finally {
      harness.close();
    }
  });

  it("does not resolve a Human Profile owned by another user", async () => {
    const harness = createHarness();
    try {
      seedMemberAndHumanProfile(harness, {
        organizationId: "org_1",
        profileId: "human_1",
        profileOrganizationId: null,
        userId: "user_2",
      });

      await expect(
        readActiveRepresentedHumanSender({
          db: harness.db,
          organizationId: "org_1",
          profileId: "human_1",
          userId: "user_1",
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });
});

function createHarness() {
  const harness = createSqliteD1Harness();
  harness.run({
    sql: `
      CREATE TABLE members (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE openmeld_profiles (
        profile_id TEXT PRIMARY KEY NOT NULL,
        profile_kind TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        organization_id TEXT,
        status TEXT NOT NULL
      )
    `,
  });
  return harness;
}

function seedMemberAndHumanProfile(
  harness: ReturnType<typeof createHarness>,
  input: {
    organizationId: string;
    profileId: string;
    profileOrganizationId: string | null;
    userId: string;
  }
) {
  harness.run({
    params: ["member_1", input.organizationId, "user_1", "owner"],
    sql: `
      INSERT INTO members (id, organization_id, user_id, role)
      VALUES (?, ?, ?, ?)
    `,
  });
  harness.run({
    params: [
      input.profileId,
      "human",
      "Felix",
      input.userId,
      input.profileOrganizationId,
      "active",
    ],
    sql: `
      INSERT INTO openmeld_profiles (
        profile_id,
        profile_kind,
        profile_name,
        owner_user_id,
        organization_id,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  });
}
