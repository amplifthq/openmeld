import { describe, expect, it } from "vitest";
import {
  listOrganizationMemberActivity,
  recordOrganizationMemberActivity,
} from "../src/organizations/organization-member-activity-repository";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("Organization member activity repository", () => {
  it("keeps the newest accepted Human activity for each Organization member", async () => {
    const harness = await createPostgresHarness();

    await harness.query({
      values: ["user-one", "Person One", "person@example.com", 1, 1],
      text: `
        INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at)
        VALUES ($1, $2, $3, 1, $4, $5)
      `,
    });
    await harness.query({
      values: ["org-one", "Organization One", "organization-one", 1],
      text: `
        INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
        VALUES ($1, $2, $3, $4)
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
      await harness.close();
    }
  });
});
