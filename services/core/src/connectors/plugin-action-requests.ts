import {
  pluginActionRequestCommandRpcSchema,
  pluginActionRequestIntentSchema,
} from "@openmeld/schemas";
import type {
  PluginActionRequestCommandRpc,
  PluginActionRequestIntent,
  PluginActionRequestView,
} from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
import {
  prepareEnsureInboxItemStatements,
  prepareResolveInboxItemsBySourceStatements,
} from "../inbox/application/inbox-item-service";
import { type CoreBindings, identityDb } from "../lib/bindings";
import { requireExpectedOrganizationContext } from "../organizations/expected-organization-context";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { createCoreRpcHttpError } from "../rpc/errors";
import { readConnectorConnectionForExecution } from "./connector-connection-repository";
import { pluginPermissionAllows, readPluginAccess } from "./plugin-access";

const REQUEST_LIFETIME_MS = 60 * 60 * 1000;
const TARGET_FIELD =
  /^(?:project|workspace|repository|repo|issue|document|channel|folder|record|resource|target)(?:_?id|Id|ID)?$/u;
const TARGET_VALUE = /^[a-zA-Z0-9_.:/-]{1,120}$/u;
const UNSAFE_LABEL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;
type RequestRow = {
  id: string;
  organization_id: string;
  user_id: string;
  actor_profile_id: string;
  operation_id: string;
  source_request_key: string | null;
  request_digest: string;
  request_json: string;
  state: "pending" | "approved" | "rejected";
  created_at_ms: number;
  expires_at_ms: number;
  decided_at_ms: number | null;
};
const sourceKey = (id: string) => `plugin-action-request:${id}`;

/** Called only after current account, catalog effect and Plugin admission. */
export async function preparePluginActionRequest(input: {
  db: D1Database;
  intent: PluginActionRequestIntent;
  requestId?: string;
}): Promise<{
  request: PluginActionRequestView;
  root: string | null;
  executionGuard: PluginRequestExecutionGuard;
}> {
  const intent = pluginActionRequestIntentSchema.parse(input.intent);
  const { sourceRequestKey: _source, ...boundIntent } = intent;
  const digest = await digestCanonicalJson(boundIntent);
  let row: RequestRow | null;
  if (input.requestId) {
    row = await readRequest(input.db, input.requestId);
  } else {
    const now = Date.now();
    await input.db
      .prepare(
        `INSERT INTO plugin_action_requests (id, organization_id, user_id, actor_profile_id, operation_id, source_request_key, request_digest, request_json, state, created_at_ms, expires_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT (organization_id, user_id, actor_profile_id, operation_id) DO NOTHING`
      )
      .bind(
        crypto.randomUUID(),
        intent.organizationId,
        intent.userId,
        intent.actorProfileId,
        intent.operationId,
        intent.sourceRequestKey,
        digest,
        JSON.stringify(intent),
        now,
        now + REQUEST_LIFETIME_MS
      )
      .run();
    row = await input.db
      .prepare(
        "SELECT * FROM plugin_action_requests WHERE organization_id = ? AND user_id = ? AND actor_profile_id = ? AND operation_id = ?"
      )
      .bind(
        intent.organizationId,
        intent.userId,
        intent.actorProfileId,
        intent.operationId
      )
      .first<RequestRow>();
  }
  if (!row || row.request_digest !== digest) {
    throw denied(
      "request_changed",
      "This request no longer matches the account, action, or input that was reviewed."
    );
  }
  const request = await projectRequest(input.db, row);
  return {
    request,
    root: request.state === "approved" ? `plugin-request:${row.id}` : null,
    executionGuard: requestExecutionGuard(row),
  };
}

export type PluginRequestExecutionGuard = {
  sql: string;
  bindings: (string | number)[];
};

