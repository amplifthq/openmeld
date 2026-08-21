import { describe, expect, it } from "vitest";
import {
  listOrganizationMemberActivity,
  recordOrganizationMemberActivity,
} from "../src/organizations/organization-member-activity-repository";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Organization member activity repository", () => {
  it("keeps the newest accepted Human activity for each Organization member", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrationsForTables(harness, [
      "users",
      "organizations",
      "organization_member_activity",
    ]);
    harness.run({
      params: ["user-one", "Person One", "person@example.com", 1, 1],
      sql: `
        INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
        VALUES (?, ?, ?, true, ?, ?)
      `,
    });
    harness.run({
      params: ["org-one", "Organization One", "organization-one", 1],
      sql: `
        INSERT INTO organizations (id, name, slug, created_at)
        VALUES (?, ?, ?, ?)
      `,
    });

    try {
      await recordOrganizationMemberActivity({
        db: harness.db,
        humanProfileId: "human-profile-current",
        lastActiveAtMs: 200,
        organizationId: "org-one",
        updatedAtMs: 210,
        userId: "user-one",
      });
      await recordOrganizationMemberActivity({
        db: harness.db,
        humanProfileId: "human-profile-stale",
        lastActiveAtMs: 100,
        organizationId: "org-one",
        updatedAtMs: 220,
        userId: "user-one",
      });

      await expect(
        listOrganizationMemberActivity({
          db: harness.db,
          organizationId: "org-one",
        })
      ).resolves.toEqual([
        {
          humanProfileId: "human-profile-current",
          lastActiveAtMs: 200,
          organizationId: "org-one",
          updatedAtMs: 210,
          userId: "user-one",
        },
      ]);
    } finally {
      harness.close();
    }
  });
});
