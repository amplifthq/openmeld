import { prepareCenterAgentAuditJournalEntryStatement } from "../../center-agent/center-agent-repository";
import {
  prepareReconcileSlackUserIdentityLinksForWorkspaceMoveStatements,
  prepareUpsertSlackOAuthInstallerIdentityLinkStatement,
} from "../infrastructure/d1/slack-user-identity-link-repo";
import {
  createRemoteAgentSlackWorkspaceBinding,
  moveRemoteAgentSlackWorkspaceBinding,
  type RemoteAgentSlackWorkspaceBindingCreateResult,
  type RemoteAgentSlackWorkspaceBindingMoveResult,
} from "../infrastructure/d1/slack-workspace-binding-repo";
import { prepareUpsertSlackWorkspaceTokenStatement } from "../infrastructure/d1/slack-workspace-token-repo";
import { encryptSlackBotToken } from "./slack-token-crypto";

export async function installSlackWorkspaceFromOAuth(input: {
  actorProfileId: string;
  auditEntryId: string;
  botScopes?: readonly string[];
  botToken: string;
  botUserId: string;
  cryptoKey: string;
  db: D1Database;
  installedByUserId: string;
  moveAuditEntryId?: string | null;
  moveFromOrganizationId?: string | null;
  nowMs: number;
  organizationId: string;
  slackInstallerUserId?: string | null;
  slackTeamId: string;
}): Promise<
  | RemoteAgentSlackWorkspaceBindingCreateResult
  | RemoteAgentSlackWorkspaceBindingMoveResult
> {
  const actorProfileId = requireNonEmptyText(
    input.actorProfileId,
    "actor profile id"
  );
  const auditEntryId = requireNonEmptyText(
    input.auditEntryId,
    "audit entry id"
  );
  const botToken = requireNonEmptyText(input.botToken, "bot token");
  const botUserId = requireNonEmptyText(input.botUserId, "bot user id");
  const installedByUserId = requireNonEmptyText(
    input.installedByUserId,
    "installer user id"
  );
  const organizationId = requireNonEmptyText(
    input.organizationId,
    "organization id"
  );
  const moveFromOrganizationId = normalizeOptionalText(
    input.moveFromOrganizationId
  );
  const slackTeamId = requireNonEmptyText(input.slackTeamId, "workspace id");
  const slackInstallerUserId = normalizeOptionalText(
    input.slackInstallerUserId
  );
  const encryptedBotToken = await encryptSlackBotToken({
    botToken,
    cryptoKey: input.cryptoKey,
  });
  const tokenStatement = prepareUpsertSlackWorkspaceTokenStatement({
    db: input.db,
    record: {
      botUserId,
      createdAtMs: input.nowMs,
      encryptedBotToken,
      grantedBotScopes: normalizeScopes(input.botScopes),
      installedByUserId,
      organizationId,
      slackTeamId,
      updatedAtMs: input.nowMs,
    },
  });
  const auditStatement = prepareCenterAgentAuditJournalEntryStatement({
    action: "connect_slack_workspace",
    actorProfileId,
    attribution: { actorProfileId, onBehalfOf: null },
    db: input.db,
    id: auditEntryId,
    nowMs: input.nowMs,
    organizationId,
    resource: { id: slackTeamId, type: "slack_workspace" },
  });
  const installerIdentityLinkStatement = slackInstallerUserId
    ? prepareUpsertSlackOAuthInstallerIdentityLinkStatement({
        db: input.db,
        nowMs: input.nowMs,
        openmeldUserId: installedByUserId,
        organizationId,
        slackTeamId,
        slackUserId: slackInstallerUserId,
      })
    : null;

  if (moveFromOrganizationId) {
    const moveAuditEntryId = requireNonEmptyText(
      input.moveAuditEntryId ?? "",
      "move audit entry id"
    );
    const moveAuditStatement = prepareCenterAgentAuditJournalEntryStatement({
      action: "move_slack_workspace",
      actorProfileId,
      attribution: { actorProfileId, onBehalfOf: null },
      db: input.db,
      id: moveAuditEntryId,
      nowMs: input.nowMs,
      organizationId: moveFromOrganizationId,
      resource: { id: slackTeamId, type: "slack_workspace" },
    });
    const identityLinkStatements =
      prepareReconcileSlackUserIdentityLinksForWorkspaceMoveStatements({
        db: input.db,
        organizationId,
        slackTeamId,
      });
    return await moveRemoteAgentSlackWorkspaceBinding({
      atomicMoveStatements: [
        tokenStatement,
        auditStatement,
        moveAuditStatement,
        ...identityLinkStatements,
        ...(installerIdentityLinkStatement
          ? [installerIdentityLinkStatement]
          : []),
      ],
      atomicUnchangedStatements: [
        tokenStatement,
        ...(installerIdentityLinkStatement
          ? [installerIdentityLinkStatement]
          : []),
      ],
      db: input.db,
      fromOrganizationId: moveFromOrganizationId,
      nowMs: input.nowMs,
      organizationId,
      slackTeamId,
    });
  }

  return await createRemoteAgentSlackWorkspaceBinding({
    atomicWrites: {
      onCreated: [auditStatement],
      onSuccess: [
        tokenStatement,
        ...(installerIdentityLinkStatement
          ? [installerIdentityLinkStatement]
          : []),
      ],
    },
    db: input.db,
    nowMs: input.nowMs,
    organizationId,
    slackTeamId,
  });
}

function normalizeScopes(
  value: readonly string[] | undefined
): string[] | null {
  if (!value) {
    return null;
  }
  const scopes = [
    ...new Set(value.map((scope) => scope.trim()).filter(Boolean)),
  ].sort();
  return scopes.length > 0 ? scopes : null;
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function requireNonEmptyText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Slack OAuth ${fieldName} is required`);
  }
  return normalized;
}
