import { SLACK_BOT_SCOPES } from "@openmeld/schemas";
import {
  requireAuthorizationUpdateInbox,
  resolveAuthorizationUpdateInbox,
} from "../../inbox/application/authorization-update-inbox";
import type { InboxSourceWriteGuard } from "../../inbox/infrastructure/d1/inbox-item-repo";
import { type CoreBindings, localStateDb } from "../../lib/bindings";
import { resolveOrganizationDirectoryMembers } from "../../organizations/organization-directory";
import { listRemoteAgentLarkPlatformChannelConnectionsForOrganization } from "../infrastructure/d1/lark-platform-channel-connection-repo";
import { readRemoteAgentSlackWorkspaceBindingByOrganization } from "../infrastructure/d1/slack-workspace-binding-repo";
import { readSlackWorkspaceToken } from "../infrastructure/d1/slack-workspace-token-repo";
import {
  LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE,
  requiresLarkPlatformAuthorizationUpdate,
} from "./lark-platform-permission-bundles";

type Requirement = {
  sourceId: string;
  revision: string;
  displayName: string;
  required: boolean | null;
  occurredAtMs: number;
  guard: InboxSourceWriteGuard;
};

async function readChannelAuthorizationRequirements(input: {
  env: CoreBindings;
  organizationId: string;
  nowMs: number;
}): Promise<{ db: D1Database; requirements: Requirement[] } | null> {
  const db = localStateDb(input.env);
  if (!db) {
    return null;
  }
  const requirements: Requirement[] = [];
  const lark =
    await listRemoteAgentLarkPlatformChannelConnectionsForOrganization({
      db,
      organizationId: input.organizationId,
    });
  for (const connection of lark) {
    requirements.push({
      sourceId: `channel.${connection.provider}.${connection.connectionId}`,
      revision: LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.version,
      displayName: connection.provider === "feishu" ? "Feishu" : "Lark",
      required: requiresLarkPlatformAuthorizationUpdate(connection),
      occurredAtMs: input.nowMs,
      guard: {
        sql: "EXISTS (SELECT 1 FROM openMeldRemoteAgent_lark_platform_channel_connections WHERE connection_id = ? AND organization_id = ? AND connection_generation = ? AND updated_at_ms = ? AND status = ? AND permission_bundle_version = ?)",
        bindings: [
          connection.connectionId,
          input.organizationId,
          connection.connectionGeneration,
          connection.updatedAtMs,
          connection.status,
          connection.permissionBundleVersion,
        ],
      },
    });
  }
  const binding = await readRemoteAgentSlackWorkspaceBindingByOrganization({
    db,
    organizationId: input.organizationId,
  });
  if (binding) {
    const token = await readSlackWorkspaceToken({
      db,
      slackTeamId: binding.slackTeamId,
    });
    if (token?.organizationId === input.organizationId) {
      const granted = token.grantedBotScopes;
      requirements.push({
        sourceId: `channel.slack.${binding.slackTeamId}`,
        revision: await slackAuthorizationRequirementRevision(),
        displayName: "Slack",
        required: granted
          ? SLACK_BOT_SCOPES.some((scope) => !granted.includes(scope))
          : null,
        occurredAtMs: input.nowMs,
        guard: {
          sql: "EXISTS (SELECT 1 FROM slack_workspace_tokens token JOIN openMeldRemoteAgent_slack_workspace_bindings binding ON binding.slack_team_id = token.slack_team_id AND binding.organization_id = token.organization_id WHERE token.slack_team_id = ? AND token.organization_id = ? AND token.updated_at_ms = ? AND token.granted_bot_scopes IS ?)",
          bindings: [
            binding.slackTeamId,
            input.organizationId,
            token.updatedAtMs,
            granted ? [...granted].sort().join(",") : null,
          ],
        },
      });
    }
  }
  return { db, requirements };
}

export async function reconcileChannelAuthorizationUpdates(input: {
  env: CoreBindings;
  organizationId: string;
  nowMs: number;
}): Promise<void> {
  const current = await readChannelAuthorizationRequirements(input);
  if (!current) {
    return;
  }
  const { db, requirements } = current;
  let members:
    | Awaited<ReturnType<typeof resolveOrganizationDirectoryMembers>>
    | undefined;
  const open = await db
    .prepare(
      "SELECT DISTINCT source_key FROM inbox_items WHERE organization_id = ? AND source_kind = 'system_attention_event' AND source_key LIKE 'authorization-update:channel.%' AND resolution_status = 'open'"
    )
    .bind(input.organizationId)
    .all<{ source_key: string }>();
  for (const row of open.results) {
    const sourceId = row.source_key
      .slice("authorization-update:".length)
      .split(":")[0];
    if (!sourceId || requirements.some((item) => item.sourceId === sourceId)) {
      continue;
    }
    const [, provider, connectionId] = sourceId.split(".");
    if (
      !(connectionId && ["slack", "feishu", "lark"].includes(provider ?? ""))
    ) {
      continue;
    }
    requirements.push({
      sourceId,
      revision: "disconnected",
      displayName: provider ?? "Channel",
      required: false,
      occurredAtMs: input.nowMs,
      guard:
        provider === "slack"
          ? {
              sql: "NOT EXISTS (SELECT 1 FROM openMeldRemoteAgent_slack_workspace_bindings WHERE organization_id = ? AND slack_team_id = ?)",
              bindings: [input.organizationId, connectionId],
            }
          : {
              sql: "NOT EXISTS (SELECT 1 FROM openMeldRemoteAgent_lark_platform_channel_connections WHERE organization_id = ? AND connection_id = ?)",
              bindings: [input.organizationId, connectionId],
            },
    });
  }
  for (const requirement of requirements) {
    if (requirement.required === null) {
      continue;
    }
    const common = {
      db,
      organizationId: input.organizationId,
      sourceId: requirement.sourceId,
      nowMs: input.nowMs,
      sourceGuard: requirement.guard,
    };
    if (!requirement.required) {
      await resolveAuthorizationUpdateInbox(common);
      continue;
    }
    members ??= await resolveOrganizationDirectoryMembers({
      authWorker: input.env.OPENMELD_AUTH_WORKER,
      organizationId: input.organizationId,
    });
    await requireAuthorizationUpdateInbox({
      ...common,
      requirementRevision: requirement.revision,
      displayName: requirement.displayName,
      occurredAtMs: requirement.occurredAtMs,
      target: { kind: "settings", section: "channels" },
      members,
    });
  }
}

