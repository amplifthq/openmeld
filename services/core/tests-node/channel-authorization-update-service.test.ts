import { SLACK_BOT_SCOPES } from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { reconcileChannelAuthorizationUpdatesTick } from "../src/remote-agent/application/channel-authorization-update-service";
import { LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE } from "../src/remote-agent/application/lark-platform-permission-bundles";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

vi.mock("../src/organizations/organization-directory", () => ({
  resolveOrganizationDirectoryMembers: async () => [
    { userId: "owner", role: "owner" },
    { userId: "admin", role: "admin" },
    { userId: "member", role: "member" },
  ],
}));

describe("Channel permission upgrade notifications", () => {
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;
  let env: CoreBindings;
  beforeEach(async () => {
    harness = await createPostgresHarness();
    for (const sql of [
      `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ('org', 'Organization', 'org', 1000)`,
      `INSERT INTO "openmeld"."users" (id, name, email) VALUES ('owner', 'Owner', 'owner@example.test'), ('admin', 'Admin', 'admin@example.test'), ('member', 'Member', 'member@example.test')`,
    ]) {
      await harness.query({ text: sql });
    }

    env = {
      OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      OPENMELD_AUTH_WORKER: { resolveOrganizationDirectoryMembers: vi.fn() },
    } as unknown as CoreBindings;
  });
  afterEach(async () => await harness.close());
  it.each([
    "feishu",
    "lark",
  ])("notifies an already-connected %s Organization and clears all recipients after consent", async (provider) => {
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"openMeldRemoteAgent_lark_platform_channel_connections\" (connection_id, organization_id, provider, app_id, transport, status, installed_by_user_id, permission_bundle_version, granted_capability_groups_json, connection_generation, last_verified_at_ms, created_at_ms, updated_at_ms) VALUES ('connection', 'org', $1, 'cli_test', 'websocket', 'connected', 'owner', 'old-permissions', '[]', 1, 1000, 1000, 1000)",
      values: [provider],
    });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 2000 });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 2500 });
    expect(await count("resolution_status = 'open'")).toBe(2);
    await harness.query({
      text: 'UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" SET status = \'configuring\', updated_at_ms = 3000',
    });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 3500 });
    expect(await count("resolution_status = 'open'")).toBe(2);
    await harness.query({
      text: 'UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" SET status = \'connected\', permission_bundle_version = $1, updated_at_ms = 4000',
      values: [LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.version],
    });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 5000 });
    expect(
      await count("resolution_status = 'resolved' AND read_at_ms IS NOT NULL")
    ).toBe(2);
  });
  it("uses the same Slack scopes as OAuth and does not mistake a partial grant for completion", async () => {
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"openMeldRemoteAgent_slack_workspace_bindings\" VALUES ('T1', 'org', 1000, 1000)",
    });
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"slack_workspace_tokens\" (slack_team_id, encrypted_bot_token, bot_user_id, granted_bot_scopes, installed_by_user_id, organization_id, created_at_ms, updated_at_ms) VALUES ('T1', 'encrypted', 'B1', 'chat:write', 'owner', 'org', 1000, 1000)",
    });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 2000 });
    expect(await count("resolution_status = 'open'")).toBe(2);
    await harness.query({
      text: 'UPDATE "openmeld"."slack_workspace_tokens" SET granted_bot_scopes = \'chat:write,im:read\', updated_at_ms = 3000',
    });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 3500 });
    expect(await count("resolution_status = 'open'")).toBe(2);
    await harness.query({
      text: 'UPDATE "openmeld"."slack_workspace_tokens" SET granted_bot_scopes = $1, updated_at_ms = 4000',
      values: [[...SLACK_BOT_SCOPES].sort().join(",")],
    });
    await reconcileChannelAuthorizationUpdatesTick({ env, nowMs: 5000 });
    expect(
      await count("resolution_status = 'resolved' AND read_at_ms IS NOT NULL")
    ).toBe(2);
  });
  async function count(where: string): Promise<number> {
    return (
      (await (
        await harness.queryFirst<{ count: number }>({
          text: `SELECT count(*) AS count FROM "openmeld"."inbox_items" WHERE ${where}`,
        })
      )?.count) ?? 0
    );
  }
});
