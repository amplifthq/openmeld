import {
  getPostgresDatabase,
  type PostgresDatabase,
} from "@openmeld/db/postgresql";
import {
  listPluginActionRequestsInputSchema,
  pluginActionRequestCommandRpcSchema,
  pluginActionRequestContinuationSchema,
  pluginActionRequestIntentSchema,
  projectPluginActionRequestView,
  readApprovedPluginActionInputSchema,
  readApprovedPluginActionResponseSchema,
  remoteAgentWorkerSubmitCapabilitiesSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  PluginActionRequestCommandRpc,
  PluginActionRequestIntent,
  PluginActionRequestView,
} from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
import {
  prepareEnsureInboxItemStatements,
  prepareResolveInboxItemsBySourceStatements,
} from "../inbox/application/inbox-item-service";
import type { CoreBindings } from "../lib/bindings";
import { requireExpectedOrganizationContext } from "../organizations/expected-organization-context";
import { resolveActiveOrganizationMembership } from "../organizations/organization-context";
import { authorizeRemoteAgentExecutionAccess } from "../remote-agent/application/remote-agent-execution-access";
import {
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryBySubmissionId,
} from "../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { createCoreRpcHttpError, readCoreRpcHttpStatus } from "../rpc/errors";
import {
  rpcGetSpaceDispatchTrace,
  rpcGetSpaceMemberDirectory,
  rpcReadPluginActionRequestLocations,
} from "../rpc/methods";
import { readSafeRpcFailureReasonCode } from "../shared/rpc/rpc-json";
import { readConnectorConnectionForExecution } from "./connector-connection-repository";
import { pluginPermissionAllows, readPluginAccess } from "./plugin-access";
import { continuePluginConnection } from "./plugin-connection-continuation";
import { readPluginConnectionExecutionBinding } from "./plugin-connection-execution-binding";

const REQUEST_LIFETIME_MS = 60 * 60 * 1000;
const TARGET_FIELD =
  /^(?:owner|team|project|workspace|repository|repo|issue|document|channel|folder|record|resource|target)(?:_?id|Id|ID)?$/u;
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
  continuation_json: string | null;
};
const sourceKey = (id: string) => `plugin-action-request:${id}`;

/** Called only after current account, catalog effect and Plugin admission. */
export async function preparePluginActionRequest(input: {
  db: PostgresDatabase;
  intent: PluginActionRequestIntent;
  requestId?: string;
}): Promise<{
  request: PluginActionRequestView;
  root: string | null;
  executionGuard: PluginRequestExecutionGuard;
}> {
  const intent = pluginActionRequestIntentSchema.parse(input.intent);
  if (intent.sourceNativeDeliveryId && intent.sourceSpaceId) {
    const delivery = await readRemoteAgentNativeDeliveryByDeliveryId({
      db: input.db,
      deliveryId: intent.sourceNativeDeliveryId,
    });
    if (
      !delivery ||
      delivery.organizationId !== intent.organizationId ||
      delivery.spaceId !== intent.sourceSpaceId ||
      delivery.profileId !== intent.actorProfileId
    ) {
      throw denied(
        "source_unavailable",
        "The original request could not be verified."
      );
    }
    intent.sourceSignalId = delivery.triggerMessageId;
  }
  // Presentation provenance is frozen on creation, not part of authorization.
  // Keep pre-existing approvals valid when an upgraded caller supplies it.
  const {
    sourceRequestKey: _source,
    sourceSpaceId: _space,
    sourceSignalId: _signal,
    sourceNativeDeliveryId: _delivery,
    recovery: _recovery,
    ...boundIntent
  } = intent;
  const digest = await digestCanonicalJson(boundIntent);
  let row: RequestRow | null;
  if (input.requestId) {
    row = await readRequest(input.db, input.requestId);
  } else {
    const now = Date.now();
    await input.db.query({
      text: 'INSERT INTO "openmeld"."plugin_action_requests" (id, organization_id, user_id, actor_profile_id, operation_id, source_request_key, request_digest, request_json, state, created_at_ms, expires_at_ms)\n       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, \'pending\', $9, $10)\n       ON CONFLICT (organization_id, user_id, actor_profile_id, operation_id) DO NOTHING',
      values: [
        crypto.randomUUID(),
        intent.organizationId,
        intent.userId,
        intent.actorProfileId,
        intent.operationId,
        intent.sourceRequestKey,
        digest,
        JSON.stringify(intent),
        now,
        now + REQUEST_LIFETIME_MS,
      ],
    });
    row = await input.db
      .query<RequestRow>({
        text: 'SELECT * FROM "openmeld"."plugin_action_requests" WHERE organization_id = $1 AND user_id = $2 AND actor_profile_id = $3 AND operation_id = $4',
        values: [
          intent.organizationId,
          intent.userId,
          intent.actorProfileId,
          intent.operationId,
        ],
      })
      .then((result) => result.rows[0] ?? null);
  }
  if (!row || row.request_digest !== digest) {
    throw denied(
      "request_changed",
      "This request no longer matches the account, action, or input that was reviewed."
    );
  }
  const request = await projectRequest(input.db, row);
  return {
    request: projectPluginActionRequestView(request),
    root: request.state === "approved" ? `plugin-request:${row.id}` : null,
    executionGuard: requestExecutionGuard(row),
  };
}

