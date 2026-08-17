import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { resolveSlackBotToken } from "../src/remote-agent/application/slack-bot-token";
import { deliverSlackInstallationWelcome } from "../src/remote-agent/application/slack-installation-welcome-service";
import { installSlackWorkspaceFromOAuth } from "../src/remote-agent/application/slack-oauth-installation";
import { readSlackUserIdentityLink } from "../src/remote-agent/infrastructure/d1/slack-user-identity-link-repo";
import {
  createRemoteAgentSlackWorkspaceBinding,
  deleteRemoteAgentSlackWorkspaceBindingByOrganization,
  readRemoteAgentSlackWorkspaceBinding,
} from "../src/remote-agent/infrastructure/d1/slack-workspace-binding-repo";
import {
  prepareDeleteSlackWorkspaceTokenByOrganizationStatement,
  readSlackWorkspaceToken,
} from "../src/remote-agent/infrastructure/d1/slack-workspace-token-repo";
import { rpcInstallSlackWorkspaceFromOAuth } from "../src/rpc/methods";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

const CRYPTO_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const NOW_MS = Date.parse("2026-07-10T00:00:00.000Z");
const RPC_INSTALLATION_INPUT = {
  actorProfileId: "human-1",
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
  let harness: ReturnType<typeof createSqliteD1Harness>;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    harness.run({
      sql: `
        CREATE TABLE openMeldRemoteAgent_slack_workspace_bindings (
          slack_team_id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        )
      `,
    });
    harness.run({
      sql: `
        CREATE UNIQUE INDEX openMeldRemoteAgent_slack_workspace_org_unique
        ON openMeldRemoteAgent_slack_workspace_bindings (organization_id)
      `,
    });
    harness.run({
      sql: `
        CREATE TABLE slack_workspace_tokens (
          slack_team_id TEXT PRIMARY KEY,
          encrypted_bot_token TEXT NOT NULL,
          bot_user_id TEXT NOT NULL,
          granted_bot_scopes TEXT,
          installed_by_user_id TEXT NOT NULL,
          organization_id TEXT NOT NULL UNIQUE,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        )
      `,
    });
    harness.run({
      sql: `
        CREATE TABLE center_agent_audit_journal (
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
        CREATE TABLE organizations (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          metadata TEXT
        )
      `,
    });
    harness.run({
      sql: `
        CREATE TABLE slack_user_identity_links (
          organization_id TEXT NOT NULL,
          slack_team_id TEXT NOT NULL,
          slack_user_id TEXT NOT NULL,
          openmeld_user_id TEXT NOT NULL,
          source TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          UNIQUE (slack_team_id, slack_user_id)
        )
      `,
    });
    harness.run({
      sql: `
        CREATE TABLE slack_installation_welcome_deliveries (
          slack_team_id TEXT NOT NULL,
          organization_id TEXT NOT NULL,
          recipient_slack_user_id TEXT NOT NULL,
          connection_created_at_ms INTEGER NOT NULL,
          welcome_version INTEGER NOT NULL,
          message_kind TEXT NOT NULL,
          status TEXT NOT NULL,
          claim_id TEXT NOT NULL,
          attempt_count INTEGER NOT NULL,
          message_ts TEXT,
          failure_code TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          PRIMARY KEY (
            slack_team_id,
            organization_id,
            recipient_slack_user_id,
            connection_created_at_ms,
            welcome_version
          )
        )
      `,
    });
    harness.run({
      sql: `
        CREATE TABLE slack_installation_welcome_preparations (
          slack_team_id TEXT NOT NULL,
          organization_id TEXT NOT NULL,
          recipient_slack_user_id TEXT NOT NULL,
          connection_created_at_ms INTEGER NOT NULL,
          welcome_version INTEGER NOT NULL,
          message_kind TEXT NOT NULL,
          installed_by_user_id TEXT NOT NULL,
          installed_by_profile_id TEXT NOT NULL,
          status TEXT NOT NULL,
          claim_id TEXT,
          research_task_id TEXT,
          failure_code TEXT,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL,
          PRIMARY KEY (
            slack_team_id,
            organization_id,
            recipient_slack_user_id,
            connection_created_at_ms,
            welcome_version
          )
        )
      `,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    harness.close();
  });

  it("queues trust-first preparation instead of sending an immediate welcome", async () => {
    insertOrganizationOwner(harness);
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
    expect(readWelcomePreparation(harness)).toEqual({
      installed_by_profile_id: "human-1",
      installed_by_user_id: "openmeld-user-1",
      message_kind: "connected",
      failure_code: null,
      organization_id: "org-1",
      recipient_slack_user_id: "U_INSTALLER",
      slack_team_id: "T_WORKSPACE",
      status: "queued",
      welcome_version: 2,
    });
    expect(readWelcomeDelivery(harness)).toBeNull();
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
    insertOrganizationOwner(harness, { personal: true });

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
    insertOrganizationOwner(harness);
    await installSlackWorkspaceFromOAuth({
      actorProfileId: "human-1",
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
      actorProfileId: "human-old",
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
    insertOrganizationOwner(harness);
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
    expect(readWelcomePreparation(harness)).toMatchObject({
      message_kind: "moved",
      status: "queued",
    });
  });

  it("rolls back the installation when its durable welcome preparation cannot be queued", async () => {
    insertOrganizationOwner(harness);
    harness.run({
      sql: `
        CREATE TRIGGER reject_welcome_preparation
        BEFORE INSERT ON slack_installation_welcome_preparations
        BEGIN
          SELECT RAISE(ABORT, 'preparation rejected');
        END
      `,
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
      harness.queryFirst({
        sql: "SELECT slack_team_id FROM slack_workspace_tokens LIMIT 1",
      })
    ).toBeNull();
    expect(
      harness.queryFirst({
        sql: "SELECT id FROM center_agent_audit_journal LIMIT 1",
      })
    ).toBeNull();
    expect(readWelcomePreparation(harness)).toBeNull();
  });

  it("preserves the Slack publication error when recording its outcome also fails", async () => {
    harness.run({
      sql: `
        CREATE TRIGGER reject_welcome_completion
        BEFORE UPDATE OF status ON slack_installation_welcome_deliveries
        WHEN NEW.status != 'pending'
        BEGIN
          SELECT RAISE(ABORT, 'welcome completion rejected');
        END
      `,
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
    harness.run({
      sql: `
        CREATE TRIGGER reject_delivered_welcome_checkpoint
        BEFORE UPDATE OF status ON slack_installation_welcome_deliveries
        WHEN NEW.status = 'delivered'
        BEGIN
          SELECT RAISE(ABORT, 'delivered checkpoint rejected');
        END
      `,
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
    expect(readWelcomeDelivery(harness)).toMatchObject({
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
    insertOrganizationOwner(harness);

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
      harness.queryAll({
        sql: "SELECT status FROM slack_installation_welcome_preparations",
      })
    ).toEqual([{ status: "queued" }]);
  });

  it("repairs a historically missing welcome preparation on OAuth reauthorization", async () => {
    insertOrganizationOwner(harness);
    await rpcInstallSlackWorkspaceFromOAuth(
      createRpcEnv(harness),
      RPC_INSTALLATION_INPUT
    );
    harness.run({
      sql: "DELETE FROM slack_installation_welcome_preparations",
    });

    await expect(
      rpcInstallSlackWorkspaceFromOAuth(
        createRpcEnv(harness),
        RPC_INSTALLATION_INPUT
      )
    ).resolves.toEqual({ status: "unchanged" });

    expect(readWelcomePreparation(harness)).toMatchObject({
      message_kind: "connected",
      status: "queued",
    });
  });

  it("authorizes one failed welcome retry when the installer reauthorizes Slack", async () => {
    insertOrganizationOwner(harness);
    await rpcInstallSlackWorkspaceFromOAuth(
      createRpcEnv(harness),
      RPC_INSTALLATION_INPUT
    );
    harness.run({
      sql: `UPDATE slack_installation_welcome_preparations
        SET status = 'failed', claim_id = 'claim-1',
          research_task_id = 'research-1', failure_code = 'slack_delivery_failed'`,
    });
    harness.run({
      params: [NOW_MS, NOW_MS],
      sql: `INSERT INTO slack_installation_welcome_deliveries (
        slack_team_id, organization_id, recipient_slack_user_id,
        connection_created_at_ms, welcome_version, message_kind, status,
        claim_id, attempt_count, message_ts, failure_code, created_at_ms,
        updated_at_ms
      ) SELECT
        slack_team_id, organization_id, recipient_slack_user_id,
        connection_created_at_ms, welcome_version, message_kind,
        'failed', 'delivery-claim-1', 1, NULL, 'channel_not_found', ?, ?
      FROM slack_installation_welcome_preparations`,
    });

    await expect(
      rpcInstallSlackWorkspaceFromOAuth(
        createRpcEnv(harness),
        RPC_INSTALLATION_INPUT
      )
    ).resolves.toEqual({ status: "unchanged" });

    expect(
      harness.queryFirst({
        sql: `SELECT status, failure_code, research_task_id
          FROM slack_installation_welcome_preparations`,
      })
    ).toEqual({
      failure_code: "slack_delivery_retry_authorized",
      research_task_id: "research-1",
      status: "ready",
    });
  });

  it("stores the encrypted bot token and workspace binding together", async () => {
    const result = await installSlackWorkspaceFromOAuth({
      actorProfileId: "human-1",
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
      harness.queryFirst({
        sql: "SELECT action, resource_id FROM center_agent_audit_journal LIMIT 1",
      })
    ).toEqual({
      action: "connect_slack_workspace",
      resource_id: "T123",
    });
  });

  it("rolls back the workspace binding when token storage fails", async () => {
    harness.run({
      sql: `
        CREATE TRIGGER reject_slack_token
        BEFORE INSERT ON slack_workspace_tokens
        BEGIN
          SELECT RAISE(ABORT, 'token rejected');
        END
      `,
    });

    await expect(
      installSlackWorkspaceFromOAuth({
        actorProfileId: "human-1",
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
      harness.queryFirst({
        sql: "SELECT id FROM center_agent_audit_journal LIMIT 1",
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
      actorProfileId: "human-2",
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
      harness.queryFirst({
        params: ["T123"],
        sql: "SELECT slack_team_id FROM slack_workspace_tokens WHERE slack_team_id = ?",
      })
    ).toBeNull();
  });

  it("moves the workspace, token ownership, and old-organization audit atomically", async () => {
    await installSlackWorkspaceFromOAuth({
      actorProfileId: "human-1",
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
    harness.run({
      params: ["member-new", "org-new", "user-shared", "member", NOW_MS],
      sql: `
        INSERT INTO members (id, organization_id, user_id, role, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
    });
    harness.run({
      params: [
        "org-existing",
        "T123",
        "U-SHARED",
        "user-shared",
        "explicit",
        NOW_MS,
      ],
      sql: `
        INSERT INTO slack_user_identity_links (
          organization_id,
          slack_team_id,
          slack_user_id,
          openmeld_user_id,
          source,
          created_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    });
    harness.run({
      params: [
        "org-existing",
        "T123",
        "U-OLD-ONLY",
        "user-old-only",
        "email_auto",
        NOW_MS,
      ],
      sql: `
        INSERT INTO slack_user_identity_links (
          organization_id,
          slack_team_id,
          slack_user_id,
          openmeld_user_id,
          source,
          created_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    });

    const result = await installSlackWorkspaceFromOAuth({
      actorProfileId: "human-2",
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
      harness.queryFirst({
        params: ["T123"],
        sql: "SELECT organization_id, installed_by_user_id FROM slack_workspace_tokens WHERE slack_team_id = ?",
      })
    ).toEqual({
      installed_by_user_id: "user-2",
      organization_id: "org-new",
    });
    expect(
      harness.queryAll({
        sql: "SELECT action, organization_id FROM center_agent_audit_journal ORDER BY created_at, id",
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
      harness.queryAll({
        params: ["T123"],
        sql: `
          SELECT organization_id, slack_user_id, openmeld_user_id
          FROM slack_user_identity_links
          WHERE slack_team_id = ?
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
      actorProfileId: "human-1",
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
    harness.run({
      sql: `
        CREATE TRIGGER reject_new_organization_audit
        BEFORE INSERT ON center_agent_audit_journal
        WHEN NEW.organization_id = 'org-new'
        BEGIN
          SELECT RAISE(ABORT, 'new organization audit rejected');
        END
      `,
    });

    await expect(
      installSlackWorkspaceFromOAuth({
        actorProfileId: "human-2",
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
      harness.queryFirst({
        params: ["org-new"],
        sql: "SELECT id FROM center_agent_audit_journal WHERE organization_id = ?",
      })
    ).toBeNull();
  });

  it("refuses a confirmed move when the expected previous organization changed", async () => {
    await installSlackWorkspaceFromOAuth({
      actorProfileId: "human-1",
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
      actorProfileId: "human-2",
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
      actorProfileId: "human-1",
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
        actorProfileId: "human-2",
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
      harness.queryFirst({
        params: ["T123"],
        sql: "SELECT organization_id FROM slack_workspace_tokens WHERE slack_team_id = ?",
      })
    ).toBeNull();
    expect(
      harness.queryFirst({
        params: ["org-new"],
        sql: "SELECT id FROM center_agent_audit_journal WHERE organization_id = ?",
      })
    ).toBeNull();
  });

  it("does not refresh a token when an unchanged binding disappears after the ownership read", async () => {
    await installSlackWorkspaceFromOAuth({
      actorProfileId: "human-1",
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
        actorProfileId: "human-1",
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
      harness.queryFirst({
        params: ["T123"],
        sql: "SELECT organization_id FROM slack_workspace_tokens WHERE slack_team_id = ?",
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
      actorProfileId: "human-1",
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
      actorProfileId: "human-1",
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
      harness.queryFirst({
        params: ["org-1"],
        sql: "SELECT slack_team_id FROM slack_workspace_tokens WHERE organization_id = ?",
      })
    ).toBeNull();
  });
});

function createDisconnectBeforeBatchDb(
  harness: ReturnType<typeof createSqliteD1Harness>,
  slackTeamId: string
): D1Database {
  let disconnected = false;
  return {
    batch: async (statements) => {
      if (!disconnected) {
        harness.run({
          params: [slackTeamId],
          sql: "DELETE FROM slack_workspace_tokens WHERE slack_team_id = ?",
        });
        harness.run({
          params: [slackTeamId],
          sql: "DELETE FROM openMeldRemoteAgent_slack_workspace_bindings WHERE slack_team_id = ?",
        });
        disconnected = true;
      }
      return await harness.db.batch(statements);
    },
    prepare: (sql) => harness.db.prepare(sql),
  } as D1Database;
}

function createRpcEnv(
  harness: ReturnType<typeof createSqliteD1Harness>
): CoreBindings {
  return {
    WEB_APP_URL: "https://openmeld.test",
    OPENMELD_DB: harness.db,
    SLACK_OPENMELD_TOKEN_CRYPTO_KEY: CRYPTO_KEY,
  } as CoreBindings;
}

function insertOrganizationOwner(
  harness: ReturnType<typeof createSqliteD1Harness>,
  input: {
    organizationId?: string;
    organizationSlug?: string;
    personal?: boolean;
    userId?: string;
  } = {}
): void {
  const organizationId = input.organizationId ?? "org-1";
  const organizationSlug = input.organizationSlug ?? "acme";
  const userId = input.userId ?? "openmeld-user-1";
  harness.run({
    params: [
      organizationId,
      organizationSlug,
      input.personal ? JSON.stringify({ personal: true }) : null,
    ],
    sql: `
      INSERT OR IGNORE INTO organizations (id, slug, metadata)
      VALUES (?, ?, ?)
    `,
  });
  harness.run({
    params: [
      `member-${organizationId}-${userId}`,
      organizationId,
      userId,
      "owner",
      NOW_MS,
    ],
    sql: `
      INSERT INTO members (id, organization_id, user_id, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
  });
}

function readWelcomeDelivery(
  harness: ReturnType<typeof createSqliteD1Harness>
): Record<string, unknown> | null {
  return harness.queryFirst({
    sql: `
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
      FROM slack_installation_welcome_deliveries
      ORDER BY created_at_ms DESC
      LIMIT 1
    `,
  });
}

function readWelcomePreparation(
  harness: ReturnType<typeof createSqliteD1Harness>
): Record<string, unknown> | null {
  return harness.queryFirst({
    sql: `
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
      FROM slack_installation_welcome_preparations
      ORDER BY created_at_ms DESC
      LIMIT 1
    `,
  });
}
