import {
  createD1Db,
  createDrizzleOpenMeldProfileRepository,
} from "@openmeld/auth/server";
import { describe, expect, it } from "vitest";
import {
  applyDrizzleMigrations,
  createSqliteD1Harness,
} from "./support/sqlite-d1-harness";

describe("sqlite D1 harness", () => {
  it("rejects Drizzle transactions because Cloudflare D1 rejects explicit transaction statements", async () => {
    const harness = createSqliteD1Harness();
    const db = createD1Db(harness.db);

    try {
      await expect(db.transaction(async () => undefined)).rejects.toMatchObject(
        {
          cause: expect.objectContaining({
            message:
              "sqlite D1 harness rejects explicit transaction statements; use batch()",
          }),
          message: expect.stringContaining("Failed query: begin"),
        }
      );
    } finally {
      harness.close();
    }
  });

  it("keeps profile activation on D1-compatible atomic writes", async () => {
    const harness = createSqliteD1Harness();
    applyDrizzleMigrations(harness.database);
    const ownerUserId = "user-profile-activation";
    const previousProfileId = "11111111-1111-4111-8111-111111111111";
    const targetProfileId = "22222222-2222-4222-8222-222222222222";
    const nowMs = Date.now();
    harness.run({
      params: [ownerUserId, nowMs, nowMs],
      sql: `
        INSERT INTO users (
          id,
          name,
          email,
          email_verified,
          created_at,
          updated_at
        ) VALUES (?, 'Profile Owner', 'profile-owner@example.com', 1, ?, ?)
      `,
    });
    harness.run({
      params: [previousProfileId, ownerUserId, ownerUserId, nowMs, nowMs],
      sql: `
        INSERT INTO openmeld_profiles (
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
        ) VALUES (?, 'Previous Profile', 'previous-profile', 'human', 1, 'active', ?, ?, 'auth_bootstrap', ?, ?)
      `,
    });
    harness.run({
      params: [targetProfileId, ownerUserId, ownerUserId, nowMs, nowMs],
      sql: `
        INSERT INTO openmeld_profiles (
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
        ) VALUES (?, 'Target Profile', 'target-profile', 'human', 0, 'disabled', ?, ?, 'auth_bootstrap', ?, ?)
      `,
    });
    const repository = createDrizzleOpenMeldProfileRepository(
      createD1Db(harness.db)
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
      harness.close();
    }
  });
});
