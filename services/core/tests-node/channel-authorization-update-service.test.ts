import { SLACK_BOT_SCOPES } from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { reconcileChannelAuthorizationUpdatesTick } from "../src/remote-agent/application/channel-authorization-update-service";
import { LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE } from "../src/remote-agent/application/lark-platform-permission-bundles";
import {
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

vi.mock("../src/organizations/organization-directory", () => ({
  resolveOrganizationDirectoryMembers: async () => [
    { userId: "owner", role: "owner" },
    { userId: "admin", role: "admin" },
    { userId: "member", role: "member" },
  ],
}));

describe("Channel permission upgrade notifications", () => {
  let harness: ReturnType<typeof createSqliteD1Harness>;
  let env: CoreBindings;
  beforeEach(() => {
    harness = createSqliteD1Harness();
    for (const sql of [
      "CREATE TABLE organizations(id text PRIMARY KEY)",
      "CREATE TABLE users(id text PRIMARY KEY)",
      "INSERT INTO organizations VALUES ('org')",
      "INSERT INTO users VALUES ('owner'), ('admin'), ('member')",
    ]) {
      harness.run({ sql });
    }
    applyDrizzleMigrationsForTables(harness, [
      "inbox_items",
      "inbox_email_deliveries",
      "openMeldRemoteAgent_lark_platform_channel_connections",
      "openMeldRemoteAgent_slack_workspace_bindings",
      "slack_workspace_tokens",
    ]);
    env = {
      OPENMELD_DB: harness.db,
      OPENMELD_AUTH_WORKER: { resolveOrganizationDirectoryMembers: vi.fn() },
    } as unknown as CoreBindings;
  });
  afterEach(() => harness.close());
  it.each([
    "feishu",
    "lark",
  ])("notifies an already-connected %s Organization and clears all recipients after consent", async (provider) => {
    harness.run({
      sql: "INSERT INTO openMeldRemoteAgent_lark_platform_channel_connections (connection_id, organization_id, provider, app_id, transport, status, installed_by_user_id, permission_bundle_version, granted_capability_groups_json, connection_generation, last_verified_at_ms, created_at_ms, updated_at_ms) VALUES ('connection', 'org', ?, 'cli_test', 'websocket', 'connected', 'owner', 'old-permissions', '[]', 1, 1000, 1000, 1000)",
      params: [provider],
    });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 2000 });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 2500 });
    expect(count("resolution_status = 'open'")).toBe(2);
    harness.run({
      sql: "UPDATE openMeldRemoteAgent_lark_platform_channel_connections SET status = 'configuring', updated_at_ms = 3000",
    });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 3500 });
    expect(count("resolution_status = 'open'")).toBe(2);
    harness.run({
      sql: "UPDATE openMeldRemoteAgent_lark_platform_channel_connections SET status = 'connected', permission_bundle_version = ?, updated_at_ms = 4000",
      params: [LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.version],
    });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 5000 });
    expect(
      count("resolution_status = 'resolved' AND read_at_ms IS NOT NULL")
    ).toBe(2);
  });
  it("uses the same Slack scopes as OAuth and does not mistake a partial grant for completion", async () => {
    harness.run({
      sql: "INSERT INTO openMeldRemoteAgent_slack_workspace_bindings VALUES ('T1', 'org', 1000, 1000)",
    });
    harness.run({
      sql: "INSERT INTO slack_workspace_tokens (slack_team_id, encrypted_bot_token, bot_user_id, granted_bot_scopes, installed_by_user_id, organization_id, created_at_ms, updated_at_ms) VALUES ('T1', 'encrypted', 'B1', 'chat:write', 'owner', 'org', 1000, 1000)",
    });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 2000 });
    expect(count("resolution_status = 'open'")).toBe(2);
    harness.run({
      sql: "UPDATE slack_workspace_tokens SET granted_bot_scopes = 'chat:write,im:read', updated_at_ms = 3000",
    });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 3500 });
    expect(count("resolution_status = 'open'")).toBe(2);
    harness.run({
      sql: "UPDATE slack_workspace_tokens SET granted_bot_scopes = ?, updated_at_ms = 4000",
      params: [[...SLACK_BOT_SCOPES].sort().join(",")],
    });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 5000 });
    expect(
      count("resolution_status = 'resolved' AND read_at_ms IS NOT NULL")
    ).toBe(2);
  });
  function count(where: string): number {
    return (
      harness.queryFirst<{ count: number }>({
        sql: `SELECT count(*) AS count FROM inbox_items WHERE ${where}`,
      })?.count ?? 0
    );
  }
});
