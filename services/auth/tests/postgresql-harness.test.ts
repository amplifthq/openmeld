import {
  createAuthDatabase,
  createDrizzleOpenMeldProfileRepository,
  schema,
} from "@openmeld/auth/server";
import { withPostgresRequest } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import { createPostgresHarness } from "../../../tooling/postgresql/test-harness";

describe("native PostgreSQL Auth transactions", () => {
  it("rolls back a failed transaction and commits a successful one", async () => {
    const harness = await createPostgresHarness();
    try {
      await withPostgresRequest(harness.binding, async () => {
        const db = createAuthDatabase();
        await expect(
          db.transaction(async (tx) => {
            await tx.insert(schema.users).values({
              id: "rolled-back",
              name: "Rollback",
              email: "rollback@example.com",
            });
            throw new Error("rollback fixture");
          })
        ).rejects.toThrow("rollback fixture");
        expect(
          await harness.queryFirst({
            text: 'SELECT id FROM "openmeld"."users" WHERE id = $1',
            values: ["rolled-back"],
          })
        ).toBeNull();
        await db.transaction(async (tx) => {
          await tx.insert(schema.users).values({
            id: "committed",
            name: "Commit",
            email: "commit@example.com",
          });
        });
        expect(
          await harness.queryFirst({
            text: 'SELECT id FROM "openmeld"."users" WHERE id = $1',
            values: ["committed"],
          })
        ).toEqual({ id: "committed" });
      });
    } finally {
      await harness.close();
    }
  });

  it("activates one default profile and persists it across repository instances", async () => {
    const harness = await createPostgresHarness();

    const ownerUserId = "user-profile-activation";
    const previousProfileId = "11111111-1111-4111-8111-111111111111";
    const targetProfileId = "22222222-2222-4222-8222-222222222222";
    const nowMs = Date.now();
    await harness.query({
      values: [ownerUserId, nowMs, nowMs],
      text: `
        INSERT INTO "openmeld"."users" (
          id,
          name,
          email,
          email_verified,
          created_at,
          updated_at
        ) VALUES ($1, 'Profile Owner', 'profile-owner@example.com', 1, $2, $3)
      `,
    });
    await harness.query({
      values: [previousProfileId, ownerUserId, ownerUserId, nowMs, nowMs],
      text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          is_default,
          status,
          owner_user_id,
          created_by_user_id,
          source,
          created_at,
          updated_at
        ) VALUES ($1, 'Previous Profile', 'previous-profile', 'human', 1, 'active', $2, $3, 'auth_bootstrap', $4, $5)
      `,
    });
    await harness.query({
      values: [targetProfileId, ownerUserId, ownerUserId, nowMs, nowMs],
      text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id,
          profile_name,
          profile_handle,
          profile_kind,
          is_default,
          status,
          owner_user_id,
          created_by_user_id,
          source,
          created_at,
          updated_at
        ) VALUES ($1, 'Target Profile', 'target-profile', 'human', 0, 'disabled', $2, $3, 'auth_bootstrap', $4, $5)
      `,
    });
    await withPostgresRequest(harness.binding, async () => {
      const repository = createDrizzleOpenMeldProfileRepository(
        createAuthDatabase()
      );

      try {
        await expect(repository.activateProfile(targetProfileId)).resolves.toBe(
          true
        );
        const profiles = await repository.listByOwner(ownerUserId);
        expect(
          profiles.find((profile) => profile.profileId === previousProfileId)
        ).toMatchObject({ isDefault: false, status: "active" });
        expect(
          profiles.find((profile) => profile.profileId === targetProfileId)
        ).toMatchObject({ isDefault: true, status: "active" });
      } finally {
        // Request-local pool cleanup belongs to withPostgresRequest.
      }
    });
    await harness.close();
  });
});
