import {
  type AuthRpcResolveOrganizationAccountIdentityInput,
  type AuthRpcResolveOrganizationAccountIdentityResult,
  buildMessageChannelConversationId,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  createMessageChannelProviderRegistry,
  type LarkPlatformMessageChannelProvider,
  type MessageChannelProviderAdapter,
} from "../src/remote-agent/application/message-channel-adapters";
import { digestMessageChannelIdentityLinkToken } from "../src/remote-agent/application/message-channel-identity-link-token";
import {
  buildMessageChannelTurnEnvelope,
  resolveMessageChannelTurnTarget as resolveMessageChannelTurnTargetWithAuth,
} from "../src/remote-agent/application/message-channel-turn-resolution";
import { readRemoteAgentLarkPlatformChannelCredentials } from "../src/remote-agent/infrastructure/d1/lark-platform-channel-connection-repo";
import {
  insertRemoteAgentLarkPlatformIdentityLinkIfAbsent,
  readRemoteAgentLarkPlatformIdentityLink,
} from "../src/remote-agent/infrastructure/d1/lark-platform-identity-link-repo";
import {
  claimRemoteAgentLarkPlatformRegistrationAttempt,
  completeRemoteAgentLarkPlatformRegistration,
  createRemoteAgentLarkPlatformRegistrationAttempt,
  persistRemoteAgentLarkPlatformRegistrationCredentials,
  recordRemoteAgentLarkPlatformWebhookReachability,
} from "../src/remote-agent/infrastructure/d1/lark-platform-registration-attempt-repo";
import { insertRemoteAgentMessageChannelIdentityLinkToken } from "../src/remote-agent/infrastructure/d1/message-channel-identity-link-token-repo";
import {
  rpcConsumeMessageChannelIdentityLink,
  rpcPreviewMessageChannelIdentityLink,
} from "../src/rpc/methods";
import {
  applyDrizzleMigrationsForTables,
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createBeforeMatchingBatchD1Database,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const CENTER_AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

function resolveMessageChannelTurnTarget(
  input: Omit<
    Parameters<typeof resolveMessageChannelTurnTargetWithAuth>[0],
    "authWorker"
  >
) {
  return resolveMessageChannelTurnTargetWithAuth({
    ...input,
    authWorker: {
      resolveOrganizationAccountIdentity: (request) =>
        resolveTestOrganizationAccountIdentity(input.identityDb, request),
    },
  });
}

async function resolveTestOrganizationAccountIdentity(
  db: D1Database,
  input: AuthRpcResolveOrganizationAccountIdentityInput
): Promise<AuthRpcResolveOrganizationAccountIdentityResult> {
  const organization = await db
    .prepare(
      `
        SELECT id, name, slug, metadata,
          (SELECT COUNT(*) FROM members WHERE organization_id = organizations.id) AS member_count
        FROM organizations
        WHERE id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<{
      id: string;
      member_count: number;
      metadata: string | null;
      name: string;
      slug: string;
    }>();
  if (!organization) {
    return {
      code: "auth.organization_identity_unavailable",
      message: "Organization identity is unavailable.",
      ok: false,
    };
  }
  const user =
    input.account?.kind === "user_id"
      ? await db
          .prepare("SELECT id, name, email FROM users WHERE id = ? LIMIT 1")
          .bind(input.account.userId)
          .first<{ email: string; id: string; name: string | null }>()
      : null;
  const membership = user
    ? await db
        .prepare(
          "SELECT id, role FROM members WHERE organization_id = ? AND user_id = ? LIMIT 1"
        )
        .bind(input.organizationId, user.id)
        .first<{ id: string; role: "admin" | "member" | "owner" }>()
    : null;
  const profile = user
    ? await db
        .prepare(
          `
            SELECT profile_id, profile_name
            FROM openmeld_profiles
            WHERE owner_user_id = ?
              AND organization_id IS NULL
              AND profile_kind = 'human'
              AND is_default = 1
              AND status = 'active'
            LIMIT 1
          `
        )
        .bind(user.id)
        .first<{ profile_id: string; profile_name: string }>()
    : null;
  const metadata = JSON.parse(organization.metadata ?? "{}") as {
    personal?: unknown;
  };
  return {
    account: user
      ? {
          defaultHumanProfile: profile
            ? {
                profileId: profile.profile_id,
                profileName: profile.profile_name,
              }
            : null,
          displayName: profile?.profile_name ?? user.name ?? user.email,
          email: user.email,
          membership: membership
            ? { memberId: membership.id, role: membership.role }
            : null,
          userId: user.id,
        }
      : null,
    ok: true,
    organization: {
      id: organization.id,
      memberCount: Number(organization.member_count) || 0,
      name: organization.name,
      personal: metadata.personal === true,
      slug: organization.slug,
    },
  };
}

describe("Remote Agent Message Channel orchestration", () => {
  it("selects only the explicitly registered provider adapter", () => {
    const lark = createProviderAdapter("lark");
    const feishu = createProviderAdapter("feishu");
    const registry = createMessageChannelProviderRegistry([lark, feishu]);

    expect(registry.require("lark")).toBe(lark);
    expect(registry.require("feishu")).toBe(feishu);
    expect(() => createMessageChannelProviderRegistry([lark, lark])).toThrow(
      "registered more than once"
    );
    expect(() =>
      createMessageChannelProviderRegistry([lark]).require("feishu")
    ).toThrow("is not registered");
  });

  it("resolves one current Organization member and the designated Center Agent", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelOrchestrationMigrations(harness);
    seedOrganizationAndCenterAgent(harness);
    await seedLarkConnection(harness);
    try {
      await insertRemoteAgentLarkPlatformIdentityLinkIfAbsent({
        connectionId: "connection_lark_1",
        db: harness.db,
        nowMs: 3000,
        organizationId: "org_1",
        provider: "lark",
        providerUserId: "ou_member_1",
        resolutionSource: "explicit",
        openmeldUserId: "user_member",
      });

      const resolution = await resolveMessageChannelTurnTarget({
        connectionId: "connection_lark_1",
        identityDb: harness.db,
        provider: "lark",
        providerUserId: "ou_member_1",
        stateDb: harness.db,
      });
      expect(resolution).toMatchObject({
        status: "resolved",
        target: {
          centerAgent: {
            agentProfileId: CENTER_AGENT_PROFILE_ID,
            bindingId: "binding_1",
          },
          connection: {
            connectionId: "connection_lark_1",
            organizationId: "org_1",
            provider: "lark",
          },
          participant: {
            kind: "member",
            member: {
              memberId: "member_1",
              organizationId: "org_1",
              userId: "user_member",
            },
          },
        },
      });
      if (resolution.status !== "resolved") {
        throw new Error("Expected a resolved Message Channel target");
      }

      const locator = {
        provider: "lark" as const,
        connectionId: "connection_lark_1",
        appId: "cli_lark_1",
        tenantKey: "tenant_lark_1",
        chatId: "oc_chat_1",
        rootMessageId: "om_root_1",
        threadId: null,
      };
      const conversationId = buildMessageChannelConversationId(locator);
      expect(
        buildMessageChannelTurnEnvelope({
          centerAgent: resolution.target.centerAgent,
          channelContext: {
            provider: "lark",
            conversationId,
            currentMessageId: "om_current_1",
            sync: { mode: "snapshot", status: "complete" },
            messages: [],
          },
          connectionId: resolution.target.connection.connectionId,
          conversationId,
          conversationName: "Product launch",
          isDirectMessage: false,
          participant: resolution.target.participant,
          provider: "lark",
          providerUserId: "ou_member_1",
          webAppUrl: "https://openmeld.test",
        })
      ).toMatchObject({
        centerAgent: {
          profileHandle: "center-agent",
          profileName: "Center Agent",
        },
        interactionEnvironment: "externally_shared",
        sender: {
          id: "member_1",
          messageChannelIdentity: {
            connectionId: "connection_lark_1",
            provider: "lark",
            providerUserId: "ou_member_1",
          },
          ownerUserId: "user_member",
          verified: true,
        },
        space: {
          id: conversationId,
          name: "Product launch",
        },
        trigger: {
          source: "message_channel",
          provider: "lark",
          connectionId: "connection_lark_1",
          conversationId,
        },
      });
    } finally {
      harness.close();
    }
  });

  it("rejects an unavailable Center Agent model without retrying the channel event", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelOrchestrationMigrations(harness);
    seedOrganizationAndCenterAgent(harness);
    await seedLarkConnection(harness);
    harness.run({
      params: ["retired/provider-model", "binding_1"],
      sql: `
        UPDATE openMeldDaemon_agent_profile_bindings
        SET model_id = ?
        WHERE binding_id = ?
      `,
    });

    try {
      await expect(
        resolveMessageChannelTurnTarget({
          connectionId: "connection_lark_1",
          identityDb: harness.db,
          provider: "lark",
          providerUserId: "ou_guest_1",
          stateDb: harness.db,
        })
      ).resolves.toEqual({
        connection: expect.objectContaining({
          connectionId: "connection_lark_1",
          organizationId: "org_1",
          provider: "lark",
        }),
        reasonCode: "message_channel.center_agent_model_unavailable",
        status: "rejected",
      });
    } finally {
      harness.close();
    }
  });

  it.each([
    ["logical runtime", "openmeld_service_runtime_id", "wrong-runtime"],
    ["conversation", "agent_controller_conversation_id", "wrong-thread"],
    ["hosted identity", "hosted_runtime_identity_json", "{}"],
  ])("rejects a hosted Binding with a damaged %s", async (_name, column, value) => {
    const harness = createSqliteD1Harness();
    applyMessageChannelOrchestrationMigrations(harness);
    seedOrganizationAndCenterAgent(harness);
    await seedLarkConnection(harness);
    harness.run({
      params: [value, "binding_1"],
      sql: `UPDATE openMeldDaemon_agent_profile_bindings SET ${column} = ? WHERE binding_id = ?`,
    });

    try {
      await expect(
        resolveMessageChannelTurnTarget({
          connectionId: "connection_lark_1",
          identityDb: harness.db,
          provider: "lark",
          providerUserId: "ou_guest_1",
          stateDb: harness.db,
        })
      ).resolves.toMatchObject({
        reasonCode: "message_channel.center_agent_unavailable",
        status: "rejected",
      });
    } finally {
      harness.close();
    }
  });

  it("admits unlinked and removed Lark participants without granting member identity", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelOrchestrationMigrations(harness);
    seedOrganizationAndCenterAgent(harness);
    await seedLarkConnection(harness);
    try {
      await expect(
        resolveMessageChannelTurnTarget({
          connectionId: "connection_lark_1",
          identityDb: harness.db,
          provider: "lark",
          providerUserDisplayName: "Guest Ari",
          providerUserId: "ou_unlinked",
          providerUserTenantKey: "tenant_lark_1",
          stateDb: harness.db,
        })
      ).resolves.toMatchObject({
        status: "resolved",
        target: {
          participant: {
            kind: "anonymous_member",
            providerUserDisplayName: "Guest Ari",
            providerUserId: "ou_unlinked",
          },
        },
      });
      await expect(
        resolveMessageChannelTurnTarget({
          connectionId: "connection_lark_1",
          identityDb: harness.db,
          provider: "feishu",
          providerUserId: "ou_unlinked",
          providerUserTenantKey: "tenant_lark_1",
          stateDb: harness.db,
        })
      ).resolves.toEqual({
        reasonCode: "message_channel.connection_unavailable",
        status: "rejected",
      });

      await insertRemoteAgentLarkPlatformIdentityLinkIfAbsent({
        connectionId: "connection_lark_1",
        db: harness.db,
        nowMs: 3000,
        organizationId: "org_1",
        provider: "lark",
        providerUserId: "ou_removed_member",
        resolutionSource: "explicit",
        openmeldUserId: "user_member",
      });
      harness.run({
        sql: "DELETE FROM members WHERE id = 'member_1'",
      });
      await expect(
        resolveMessageChannelTurnTarget({
          connectionId: "connection_lark_1",
          identityDb: harness.db,
          provider: "lark",
          providerUserId: "ou_removed_member",
          providerUserTenantKey: "tenant_lark_1",
          stateDb: harness.db,
        })
      ).resolves.toMatchObject({
        status: "resolved",
        target: {
          participant: {
            kind: "anonymous_member",
            providerUserId: "ou_removed_member",
          },
        },
      });
      await expect(
        resolveMessageChannelTurnTarget({
          connectionId: "connection_lark_1",
          identityDb: harness.db,
          provider: "lark",
          providerUserDisplayName: "External Lee",
          providerUserId: "ou_external",
          providerUserTenantKey: "tenant_external",
          stateDb: harness.db,
        })
      ).resolves.toMatchObject({
        status: "resolved",
        target: {
          participant: {
            kind: "external",
            providerUserDisplayName: "External Lee",
            providerUserId: "ou_external",
          },
        },
      });
    } finally {
      harness.close();
    }
  });

  it("links an existing Lark member idempotently and enrolls an authenticated non-member", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelOrchestrationMigrations(harness);
    seedOrganizationAndCenterAgent(harness);
    await seedLarkConnection(harness);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(4000);
    const memberToken =
      "messagechannellink_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const nonMemberToken =
      "messagechannellink_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    try {
      for (const [token, providerUserId] of [
        [memberToken, "ou_member_1"],
        [nonMemberToken, "ou_non_member_1"],
      ] as const) {
        await insertRemoteAgentMessageChannelIdentityLinkToken({
          connectionId: "connection_lark_1",
          db: harness.db,
          expiresAtMs: 10_000,
          issuedAtMs: 3000,
          organizationId: "org_1",
          provider: "lark",
          providerUserDisplayName:
            providerUserId === "ou_member_1" ? "Ari Lark" : "No Member",
          providerUserId,
          tokenHash: await digestMessageChannelIdentityLinkToken(token),
        });
      }

      await expect(
        rpcPreviewMessageChannelIdentityLink(buildIdentityLinkEnv(harness.db), {
          context: buildHumanContext(),
          token: memberToken,
        })
      ).resolves.toEqual({
        alreadyMember: true,
        continuesRequest: false,
        expiresAt: "1970-01-01T00:00:10.000Z",
        organizationId: "org_1",
        organizationName: "OpenMeld Labs",
        provider: "lark",
        providerUserDisplayName: "Ari Lark",
        providerUserId: "ou_member_1",
        openMeldAccountEmail: "ari@example.test",
        replacesExistingLink: false,
      });
      await expect(
        rpcConsumeMessageChannelIdentityLink(buildIdentityLinkEnv(harness.db), {
          context: buildHumanContext(),
          token: memberToken,
        })
      ).resolves.toMatchObject({
        linked: true,
        organizationId: "org_1",
        provider: "lark",
        providerUserId: "ou_member_1",
        openMeldUserId: "user_member",
      });
      await expect(
        rpcConsumeMessageChannelIdentityLink(buildIdentityLinkEnv(harness.db), {
          context: buildHumanContext(),
          token: memberToken,
        })
      ).resolves.toMatchObject({
        continued: false,
        linked: true,
        organizationId: "org_1",
        openMeldUserId: "user_member",
      });
      await expect(
        rpcPreviewMessageChannelIdentityLink(buildIdentityLinkEnv(harness.db), {
          context: buildHumanContext({ userId: "user_owner" }),
          token: nonMemberToken,
        })
      ).resolves.toMatchObject({
        alreadyMember: false,
        organizationId: "org_1",
        providerUserId: "ou_non_member_1",
        openMeldAccountEmail: "owner@example.test",
      });
      await expect(
        rpcConsumeMessageChannelIdentityLink(buildIdentityLinkEnv(harness.db), {
          context: buildHumanContext({ userId: "user_owner" }),
          token: nonMemberToken,
        })
      ).resolves.toMatchObject({
        joinedOrganization: true,
        linked: true,
        organizationId: "org_1",
        providerUserId: "ou_non_member_1",
        openMeldUserId: "user_owner",
      });
    } finally {
      dateNow.mockRestore();
      harness.close();
    }
  });

  it("rolls back a Lark identity replacement when its audit write fails", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelOrchestrationMigrations(harness);
    seedOrganizationAndCenterAgent(harness);
    await seedLarkConnection(harness);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(4000);
    const token =
      "messagechannellink_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    try {
      harness.run({
        sql: `
          INSERT INTO openmeld_profiles (
            profile_id,
            profile_name,
            profile_handle,
            profile_kind,
            is_default,
            status,
            organization_id,
            owner_user_id,
            created_at,
            updated_at
          ) VALUES (
            '22222222-2222-4222-8222-222222222222',
            'Ari Human',
            'ari-audit',
            'human',
            0,
            'active',
            NULL,
            'user_member',
            100,
            100
          )
        `,
      });
      harness.run({
        params: ["member_owner", "org_1", "user_owner", "member", 100],
        sql: `
          INSERT INTO members (id, organization_id, user_id, role, created_at)
          VALUES (?, ?, ?, ?, ?)
        `,
      });
      await insertRemoteAgentLarkPlatformIdentityLinkIfAbsent({
        connectionId: "connection_lark_1",
        db: harness.db,
        nowMs: 3000,
        organizationId: "org_1",
        provider: "lark",
        providerUserId: "ou_member_1",
        resolutionSource: "explicit",
        openmeldUserId: "user_owner",
      });
      await insertRemoteAgentMessageChannelIdentityLinkToken({
        connectionId: "connection_lark_1",
        db: harness.db,
        expiresAtMs: 10_000,
        issuedAtMs: 3000,
        organizationId: "org_1",
        provider: "lark",
        providerUserDisplayName: "Ari Lark",
        providerUserId: "ou_member_1",
        tokenHash: await digestMessageChannelIdentityLinkToken(token),
      });
      harness.run({
        sql: `
          CREATE TRIGGER fail_identity_link_audit
          BEFORE INSERT ON center_agent_audit_journal
          WHEN NEW.action = 'replace_message_channel_identity_link'
          BEGIN
            SELECT RAISE(ABORT, 'injected identity-link audit failure');
          END
        `,
      });

      await expect(
        rpcConsumeMessageChannelIdentityLink(buildIdentityLinkEnv(harness.db), {
          context: buildHumanContext(),
          token,
        })
      ).rejects.toThrow("injected identity-link audit failure");
      await expect(
        readRemoteAgentLarkPlatformIdentityLink({
          connectionId: "connection_lark_1",
          db: harness.db,
          provider: "lark",
          providerUserId: "ou_member_1",
        })
      ).resolves.toMatchObject({ openmeldUserId: "user_owner" });
      harness.run({ sql: "DROP TRIGGER fail_identity_link_audit" });
      await expect(
        rpcConsumeMessageChannelIdentityLink(buildIdentityLinkEnv(harness.db), {
          context: buildHumanContext(),
          token,
        })
      ).resolves.toMatchObject({
        linked: true,
        replacedExistingLink: true,
        openMeldUserId: "user_member",
      });
      await expect(
        rpcConsumeMessageChannelIdentityLink(buildIdentityLinkEnv(harness.db), {
          context: buildHumanContext(),
          token,
        })
      ).resolves.toMatchObject({ linked: true });
      expect(
        harness.queryFirst<{ audit_count: number }>({
          sql: `
            SELECT COUNT(*) AS audit_count
            FROM center_agent_audit_journal
            WHERE action = 'replace_message_channel_identity_link'
          `,
        })
      ).toEqual({ audit_count: 1 });
    } finally {
      dateNow.mockRestore();
      harness.close();
    }
  });

  it("does not audit a Lark replacement when the canonical link is already corrected inside the consume batch", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelOrchestrationMigrations(harness);
    seedOrganizationAndCenterAgent(harness);
    await seedLarkConnection(harness);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(4000);
    const token =
      "messagechannellink_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    try {
      harness.run({
        params: ["member_owner", "org_1", "user_owner", "member", 100],
        sql: `
          INSERT INTO members (id, organization_id, user_id, role, created_at)
          VALUES (?, ?, ?, ?, ?)
        `,
      });
      harness.run({
        sql: `
          INSERT INTO openmeld_profiles (
            profile_id, profile_name, profile_handle, profile_kind, is_default,
            status, organization_id, owner_user_id, created_at, updated_at
          ) VALUES (
            '22222222-2222-4222-8222-222222222222', 'Ari Human', 'ari-audit',
            'human', 0, 'active', NULL, 'user_member', 100, 100
          )
        `,
      });
      await insertRemoteAgentLarkPlatformIdentityLinkIfAbsent({
        connectionId: "connection_lark_1",
        db: harness.db,
        nowMs: 3000,
        organizationId: "org_1",
        provider: "lark",
        providerUserId: "ou_member_1",
        resolutionSource: "explicit",
        openmeldUserId: "user_owner",
      });
      await insertRemoteAgentMessageChannelIdentityLinkToken({
        connectionId: "connection_lark_1",
        db: harness.db,
        expiresAtMs: 10_000,
        issuedAtMs: 3000,
        organizationId: "org_1",
        provider: "lark",
        providerUserDisplayName: "Ari Lark",
        providerUserId: "ou_member_1",
        tokenHash: await digestMessageChannelIdentityLinkToken(token),
      });
      const racingDb = createBeforeMatchingBatchD1Database({
        beforeBatch: () => {
          harness.run({
            sql: `
              UPDATE openMeldRemoteAgent_lark_platform_identity_links
              SET openmeld_user_id = 'user_member'
              WHERE provider = 'lark'
                AND connection_id = 'connection_lark_1'
                AND provider_user_id = 'ou_member_1'
            `,
          });
        },
        db: harness.db,
        matches: (sql) =>
          sql.includes(
            "UPDATE openMeldRemoteAgent_message_channel_identity_link_tokens"
          ) && sql.includes("SET consumed_at_ms"),
      });

      await expect(
        rpcConsumeMessageChannelIdentityLink(buildIdentityLinkEnv(racingDb), {
          context: buildHumanContext(),
          token,
        })
      ).resolves.toMatchObject({
        linked: true,
        replacedExistingLink: false,
        openMeldUserId: "user_member",
      });
      expect(
        harness.queryFirst<{ audit_count: number }>({
          sql: `
            SELECT COUNT(*) AS audit_count
            FROM center_agent_audit_journal
            WHERE action = 'replace_message_channel_identity_link'
          `,
        })
      ).toEqual({ audit_count: 0 });
    } finally {
      dateNow.mockRestore();
      harness.close();
    }
  });
});

function createProviderAdapter(
  provider: LarkPlatformMessageChannelProvider
): MessageChannelProviderAdapter {
  return {
    createWorkingCard: vi.fn(),
    downloadResource: vi.fn(),
    finalizeWorkingCard: vi.fn(),
    provider,
    publishIdentityLinkGuidance: vi.fn(),
    publishPrivateNavigationGuidance: vi.fn(),
    publishFailure: vi.fn(),
    publishReply: vi.fn(),
    publishWorkingCard: vi.fn(),
    readChannelContext: vi.fn(),
    updateWorkingCard: vi.fn(),
  };
}

function buildHumanContext(
  input: { userId?: string } = {}
): NonNullable<
  Parameters<typeof rpcPreviewMessageChannelIdentityLink>[1]["context"]
> {
  const userId = input.userId ?? "user_member";
  return {
    activeOrganizationId: "org_1",
    actorContext: {
      callerPrincipalId: userId,
      ownerUserId: userId,
      profileKind: "human",
      profileName: userId === "user_member" ? "Ari Human" : "No Member",
      requestId: "req_message_channel_link_test",
      openMeldProfileId: "22222222-2222-4222-8222-222222222222",
    },
  };
}

function buildIdentityLinkEnv(db: D1Database): CoreBindings {
  return {
    OPENMELD_DB: db,
    OPENMELD_AUTH_WORKER: {
      ensureMessageChannelMemberOrganizationMembership: async (request) => {
        await db
          .prepare(
            `
              INSERT OR IGNORE INTO members (
                id, organization_id, user_id, role, created_at
              ) VALUES (?, ?, ?, 'member', ?)
            `
          )
          .bind(
            `member_enrolled_${request.userId}`,
            request.organizationId,
            request.userId,
            Date.now()
          )
          .run();
        return {
          alreadyMember: false,
          ok: true as const,
          organizationId: request.organizationId,
          organizationName: "OpenMeld Labs",
          organizationSlug: "openmeld-labs",
          role: "member" as const,
        };
      },
      resolveOrganizationAccountIdentity: (request) =>
        resolveTestOrganizationAccountIdentity(db, request),
    },
    OPENMELD_LOCAL_STATE_DB: db,
    OPENMELD_SPACES: {
      get: () => null,
    } as unknown as CoreBindings["OPENMELD_SPACES"],
  };
}

function applyMessageChannelOrchestrationMigrations(
  harness: Parameters<typeof applyMigrationForTable>[0]
): void {
  harness.run({
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        email_verified INTEGER DEFAULT false NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        normalized_email TEXT
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE members (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE openmeld_profiles (
        profile_id TEXT PRIMARY KEY,
        profile_name TEXT NOT NULL,
        profile_handle TEXT NOT NULL,
        profile_kind TEXT NOT NULL,
        is_default INTEGER DEFAULT false NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        organization_id TEXT,
        owner_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE center_agent_designations (
        organization_id TEXT PRIMARY KEY,
        agent_profile_id TEXT NOT NULL,
        duty TEXT,
        designated_by TEXT NOT NULL,
        operating_state TEXT NOT NULL DEFAULT 'active',
        paused_at INTEGER,
        paused_by_user_id TEXT,
        created_at INTEGER NOT NULL
      )
    `,
  });
  applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
  applyDrizzleMigrationsForTables(harness, [
    "center_agent_audit_journal",
    "openMeldRemoteAgent_lark_platform_channel_connections",
    "openMeldRemoteAgent_message_channel_identity_link_tokens",
  ]);
  applyMigrationForTable(
    harness,
    "openMeldRemoteAgent_lark_platform_registration_attempts"
  );
}

