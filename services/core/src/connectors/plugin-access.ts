import { pluginAccessPolicySchema } from "@openmeld/schemas";
import type {
  ConnectorConnectionPreference,
  ConnectorService,
  PluginAccessPolicy,
  PluginConsumer,
  PluginPermission,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../rpc/errors";
import { selectActiveConnectorConnection } from "./connector-connection-repository";

type ConnectionAccessRow = {
  access_policy: string | null;
  access_revision: number;
  scope: "member" | "shared";
};

// An absent policy preserves shipped authority, including the shared-only
// personal Remote Agent boundary. It never grants a newly introduced consumer.
export function resolvePluginAccessPolicy(
  scope: "member" | "shared",
  stored: string | null
): PluginAccessPolicy {
  if (stored === null) {
    return {
      center_agent: "write",
      local_agent: "none",
      remote_agent: scope === "shared" ? "write" : "none",
    };
  }
  const parsed = pluginAccessPolicySchema.safeParse(JSON.parse(stored));
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "plugin.access_invalid",
      reason: "Plugin access settings are invalid. Contact support.",
      status: 503,
    });
  }
  return parsed.data;
}

export function pluginPermissionAllows(
  permission: PluginPermission,
  effect: "read" | "write" | "destructive" | "unspecified"
): boolean {
  return permission === "write" || (permission === "read" && effect === "read");
}

export async function selectPluginConnection(input: {
  db: D1Database;
  organizationId: string;
  requesterUserId: string | null;
  service: ConnectorService;
  preference: ConnectorConnectionPreference;
  consumer: PluginConsumer;
}) {
  const preferences =
    input.preference === "automatic"
      ? (["requester", "shared"] as const)
      : [input.preference];
  for (const preference of preferences) {
    const selected = await selectActiveConnectorConnection({
      ...input,
      preference,
    });
    if (!selected) {
      continue;
    }
    const { policy } = await readPluginAccess({
      ...input,
      connectionName: selected.connection.connectionName,
    });
    if (policy[input.consumer] !== "none") {
      return selected;
    }
  }
  return null;
}

export async function readPluginAccess(input: {
  db: D1Database;
  organizationId: string;
  connectionName: string;
}) {
  const row = await input.db
    .prepare(
      "SELECT access_policy, access_revision, scope FROM connector_connections WHERE organization_id = ? AND connection_name = ?"
    )
    .bind(input.organizationId, input.connectionName)
    .first<ConnectionAccessRow>();
  if (!row) {
    throw createCoreRpcHttpError({
      code: "plugin.connection_not_found",
      reason: "This plugin connection is no longer available.",
      status: 404,
    });
  }
  return {
    policy: resolvePluginAccessPolicy(row.scope, row.access_policy),
    revision: row.access_revision,
  };
}

export async function requirePluginPermission(input: {
  db: D1Database;
  organizationId: string;
  connectionName: string;
  consumer: PluginConsumer;
  effect: "read" | "write" | "destructive" | "unspecified";
}): Promise<PluginPermission> {
  const { policy } = await readPluginAccess(input);
  const permission = policy[input.consumer];
  if (!pluginPermissionAllows(permission, input.effect)) {
    throw createCoreRpcHttpError({
      code: "plugin.action_forbidden",
      reason:
        "This Agent does not have permission to perform this action with the selected account. Review its access in Plugins.",
      status: 403,
    });
  }
  return permission;
}

export async function updatePluginAccess(input: {
  db: D1Database;
  organizationId: string;
  connectionName: string;
  actorProfileId: string;
  actorUserId: string;
  expectedRevision: number;
  policy: PluginAccessPolicy;
}) {
  const previous = await readPluginAccess(input);
  if (previous.revision !== input.expectedRevision) {
    throw accessConflict();
  }
  const id = crypto.randomUUID();
  const policy = JSON.stringify(pluginAccessPolicySchema.parse(input.policy));
  const results = await input.db.batch([
    input.db
      .prepare(`INSERT INTO connector_access_events
      (id, connection_name, organization_id, actor_profile_id, actor_user_id, revision, previous_policy, policy, created_at_ms)
      SELECT ?, connection_name, organization_id, ?, ?, access_revision + 1, ?, ?, ?
      FROM connector_connections WHERE organization_id = ? AND connection_name = ? AND access_revision = ?`)
      .bind(
        id,
        input.actorProfileId,
        input.actorUserId,
        JSON.stringify(previous.policy),
        policy,
        Date.now(),
        input.organizationId,
        input.connectionName,
        input.expectedRevision
      ),
    input.db
      .prepare(`UPDATE connector_connections SET access_policy = ?, access_revision = access_revision + 1
      WHERE organization_id = ? AND connection_name = ? AND access_revision = ?
      AND EXISTS (SELECT 1 FROM connector_access_events WHERE id = ?)`)
      .bind(
        policy,
        input.organizationId,
        input.connectionName,
        input.expectedRevision,
        id
      ),
  ]);
  if (results[1]?.meta.changes !== 1) {
    throw accessConflict();
  }
  return { policy: input.policy, revision: input.expectedRevision + 1 };
}

function accessConflict() {
  return createCoreRpcHttpError({
    code: "plugin.access_changed",
    reason:
      "Plugin access changed while you were editing. Reload the settings and try again.",
    status: 409,
  });
}