/** The request owner resolves expired/revoked attention on recipient reads. */
export async function reconcilePluginActionRequestInbox(input: {
  db: D1Database;
  organizationId: string;
  userId: string;
}) {
  await input.db
    .prepare(`UPDATE inbox_items AS item SET resolution_status = 'resolved', resolved_at_ms = ?, updated_at_ms = max(updated_at_ms, ?)
    WHERE item.organization_id = ? AND item.recipient_user_id = ? AND item.resolution_status = 'open'
      AND item.source_kind = 'system_attention_event' AND EXISTS (
        SELECT 1 FROM plugin_action_requests AS request
        WHERE item.source_key = 'plugin-action-request:' || request.id
          AND request.organization_id = item.organization_id AND request.user_id = item.recipient_user_id
          AND (request.state != 'pending' OR request.expires_at_ms <= ? OR NOT EXISTS (
            SELECT 1 FROM connector_connections AS connection WHERE connection.organization_id = request.organization_id
              AND connection.connection_name = json_extract(request.request_json, '$.connection.connectionName')
              AND connection.status = 'active'
              AND connection.updated_at_ms = json_extract(request.request_json, '$.connectionUpdatedAtMs')
              AND connection.access_revision = json_extract(request.request_json, '$.accessRevision')
          ))
      )`)
    .bind(
      Date.now(),
      Date.now(),
      input.organizationId,
      input.userId,
      Date.now()
    )
    .run();
}

function requestExecutionGuard(row: RequestRow): PluginRequestExecutionGuard {
  const intent = pluginActionRequestIntentSchema.parse(
    JSON.parse(row.request_json)
  );
  return {
    sql: `EXISTS (SELECT 1 FROM plugin_action_requests AS request
      INNER JOIN members ON members.organization_id = request.organization_id AND members.user_id = request.user_id
      INNER JOIN connector_connections AS connection ON connection.organization_id = request.organization_id AND connection.connection_name = ?
      WHERE request.id = ? AND request.state = 'approved' AND request.expires_at_ms > ?
        AND connection.status = 'active' AND connection.updated_at_ms = ? AND connection.access_revision = ?)`,
    bindings: [
      intent.connection.connectionName,
      row.id,
      Date.now(),
      intent.connectionUpdatedAtMs,
      intent.accessRevision,
    ],
  };
}

/** Reads authority for a retained operation. It never creates a new request. */
export async function readPluginActionRequestForOperation(input: {
  db: D1Database;
  organizationId: string;
  userId: string;
  actorProfileId: string;
  operationId: string;
}) {
  const row = await input.db
    .prepare(
      "SELECT * FROM plugin_action_requests WHERE organization_id = ? AND user_id = ? AND actor_profile_id = ? AND operation_id = ?"
    )
    .bind(
      input.organizationId,
      input.userId,
      input.actorProfileId,
      input.operationId
    )
    .first<RequestRow>();
  if (!row) {
    return null;
  }
  const state = await currentState(
    input.db,
    row,
    pluginActionRequestIntentSchema.parse(JSON.parse(row.request_json))
  );
  return state === "approved"
    ? {
        executionGuard: requestExecutionGuard(row),
        expiresAtMs: row.expires_at_ms,
      }
    : null;
}