/** Only the admitted continuation can recover its own private, approved input. */
export async function readApprovedPluginAction(
  env: CoreBindings,
  value: unknown
) {
  const { context } = readApprovedPluginActionInputSchema.parse(value);
  const submissionId = context.agentControllerConversationId;
  if (!submissionId) {
    throw denied(
      "recovery_unavailable",
      "The approved execution is unavailable."
    );
  }
  const access = await authorizeRemoteAgentExecutionAccess(env, {
    context,
    submissionId,
    effect: "write",
  });
  const binding = await readPluginConnectionExecutionBinding(env, context);
  if (
    !(
      binding &&
      "approvedActionRequestId" in binding &&
      binding.approvedActionRequestId
    )
  ) {
    return { action: null };
  }
  const db = getPostgresDatabase(env);
  if (!db || access.scope.principal.kind !== "member") {
    throw denied(
      "recovery_unavailable",
      "The original requester is unavailable."
    );
  }
  const row = await readRequest(db, binding.approvedActionRequestId);
  const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db,
    submissionId,
  });
  if (!(row && delivery)) {
    throw denied(
      "recovery_unavailable",
      "The approved request is unavailable."
    );
  }
  const intent = pluginActionRequestIntentSchema.parse(
    JSON.parse(row.request_json)
  );
  if (
    intent.organizationId !== access.scope.organizationId ||
    intent.actorProfileId !== delivery.profileId ||
    intent.userId !== access.scope.principal.userId ||
    intent.sourceSpaceId !== delivery.spaceId ||
    intent.sourceSignalId !== binding.source.signalId ||
    intent.service !== binding.service ||
    intent.connection.connectionName !== binding.connectionName ||
    intent.connectionUpdatedAtMs !== binding.connectionUpdatedAtMs ||
    (await currentState(db, row, intent)) !== "approved"
  ) {
    throw denied(
      "recovery_unavailable",
      "The approved request no longer matches this execution."
    );
  }
  await authorizeRemoteAgentExecutionAccess(env, {
    context,
    submissionId,
    effect: "write",
    sources: [
      {
        kind: "plugin_connection",
        service: intent.service,
        connectionName: intent.connection.connectionName,
        connectionUpdatedAtMs: intent.connectionUpdatedAtMs,
      },
    ],
  });
  if (!intent.recovery) {
    throw denied(
      "recovery_input_unavailable",
      "This older approval has no retained executable input. No action was replayed."
    );
  }
  return readApprovedPluginActionResponseSchema.parse({
    action: {
      requestId: row.id,
      operationId: intent.operationId,
      service: intent.service,
      actionId: intent.actionId,
      connectionPreference:
        intent.connection.scope === "member" ? "requester" : "shared",
      recovery: intent.recovery,
    },
  });
}

