import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { buildMessageChannelIdentityLinkId } from "../src/remote-agent/application/message-channel-connection-projection";
import { rpcDisconnectMessageChannelIdentityLink } from "../src/rpc/methods";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

describe("Message Channel identity-link disconnect RPC", () => {
  let harness: ReturnType<typeof createSqliteD1Harness>;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    createTables(harness);
    seedSlackConnection(harness);
  });

  afterEach(() => harness.close());

  it("lets a member disconnect the provider account mapped to them", async () => {
    seedMember(harness, { role: "member", userId: "user-self" });
    seedIdentityLink(harness, {
      openMeldUserId: "user-self",
      organizationId: "org-a",
    });

    await expect(
      disconnectIdentityLink({ roleUserId: "user-self" })
    ).resolves.toMatchObject({ identityLinks: [] });
    expect(readIdentityLink()).toBeNull();
  });

  it("rejects a member disconnecting another member's provider account", async () => {
    seedMember(harness, { role: "member", userId: "user-requester" });
    seedMember(harness, { role: "member", userId: "user-owner" });
    seedIdentityLink(harness, {
      openMeldUserId: "user-owner",
      organizationId: "org-a",
    });

    await expect(
      disconnectIdentityLink({ roleUserId: "user-requester" })
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(readIdentityLink()).toMatchObject({
      openmeld_user_id: "user-owner",
      organization_id: "org-a",
    });
  });

  it("lets an Organization owner disconnect another member's provider account", async () => {
    seedMember(harness, { role: "owner", userId: "user-requester" });
    seedMember(harness, { role: "member", userId: "user-owner" });
    seedIdentityLink(harness, {
      openMeldUserId: "user-owner",
      organizationId: "org-a",
    });

    await expect(
      disconnectIdentityLink({ roleUserId: "user-requester" })
    ).resolves.toMatchObject({ identityLinks: [] });
    expect(readIdentityLink()).toBeNull();
  });

  it("does not resolve an identity link from another Organization", async () => {
    seedMember(harness, { role: "owner", userId: "user-requester" });
    seedIdentityLink(harness, {
      openMeldUserId: "user-other-org",
      organizationId: "org-b",
    });

    await expect(
      disconnectIdentityLink({ roleUserId: "user-requester" })
    ).rejects.toMatchObject({
      code: "message_channel.identity_link_not_found",
      status: 404,
    });
    expect(readIdentityLink()).toMatchObject({
      openmeld_user_id: "user-other-org",
      organization_id: "org-b",
    });
  });

  async function disconnectIdentityLink(input: { roleUserId: string }) {
    return await rpcDisconnectMessageChannelIdentityLink(buildEnv(harness.db), {
      context: {
        activeOrganizationId: "org-a",
        actorContext: {
          callerPrincipalId: input.roleUserId,
          openMeldProfileId: "00000000-0000-4000-8000-000000000001",
          ownerUserId: input.roleUserId,
          profileKind: "human",
          profileName: "Test member",
          requestId: `request-${input.roleUserId}`,
        },
      },
      identityLinkId: await buildMessageChannelIdentityLinkId({
        connectionId: "slack:T123",
        provider: "slack",
        providerUserId: "U_LINKED",
      }),
    });
  }

  function readIdentityLink(): Record<string, unknown> | null {
    return harness.queryFirst({
      sql: `SELECT organization_id, openmeld_user_id
        FROM slack_user_identity_links
        WHERE slack_team_id = 'T123' AND slack_user_id = 'U_LINKED'`,
    });
  }
});

function buildEnv(db: D1Database): CoreBindings {
  return { OPENMELD_DB: db } as CoreBindings;
}

function createTables(harness: ReturnType<typeof createSqliteD1Harness>): void {
  for (const sql of [
    `CREATE TABLE members (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL
    )`,
    `CREATE TABLE openMeldRemoteAgent_slack_workspace_bindings (
      slack_team_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )`,
    `CREATE TABLE slack_user_identity_links (
      organization_id TEXT NOT NULL,
      slack_team_id TEXT NOT NULL,
      slack_user_id TEXT NOT NULL,
      openmeld_user_id TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (slack_team_id, slack_user_id)
    )`,
    `CREATE TABLE slack_user_identity_link_tokens (
      slack_team_id TEXT NOT NULL,
      slack_user_id TEXT NOT NULL,
      slack_user_display_name TEXT NOT NULL,
      issued_at_ms INTEGER NOT NULL
    )`,
    `CREATE TABLE openMeldRemoteAgent_lark_platform_channel_connections (
      connection_id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      app_id TEXT NOT NULL,
      tenant_key TEXT,
      bot_open_id TEXT,
      bot_name TEXT,
      callbacks_webhook_verified_at_ms INTEGER,
      transport TEXT NOT NULL,
      status TEXT NOT NULL,
      installed_by_user_id TEXT NOT NULL,
      permission_bundle_version TEXT NOT NULL,
      granted_capability_groups_json TEXT NOT NULL,
      connection_generation INTEGER NOT NULL,
      events_webhook_verified_at_ms INTEGER,
      last_verified_at_ms INTEGER,
      failure_reason_code TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )`,
    `CREATE TABLE center_agent_audit_journal (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      actor_profile_id TEXT NOT NULL,
      action TEXT NOT NULL,
      on_behalf_of_profile_id TEXT,
      on_behalf_of_user_id TEXT,
      on_behalf_of_display_name TEXT,
      resource_type TEXT,
      resource_id TEXT,
      source_native_delivery_id TEXT,
      created_at INTEGER NOT NULL
    )`,
  ]) {
    harness.run({ sql });
  }
}

function seedSlackConnection(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({
    sql: `INSERT INTO openMeldRemoteAgent_slack_workspace_bindings
      (slack_team_id, organization_id, created_at_ms, updated_at_ms)
      VALUES ('T123', 'org-a', 1000, 1000)`,
  });
}

function seedMember(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: { role: "member" | "owner"; userId: string }
): void {
  harness.run({
    params: [`member-${input.userId}`, "org-a", input.userId, input.role],
    sql: `INSERT INTO members (id, organization_id, user_id, role)
      VALUES (?, ?, ?, ?)`,
  });
}

function seedIdentityLink(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: { openMeldUserId: string; organizationId: string }
): void {
  harness.run({
    params: [input.organizationId, input.openMeldUserId],
    sql: `INSERT INTO slack_user_identity_links (
      organization_id, slack_team_id, slack_user_id,
      openmeld_user_id, source, created_at_ms
    ) VALUES (?, 'T123', 'U_LINKED', ?, 'explicit', 2000)`,
  });
}
