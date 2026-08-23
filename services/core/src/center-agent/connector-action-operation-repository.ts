import type {
  CenterAgentAction,
  CenterAgentAttribution,
  CenterAgentConnectorActionExecutionConnection,
  CenterAgentConnectorActionOperationStatus,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../rpc/errors";
import { prepareCenterAgentAuditJournalEntryIfMissingStatement } from "./center-agent-repository";

export type CenterAgentConnectorActionOperationScope = {
  actorProfileId: string;
  operationId: string;
  organizationId: string;
} & CenterAgentConnectorActionRequesterAttribution;

export type CenterAgentConnectorActionRequester =
  | {
      kind: "represented_member";
      representedUserId: string;
    }
  | {
      kind: "connected_message_channel_member";
      sourceNativeDeliveryId: string;
    };

type CenterAgentConnectorActionRequesterAttribution =
  | {
      representedUserId: string;
      requesterAttributionKey: string;
      sourceNativeDeliveryId: null;
    }
  | {
      representedUserId: null;
      requesterAttributionKey: string;
      sourceNativeDeliveryId: string;
    };

export type CenterAgentConnectorActionOperationRecord =
  CenterAgentConnectorActionOperationScope & {
    actionId: string;
    connectionName: string;
    createdAtMs: number;
    executionConnection: CenterAgentConnectorActionExecutionConnection | null;
    id: string;
    providerExecutionId: string | null;
    requestSignature: string;
    service: string;
    status: CenterAgentConnectorActionOperationStatus;
    updatedAtMs: number;
  };

type CenterAgentConnectorActionOperationRow = {
  action_id: string;
  actor_profile_id: string;
  connection_name: string;
  connection_owner_display_name: string | null;
  connection_owner_user_id: string | null;
  connection_scope: string | null;
  created_at_ms: number;
  id: string;
  operation_id: string;
  organization_id: string;
  provider_execution_id: string | null;
  represented_user_id: string | null;
  requester_attribution_key: string;
  request_signature: string;
  service: string;
  source_native_delivery_id: string | null;
  status: CenterAgentConnectorActionOperationStatus;
  updated_at_ms: number;
};

type CenterAgentConnectorActionOperationAttributionRow = {
  actor_profile_id: string;
  on_behalf_of_display_name: string | null;
  on_behalf_of_profile_id: string | null;
  on_behalf_of_user_id: string | null;
  source_native_delivery_id: string | null;
  source_space_id: string | null;
};

type CenterAgentConnectorActionOperationProvenance = {
  attribution: CenterAgentAttribution;
  sourceSpaceId: string | null;
};

export function buildCenterAgentConnectorActionOperationScope(input: {
  actorProfileId: string;
  operationId: string;
  organizationId: string;
  requester: CenterAgentConnectorActionRequester;
}): CenterAgentConnectorActionOperationScope {
  return {
    actorProfileId: input.actorProfileId,
    operationId: input.operationId,
    organizationId: input.organizationId,
    ...resolveRequesterAttribution(input.requester),
  };
}

export async function readCenterAgentConnectorActionOperationForRecovery(input: {
  actionId: string;
  db: D1Database;
  scope: CenterAgentConnectorActionOperationScope;
  service: string;
}): Promise<CenterAgentConnectorActionOperationRecord | null> {
  const operation = await readOperation({
    db: input.db,
    scope: input.scope,
  });
  if (!operation) {
    return null;
  }
  if (
    operation.actionId !== input.actionId ||
    operation.service !== input.service
  ) {
    throw operationConflict(
      "This connector action operation ID was already used for a different request."
    );
  }
  return operation;
}

export async function readCenterAgentConnectorActionOperationForRequest(input: {
  actionId: string;
  db: D1Database;
  requestSignature: string;
  scope: CenterAgentConnectorActionOperationScope;
  service: string;
}): Promise<{
  attribution: CenterAgentAttribution;
  operation: CenterAgentConnectorActionOperationRecord;
} | null> {
  const operation = await readOperation({
    db: input.db,
    scope: input.scope,
  });
  if (!operation) {
    return null;
  }
  assertSameRequest(operation, input);
  const provenance = await requireOperationProvenance({
    db: input.db,
    operation,
  });
  return {
    attribution: provenance.attribution,
    operation,
  };
}

export async function recordCenterAgentConnectorActionOperation(input: {
  actionId: string;
  actorProfileId: string;
  attribution?: CenterAgentAttribution;
  connectionName: string;
  db: D1Database;
  executionConnection?: CenterAgentConnectorActionExecutionConnection;
  nowMs: number;
  operationId: string;
  organizationId: string;
  outcome: "attempted" | "completed" | "failed" | "outcome_unknown";
  providerExecutionId: string | null;
  requester: CenterAgentConnectorActionRequester;
  requestSignature: string;
  service: string;
  sourceSpaceId?: string | null;
}): Promise<{
  attribution: CenterAgentAttribution;
  operation: CenterAgentConnectorActionOperationRecord;
  replayed: boolean;
}> {
  const scope = buildCenterAgentConnectorActionOperationScope({
    actorProfileId: input.actorProfileId,
    operationId: input.operationId,
    organizationId: input.organizationId,
    requester: input.requester,
  });
  const recordId = await buildOperationRecordId(scope);
  const existing = await readOperation({ db: input.db, scope });

  if (existing) {
    assertSameRequest(existing, input);
  }
  const existingProvenance = existing
    ? await requireOperationProvenance({ db: input.db, operation: existing })
    : null;
  const existingAttribution = existingProvenance?.attribution ?? null;

  if (input.outcome === "attempted") {
    if (existing) {
      return {
        attribution: requireExistingAttribution(existingAttribution),
        operation: existing,
        replayed: true,
      };
    }
    const attribution = requireNewOperationAttribution({
      actorProfileId: input.actorProfileId,
      attribution: input.attribution,
      representedUserId: scope.representedUserId,
      sourceNativeDeliveryId: scope.sourceNativeDeliveryId,
    });
    const executionConnection = requireNewOperationExecutionConnection(input);
    const auditAction = resolveAuditAction(input.outcome);
    const [insertResult] = await input.db.batch([
      prepareInsertOperationStatement({
        ...input,
        attribution,
        executionConnection,
        id: recordId,
        requesterAttributionKey: scope.requesterAttributionKey,
        representedUserId: scope.representedUserId,
        sourceNativeDeliveryId: scope.sourceNativeDeliveryId,
        status: "pending",
      }),
      prepareCenterAgentAuditJournalEntryIfMissingStatement({
        action: auditAction,
        actorProfileId: input.actorProfileId,
        attribution,
        db: input.db,
        id: `${recordId}:attempted`,
        nowMs: input.nowMs,
        organizationId: input.organizationId,
        resource: operationAuditResource(input),
        sourceNativeDeliveryId: scope.sourceNativeDeliveryId,
        sourceSpaceId: input.sourceSpaceId ?? null,
      }),
    ]);
    const operation = await requireOperation({ db: input.db, scope });
    assertSameRequest(operation, input);
    return {
      attribution: (
        await requireOperationProvenance({ db: input.db, operation })
      ).attribution,
      operation,
      replayed: Number(insertResult?.meta.changes ?? 0) !== 1,
    };
  }

  if (!existing) {
    throw operationConflict(
      "This connector action operation has not been claimed."
    );
  }
  if (
    existing.status === input.outcome &&
    existing.providerExecutionId === input.providerExecutionId
  ) {
    return {
      attribution: requireExistingAttribution(existingAttribution),
      operation: existing,
      replayed: true,
    };
  }
  if (existing.status !== "pending" && existing.status !== "outcome_unknown") {
    throw operationConflict(
      "This connector action operation already has a different final outcome."
    );
  }
  if (
    existing.status === "outcome_unknown" &&
    input.outcome === "outcome_unknown"
  ) {
    throw operationConflict(
      "This connector action operation already has different provider evidence."
    );
  }

  const [, updateResult] = await input.db.batch([
    prepareFinalizeAuditStatement({
      action: resolveAuditAction(input.outcome),
      attribution: requireExistingAttribution(existingAttribution),
      db: input.db,
      id: `${recordId}:${input.outcome}`,
      nowMs: input.nowMs,
      operationRecordId: existing.id,
      organizationId: input.organizationId,
      resource: operationAuditResource(input),
      sourceNativeDeliveryId: existing.sourceNativeDeliveryId,
      sourceSpaceId: existingProvenance?.sourceSpaceId ?? null,
    }),
    prepareFinalizeOperationStatement({
      db: input.db,
      id: existing.id,
      nowMs: input.nowMs,
      outcome: input.outcome,
      providerExecutionId: input.providerExecutionId,
    }),
  ]);
  const operation = await requireOperation({ db: input.db, scope });
  assertSameRequest(operation, input);
  if (
    operation.status !== input.outcome ||
    operation.providerExecutionId !== input.providerExecutionId
  ) {
    throw operationConflict(
      "This connector action operation was finalized concurrently with a different outcome."
    );
  }
  return {
    attribution: requireExistingAttribution(existingAttribution),
    operation,
    replayed: Number(updateResult?.meta.changes ?? 0) !== 1,
  };
}

function requireNewOperationAttribution(input: {
  actorProfileId: string;
  attribution?: CenterAgentAttribution;
  representedUserId: string | null;
  sourceNativeDeliveryId: string | null;
}): CenterAgentAttribution {
  if (
    !input.attribution ||
    input.attribution.actorProfileId !== input.actorProfileId ||
    (input.representedUserId
      ? input.attribution.onBehalfOf?.userId !== input.representedUserId
      : input.attribution.onBehalfOf !== null) ||
    (input.sourceNativeDeliveryId
      ? input.attribution.onBehalfOf !== null
      : input.attribution.onBehalfOf === null)
  ) {
    throw new Error(
      "A matching Center Agent attribution is required to claim a connector action operation."
    );
  }
  return input.attribution;
}

function requireNewOperationExecutionConnection(input: {
  connectionName: string;
  executionConnection?: CenterAgentConnectorActionExecutionConnection;
  service: string;
}): CenterAgentConnectorActionExecutionConnection {
  if (
    !input.executionConnection ||
    input.executionConnection.connectionName !== input.connectionName ||
    input.executionConnection.service !== input.service
  ) {
    throw new Error(
      "A matching connector execution connection is required to claim a connector action operation."
    );
  }
  return input.executionConnection;
}

function requireExistingAttribution(
  attribution: CenterAgentAttribution | null
): CenterAgentAttribution {
  if (!attribution) {
    throw new Error(
      "Center Agent connector action operation attribution was not stored."
    );
  }
  return attribution;
}

function prepareFinalizeAuditStatement(input: {
  action: CenterAgentAction;
  attribution: CenterAgentAttribution;
  db: D1Database;
  id: string;
  nowMs: number;
  operationRecordId: string;
  organizationId: string;
  resource: { id: string; type: string };
  sourceNativeDeliveryId: string | null;
  sourceSpaceId: string | null;
}): D1PreparedStatement {
  const onBehalfOf = input.attribution.onBehalfOf;
  return input.db
    .prepare(
      `
        INSERT OR IGNORE INTO center_agent_audit_journal (
          id,
          organization_id,
          actor_profile_id,
          action,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          resource_type,
          resource_id,
          source_native_delivery_id,
          source_space_id,
          created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM center_agent_connector_action_operations
          WHERE id = ?
            AND status IN ('pending', 'outcome_unknown')
        )
      `
    )
    .bind(
      input.id,
      input.organizationId,
      input.attribution.actorProfileId,
      input.action,
      onBehalfOf?.profileId ?? null,
      onBehalfOf?.userId ?? null,
      onBehalfOf?.displayName ?? null,
      input.resource.type,
      input.resource.id,
      input.sourceNativeDeliveryId,
      input.sourceSpaceId,
      input.nowMs,
      input.operationRecordId
    );
}

function prepareInsertOperationStatement(input: {
  actionId: string;
  connectionName: string;
  db: D1Database;
  executionConnection: CenterAgentConnectorActionExecutionConnection;
  id: string;
  nowMs: number;
  operationId: string;
  organizationId: string;
  providerExecutionId: string | null;
  representedUserId: string | null;
  requesterAttributionKey: string;
  requestSignature: string;
  service: string;
  sourceNativeDeliveryId: string | null;
  status: CenterAgentConnectorActionOperationStatus;
  attribution: CenterAgentAttribution;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        INSERT OR IGNORE INTO center_agent_connector_action_operations (
          id,
          organization_id,
          actor_profile_id,
          requester_attribution_key,
          represented_user_id,
          source_native_delivery_id,
          operation_id,
          request_signature,
          service,
          action_id,
          connection_name,
          connection_owner_display_name,
          connection_owner_user_id,
          connection_scope,
          status,
          provider_execution_id,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      input.id,
      input.organizationId,
      input.attribution.actorProfileId,
      input.requesterAttributionKey,
      input.representedUserId,
      input.sourceNativeDeliveryId,
      input.operationId,
      input.requestSignature,
      input.service,
      input.actionId,
      input.connectionName,
      input.executionConnection.ownerDisplayName,
      input.executionConnection.ownerUserId,
      input.executionConnection.scope,
      input.status,
      input.providerExecutionId,
      input.nowMs,
      input.nowMs
    );
}

function prepareFinalizeOperationStatement(input: {
  db: D1Database;
  id: string;
  nowMs: number;
  outcome: Exclude<CenterAgentConnectorActionOperationStatus, "pending">;
  providerExecutionId: string | null;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        UPDATE center_agent_connector_action_operations
        SET status = ?, provider_execution_id = ?, updated_at_ms = ?
        WHERE id = ?
          AND status IN ('pending', 'outcome_unknown')
      `
    )
    .bind(input.outcome, input.providerExecutionId, input.nowMs, input.id);
}

async function requireOperation(input: {
  db: D1Database;
  scope: CenterAgentConnectorActionOperationScope;
}): Promise<CenterAgentConnectorActionOperationRecord> {
  const operation = await readOperation(input);
  if (!operation) {
    throw new Error("Center Agent connector action operation was not stored.");
  }
  return operation;
}

async function readOperation(input: {
  db: D1Database;
  scope: CenterAgentConnectorActionOperationScope;
}): Promise<CenterAgentConnectorActionOperationRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT *
        FROM center_agent_connector_action_operations
        WHERE organization_id = ?
          AND actor_profile_id = ?
          AND requester_attribution_key = ?
          AND operation_id = ?
        LIMIT 1
      `
    )
    .bind(
      input.scope.organizationId,
      input.scope.actorProfileId,
      input.scope.requesterAttributionKey,
      input.scope.operationId
    )
    .first<CenterAgentConnectorActionOperationRow>();
  return row ? mapOperation(row) : null;
}

function assertSameRequest(
  operation: CenterAgentConnectorActionOperationRecord,
  input: {
    actionId: string;
    requestSignature: string;
    service: string;
  }
): void {
  if (
    operation.requestSignature !== input.requestSignature ||
    operation.service !== input.service ||
    operation.actionId !== input.actionId
  ) {
    throw operationConflict(
      "This connector action operation ID was already used for a different request."
    );
  }
}

async function requireOperationProvenance(input: {
  db: D1Database;
  operation: CenterAgentConnectorActionOperationRecord;
}): Promise<CenterAgentConnectorActionOperationProvenance> {
  const row = await input.db
    .prepare(
      `
        SELECT
          actor_profile_id,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          source_native_delivery_id,
          source_space_id
        FROM center_agent_audit_journal
        WHERE id = ?
          AND organization_id = ?
          AND action = 'execute_connector_action'
        LIMIT 1
      `
    )
    .bind(`${input.operation.id}:attempted`, input.operation.organizationId)
    .first<CenterAgentConnectorActionOperationAttributionRow>();
  if (!row || row.actor_profile_id !== input.operation.actorProfileId) {
    throw new Error(
      "Center Agent connector action operation attribution was not stored."
    );
  }
  if (input.operation.sourceNativeDeliveryId) {
    if (
      row.source_native_delivery_id !==
        input.operation.sourceNativeDeliveryId ||
      row.on_behalf_of_profile_id !== null ||
      row.on_behalf_of_user_id !== null ||
      row.on_behalf_of_display_name !== null
    ) {
      throw new Error(
        "Center Agent connector action delivery attribution was not stored."
      );
    }
    return {
      attribution: {
        actorProfileId: row.actor_profile_id,
        onBehalfOf: null,
      },
      sourceSpaceId: row.source_space_id,
    };
  }
  if (
    row.source_native_delivery_id !== null ||
    !row.on_behalf_of_profile_id ||
    row.on_behalf_of_user_id !== input.operation.representedUserId ||
    !row.on_behalf_of_display_name
  ) {
    throw new Error(
      "Center Agent connector action member attribution was not stored."
    );
  }
  return {
    attribution: {
      actorProfileId: row.actor_profile_id,
      onBehalfOf: {
        displayName: row.on_behalf_of_display_name,
        profileId: row.on_behalf_of_profile_id,
        userId: row.on_behalf_of_user_id,
      },
    },
    sourceSpaceId: row.source_space_id,
  };
}

function mapOperation(
  row: CenterAgentConnectorActionOperationRow
): CenterAgentConnectorActionOperationRecord {
  const requesterAttribution = resolveStoredRequesterAttribution({
    representedUserId: row.represented_user_id,
    sourceNativeDeliveryId: row.source_native_delivery_id,
  });
  if (
    requesterAttribution.requesterAttributionKey !==
    row.requester_attribution_key
  ) {
    throw new Error(
      "Center Agent connector action requester attribution is inconsistent."
    );
  }
  return {
    actionId: row.action_id,
    actorProfileId: row.actor_profile_id,
    connectionName: row.connection_name,
    createdAtMs: Number(row.created_at_ms),
    executionConnection: mapExecutionConnection(row),
    id: row.id,
    operationId: row.operation_id,
    organizationId: row.organization_id,
    providerExecutionId: row.provider_execution_id,
    ...requesterAttribution,
    requestSignature: row.request_signature,
    service: row.service,
    status: row.status,
    updatedAtMs: Number(row.updated_at_ms),
  };
}

function mapExecutionConnection(
  row: CenterAgentConnectorActionOperationRow
): CenterAgentConnectorActionExecutionConnection | null {
  const values = [
    row.connection_owner_display_name,
    row.connection_owner_user_id,
    row.connection_scope,
  ];
  if (values.every((value) => value === null)) {
    return null;
  }
  if (
    !(row.connection_owner_display_name && row.connection_owner_user_id) ||
    (row.connection_scope !== "member" && row.connection_scope !== "shared")
  ) {
    throw new Error(
      "Center Agent connector action operation execution connection is incomplete."
    );
  }
  return {
    connectionName:
      row.connection_name as CenterAgentConnectorActionExecutionConnection["connectionName"],
    ownerDisplayName: row.connection_owner_display_name,
    ownerUserId: row.connection_owner_user_id,
    scope: row.connection_scope,
    service:
      row.service as CenterAgentConnectorActionExecutionConnection["service"],
  };
}

function operationAuditResource(input: {
  actionId: string;
  operationId: string;
  service: string;
}) {
  return {
    id: `${input.service}:${input.actionId}:${input.operationId}`,
    type: "connector_action",
  };
}

function resolveAuditAction(
  outcome: "attempted" | "completed" | "failed" | "outcome_unknown"
): CenterAgentAction {
  switch (outcome) {
    case "attempted":
      return "execute_connector_action";
    case "completed":
      return "complete_connector_action";
    case "failed":
      return "fail_connector_action";
    case "outcome_unknown":
      return "record_connector_action_outcome_unknown";
    default:
      throw new Error(`Unsupported connector action outcome: ${outcome}`);
  }
}

async function buildOperationRecordId(
  scope: CenterAgentConnectorActionOperationScope
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        scope.organizationId,
        scope.actorProfileId,
        scope.requesterAttributionKey,
        scope.operationId,
      ])
    )
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `center_agent_connector_action_operation_${hash}`;
}