export type PluginRequestExecutionGuard = {
  sql: (firstParameter: number) => string;
  bindings: (string | number)[];
};

/** The request owner resolves expired/revoked attention on recipient reads. */
export async function reconcilePluginActionRequestInbox(input: {
  db: PostgresDatabase;
  organizationId: string;
  userId: string;
}) {
  await input.db.query({
    text: "UPDATE \"openmeld\".\"inbox_items\" AS item SET resolution_status = 'resolved', resolved_at_ms = $1, updated_at_ms = greatest(updated_at_ms, $2)\n    WHERE item.organization_id = $3 AND item.recipient_user_id = $4 AND item.resolution_status = 'open'\n      AND item.source_kind = 'system_attention_event' AND EXISTS (\n        SELECT 1 FROM \"openmeld\".\"plugin_action_requests\" AS request\n        WHERE item.source_key = 'plugin-action-request:' || request.id\n          AND request.organization_id = item.organization_id AND request.user_id = item.recipient_user_id\n          AND (request.state != 'pending' OR request.expires_at_ms <= $5 OR NOT EXISTS (\n            SELECT 1 FROM \"openmeld\".\"connector_connections\" AS connection WHERE connection.organization_id = request.organization_id\n              AND connection.connection_name = (request.request_json::jsonb #>> '{connection,connectionName}')\n              AND connection.status = 'active'\n              AND connection.updated_at_ms = (request.request_json::jsonb ->> 'connectionUpdatedAtMs')::bigint\n              AND connection.access_revision = (request.request_json::jsonb ->> 'accessRevision')::bigint\n          ))\n      )",
    values: [
      Date.now(),
      Date.now(),
      input.organizationId,
      input.userId,
      Date.now(),
    ],
  });
}

function requestExecutionGuard(row: RequestRow): PluginRequestExecutionGuard {
  const intent = pluginActionRequestIntentSchema.parse(
    JSON.parse(row.request_json)
  );
  return {
    sql: (
      first
    ) => `EXISTS (SELECT 1 FROM "openmeld"."plugin_action_requests" AS request
      INNER JOIN "openmeld"."members" ON members.organization_id = request.organization_id AND members.user_id = request.user_id
      INNER JOIN "openmeld"."connector_connections" AS connection ON connection.organization_id = request.organization_id AND connection.connection_name = $${first}
      WHERE request.id = $${first + 1} AND request.state = 'approved' AND request.expires_at_ms > $${first + 2}
        AND connection.status = 'active' AND connection.updated_at_ms = $${first + 3} AND connection.access_revision = $${first + 4})`,
    bindings: [
      intent.connection.connectionName,
      row.id,
      Date.now(),
      intent.connectionUpdatedAtMs,
      intent.accessRevision,
    ],
  };
}

/** Check absence now and again in the operation claim; a later request owns consent. */
export async function preparePluginActionRequestAbsenceGuard(input: {
  db: PostgresDatabase;
  organizationId: string;
  userId: string;
  actorProfileId: string;
  operationId: string;
}): Promise<PluginRequestExecutionGuard | null> {
  const guard: PluginRequestExecutionGuard = {
    sql: (
      first
    ) => `NOT EXISTS (SELECT 1 FROM "openmeld"."plugin_action_requests"
      WHERE organization_id = $${first} AND user_id = $${first + 1}
        AND actor_profile_id = $${first + 2} AND operation_id = $${first + 3})`,
    bindings: [
      input.organizationId,
      input.userId,
      input.actorProfileId,
      input.operationId,
    ],
  };
  const result = await input.db.query({
    text: `SELECT 1 WHERE ${guard.sql(1)}`,
    values: guard.bindings,
  });
  return result.rows.length > 0 ? guard : null;
}

