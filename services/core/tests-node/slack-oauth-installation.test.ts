import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { resolveSlackBotToken } from "../src/remote-agent/application/slack-bot-token";
import { deliverSlackInstallationWelcome } from "../src/remote-agent/application/slack-installation-welcome-service";
import { installSlackWorkspaceFromOAuth } from "../src/remote-agent/application/slack-oauth-installation";
import { readSlackUserIdentityLink } from "../src/remote-agent/infrastructure/postgresql/slack-user-identity-link-repo";
import {
  createRemoteAgentSlackWorkspaceBinding,
  deleteRemoteAgentSlackWorkspaceBindingByOrganization,
  readRemoteAgentSlackWorkspaceBinding,
} from "../src/remote-agent/infrastructure/postgresql/slack-workspace-binding-repo";
import {
  prepareDeleteSlackWorkspaceTokenByOrganizationStatement,
  readSlackWorkspaceToken,
} from "../src/remote-agent/infrastructure/postgresql/slack-workspace-token-repo";
import { rpcInstallSlackWorkspaceFromOAuth } from "../src/rpc/methods";
import {
  createBeforeMatchingPostgresTransaction,
  createPostgresHarness,
  installPostgresWriteFailure,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const MUTATION_QUERY_PATTERN = /^\s*(UPDATE|INSERT|DELETE)\b/u;

const CRYPTO_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const NOW_MS = Date.parse("2026-07-10T00:00:00.000Z");
const RPC_INSTALLATION_INPUT = {
  actorProfileId: "11111111-1111-4111-8111-111111111111",
  botScopes: ["chat:write", "im:history", "im:read", "im:write"],
  botToken: "xoxb-installed-token",
  botUserId: "U_BOT",
  installedByUserId: "openmeld-user-1",
  organizationId: "org-1",
  slackInstallerUserId: "U_INSTALLER",
  slackTeamId: "T_WORKSPACE",
};
// Mirrors the documented Slack chat.postMessage success response shape.
const SLACK_MESSAGE_SUCCESS_RESPONSE = {
  channel: "D_INSTALLER",
  message: {
    bot_id: "B1234567890",
    subtype: "bot_message",
    text: "Welcome to OpenMeld.",
    ts: "1503435956.000247",
    type: "message",
    username: "OpenMeld",
  },
  ok: true,
  ts: "1503435956.000247",
} as const;
describe("Slack OAuth installation", () => {
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;
  beforeEach(async () => {
    harness = await createPostgresHarness();
    for (const id of [
      "user-1",
      "user-2",
      "user-shared",
      "openmeld-user-1",
      "openmeld-old-user",
    ]) {
      await harness.query({
        text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $1, $2)',
        values: [id, `${id}@example.com`],
      });
    }
    for (const id of [
      "org-1",
      "org-old",
      "org-existing",
      "org-new",
      "org-current",
    ]) {
      await harness.query({
        text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $1, $1, $2)',
        values: [id, NOW_MS],
      });
    }
    for (const [id, owner] of [
      ["11111111-1111-4111-8111-111111111111", "user-1"],
      ["22222222-2222-4222-8222-222222222222", "user-2"],
    ]) {
      await harness.query({
        text: 'INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, owner_user_id, source) VALUES ($1, $2, $2, $3, $2, $4)',
        values: [id, owner, "human", "migration"],
      });
    }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await harness.close();
  });
  it("queues trust-first preparation instead of sending an immediate welcome", async () => {
    await insertOrganizationOwner(harness);
    const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(Response.json(SLACK_MESSAGE_SUCCESS_RESPONSE))
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      rpcInstallSlackWorkspaceFromOAuth(
        createRpcEnv(harness),
        RPC_INSTALLATION_INPUT
      )
    ).resolves.toEqual({ status: "created" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readWelcomePreparation(harness)).toEqual({
      installed_by_profile_id: "11111111-1111-4111-8111-111111111111",
      installed_by_user_id: "openmeld-user-1",
      message_kind: "connected",
      failure_code: null,
      organization_id: "org-1",
      recipient_slack_user_id: "U_INSTALLER",
      slack_team_id: "T_WORKSPACE",
      status: "queued",
      welcome_version: 2,
    });
    expect(await readWelcomeDelivery(harness)).toBeNull();
    await expect(
      readSlackUserIdentityLink({
        db: harness.db,
        slackTeamId: "T_WORKSPACE",
        slackUserId: "U_INSTALLER",
      })
    ).resolves.toMatchObject({
      openmeldUserId: "openmeld-user-1",
      organizationId: "org-1",
      source: "explicit",
    });
    await expect(
      readSlackWorkspaceToken({
        db: harness.db,
        slackTeamId: "T_WORKSPACE",
      })
    ).resolves.toMatchObject({
      grantedBotScopes: ["chat:write", "im:history", "im:read", "im:write"],
    });
  });
  it("rejects an OAuth installation for a Personal Workspace before writing Slack state", async () => {
    await insertOrganizationOwner(harness, { personal: true });
    await expect(
      rpcInstallSlackWorkspaceFromOAuth(
        createRpcEnv(harness),
        RPC_INSTALLATION_INPUT
      )
    ).rejects.toMatchObject({
      code: "message_channel.organization_required",
      status: 409,
    });
    expect(
      await readRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        slackTeamId: RPC_INSTALLATION_INPUT.slackTeamId,
      })
    ).toBeNull();
  });
  it("does not send the welcome DM when an existing binding is reauthorized", async () => {
    await insertOrganizationOwner(harness);
    await installSlackWorkspaceFromOAuth({
      actorProfileId: "11111111-1111-4111-8111-111111111111",
      auditEntryId: "audit-existing",
      botToken: "xoxb-old-token",
      botUserId: "U_OLD_BOT",
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      installedByUserId: "openmeld-user-1",
      nowMs: NOW_MS,
      organizationId: "org-1",
      slackTeamId: "T_WORKSPACE",
    });
    const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(Response.json(SLACK_MESSAGE_SUCCESS_RESPONSE))
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      rpcInstallSlackWorkspaceFromOAuth(
        createRpcEnv(harness),
        RPC_INSTALLATION_INPUT
      )
    ).resolves.toEqual({ status: "unchanged" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("queues fresh trust-first preparation when a workspace moves organizations", async () => {
    await installSlackWorkspaceFromOAuth({
      actorProfileId: "22222222-2222-4222-8222-222222222222",
      auditEntryId: "audit-old",
      botToken: "xoxb-old-token",
      botUserId: "U_OLD_BOT",
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      installedByUserId: "openmeld-old-user",
      nowMs: NOW_MS,
      organizationId: "org-old",
      slackTeamId: "T_WORKSPACE",
    });
    await insertOrganizationOwner(harness);
    const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(Response.json(SLACK_MESSAGE_SUCCESS_RESPONSE))
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      rpcInstallSlackWorkspaceFromOAuth(createRpcEnv(harness), {
        ...RPC_INSTALLATION_INPUT,
        moveFromOrganizationId: "org-old",
      })
    ).resolves.toEqual({ status: "moved" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readWelcomePreparation(harness)).toMatchObject({
      message_kind: "moved",
      status: "queued",
    });
  });
  it("rolls back the installation when its durable welcome preparation cannot be queued", async () => {
    await insertOrganizationOwner(harness);
    await installPostgresWriteFailure({
      harness,
      table: "slack_installation_welcome_preparations",
      operation: "INSERT",
      message: "preparation rejected",
    });
    await expect(
      rpcInstallSlackWorkspaceFromOAuth(
        createRpcEnv(harness),
        RPC_INSTALLATION_INPUT
      )
    ).rejects.toThrow("preparation rejected");
    await expect(
      readRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        slackTeamId: RPC_INSTALLATION_INPUT.slackTeamId,
      })
    ).resolves.toBeNull();
    expect(
      await harness.queryFirst({
        text: 'SELECT slack_team_id FROM "openmeld"."slack_workspace_tokens" LIMIT 1',
      })
    ).toBeNull();
    expect(
      await harness.queryFirst({
        text: 'SELECT id FROM "openmeld"."center_agent_audit_journal" LIMIT 1',
      })
    ).toBeNull();
    expect(await readWelcomePreparation(harness)).toBeNull();
  });
  it("preserves the Slack publication error when recording its outcome also fails", async () => {
    await installPostgresWriteFailure({
      harness,
      table: "slack_installation_welcome_deliveries",
      operation: "UPDATE",
      columns: ["status"],
      condition: "NEW.status != 'pending'",
      message: "welcome completion rejected",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("socket closed")))
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(
      deliverSlackInstallationWelcome({
        allowCreate: true,
        allowRetry: false,
        botToken: "xoxb-installed-token",
        buildBlocks: () => Promise.resolve(undefined),
        connectionCreatedAtMs: NOW_MS,
        db: harness.db,
        messages: {
          connected: "Welcome to OpenMeld.",
          moved: "Your workspace moved.",
        },
        messageKind: "connected",
        nowMs: NOW_MS,
        organizationId: "org-1",
        recipientSlackUserId: "U_INSTALLER",
        slackTeamId: "T_WORKSPACE",
      })
    ).rejects.toThrow("socket closed");
  });
  it("never rewrites a confirmed Slack publication as failed when its checkpoint cannot be stored", async () => {
    await installPostgresWriteFailure({
      harness,
      table: "slack_installation_welcome_deliveries",
      operation: "UPDATE",
      columns: ["status"],
      condition: "NEW.status = 'delivered'",
      message: "delivered checkpoint rejected",
    });
    const fetchMock = vi.fn(() =>
      Promise.resolve(Response.json(SLACK_MESSAGE_SUCCESS_RESPONSE))
    );
    vi.stubGlobal("fetch", fetchMock);
    const delivery = {
      allowCreate: true,
      botToken: "xoxb-installed-token",
      buildBlocks: () => Promise.resolve(undefined),
      connectionCreatedAtMs: NOW_MS,
      db: harness.db,
      messages: {
        connected: "Welcome to OpenMeld.",
        moved: "Your workspace moved.",
      },
      messageKind: "connected" as const,
      nowMs: NOW_MS,
      organizationId: "org-1",
      recipientSlackUserId: "U_INSTALLER",
      slackTeamId: "T_WORKSPACE",
    };
    await expect(
      deliverSlackInstallationWelcome({ ...delivery, allowRetry: false })
    ).resolves.toBe("delivered");
    expect(await readWelcomeDelivery(harness)).toMatchObject({
      failure_code: null,
      message_ts: null,
      status: "pending",
    });
    await expect(
      deliverSlackInstallationWelcome({
        ...delivery,
        allowRetry: true,
        nowMs: NOW_MS + 1,
      })
    ).resolves.toBe("skipped");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("does not retry a confirmed Slack rejection until reauthorization explicitly allows it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "channel_not_found", ok: false })
      )
      .mockResolvedValueOnce(Response.json(SLACK_MESSAGE_SUCCESS_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);
    const delivery = {
      allowCreate: true,
      botToken: "xoxb-installed-token",
      buildBlocks: () => Promise.resolve(undefined),
      connectionCreatedAtMs: NOW_MS,
      db: harness.db,
      messages: {
        connected: "Welcome to OpenMeld.",
        moved: "Your workspace moved.",
      },
      messageKind: "connected" as const,
      nowMs: NOW_MS,
      organizationId: "org-1",
      recipientSlackUserId: "U_INSTALLER",
      slackTeamId: "T_WORKSPACE",
    };
    await expect(
      deliverSlackInstallationWelcome({ ...delivery, allowRetry: false })
    ).rejects.toThrow("channel_not_found");
    await expect(
      deliverSlackInstallationWelcome({
        ...delivery,
        allowRetry: false,
        nowMs: NOW_MS + 1,
      })
    ).resolves.toBe("skipped");
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(
      deliverSlackInstallationWelcome({
        ...delivery,
        allowRetry: true,
        nowMs: NOW_MS + 2,
      })
    ).resolves.toBe("delivered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not duplicate queued preparation when OAuth is reauthorized", async () => {
    await insertOrganizationOwner(harness);
    await expect(
      rpcInstallSlackWorkspaceFromOAuth(
        createRpcEnv(harness),
        RPC_INSTALLATION_INPUT
      )
    ).resolves.toEqual({ status: "created" });
    await expect(
      rpcInstallSlackWorkspaceFromOAuth(
        createRpcEnv(harness),
        RPC_INSTALLATION_INPUT
      )
    ).resolves.toEqual({ status: "unchanged" });
    expect(
      await harness.queryAll({
        text: 'SELECT status FROM "openmeld"."slack_installation_welcome_preparations"',
      })
    ).toEqual([{ status: "queued" }]);
  });
  it("repairs a historically missing welcome preparation on OAuth reauthorization", async () => {
    await insertOrganizationOwner(harness);
    await rpcInstallSlackWorkspaceFromOAuth(
      createRpcEnv(harness),
      RPC_INSTALLATION_INPUT
    );
    await harness.query({
      text: 'DELETE FROM "openmeld"."slack_installation_welcome_preparations"',
    });
    await expect(
      rpcInstallSlackWorkspaceFromOAuth(
        createRpcEnv(harness),
        RPC_INSTALLATION_INPUT
      )
    ).resolves.toEqual({ status: "unchanged" });
    expect(await readWelcomePreparation(harness)).toMatchObject({
      message_kind: "connected",
      status: "queued",
    });
  });
  it("authorizes one failed welcome retry when the installer reauthorizes Slack", async () => {
    await insertOrganizationOwner(harness);
    await rpcInstallSlackWorkspaceFromOAuth(
      createRpcEnv(harness),
      RPC_INSTALLATION_INPUT
    );
    await harness.query({
      text: `UPDATE "openmeld"."slack_installation_welcome_preparations"
        SET status = 'failed', claim_id = 'claim-1',
          research_task_id = 'research-1', failure_code = 'slack_delivery_failed'`,
    });
    await harness.query({
      values: [NOW_MS, NOW_MS],
      text: `INSERT INTO "openmeld"."slack_installation_welcome_deliveries" (
        slack_team_id, organization_id, recipient_slack_user_id,
        connection_created_at_ms, welcome_version, message_kind, status,
        claim_id, attempt_count, message_ts, failure_code, created_at_ms,
        updated_at_ms
      ) SELECT
        slack_team_id, organization_id, recipient_slack_user_id,
        connection_created_at_ms, welcome_version, message_kind,
        'failed', 'delivery-claim-1', 1, NULL, 'channel_not_found', $1, $2
      FROM "openmeld"."slack_installation_welcome_preparations"`,
    });
    await expect(
      rpcInstallSlackWorkspaceFromOAuth(
        createRpcEnv(harness),
        RPC_INSTALLATION_INPUT
      )
    ).resolves.toEqual({ status: "unchanged" });
    expect(
      await harness.queryFirst({
        text: `SELECT status, failure_code, research_task_id
          FROM "openmeld"."slack_installation_welcome_preparations"`,
      })
    ).toEqual({
      failure_code: "slack_delivery_retry_authorized",
      research_task_id: "research-1",
      status: "ready",
    });
  });
  it("stores the encrypted bot token and workspace binding together", async () => {
    const result = await installSlackWorkspaceFromOAuth({
      actorProfileId: "11111111-1111-4111-8111-111111111111",
      auditEntryId: "audit-1",
      botToken: "xoxb-installed-token",
      botUserId: "U123",
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      installedByUserId: "user-1",
      nowMs: NOW_MS,
      organizationId: "org-1",
      slackTeamId: "T123",
    });
    expect(result.status).toBe("created");
    await expect(
      readRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        slackTeamId: "T123",
      })
    ).resolves.toMatchObject({ organizationId: "org-1" });
    await expect(
      resolveSlackBotToken({
        cryptoKey: CRYPTO_KEY,
        db: harness.db,
        fallbackBotToken: null,
        slackTeamId: "T123",
      })
    ).resolves.toBe("xoxb-installed-token");
    expect(
      await harness.queryFirst({
        text: 'SELECT action, resource_id FROM "openmeld"."center_agent_audit_journal" LIMIT 1',
      })
    ).toEqual({
      action: "connect_slack_workspace",
      resource_id: "T123",
    });
  });
  it("rolls back the workspace binding when token storage fails", async () => {
    await installPostgresWriteFailure({
      harness,
      table: "slack_workspace_tokens",
      operation: "INSERT",
      message: "token rejected",
    });
    await expect(
      installSlackWorkspaceFromOAuth({
        actorProfileId: "11111111-1111-4111-8111-111111111111",
        auditEntryId: "audit-1",
        botToken: "xoxb-installed-token",
        botUserId: "U123",
        cryptoKey: CRYPTO_KEY,
        db: harness.db,
        installedByUserId: "user-1",
        nowMs: NOW_MS,
        organizationId: "org-1",
        slackTeamId: "T123",
      })
    ).rejects.toThrow("token rejected");
    await expect(
      readRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        slackTeamId: "T123",
      })
    ).resolves.toBeNull();
    expect(
      await harness.queryFirst({
        text: 'SELECT id FROM "openmeld"."center_agent_audit_journal" LIMIT 1',
      })
    ).toBeNull();
  });
  it("preserves the existing workspace ownership guard", async () => {
    await createRemoteAgentSlackWorkspaceBinding({
      db: harness.db,
      nowMs: NOW_MS,
      organizationId: "org-existing",
      slackTeamId: "T123",
    });
    const result = await installSlackWorkspaceFromOAuth({
      actorProfileId: "22222222-2222-4222-8222-222222222222",
      auditEntryId: "audit-2",
      botToken: "xoxb-attacker-token",
      botUserId: "U999",
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      installedByUserId: "user-2",
      nowMs: NOW_MS + 1,
      organizationId: "org-other",
      slackTeamId: "T123",
    });
    expect(result).toMatchObject({
      existing: { organizationId: "org-existing", slackTeamId: "T123" },
      status: "workspace_already_bound",
    });
    expect(
      await harness.queryFirst({
        values: ["T123"],
        text: 'SELECT slack_team_id FROM "openmeld"."slack_workspace_tokens" WHERE slack_team_id = $1',
      })
    ).toBeNull();
  });
  it("moves the workspace, token ownership, and old-organization audit atomically", async () => {
    await installSlackWorkspaceFromOAuth({
      actorProfileId: "11111111-1111-4111-8111-111111111111",
      auditEntryId: "audit-connect-old",
      botToken: "xoxb-old-token",
      botUserId: "U123",
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      installedByUserId: "user-1",
      nowMs: NOW_MS,
      organizationId: "org-existing",
      slackTeamId: "T123",
    });
    await harness.query({
      values: ["member-new", "org-new", "user-shared", "member", NOW_MS],
      text: `
        INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
    });
    await harness.query({
      values: [
        "org-existing",
        "T123",
        "U-SHARED",
        "user-shared",
        "explicit",
        NOW_MS,
      ],
      text: `
        INSERT INTO "openmeld"."slack_user_identity_links" (
          organization_id,
          slack_team_id,
          slack_user_id,
          openmeld_user_id,
          source,
          created_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
    });
    await harness.query({
      values: [
        "org-existing",
        "T123",
        "U-OLD-ONLY",
        "user-old-only",
        "email_auto",
        NOW_MS,
      ],
      text: `
        INSERT INTO "openmeld"."slack_user_identity_links" (
          organization_id,
          slack_team_id,
          slack_user_id,
          openmeld_user_id,
          source,
          created_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
    });
    const result = await installSlackWorkspaceFromOAuth({
      actorProfileId: "22222222-2222-4222-8222-222222222222",
      auditEntryId: "audit-connect-new",
      botToken: "xoxb-new-token",
      botUserId: "U456",
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      installedByUserId: "user-2",
      moveAuditEntryId: "audit-move-old",
      moveFromOrganizationId: "org-existing",
      nowMs: NOW_MS + 1,
      organizationId: "org-new",
      slackTeamId: "T123",
    });
    expect(result).toMatchObject({
      record: { organizationId: "org-new", slackTeamId: "T123" },
      status: "moved",
    });
    await expect(
      resolveSlackBotToken({
        cryptoKey: CRYPTO_KEY,
        db: harness.db,
        fallbackBotToken: null,
        slackTeamId: "T123",
      })
    ).resolves.toBe("xoxb-new-token");
    expect(
      await harness.queryFirst({
        values: ["T123"],
        text: 'SELECT organization_id, installed_by_user_id FROM "openmeld"."slack_workspace_tokens" WHERE slack_team_id = $1',
      })
    ).toEqual({
      installed_by_user_id: "user-2",
      organization_id: "org-new",
    });
    expect(
      await harness.queryAll({
        text: 'SELECT action, organization_id FROM "openmeld"."center_agent_audit_journal" ORDER BY created_at, id',
      })
    ).toEqual([
      {
        action: "connect_slack_workspace",
        organization_id: "org-existing",
      },
      { action: "connect_slack_workspace", organization_id: "org-new" },
      { action: "move_slack_workspace", organization_id: "org-existing" },
    ]);
    expect(
      await harness.queryAll({
        values: ["T123"],
        text: `
          SELECT organization_id, slack_user_id, openmeld_user_id
          FROM "openmeld"."slack_user_identity_links"
          WHERE slack_team_id = $1
          ORDER BY slack_user_id
        `,
      })
    ).toEqual([
      {
        organization_id: "org-new",
        slack_user_id: "U-SHARED",
        openmeld_user_id: "user-shared",
      },
    ]);
  });
  it("keeps the old binding and token when a confirmed move fails halfway", async () => {
    await installSlackWorkspaceFromOAuth({
      actorProfileId: "11111111-1111-4111-8111-111111111111",
      auditEntryId: "audit-connect-old",
      botToken: "xoxb-old-token",
      botUserId: "U123",
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      installedByUserId: "user-1",
      nowMs: NOW_MS,
      organizationId: "org-existing",
      slackTeamId: "T123",
    });
    await installPostgresWriteFailure({
      harness,
      table: "center_agent_audit_journal",
      operation: "INSERT",
      condition: "NEW.organization_id = 'org-new'",
      message: "new organization audit rejected",
    });
    await expect(
      installSlackWorkspaceFromOAuth({
        actorProfileId: "22222222-2222-4222-8222-222222222222",
        auditEntryId: "audit-connect-new",
        botToken: "xoxb-new-token",
        botUserId: "U456",
        cryptoKey: CRYPTO_KEY,
        db: harness.db,
        installedByUserId: "user-2",
        moveAuditEntryId: "audit-move-old",
        moveFromOrganizationId: "org-existing",
        nowMs: NOW_MS + 1,
        organizationId: "org-new",
        slackTeamId: "T123",
      })
    ).rejects.toThrow("new organization audit rejected");
    await expect(
      readRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        slackTeamId: "T123",
      })
    ).resolves.toMatchObject({ organizationId: "org-existing" });
    await expect(
      resolveSlackBotToken({
        cryptoKey: CRYPTO_KEY,
        db: harness.db,
        fallbackBotToken: null,
        slackTeamId: "T123",
      })
    ).resolves.toBe("xoxb-old-token");
    expect(
      await harness.queryFirst({
        values: ["org-new"],
        text: 'SELECT id FROM "openmeld"."center_agent_audit_journal" WHERE organization_id = $1',
      })
    ).toBeNull();
  });
  it("refuses a confirmed move when the expected previous organization changed", async () => {
    await installSlackWorkspaceFromOAuth({
      actorProfileId: "11111111-1111-4111-8111-111111111111",
      auditEntryId: "audit-connect-old",
      botToken: "xoxb-old-token",
      botUserId: "U123",
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      installedByUserId: "user-1",
      nowMs: NOW_MS,
      organizationId: "org-current",
      slackTeamId: "T123",
    });
    const result = await installSlackWorkspaceFromOAuth({
      actorProfileId: "22222222-2222-4222-8222-222222222222",
      auditEntryId: "audit-connect-new",
      botToken: "xoxb-new-token",
      botUserId: "U456",
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      installedByUserId: "user-2",
      moveAuditEntryId: "audit-move-old",
      moveFromOrganizationId: "org-stale",
      nowMs: NOW_MS + 1,
      organizationId: "org-new",
      slackTeamId: "T123",
    });
    expect(result).toMatchObject({
      existing: { organizationId: "org-current" },
      status: "workspace_already_bound",
    });
    await expect(
      readRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        slackTeamId: "T123",
      })
    ).resolves.toMatchObject({ organizationId: "org-current" });
    await expect(
      resolveSlackBotToken({
        cryptoKey: CRYPTO_KEY,
        db: harness.db,
        fallbackBotToken: null,
        slackTeamId: "T123",
      })
    ).resolves.toBe("xoxb-old-token");
  });
  it("rolls back when the previous binding disappears after the ownership read", async () => {
    await installSlackWorkspaceFromOAuth({
      actorProfileId: "11111111-1111-4111-8111-111111111111",
      auditEntryId: "audit-connect-old",
      botToken: "xoxb-old-token",
      botUserId: "U123",
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      installedByUserId: "user-1",
      nowMs: NOW_MS,
      organizationId: "org-existing",
      slackTeamId: "T123",
    });
    const racingDb = createDisconnectBeforeBatchDb(harness, "T123");
    await expect(
      installSlackWorkspaceFromOAuth({
        actorProfileId: "22222222-2222-4222-8222-222222222222",
        auditEntryId: "audit-connect-new",
        botToken: "xoxb-new-token",
        botUserId: "U456",
        cryptoKey: CRYPTO_KEY,
        db: racingDb,
        installedByUserId: "user-2",
        moveAuditEntryId: "audit-move-old",
        moveFromOrganizationId: "org-existing",
        nowMs: NOW_MS + 1,
        organizationId: "org-new",
        slackTeamId: "T123",
      })
    ).rejects.toThrow();
    await expect(
      readRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        slackTeamId: "T123",
      })
    ).resolves.toBeNull();
    expect(
      await harness.queryFirst({
        values: ["T123"],
        text: 'SELECT organization_id FROM "openmeld"."slack_workspace_tokens" WHERE slack_team_id = $1',
      })
    ).toBeNull();
    expect(
      await harness.queryFirst({
        values: ["org-new"],
        text: 'SELECT id FROM "openmeld"."center_agent_audit_journal" WHERE organization_id = $1',
      })
    ).toBeNull();
  });
  it("does not refresh a token when an unchanged binding disappears after the ownership read", async () => {
    await installSlackWorkspaceFromOAuth({
      actorProfileId: "11111111-1111-4111-8111-111111111111",
      auditEntryId: "audit-connect-old",
      botToken: "xoxb-old-token",
      botUserId: "U123",
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      installedByUserId: "user-1",
      nowMs: NOW_MS,
      organizationId: "org-existing",
      slackTeamId: "T123",
    });
    const racingDb = createDisconnectBeforeBatchDb(harness, "T123");
    await expect(
      installSlackWorkspaceFromOAuth({
        actorProfileId: "11111111-1111-4111-8111-111111111111",
        auditEntryId: "audit-unused",
        botToken: "xoxb-refreshed-token",
        botUserId: "U456",
        cryptoKey: CRYPTO_KEY,
        db: racingDb,
        installedByUserId: "user-1",
        moveAuditEntryId: "audit-unused-move",
        moveFromOrganizationId: "org-existing",
        nowMs: NOW_MS + 1,
        organizationId: "org-existing",
        slackTeamId: "T123",
      })
    ).rejects.toThrow();
    expect(
      await harness.queryFirst({
        values: ["T123"],
        text: 'SELECT organization_id FROM "openmeld"."slack_workspace_tokens" WHERE slack_team_id = $1',
      })
    ).toBeNull();
  });
  it("preserves the existing one-workspace-per-organization guard", async () => {
    await createRemoteAgentSlackWorkspaceBinding({
      db: harness.db,
      nowMs: NOW_MS,
      organizationId: "org-1",
      slackTeamId: "T123",
    });
    const result = await installSlackWorkspaceFromOAuth({
      actorProfileId: "11111111-1111-4111-8111-111111111111",
      auditEntryId: "audit-2",
      botToken: "xoxb-other-token",
      botUserId: "U999",
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      installedByUserId: "user-1",
      nowMs: NOW_MS + 1,
      organizationId: "org-1",
      slackTeamId: "T999",
    });
    expect(result).toMatchObject({
      existing: { organizationId: "org-1", slackTeamId: "T123" },
      status: "organization_already_bound",
    });
  });
  it("removes the workspace token with the existing disconnect flow", async () => {
    await installSlackWorkspaceFromOAuth({
      actorProfileId: "11111111-1111-4111-8111-111111111111",
      auditEntryId: "audit-1",
      botToken: "xoxb-installed-token",
      botUserId: "U123",
      cryptoKey: CRYPTO_KEY,
      db: harness.db,
      installedByUserId: "user-1",
      nowMs: NOW_MS,
      organizationId: "org-1",
      slackTeamId: "T123",
    });
    await deleteRemoteAgentSlackWorkspaceBindingByOrganization({
      atomicDeleteStatements: [
        prepareDeleteSlackWorkspaceTokenByOrganizationStatement({
          db: harness.db,
          organizationId: "org-1",
        }),
      ],
      db: harness.db,
      organizationId: "org-1",
    });
    await expect(
      readRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        slackTeamId: "T123",
      })
    ).resolves.toBeNull();
    expect(
      await harness.queryFirst({
        values: ["org-1"],
        text: 'SELECT slack_team_id FROM "openmeld"."slack_workspace_tokens" WHERE organization_id = $1',
      })
    ).toBeNull();
  });
});
function createDisconnectBeforeBatchDb(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  slackTeamId: string
): PostgresDatabase {
  return createBeforeMatchingPostgresTransaction({
    db: harness.db,
    matches: (sql) => MUTATION_QUERY_PATTERN.test(sql),
    beforeTransaction: async () => {
      await harness.query({
        text: 'DELETE FROM "openmeld"."slack_workspace_tokens" WHERE slack_team_id = $1',
        values: [slackTeamId],
      });
      await harness.query({
        text: 'DELETE FROM "openmeld"."openMeldRemoteAgent_slack_workspace_bindings" WHERE slack_team_id = $1',
        values: [slackTeamId],
      });
    },
  });
}
function createRpcEnv(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): CoreBindings {
  return {
    WEB_APP_URL: "https://openmeld.test",
    OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
    SLACK_OPENMELD_TOKEN_CRYPTO_KEY: CRYPTO_KEY,
  } as CoreBindings;
}
async function insertOrganizationOwner(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    organizationId?: string;
    organizationSlug?: string;
    personal?: boolean;
    userId?: string;
  } = {}
): Promise<void> {
  const organizationId = input.organizationId ?? "org-1";
  const organizationSlug = input.organizationSlug ?? "acme";
  const userId = input.userId ?? "openmeld-user-1";
  await harness.query({
    values: [
      organizationId,
      organizationSlug,
      input.personal ? JSON.stringify({ personal: true }) : null,
    ],
    text: `
      INSERT INTO "openmeld"."organizations" (id, name, slug, metadata, created_at)
      VALUES ($1, $2, $2, $3, 1000) ON CONFLICT (id) DO UPDATE SET slug = excluded.slug, metadata = excluded.metadata`,
  });
  await harness.query({
    values: [
      `member-${organizationId}-${userId}`,
      organizationId,
      userId,
      "owner",
      NOW_MS,
    ],
    text: `
      INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
  });
}
async function readWelcomeDelivery(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<Record<string, unknown> | null> {
  return await harness.queryFirst({
    text: `
      SELECT
        slack_team_id,
        organization_id,
        recipient_slack_user_id,
        welcome_version,
        message_kind,
        status,
        attempt_count,
        message_ts,
        failure_code
      FROM "openmeld"."slack_installation_welcome_deliveries"
      ORDER BY created_at_ms DESC
      LIMIT 1
    `,
  });
}
async function readWelcomePreparation(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>
): Promise<Record<string, unknown> | null> {
  return await harness.queryFirst({
    text: `
      SELECT
        slack_team_id,
        organization_id,
        recipient_slack_user_id,
        welcome_version,
        message_kind,
        installed_by_user_id,
        installed_by_profile_id,
        status,
        failure_code
      FROM "openmeld"."slack_installation_welcome_preparations"
      ORDER BY created_at_ms DESC
      LIMIT 1
    `,
  });
}