function seedOrganizationAndCenterAgent(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({
    sql: `
      INSERT INTO users (
        id, name, email, email_verified, created_at, updated_at
      )
      VALUES
        ('user_member', 'Ari', 'ari@example.test', 1, 100, 100),
        ('user_owner', 'Center Agent Owner', 'owner@example.test', 1, 100, 100)
    `,
  });
  harness.run({
    params: [JSON.stringify({ personal: false })],
    sql: `
      INSERT INTO organizations (id, name, slug, metadata, created_at)
      VALUES ('org_1', 'OpenMeld Labs', 'openmeld-labs', ?, 100)
    `,
  });
  harness.run({
    sql: `
      INSERT INTO members (id, organization_id, user_id, role, created_at)
      VALUES ('member_1', 'org_1', 'user_member', 'owner', 100)
    `,
  });
  harness.run({
    sql: `
      INSERT INTO openmeld_profiles (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        is_default,
        status,
        organization_id,
        owner_user_id,
        created_at,
        updated_at
      )
      VALUES
        (
          'profile_human_1',
          'Ari Human',
          'ari',
          'human',
          1,
          'active',
          NULL,
          'user_member',
          100,
          100
        ),
        (
          '${CENTER_AGENT_PROFILE_ID}',
          'Center Agent',
          'center-agent',
          'agent',
          0,
          'active',
          'org_1',
          'user_owner',
          100,
          100
        )
    `,
  });
  harness.run({
    params: ["org_1", CENTER_AGENT_PROFILE_ID, "user_owner", 100],
    sql: `
      INSERT INTO center_agent_designations (
        organization_id, agent_profile_id, designated_by, created_at
      )
      VALUES (?, ?, ?, ?)
    `,
  });
  harness.run({
    params: [
      "binding_1",
      "owner_account",
      "user_owner",
      CENTER_AGENT_PROFILE_ID,
      HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      "hosted_center_agent",
      JSON.stringify(HOSTED_CENTER_AGENT_RUNTIME_IDENTITY),
      HOSTED_CENTER_AGENT_CONTROLLER_REF,
      null,
      "enabled_primary",
      100,
      100,
    ],
    sql: `
      INSERT INTO openMeldDaemon_agent_profile_bindings (
        binding_id,
        owner_kind,
        owner_id,
        agent_profile_id,
        openmeld_service_runtime_id,
        runtime_kind,
        hosted_runtime_identity_json,
        agent_controller_ref,
        agent_controller_conversation_id,
        binding_state,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
}

async function seedLarkConnection(
  harness: ReturnType<typeof createSqliteD1Harness>
): Promise<void> {
  await createRemoteAgentLarkPlatformRegistrationAttempt({
    accountDomain: "https://open.larksuite.com",
    attemptId: "attempt_lark_1",
    db: harness.db,
    encryptedDeviceCode: "encrypted-device-code",
    encryptedRegistrationUrl: "encrypted-registration-url",
    expiresAtMs: 10_000,
    initiatedByProfileId: "profile_member",
    initiatedByUserId: "user_member",
    nextPollAtMs: 2000,
    nowMs: 1000,
    organizationId: "org_1",
    permissionBundleVersion: "channel-v1",
    permissionMode: "channel_only_template",
    pollIntervalMs: 1000,
    provider: "lark",
    returnPath: "/center-agent/channels",
  });
  await claimRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: "attempt_lark_1",
    claimExpiresAtMs: 4000,
    claimId: "claim_lark_1",
    db: harness.db,
    nowMs: 2000,
  });
  await persistRemoteAgentLarkPlatformRegistrationCredentials({
    appId: "cli_lark_1",
    attemptId: "attempt_lark_1",
    claimId: "claim_lark_1",
    connectionGeneration: 1,
    connectionId: "connection_lark_1",
    configurationExpiresAtMs: 10_000,
    credentialFormatVersion: 1,
    db: harness.db,
    encryptedAppSecret: "encrypted-app-secret",
    encryptedEventEncryptKey: "encrypted-event-key",
    encryptedVerificationToken: "encrypted-verification-token",
    nowMs: 2500,
    operatorOpenId: "ou_installer_1",
    tenantKey: "tenant_lark_1",
    transport: "webhook",
  });
  await claimRemoteAgentLarkPlatformRegistrationAttempt({
    attemptId: "attempt_lark_1",
    claimExpiresAtMs: 5000,
    claimId: "claim_lark_configure",
    db: harness.db,
    nowMs: 2600,
  });
  await recordRemoteAgentLarkPlatformWebhookReachability({
    encryptedVerificationToken:
      (
        await readRemoteAgentLarkPlatformChannelCredentials({
          connectionId: "connection_lark_1",
          db: harness.db,
        })
      )?.encryptedVerificationToken ?? null,
    connectionId: "connection_lark_1",
    db: harness.db,
    organizationId: "org_1",
    provider: "lark",
    surface: "events",
    verifiedAtMs: 2650,
  });
  await recordRemoteAgentLarkPlatformWebhookReachability({
    encryptedVerificationToken:
      (
        await readRemoteAgentLarkPlatformChannelCredentials({
          connectionId: "connection_lark_1",
          db: harness.db,
        })
      )?.encryptedVerificationToken ?? null,
    connectionId: "connection_lark_1",
    db: harness.db,
    organizationId: "org_1",
    provider: "lark",
    surface: "callbacks",
    verifiedAtMs: 2675,
  });
  const completed = await completeRemoteAgentLarkPlatformRegistration({
    attemptId: "attempt_lark_1",
    botName: "Center Agent",
    botOpenId: "ou_bot_1",
    claimId: "claim_lark_configure",
    connectionId: "connection_lark_1",
    db: harness.db,
    grantedCapabilityGroups: ["conversation.text"],
    nextPollAtMs: 3700,
    nowMs: 2700,
  });
  if (completed.status !== "completed") {
    throw new Error("Failed to seed a connected Lark Message Channel");
  }
}