/** Reads authority for a retained operation. It never creates a new request. */
export async function readPluginActionRequestForOperation(input: {
  db: PostgresDatabase;
  organizationId: string;
  userId: string;
  actorProfileId: string;
  operationId: string;
}) {
  const row = await readRequestForOperation(input);
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

/** A recipient- and actor-scoped projection; never approves or retries a write. */
export async function readPluginActionRequestStatusForOperation(
  input: Parameters<typeof readPluginActionRequestForOperation>[0] & {
    service: string;
    actionId: string;
  }
) {
  const row = await readRequestForOperation(input);
  if (!row) {
    return null;
  }
  const intent = pluginActionRequestIntentSchema.parse(
    JSON.parse(row.request_json)
  );
  if (intent.service !== input.service || intent.actionId !== input.actionId) {
    return null;
  }
  return {
    requestId: row.id,
    state: await currentState(input.db, row, intent),
    continuation: row.continuation_json
      ? pluginActionRequestContinuationSchema.parse(
          JSON.parse(row.continuation_json)
        ).state
      : null,
  };
}

async function readRequestForOperation(
  input: Parameters<typeof readPluginActionRequestForOperation>[0]
) {
  const row = await input.db
    .query<RequestRow>({
      text: 'SELECT * FROM "openmeld"."plugin_action_requests" WHERE organization_id = $1 AND user_id = $2 AND actor_profile_id = $3 AND operation_id = $4',
      values: [
        input.organizationId,
        input.userId,
        input.actorProfileId,
        input.operationId,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row;
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
  const db = getPostgresDatabase(env);
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
  await decideRequest(db, row, command, context);
  const updated = await readRequest(db, row.id);
  if (!updated) {
    throw denied("request_not_found", "This request is no longer available.");
  }
  await continueApprovedRequest(env, db, updated);
  return projectRequest(db, (await readRequest(db, row.id)) ?? updated);
}

export async function listPluginActionRequests(
  env: CoreBindings,
  value: unknown
) {
  const input = listPluginActionRequestsInputSchema.parse(value);
  const member = await resolveActiveOrganizationMembership({
    env,
    context: input.context,
  });
  if (!member.ok) {
    throw createCoreRpcHttpError({
      code: member.code,
      reason: member.message,
      status: member.status,
    });
  }
  requireExpectedOrganizationContext({
    actualOrganizationId: member.organizationId,
    expectedOrganizationId: input.expectedOrganizationId,
    errorCode: "plugin.request_organization_changed",
  });
  await rpcGetSpaceMemberDirectory(env, {
    context: input.context,
    spaceId: input.spaceId,
  });
  const db = getPostgresDatabase(env);
  if (!db) {
    throw denied("state_unavailable", "Requests could not be loaded.");
  }
  const rows = await db.query<RequestRow>({
    text: `SELECT * FROM "openmeld"."plugin_action_requests"
      WHERE organization_id = $1 AND user_id = $2
        AND request_json::jsonb ->> 'sourceSpaceId' = $3
        AND (CASE WHEN $4::text[] IS NULL THEN state = 'pending' AND expires_at_ms > $5
          AND request_json::jsonb ->> 'sourceSignalId' IS NOT NULL
          ELSE request_json::jsonb ->> 'sourceSignalId' = ANY($4::text[]) END)
      ORDER BY created_at_ms, id`,
    values: [
      member.organizationId,
      member.userId,
      input.spaceId,
      input.sourceSignalIds ?? null,
      Date.now(),
    ],
  });
  const requests = await Promise.all(
    rows.rows.map((row) => projectRequest(db, row))
  );
  if (input.sourceSignalIds) {
    return { requests };
  }
  const pending = requests.filter((request) => request.state === "pending");
  const threadIds = new Map<string, string | null>();
  const sourceSignalIds = [
    ...new Set(
      pending
        .map((request) => request.sourceSignalId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  for (let offset = 0; offset < sourceSignalIds.length; offset += 1000) {
    const locations = await rpcReadPluginActionRequestLocations(env, {
      ...input,
      sourceSignalIds: sourceSignalIds.slice(offset, offset + 1000),
    });
    for (const location of locations) {
      threadIds.set(location.sourceSignalId, location.threadId);
    }
  }
  return {
    requests: pending.map((request) => ({
      ...request,
      sourceThreadId: request.sourceSignalId
        ? threadIds.get(request.sourceSignalId)
        : undefined,
    })),
  };
}

/** The approved request retains delivery intent. A browser response is not its scheduler. */
export async function retryApprovedPluginActionRequests(env: CoreBindings) {
  const db = getPostgresDatabase(env);
  if (!db) {
    return;
  }
  const through = Date.now();
  await expirePluginActionRecoveryInputs(db, through);
  let cursor: { decidedAt: number; id: string } | null = null;
  // Page past still-running requests so they cannot starve later approvals.
  // Bound this scan to decisions already present when the job started.
  for (;;) {
    const pending: { rows: (RequestRow & { decided_at_ms: number })[] } =
      await db.query<RequestRow & { decided_at_ms: number }>({
        text: `SELECT * FROM "openmeld"."plugin_action_requests"
        WHERE state = 'approved' AND continuation_json::jsonb ->> 'state' = 'pending'
          AND decided_at_ms <= $1
          AND ($2::bigint IS NULL OR (decided_at_ms, id) > ($2, $3))
        ORDER BY decided_at_ms, id LIMIT 100`,
        values: [through, cursor?.decidedAt ?? null, cursor?.id ?? null],
      });
    for (const row of pending.rows) {
      await continueApprovedRequest(env, db, row);
    }
    const last = pending.rows.at(-1);
    if (!last || pending.rows.length < 100) {
      return;
    }
    cursor = { decidedAt: last.decided_at_ms, id: last.id };
  }
}

/** Retain decision/operation identity after expiry, but remove private bodies. */
export async function expirePluginActionRecoveryInputs(
  db: PostgresDatabase,
  nowMs: number
) {
  await db.query({
    text: `UPDATE "openmeld"."plugin_action_requests"
      SET request_json = (request_json::jsonb - 'recovery')::text
      WHERE id IN (
        SELECT id FROM "openmeld"."plugin_action_requests"
        WHERE expires_at_ms <= $1 AND request_json::jsonb ? 'recovery'
        ORDER BY expires_at_ms, id LIMIT 1000
      )`,
    values: [nowMs],
  });
}

async function continueApprovedRequest(
  env: CoreBindings,
  db: PostgresDatabase,
  row: RequestRow
) {
  if (!row.continuation_json || row.state !== "approved") {
    return;
  }
  const continuation = pluginActionRequestContinuationSchema.parse(
    JSON.parse(row.continuation_json)
  );
  if (continuation.state !== "pending") {
    return;
  }
  const intent = pluginActionRequestIntentSchema.parse(
    JSON.parse(row.request_json)
  );
  const save = async (
    state: "requested" | "unavailable",
    signalId: string | null = null
  ) => {
    await db.query({
      text: `UPDATE "openmeld"."plugin_action_requests" SET continuation_json = $1
      WHERE id = $2 AND continuation_json = $3 AND state = 'approved'`,
      values: [
        JSON.stringify({ ...continuation, state, signalId }),
        row.id,
        row.continuation_json,
      ],
    });
  };
  try {
    if (
      !(intent.sourceSpaceId && intent.sourceSignalId) ||
      (await currentState(db, row, intent)) !== "approved"
    ) {
      await save("unavailable");
      return;
    }
    let replySignalId: string | null = null;
    if (intent.sourceNativeDeliveryId) {
      replySignalId = await readApprovedNativeReply(db, row, intent);
    } else if (row.source_request_key?.startsWith("dispatch:")) {
      replySignalId = await readApprovedLocalReply(env, {
        context: continuation.context,
        spaceId: intent.sourceSpaceId,
        dispatchId: row.source_request_key.slice("dispatch:".length),
      });
    } else {
      await save("unavailable");
      return;
    }
    if (!replySignalId) {
      return;
    }
    if (intent.recovery) {
      // Keep the durable continuation pending until the receiving executor
      // supports exact replay; an older worker must not ask the model to retry.
      const raw =
        await env.OPENMELD_REMOTE_AGENT_WORKER?.readSubmitTurnCapabilities?.({
          v: 1,
          includePluginActionRecovery: true,
        });
      if (
        !remoteAgentWorkerSubmitCapabilitiesSchema.safeParse(raw).data
          ?.pluginActionRecovery
      ) {
        throw createCoreRpcHttpError({
          code: "plugin.request.recovery_executor_unavailable",
          status: 503,
          reason:
            "The approved operation is waiting for its compatible executor.",
        });
      }
    }
    const result = await continuePluginConnection(
      env,
      {
        context: continuation.context,
        spaceId: intent.sourceSpaceId,
        sourceSignalId: replySignalId,
        service: intent.service,
        scope: intent.connection.scope,
      },
      { requestId: row.id, intent }
    );
    await save("requested", result.signalId);
  } catch (error) {
    const status = readCoreRpcHttpStatus(error);
    if (
      status !== null &&
      status >= 400 &&
      status < 500 &&
      readSafeRpcFailureReasonCode(error) !== "plugin.continue.outcome_unknown"
    ) {
      await save("unavailable");
    }
    console.error("[plugin.request.continuation_failed]", {
      requestId: row.id,
      status,
    });
  }
}

async function readApprovedLocalReply(
  env: CoreBindings,
  input: Parameters<typeof rpcGetSpaceDispatchTrace>[1]
): Promise<string | null> {
  const { trace } = await rpcGetSpaceDispatchTrace(env, input);
  const execution = trace?.runtimeCoordinatorExecution;
  if (execution?.status !== "reply_published") {
    if (execution?.terminalOutcome) {
      throw denied(
        "continuation_source_stopped",
        "The original execution stopped before it could continue."
      );
    }
    return null;
  }
  const replySignalId = trace?.finalVisibleMessage?.signalId ?? null;
  // Space publication can become visible before the coordinator receipt.
  // Keep delivery pending until both owners agree the reply is settled.
  return execution.terminalOutcome?.kind === "reply_published" &&
    trace?.result?.publishedSignalId === replySignalId
    ? replySignalId
    : null;
}

async function readApprovedNativeReply(
  db: PostgresDatabase,
  row: RequestRow,
  intent: PluginActionRequestIntent
): Promise<string | null> {
  const delivery = intent.sourceNativeDeliveryId
    ? await readRemoteAgentNativeDeliveryByDeliveryId({
        db,
        deliveryId: intent.sourceNativeDeliveryId,
      })
    : null;
  if (
    !delivery ||
    delivery.organizationId !== row.organization_id ||
    delivery.profileId !== row.actor_profile_id ||
    delivery.spaceId !== intent.sourceSpaceId ||
    delivery.triggerMessageId !== intent.sourceSignalId
  ) {
    throw denied(
      "continuation_source_changed",
      "The original request is no longer available."
    );
  }
  if (delivery.status === "completed") {
    return delivery.publishedSignalId;
  }
  if (["submitted", "accepted", "retry_observed"].includes(delivery.status)) {
    return null;
  }
  throw denied(
    "continuation_source_stopped",
    "The original execution stopped before it could continue."
  );
}

async function decideRequest(
  db: PostgresDatabase,
  row: RequestRow,
  command: Extract<
    PluginActionRequestCommandRpc["command"],
    { operation: "approve" | "reject" }
  >,
  context: OpenMeldRequestContext
) {
  const wanted = command.operation === "approve" ? "approved" : "rejected";
  const intent = pluginActionRequestIntentSchema.parse(
    JSON.parse(row.request_json)
  );
  // The decision and its Inbox resolution are one transaction. A concurrent
  // rejection or lost approval response cannot mint a second request identity.
  await db.transaction(async (client) => {
    for (const query of [
      {
        text: 'UPDATE "openmeld"."plugin_action_requests" SET state = $1, decided_at_ms = $2, continuation_json = $11\n      WHERE id = $3 AND state = \'pending\' AND expires_at_ms > $4\n        AND EXISTS (SELECT 1 FROM "openmeld"."members" WHERE organization_id = $5 AND user_id = $6)\n        AND EXISTS (SELECT 1 FROM "openmeld"."connector_connections" WHERE organization_id = $7 AND connection_name = $8 AND status = \'active\' AND updated_at_ms = $9 AND access_revision = $10)',
        values: [
          wanted,
          Date.now(),
          row.id,
          Date.now(),
          row.organization_id,
          row.user_id,
          row.organization_id,
          intent.connection.connectionName,
          intent.connectionUpdatedAtMs,
          intent.accessRevision,
          wanted === "approved" && intent.sourceSignalId && intent.sourceSpaceId
            ? JSON.stringify({ context, state: "pending", signalId: null })
            : null,
        ],
      },
      ...prepareResolveInboxItemsBySourceStatements({
        db,
        organizationId: row.organization_id,
        sourceKind: "system_attention_event",
        sourceKey: sourceKey(row.id),
        resolvedAtMs: Date.now(),
        sourceGuard: {
          sql: (offset) =>
            `EXISTS (SELECT 1 FROM "openmeld"."plugin_action_requests" WHERE id = $${offset + 1} AND state != 'pending')`,
          bindings: [row.id],
        },
      }),
    ]) {
      await client.query(query);
    }
  });
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
  db: PostgresDatabase,
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
      sourceTarget: {
        kind: "plugin_action_request",
        requestId: row.id,
        ...(intent.sourceSpaceId ? { spaceId: intent.sourceSpaceId } : {}),
      },
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
      title:
        intent.purpose === "issue_destination"
          ? "Confirm an issue destination"
          : "Confirm a Plugin action",
      preview:
        "An Agent needs your confirmation for a new operation. Open the request to review it.",
    },
  });
  await db.transaction(async (client) => {
    for (const query of [
      ...prepared.statements,
      ...prepareResolveInboxItemsBySourceStatements({
        db,
        organizationId: row.organization_id,
        sourceKind: "system_attention_event",
        sourceKey: sourceKey(row.id),
        resolvedAtMs: Date.now(),
        sourceGuard: {
          sql: (offset) =>
            `EXISTS (SELECT 1 FROM "openmeld"."plugin_action_requests" WHERE id = $${offset + 1} AND (state != 'pending' OR expires_at_ms <= $${offset + 2} OR $${offset + 3} = 1))`,
          bindings: [row.id, Date.now(), state === "revoked" ? 1 : 0],
        },
      }),
    ]) {
      await client.query(query);
    }
  });
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
    sourceSignalId: intent.sourceSignalId ?? null,
    continuation: row.continuation_json
      ? pluginActionRequestContinuationSchema.parse(
          JSON.parse(row.continuation_json)
        ).state
      : null,
  };
}

async function currentState(
  db: PostgresDatabase,
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
    .query({
      text: 'SELECT id FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
      values: [row.organization_id, row.user_id],
    })
    .then((result) => result.rows[0] ?? null);
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
    !pluginPermissionAllows(
      access.policy[intent.consumer ?? "local_agent"],
      intent.effect
    )
  ) {
    return "revoked";
  }
  return row.state;
}

function readRequest(db: PostgresDatabase, id: string) {
  return db
    .query<RequestRow>({
      text: 'SELECT * FROM "openmeld"."plugin_action_requests" WHERE id = $1',
      values: [id],
    })
    .then((result) => result.rows[0] ?? null);
}
async function requireRequest(db: PostgresDatabase, id: string) {
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
