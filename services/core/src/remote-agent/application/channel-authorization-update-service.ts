import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import { SLACK_BOT_SCOPES } from "@openmeld/schemas";
import {
  requireAuthorizationUpdateInbox,
  resolveAuthorizationUpdateInbox,
} from "../../inbox/application/authorization-update-inbox";
import type { InboxSourceWriteGuard } from "../../inbox/infrastructure/postgresql/inbox-item-repo";
import type { CoreBindings } from "../../lib/bindings";
import { resolveOrganizationDirectoryMembers } from "../../organizations/organization-directory";
import { listRemoteAgentLarkPlatformChannelConnectionsForOrganization } from "../infrastructure/postgresql/lark-platform-channel-connection-repo";
import { readRemoteAgentSlackWorkspaceBindingByOrganization } from "../infrastructure/postgresql/slack-workspace-binding-repo";
import { readSlackWorkspaceToken } from "../infrastructure/postgresql/slack-workspace-token-repo";
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
}): Promise<{
  db: PostgresDatabase;
  requirements: Requirement[];
} | null> {
  const db = getPostgresDatabase(input.env);
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
        sql: (offset) =>
          `EXISTS (SELECT 1 FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" WHERE connection_id = $${offset + 1} AND organization_id = $${offset + 2} AND connection_generation = $${offset + 3} AND updated_at_ms = $${offset + 4} AND status = $${offset + 5} AND permission_bundle_version = $${offset + 6})`,
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
          sql: (offset) =>
            `EXISTS (SELECT 1 FROM "openmeld"."slack_workspace_tokens" token JOIN "openmeld"."openMeldRemoteAgent_slack_workspace_bindings" binding ON binding.slack_team_id = token.slack_team_id AND binding.organization_id = token.organization_id WHERE token.slack_team_id = $${offset + 1} AND token.organization_id = $${offset + 2} AND token.updated_at_ms = $${offset + 3} AND token.granted_bot_scopes IS NOT DISTINCT FROM $${offset + 4})`,
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
  const open = await db.query<{
    source_key: string;
  }>({
    text: "SELECT DISTINCT source_key FROM \"openmeld\".\"inbox_items\" WHERE organization_id = $1 AND source_kind = 'system_attention_event' AND source_key ILIKE 'authorization-update:channel.%' AND resolution_status = 'open'",
    values: [input.organizationId],
  });
  for (const row of open.rows) {
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
              sql: (offset) =>
                `NOT EXISTS (SELECT 1 FROM "openmeld"."openMeldRemoteAgent_slack_workspace_bindings" WHERE organization_id = $${offset + 1} AND slack_team_id = $${offset + 2})`,
              bindings: [input.organizationId, connectionId],
            }
          : {
              sql: (offset) =>
                `NOT EXISTS (SELECT 1 FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" WHERE organization_id = $${offset + 1} AND connection_id = $${offset + 2})`,
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
  const db = getPostgresDatabase(input.env);
  if (
    !(db && input.env.OPENMELD_AUTH_WORKER?.resolveOrganizationDirectoryMembers)
  ) {
    return;
  }
  const larkVersion = LARK_PLATFORM_CHANNEL_ONLY_PERMISSION_BUNDLE.version;
  const slackVersion = await slackAuthorizationRequirementRevision();
  const pending = await db.query<{
    organization_id: string;
  }>({
    text: `
    SELECT DISTINCT organization_id FROM (
      SELECT connection.organization_id FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection
      WHERE ((connection.status = 'connected' AND connection.permission_bundle_version != $1)
        OR (connection.status = 'configuring' AND connection.failure_reason_code IN (connection.provider || '.application_config_permission_required', connection.provider || '.authorization_update_required', connection.provider || '.permission_bundle_mismatch')))
        AND NOT EXISTS (SELECT 1 FROM "openmeld"."inbox_items" item WHERE item.organization_id = connection.organization_id AND item.source_kind = 'system_attention_event' AND item.source_key = 'authorization-update:channel.' || connection.provider || '.' || connection.connection_id || ':' || $2)
      UNION ALL
      SELECT token.organization_id FROM "openmeld"."slack_workspace_tokens" token JOIN "openmeld"."openMeldRemoteAgent_slack_workspace_bindings" binding ON binding.slack_team_id = token.slack_team_id AND binding.organization_id = token.organization_id
      WHERE token.granted_bot_scopes IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text($3::jsonb) AS required(value) WHERE strpos(',' || token.granted_bot_scopes || ',', ',' || required.value || ',') = 0)
        AND NOT EXISTS (SELECT 1 FROM "openmeld"."inbox_items" item WHERE item.organization_id = token.organization_id AND item.source_kind = 'system_attention_event' AND item.source_key = 'authorization-update:channel.slack.' || token.slack_team_id || ':' || $4)
      UNION ALL
      SELECT item.organization_id FROM "openmeld"."inbox_items" item
      WHERE item.source_kind = 'system_attention_event' AND item.source_key ILIKE 'authorization-update:channel.%' AND item.resolution_status = 'open'
      AND (
        EXISTS (SELECT 1 FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection WHERE connection.organization_id = item.organization_id AND strpos(item.source_key, 'authorization-update:channel.' || connection.provider || '.' || connection.connection_id || ':') = 1 AND (connection.status = 'disconnected' OR (connection.status = 'connected' AND connection.permission_bundle_version = $5)))
        OR EXISTS (SELECT 1 FROM "openmeld"."slack_workspace_tokens" token WHERE token.organization_id = item.organization_id AND strpos(item.source_key, 'authorization-update:channel.slack.' || token.slack_team_id || ':') = 1 AND token.granted_bot_scopes IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text($6::jsonb) AS required(value) WHERE strpos(',' || token.granted_bot_scopes || ',', ',' || required.value || ',') = 0))
        OR (NOT EXISTS (SELECT 1 FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection WHERE connection.organization_id = item.organization_id AND strpos(item.source_key, 'authorization-update:channel.' || connection.provider || '.' || connection.connection_id || ':') = 1)
          AND NOT EXISTS (SELECT 1 FROM "openmeld"."openMeldRemoteAgent_slack_workspace_bindings" binding WHERE binding.organization_id = item.organization_id AND strpos(item.source_key, 'authorization-update:channel.slack.' || binding.slack_team_id || ':') = 1))
      )
    ) LIMIT 20
  `,
    values: [
      larkVersion,
      larkVersion,
      JSON.stringify(SLACK_BOT_SCOPES),
      slackVersion,
      larkVersion,
      JSON.stringify(SLACK_BOT_SCOPES),
    ],
  });
  for (const row of pending.rows) {
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
