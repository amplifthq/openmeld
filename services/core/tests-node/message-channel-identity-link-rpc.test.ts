import { createHash } from "node:crypto";
import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installPostgresWriteFailure } from "../../../tooling/postgresql/test-harness";
import type { CoreBindings } from "../src/lib/bindings";
import { buildMessageChannelIdentityLinkId } from "../src/remote-agent/application/message-channel-connection-projection";
import { rpcDisconnectMessageChannelIdentityLink } from "../src/rpc/methods";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

describe("Message Channel identity-link disconnect RPC", () => {
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;

  beforeEach(async () => {
    harness = await createPostgresHarness();
    await harness.query({
      text: `INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ('org-a', 'Organization A', 'org-a', 1000), ('org-b', 'Organization B', 'org-b', 1000)`,
    });

    await seedSlackConnection(harness);
  });

  afterEach(async () => await harness.close());

  it("lets a member disconnect the provider account mapped to them", async () => {
    await seedMember(harness, { role: "member", userId: "user-self" });
    await seedIdentityLink(harness, {
      openMeldUserId: "user-self",
      organizationId: "org-a",
    });

    await expect(
      disconnectIdentityLink({ roleUserId: "user-self" })
    ).resolves.toMatchObject({ identityLinks: [] });
    expect(await readIdentityLink()).toBeNull();
  });

  it("rolls back an identity-link disconnect when its audit write fails", async () => {
    await seedMember(harness, { role: "member", userId: "user-self" });
    await seedIdentityLink(harness, {
      openMeldUserId: "user-self",
      organizationId: "org-a",
    });
    await installPostgresWriteFailure({
      harness,
      table: "center_agent_audit_journal",
      operation: "INSERT",
      condition: "NEW.action = 'disconnect_message_channel_identity_link'",
      message: "injected identity-link audit failure",
    });

    await expect(
      disconnectIdentityLink({ roleUserId: "user-self" })
    ).rejects.toThrow("injected identity-link audit failure");
    expect(await readIdentityLink()).toMatchObject({
      openmeld_user_id: "user-self",
      organization_id: "org-a",
    });
  });

  it("rejects a member disconnecting another member's provider account", async () => {
    await seedMember(harness, { role: "member", userId: "user-requester" });
    await seedMember(harness, { role: "member", userId: "user-owner" });
    await seedIdentityLink(harness, {
      openMeldUserId: "user-owner",
      organizationId: "org-a",
    });

    await expect(
      disconnectIdentityLink({ roleUserId: "user-requester" })
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(await readIdentityLink()).toMatchObject({
      openmeld_user_id: "user-owner",
      organization_id: "org-a",
    });
  });

  it.each([
    "owner",
    "admin",
  ] as const)("lets an Organization %s disconnect another member's provider account", async (role) => {
    await seedMember(harness, { role, userId: "user-requester" });
    await seedMember(harness, { role: "member", userId: "user-owner" });
    await seedIdentityLink(harness, {
      openMeldUserId: "user-owner",
      organizationId: "org-a",
    });

    await expect(
      disconnectIdentityLink({ roleUserId: "user-requester" })
    ).resolves.toMatchObject({ identityLinks: [] });
    expect(await readIdentityLink()).toBeNull();
  });

  it("does not resolve an identity link from another Organization", async () => {
    await seedMember(harness, { role: "owner", userId: "user-requester" });
    await seedIdentityLink(harness, {
      openMeldUserId: "user-other-org",
      organizationId: "org-b",
    });

    await expect(
      disconnectIdentityLink({ roleUserId: "user-requester" })
    ).rejects.toMatchObject({
      code: "message_channel.identity_link_not_found",
      status: 404,
    });
    expect(await readIdentityLink()).toMatchObject({
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
          openMeldProfileId: fixtureHumanProfileId(input.roleUserId),
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

  async function readIdentityLink(): Promise<Record<string, unknown> | null> {
    return await harness.queryFirst({
      text: `SELECT organization_id, openmeld_user_id
        FROM "openmeld"."slack_user_identity_links"
        WHERE slack_team_id = 'T123' AND slack_user_id = 'U_LINKED'`,
    });
  }
});

function buildEnv(db: PostgresDatabase): CoreBindings {
  return { OPENMELD_POSTGRESQL: postgresTestBinding(db) } as CoreBindings;
}

async function seedSlackConnection(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<void> {
  await harness.query({
    text: `INSERT INTO "openmeld"."openMeldRemoteAgent_slack_workspace_bindings"
      (slack_team_id, organization_id, created_at_ms, updated_at_ms)
      VALUES ('T123', 'org-a', 1000, 1000)`,
  });
}

async function seedMember(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: { role: "admin" | "member" | "owner"; userId: string }
): Promise<void> {
  await harness.query({
    text: `INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, 'Member', $1::text || '@example.test') ON CONFLICT (id) DO NOTHING`,
    values: [input.userId],
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id,profile_name,profile_handle,profile_kind,owner_user_id,source,status) VALUES ($1,'Member',$2,'human',$2,'auth_bootstrap','active')`,
    values: [fixtureHumanProfileId(input.userId), input.userId],
  });
  await harness.query({
    values: [`member-${input.userId}`, "org-a", input.userId, input.role],
    text: `INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, "created_at")
      VALUES ($1, $2, $3, $4, 1700000000000)`,
  });
}

async function seedIdentityLink(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: { openMeldUserId: string; organizationId: string }
): Promise<void> {
  await harness.query({
    values: [input.organizationId, input.openMeldUserId],
    text: `INSERT INTO "openmeld"."slack_user_identity_links" (
      organization_id, slack_team_id, slack_user_id,
      openmeld_user_id, source, created_at_ms
    ) VALUES ($1, 'T123', 'U_LINKED', $2, 'explicit', 2000)`,
  });
}
function fixtureHumanProfileId(userId: string): string {
  const hash = createHash("sha256").update(userId).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
