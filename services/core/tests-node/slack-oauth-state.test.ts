import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSlackOAuthChannelsReturnPath,
  consumeSlackOAuthState,
  createSlackOAuthState,
  SLACK_OAUTH_STATE_TTL_MS,
} from "../src/remote-agent/application/slack-oauth-state";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

const NOW_MS = Date.parse("2026-07-10T00:00:00.000Z");
const SLACK_OAUTH_STATE_PATTERN = /^slackoauth_[0-9a-f]{64}$/u;

describe("Slack OAuth state", () => {
  it("returns directly to the canonical Center Agent Channels page", () => {
    expect(buildSlackOAuthChannelsReturnPath("acme/team")).toBe(
      "/o/acme%2Fteam/center-agent/channels"
    );
  });

  let harness: ReturnType<typeof createSqliteD1Harness>;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    harness.run({
      sql: `
        CREATE TABLE slack_oauth_states (
          state_digest TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          actor_profile_id TEXT NOT NULL,
          return_path TEXT NOT NULL,
          move_from_organization_id TEXT,
          expires_at_ms INTEGER NOT NULL,
          created_at_ms INTEGER NOT NULL
        )
      `,
    });
  });

  it("binds a confirmed move to the expected previous organization", async () => {
    const created = await createSlackOAuthState({
      actorProfileId: "human-1",
      db: harness.db,
      moveFromOrganizationId: "org-existing",
      nowMs: NOW_MS,
      organizationId: "org-new",
      returnPath: "/o/new/center-agent/channels",
      userId: "user-1",
    });

    await expect(
      consumeSlackOAuthState({
        db: harness.db,
        nowMs: NOW_MS + 1,
        state: created.state,
      })
    ).resolves.toEqual({
      actorProfileId: "human-1",
      moveFromOrganizationId: "org-existing",
      organizationId: "org-new",
      returnPath: "/o/new/center-agent/channels",
      status: "valid",
      userId: "user-1",
    });
  });

  afterEach(() => harness.close());

  it("binds a one-time state to the installer and organization", async () => {
    const created = await createSlackOAuthState({
      actorProfileId: "human-1",
      db: harness.db,
      nowMs: NOW_MS,
      organizationId: "org-1",
      returnPath: "/o/acme/center-agent/channels",
      userId: "user-1",
    });

    expect(created.state).toMatch(SLACK_OAUTH_STATE_PATTERN);
    expect(created.expiresAtMs).toBe(NOW_MS + SLACK_OAUTH_STATE_TTL_MS);
    const consumed = await consumeSlackOAuthState({
      db: harness.db,
      nowMs: NOW_MS + 1,
      state: created.state,
    });

    expect(consumed).toEqual({
      actorProfileId: "human-1",
      moveFromOrganizationId: null,
      organizationId: "org-1",
      returnPath: "/o/acme/center-agent/channels",
      status: "valid",
      userId: "user-1",
    });
    await expect(
      consumeSlackOAuthState({
        db: harness.db,
        nowMs: NOW_MS + 2,
        state: created.state,
      })
    ).resolves.toEqual({ status: "invalid" });
  });

  it("rejects a tampered state", async () => {
    const created = await createSlackOAuthState({
      actorProfileId: "human-1",
      db: harness.db,
      nowMs: NOW_MS,
      organizationId: "org-1",
      returnPath: "/o/acme/center-agent/channels",
      userId: "user-1",
    });

    await expect(
      consumeSlackOAuthState({
        db: harness.db,
        nowMs: NOW_MS + 1,
        state: `${created.state.slice(0, -1)}${created.state.endsWith("0") ? "1" : "0"}`,
      })
    ).resolves.toEqual({ status: "invalid" });
  });

  it("rejects and consumes an expired state", async () => {
    const created = await createSlackOAuthState({
      actorProfileId: "human-1",
      db: harness.db,
      nowMs: NOW_MS,
      organizationId: "org-1",
      returnPath: "/o/acme/center-agent/channels",
      userId: "user-1",
    });

    await expect(
      consumeSlackOAuthState({
        db: harness.db,
        nowMs: created.expiresAtMs + 1,
        state: created.state,
      })
    ).resolves.toEqual({
      returnPath: "/o/acme/center-agent/channels",
      status: "expired",
    });
    await expect(
      consumeSlackOAuthState({
        db: harness.db,
        nowMs: created.expiresAtMs + 2,
        state: created.state,
      })
    ).resolves.toEqual({ status: "invalid" });
  });

  it("removes abandoned expired states when creating a new request", async () => {
    await createSlackOAuthState({
      actorProfileId: "human-1",
      db: harness.db,
      nowMs: NOW_MS,
      organizationId: "org-1",
      returnPath: "/o/acme/center-agent/channels",
      userId: "user-1",
    });

    await createSlackOAuthState({
      actorProfileId: "human-1",
      db: harness.db,
      nowMs: NOW_MS + SLACK_OAUTH_STATE_TTL_MS + 1,
      organizationId: "org-1",
      returnPath: "/o/acme/center-agent/channels",
      userId: "user-1",
    });

    expect(
      harness.queryFirst<{ count: number }>({
        sql: "SELECT COUNT(*) AS count FROM slack_oauth_states",
      })
    ).toEqual({ count: 1 });
  });
});