export async function rpcPluginActionRequest(
  env: CoreBindings,
  value: PluginActionRequestCommandRpc
): Promise<PluginActionRequestView> {
  const parsed = pluginActionRequestCommandRpcSchema.safeParse(value);
  if (!parsed.success) {
    throw denied("invalid_request", "Choose a valid Plugin request.");
  }
  const { context, command, expectedOrganizationId } = parsed.data;
  const member = await resolveActiveOrganizationMembership({ env, context });
  if (!member.ok) {
    throw createCoreRpcHttpError({
      code: member.code,
      reason: member.message,
      status: member.status,
    });
  }
  requireExpectedOrganizationContext({
    actualOrganizationId: member.organizationId,
    expectedOrganizationId,
    errorCode: "plugin.request_organization_changed",
  });
  const db = identityDb(env);
  if (!db) {
    throw denied(
      "state_unavailable",
      "This request cannot be checked right now."
    );
  }
  const row = await readRequest(db, command.requestId);
  if (
    !(
      row &&
      row.user_id === member.userId &&
      row.organization_id === member.organizationId
    )
  ) {
    throw createCoreRpcHttpError({
      code: "plugin.request_not_found",
      reason: "This request is not available to your account.",
      status: 404,
    });
  }
  const current = await projectRequest(db, row);
  if (command.operation === "read") {
    return current;
  }
  if (
    context.actorContext.profileKind !== "human" ||
    context.actorContext.callerPrincipalId !== member.userId
  ) {
    throw denied(
      "human_required",
      "Open this request in your Inbox to respond."
    );
  }
  const wanted = command.operation === "approve" ? "approved" : "rejected";
  if (current.state !== "pending") {
    if (current.state === wanted) {
      return current;
    }
    throw denied(
      "already_handled",
      "This request has expired, changed, or already been handled. Refresh to see its status."
    );
  }
  return await decideRequest(db, row, command);
}

async function decideRequest(
  db: D1Database,
  row: RequestRow,
  command: Extract<
    PluginActionRequestCommandRpc["command"],
    { operation: "approve" | "reject" }
  >
) {
  const wanted = command.operation === "approve" ? "approved" : "rejected";
  const intent = pluginActionRequestIntentSchema.parse(
    JSON.parse(row.request_json)
  );
  // The decision and its Inbox resolution are one transaction. A concurrent
  // rejection or lost approval response cannot mint a second request identity.
  await db.batch([
    db
      .prepare(`UPDATE plugin_action_requests SET state = ?, decided_at_ms = ?
      WHERE id = ? AND state = 'pending' AND expires_at_ms > ?
        AND EXISTS (SELECT 1 FROM members WHERE organization_id = ? AND user_id = ?)
        AND EXISTS (SELECT 1 FROM connector_connections WHERE organization_id = ? AND connection_name = ? AND status = 'active' AND updated_at_ms = ? AND access_revision = ?)`)
      .bind(
        wanted,
        Date.now(),
        row.id,
        Date.now(),
        row.organization_id,
        row.user_id,
        row.organization_id,
        intent.connection.connectionName,
        intent.connectionUpdatedAtMs,
        intent.accessRevision
      ),
    ...prepareResolveInboxItemsBySourceStatements({
      db,
      organizationId: row.organization_id,
      sourceKind: "system_attention_event",
      sourceKey: sourceKey(row.id),
      resolvedAtMs: Date.now(),
      sourceGuard: {
        sql: "EXISTS (SELECT 1 FROM plugin_action_requests WHERE id = ? AND state != 'pending')",
        bindings: [row.id],
      },
    }),
  ]);
  const result = await projectRequest(db, await requireRequest(db, row.id));
  if (result.state !== wanted) {
    throw denied(
      "decision_conflict",
      "This request changed before your response was saved. Refresh to see its status."
    );
  }
  return result;
}

