import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  beginGitHubAppInstallationVerification,
  completeGitHubAppInstallation,
  createGitHubAppInstallationState,
  GITHUB_APP_INSTALLATION_STATE_TTL_MS,
  readPendingGitHubAppInstallation,
} from "../src/connectors/github-app-installation-state";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

const NOW_MS = Date.parse("2026-07-23T00:00:00.000Z");
const STATE_PATTERN = /^githubapp_[0-9a-f]{64}$/u;
const VERIFICATION_CONNECTION_PATTERN = /^github_verify_[0-9a-f]{24}$/u;

describe("GitHub App installation state", () => {
  let harness: ReturnType<typeof createSqliteD1Harness>;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    harness.run({
      sql: `
        CREATE TABLE github_app_installation_states (
          state_digest TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          actor_profile_id TEXT NOT NULL,
          target_connection_name TEXT NOT NULL,
          verification_connection_name TEXT,
          installation_id TEXT,
          status TEXT NOT NULL,
          expires_at_ms INTEGER NOT NULL,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        )
      `,
    });
  });

  afterEach(() => harness.close());

  it("binds one installation request to the organization, installer, and target connection", async () => {
    const created = await createGitHubAppInstallationState({
      actorProfileId: "profile-1",
      db: harness.db,
      nowMs: NOW_MS,
      organizationId: "org-1",
      targetConnectionName: "org_target_shared_github",
      userId: "user-1",
    });

    expect(created.state).toMatch(STATE_PATTERN);
    expect(created.expiresAtMs).toBe(
      NOW_MS + GITHUB_APP_INSTALLATION_STATE_TTL_MS
    );

    const verification = await beginGitHubAppInstallationVerification({
      db: harness.db,
      installationId: "987654",
      nowMs: NOW_MS + 1,
      state: created.state,
    });

    expect(verification).toEqual({
      actorProfileId: "profile-1",
      installationId: "987654",
      organizationId: "org-1",
      status: "valid",
      targetConnectionName: "org_target_shared_github",
      userId: "user-1",
      verificationConnectionName: expect.stringMatching(
        VERIFICATION_CONNECTION_PATTERN
      ),
    });
  });

  it("accepts the setup callback only once", async () => {
    const created = await createState(harness.db);

    await expect(
      beginGitHubAppInstallationVerification({
        db: harness.db,
        installationId: "987654",
        nowMs: NOW_MS + 1,
        state: created.state,
      })
    ).resolves.toMatchObject({ status: "valid" });

    await expect(
      beginGitHubAppInstallationVerification({
        db: harness.db,
        installationId: "987654",
        nowMs: NOW_MS + 2,
        state: created.state,
      })
    ).resolves.toEqual({ status: "invalid" });
  });

  it("rejects and consumes an expired setup callback", async () => {
    const created = await createState(harness.db);

    await expect(
      beginGitHubAppInstallationVerification({
        db: harness.db,
        installationId: "987654",
        nowMs: created.expiresAtMs + 1,
        state: created.state,
      })
    ).resolves.toEqual({ status: "expired" });
    await expect(
      beginGitHubAppInstallationVerification({
        db: harness.db,
        installationId: "987654",
        nowMs: created.expiresAtMs + 2,
        state: created.state,
      })
    ).resolves.toEqual({ status: "invalid" });
  });

  it("returns pending verification only to the bound OpenMeld member", async () => {
    const created = await createState(harness.db);
    await beginGitHubAppInstallationVerification({
      db: harness.db,
      installationId: "987654",
      nowMs: NOW_MS + 1,
      state: created.state,
    });

    await expect(
      readPendingGitHubAppInstallation({
        db: harness.db,
        nowMs: NOW_MS + 2,
        organizationId: "org-1",
        userId: "user-1",
      })
    ).resolves.toMatchObject({
      installationId: "987654",
      status: "verifying",
      targetConnectionName: "org_target_shared_github",
    });
    await expect(
      readPendingGitHubAppInstallation({
        db: harness.db,
        nowMs: NOW_MS + 2,
        organizationId: "org-1",
        userId: "user-other",
      })
    ).resolves.toBeNull();
  });

  it("completes only the exact pending installation", async () => {
    const created = await createState(harness.db);
    const verification = await beginGitHubAppInstallationVerification({
      db: harness.db,
      installationId: "987654",
      nowMs: NOW_MS + 1,
      state: created.state,
    });
    if (verification.status !== "valid") {
      throw new Error("Expected a valid verification state.");
    }

    await expect(
      completeGitHubAppInstallation({
        db: harness.db,
        installationId: "123456",
        nowMs: NOW_MS + 2,
        organizationId: "org-1",
        targetConnectionName: "org_target_shared_github",
        userId: "user-1",
        verificationConnectionName: verification.verificationConnectionName,
      })
    ).resolves.toBe(false);
    await expect(
      completeGitHubAppInstallation({
        db: harness.db,
        installationId: "987654",
        nowMs: NOW_MS + 3,
        organizationId: "org-1",
        targetConnectionName: "org_target_shared_github",
        userId: "user-1",
        verificationConnectionName: verification.verificationConnectionName,
      })
    ).resolves.toBe(true);
    await expect(
      readPendingGitHubAppInstallation({
        db: harness.db,
        nowMs: NOW_MS + 4,
        organizationId: "org-1",
        userId: "user-1",
      })
    ).resolves.toBeNull();
  });

  it("supersedes an abandoned request from the same member and Organization", async () => {
    const first = await createState(harness.db);
    const second = await createGitHubAppInstallationState({
      actorProfileId: "profile-1",
      db: harness.db,
      nowMs: NOW_MS + 1,
      organizationId: "org-1",
      targetConnectionName: "org_target_shared_github",
      userId: "user-1",
    });

    await expect(
      beginGitHubAppInstallationVerification({
        db: harness.db,
        installationId: "987654",
        nowMs: NOW_MS + 2,
        state: first.state,
      })
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      beginGitHubAppInstallationVerification({
        db: harness.db,
        installationId: "987654",
        nowMs: NOW_MS + 2,
        state: second.state,
      })
    ).resolves.toMatchObject({ status: "valid" });
  });
});

async function createState(db: D1Database) {
  return await createGitHubAppInstallationState({
    actorProfileId: "profile-1",
    db,
    nowMs: NOW_MS,
    organizationId: "org-1",
    targetConnectionName: "org_target_shared_github",
    userId: "user-1",
  });
}