/** Bounded repair: already-projected requirements are excluded from discovery. */
export async function reconcileChannelAuthorizationUpdatesTick(input: {
  env: CoreBindings;
  nowMs: number;
}): Promise<void> {
  const db = localStateDb(input.env);
  if (
    !(db && input.env.OPENMELD_AUTH_WORKER?.resolveOrganizationDirectoryMembers)
  ) {
    return;
  }
  const larkVersion = LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.version;
  const slackVersion = await slackAuthorizationRequirementRevision();
  const pending = await db
    .prepare(`
    SELECT DISTINCT organization_id FROM (
      SELECT connection.organization_id FROM openMeldRemoteAgent_lark_platform_channel_connections connection
      WHERE ((connection.status = 'connected' AND connection.permission_bundle_version != ?)
        OR (connection.status = 'configuring' AND connection.failure_reason_code IN (connection.provider || '.application_config_permission_required', connection.provider || '.authorization_update_required', connection.provider || '.permission_bundle_mismatch')))
        AND NOT EXISTS (SELECT 1 FROM inbox_items item WHERE item.organization_id = connection.organization_id AND item.source_kind = 'system_attention_event' AND item.source_key = 'authorization-update:channel.' || connection.provider || '.' || connection.connection_id || ':' || ?)
      UNION ALL
      SELECT token.organization_id FROM slack_workspace_tokens token JOIN openMeldRemoteAgent_slack_workspace_bindings binding ON binding.slack_team_id = token.slack_team_id AND binding.organization_id = token.organization_id
      WHERE token.granted_bot_scopes IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(?) required WHERE instr(',' || token.granted_bot_scopes || ',', ',' || required.value || ',') = 0)
        AND NOT EXISTS (SELECT 1 FROM inbox_items item WHERE item.organization_id = token.organization_id AND item.source_kind = 'system_attention_event' AND item.source_key = 'authorization-update:channel.slack.' || token.slack_team_id || ':' || ?)
      UNION ALL
      SELECT item.organization_id FROM inbox_items item
      WHERE item.source_kind = 'system_attention_event' AND item.source_key LIKE 'authorization-update:channel.%' AND item.resolution_status = 'open'
      AND (
        EXISTS (SELECT 1 FROM openMeldRemoteAgent_lark_platform_channel_connections connection WHERE connection.organization_id = item.organization_id AND instr(item.source_key, 'authorization-update:channel.' || connection.provider || '.' || connection.connection_id || ':') = 1 AND (connection.status = 'disconnected' OR (connection.status = 'connected' AND connection.permission_bundle_version = ?)))
        OR EXISTS (SELECT 1 FROM slack_workspace_tokens token WHERE token.organization_id = item.organization_id AND instr(item.source_key, 'authorization-update:channel.slack.' || token.slack_team_id || ':') = 1 AND token.granted_bot_scopes IS NOT NULL AND NOT EXISTS (SELECT 1 FROM json_each(?) required WHERE instr(',' || token.granted_bot_scopes || ',', ',' || required.value || ',') = 0))
        OR (NOT EXISTS (SELECT 1 FROM openMeldRemoteAgent_lark_platform_channel_connections connection WHERE connection.organization_id = item.organization_id AND instr(item.source_key, 'authorization-update:channel.' || connection.provider || '.' || connection.connection_id || ':') = 1)
          AND NOT EXISTS (SELECT 1 FROM openMeldRemoteAgent_slack_workspace_bindings binding WHERE binding.organization_id = item.organization_id AND instr(item.source_key, 'authorization-update:channel.slack.' || binding.slack_team_id || ':') = 1))
      )
    ) LIMIT 20
  `)
    .bind(
      larkVersion,
      larkVersion,
      JSON.stringify(SLACK_BOT_SCOPES),
      slackVersion,
      larkVersion,
      JSON.stringify(SLACK_BOT_SCOPES)
    )
    .all<{ organization_id: string }>();
  for (const row of pending.results) {
    try {
      await reconcileChannelAuthorizationUpdates({
        ...input,
        organizationId: row.organization_id,
      });
    } catch (error) {
      console.error("[core.channel.authorization_update_projection_failed]", {
        organizationId: row.organization_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function slackAuthorizationRequirementRevision(): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode([...SLACK_BOT_SCOPES].sort().join(","))
    )
  );
  return Array.from(digest.slice(0, 16), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}