async function projectRequest(
  db: D1Database,
  row: RequestRow
): Promise<PluginActionRequestView> {
  const intent = pluginActionRequestIntentSchema.parse(
    JSON.parse(row.request_json)
  );
  const state = await currentState(db, row, intent);
  const prepared = await prepareEnsureInboxItemStatements({
    db,
    nowMs: Date.now(),
    candidate: {
      organizationId: row.organization_id,
      recipientUserId: row.user_id,
      sourceKind: "system_attention_event",
      sourceKey: sourceKey(row.id),
      sourceTarget: { kind: "plugin_action_request", requestId: row.id },
      sourceFacts: {
        version: 1,
        recipientReasons: ["requester"],
        requestCategory: "action",
      },
      kind: "system_issue",
      importance: "normal",
      attention: "action_required",
      occurredAtMs: row.created_at_ms,
      contextLabel: "Plugin request",
      title: "Confirm a Plugin action",
      preview:
        "An Agent needs your confirmation for a new operation. Open the request to review it.",
    },
  });
  await db.batch([
    ...prepared.statements,
    ...prepareResolveInboxItemsBySourceStatements({
      db,
      organizationId: row.organization_id,
      sourceKind: "system_attention_event",
      sourceKey: sourceKey(row.id),
      resolvedAtMs: Date.now(),
      sourceGuard: {
        sql: "EXISTS (SELECT 1 FROM plugin_action_requests WHERE id = ? AND (state != 'pending' OR expires_at_ms <= ? OR ?))",
        bindings: [row.id, Date.now(), state === "revoked" ? 1 : 0],
      },
    }),
  ]);
  const targets: PluginActionRequestView["targets"] = [];
  // This action's name is the proposed resource label, not a credential or
  // message body. Keep it in the private detail, never the Inbox projection.
  if (
    intent.service === "posthog" &&
    intent.actionId === "posthog.create_dashboard" &&
    typeof intent.input.name === "string" &&
    intent.input.name.length > 0 &&
    intent.input.name.length <= 200 &&
    !UNSAFE_LABEL_CHARACTERS.test(intent.input.name)
  ) {
    targets.push({ label: "Dashboard name", value: intent.input.name });
  }
  for (const [key, value] of Object.entries(intent.input)) {
    if (targets.length === 12) {
      break;
    }
    if (
      TARGET_FIELD.test(key) &&
      (typeof value === "string" || typeof value === "number") &&
      TARGET_VALUE.test(String(value))
    ) {
      targets.push({ label: key, value: String(value) });
    }
  }
  return {
    requestId: row.id,
    inboxItemId: prepared.itemId,
    state,
    service: intent.service,
    actionId: intent.actionId,
    effect: intent.effect,
    accountName: intent.connection.ownerDisplayName ?? "Connected account",
    accountScope: intent.connection.scope,
    actorProfileId: intent.actorProfileId,
    inputFieldCount: Object.keys(intent.input).length,
    targets,
    createdAtMs: row.created_at_ms,
    expiresAtMs: row.expires_at_ms,
  };
}

async function currentState(
  db: D1Database,
  row: RequestRow,
  intent: PluginActionRequestIntent
): Promise<PluginActionRequestView["state"]> {
  if (row.state === "rejected") {
    return "rejected";
  }
  if (row.expires_at_ms <= Date.now()) {
    return "expired";
  }
  const membership = await db
    .prepare("SELECT id FROM members WHERE organization_id = ? AND user_id = ?")
    .bind(row.organization_id, row.user_id)
    .first();
  if (!membership) {
    return "revoked";
  }
  const connection = await readConnectorConnectionForExecution({
    db,
    organizationId: row.organization_id,
    connectionName: intent.connection.connectionName,
  });
  if (!connection) {
    return "revoked";
  }
  const access = await readPluginAccess({
    db,
    organizationId: row.organization_id,
    connectionName: intent.connection.connectionName,
    activeOnly: true,
  });
  if (
    connection.status !== "active" ||
    connection.updatedAtMs !== intent.connectionUpdatedAtMs ||
    connection.userId !== intent.connection.ownerUserId ||
    connection.scope !== intent.connection.scope ||
    access.revision !== intent.accessRevision ||
    !pluginPermissionAllows(access.policy.local_agent, intent.effect)
  ) {
    return "revoked";
  }
  return row.state;
}

function readRequest(db: D1Database, id: string) {
  return db
    .prepare("SELECT * FROM plugin_action_requests WHERE id = ?")
    .bind(id)
    .first<RequestRow>();
}
async function requireRequest(db: D1Database, id: string) {
  const row = await readRequest(db, id);
  if (!row) {
    throw denied("request_missing", "This request is no longer available.");
  }
  return row;
}
function denied(code: string, reason: string) {
  return createCoreRpcHttpError({
    code: `plugin.${code}`,
    reason,
    status: 403,
  });
}