function resolveRequesterAttribution(
  input: CenterAgentConnectorActionRequester
): CenterAgentConnectorActionRequesterAttribution {
  if (input.kind === "represented_member" && input.representedUserId) {
    return {
      representedUserId: input.representedUserId,
      requesterAttributionKey: `user:${input.representedUserId}`,
      sourceNativeDeliveryId: null,
    };
  }
  if (
    input.kind === "connected_message_channel_member" &&
    input.sourceNativeDeliveryId
  ) {
    return {
      representedUserId: null,
      requesterAttributionKey: `delivery:${input.sourceNativeDeliveryId}`,
      sourceNativeDeliveryId: input.sourceNativeDeliveryId,
    };
  }
  throw new Error(
    "A connector action operation requires one valid requester attribution source."
  );
}

function resolveStoredRequesterAttribution(input: {
  representedUserId: string | null;
  sourceNativeDeliveryId: string | null;
}): CenterAgentConnectorActionRequesterAttribution {
  if (input.representedUserId && !input.sourceNativeDeliveryId) {
    return resolveRequesterAttribution({
      kind: "represented_member",
      representedUserId: input.representedUserId,
    });
  }
  if (input.sourceNativeDeliveryId && !input.representedUserId) {
    return resolveRequesterAttribution({
      kind: "connected_message_channel_member",
      sourceNativeDeliveryId: input.sourceNativeDeliveryId,
    });
  }
  throw new Error(
    "Center Agent connector action requester attribution is inconsistent."
  );
}

function operationConflict(reason: string): Error {
  return createCoreRpcHttpError({
    code: "center_agent.connector_action_operation_conflict",
    reason,
    status: 409,
  });
}
