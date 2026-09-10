import { createCoreRpcHttpError } from "../rpc/errors";

export type CenterAgentPublicationDestinationKind =
  | "slack_channel"
  | "slack_file"
  | "message_channel_file";
export type CenterAgentPublicationSourceKind =
  | "organization_document"
  | "remote_agent_execution"
  | "routine_run";

export type CenterAgentPublicationSource = {
  kind: CenterAgentPublicationSourceKind;
  sourceId: string;
  sourceRevision: string;
};

export type CenterAgentPublicationOperationStatus =
  | "completed"
  | "failed"
  | "outcome_unknown"
  | "pending";

export type CenterAgentPublicationOperationRecord = {
  actorProfileId: string;
  claimExpiresAtMs: number | null;
  claimId: string | null;
  createdAtMs: number;
  destinationId: string;
  destinationKind: CenterAgentPublicationDestinationKind;
  id: string;
  organizationId: string;
  operationKey: string;
  representedUserId: string;
  requestSignature: string;
  responseJson: string | null;
  source: CenterAgentPublicationSource;
  status: CenterAgentPublicationOperationStatus;
  updatedAtMs: number;
};

export type BeginCenterAgentPublicationOperationResult = {
  operation: CenterAgentPublicationOperationRecord;
  outcome:
    | "claimed"
    | "completed_replay"
    | "outcome_unknown"
    | "pending_in_progress";
};

type CenterAgentPublicationOperationRow = {
  actor_profile_id: string;
  claim_expires_at_ms: number | null;
  claim_id: string | null;
  created_at_ms: number;
  destination_id: string;
  destination_kind: CenterAgentPublicationDestinationKind;
  id: string;
  organization_id: string;
  operation_key: string;
  represented_user_id: string;
  request_signature: string;
  response_json: string | null;
  source_id: string;
  source_kind: CenterAgentPublicationSourceKind;
  source_revision: string;
  status: CenterAgentPublicationOperationStatus;
  updated_at_ms: number;
};

type BeginCenterAgentPublicationOperationInput = {
  actorProfileId: string;
  db: D1Database;
  destinationId: string;
  destinationKind: CenterAgentPublicationDestinationKind;
  nowMs: number;
  organizationId: string;
  operationKey: string;
  representedUserId: string;
  requestSignature: string;
  source: CenterAgentPublicationSource;
};

export const CENTER_AGENT_PUBLICATION_CLAIM_LEASE_MS = 5 * 60_000;
export const CENTER_AGENT_PUBLICATION_DEFAULT_OPERATION_KEY = "source";

export async function buildCenterAgentPublicationRequestSignature(
  value: unknown
): Promise<string> {
  return await sha256Hex(stableJson(value));
}

export async function buildCenterAgentPublicationSourceRevision(
  value: unknown
): Promise<string> {
  return await sha256Hex(stableJson(value));
}

export async function beginCenterAgentPublicationOperation(
  input: BeginCenterAgentPublicationOperationInput
): Promise<BeginCenterAgentPublicationOperationResult> {
  const id = `center_agent_publication_operation_${crypto.randomUUID()}`;
  const claimId = `center_agent_publication_claim_${crypto.randomUUID()}`;
  const claimExpiresAtMs =
    input.nowMs + CENTER_AGENT_PUBLICATION_CLAIM_LEASE_MS;
  const inserted = await input.db
    .prepare(
      `
        INSERT OR IGNORE INTO center_agent_publication_operations (
          id,
          organization_id,
          actor_profile_id,
          represented_user_id,
          source_kind,
          source_id,
          source_revision,
          operation_key,
          destination_kind,
          destination_id,
          request_signature,
          status,
          response_json,
          claim_id,
          claim_expires_at_ms,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, ?, ?)
      `
    )
    .bind(
      id,
      input.organizationId,
      input.actorProfileId,
      input.representedUserId,
      input.source.kind,
      input.source.sourceId,
      input.source.sourceRevision,
      input.operationKey,
      input.destinationKind,
      input.destinationId,
      input.requestSignature,
      claimId,
      claimExpiresAtMs,
      input.nowMs,
      input.nowMs
    )
    .run();

  if (Number(inserted.meta?.changes ?? 0) === 1) {
    const operation = await requireCenterAgentPublicationOperation({
      db: input.db,
      input,
    });
    assertSamePublicationRequest(operation, input);
    if (
      operation.id !== id ||
      operation.status !== "pending" ||
      operation.claimId !== claimId
    ) {
      throw new Error(
        "Center Agent publication claim did not preserve its inserted pending row."
      );
    }
    return { operation, outcome: "claimed" };
  }

  return await settleExistingCenterAgentPublicationOperation({
    claimExpiresAtMs,
    claimId,
    input,
  });
}

async function settleExistingCenterAgentPublicationOperation(input: {
  claimExpiresAtMs: number;
  claimId: string;
  input: BeginCenterAgentPublicationOperationInput;
}): Promise<BeginCenterAgentPublicationOperationResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const operation = await requireCenterAgentPublicationOperation({
      db: input.input.db,
      input: input.input,
    });
    assertSamePublicationRequest(operation, input.input);
    switch (operation.status) {
      case "completed":
        return { operation, outcome: "completed_replay" };
      case "outcome_unknown":
        return { operation, outcome: "outcome_unknown" };
      case "failed": {
        const reclaimed = await reclaimFailedCenterAgentPublicationOperation({
          claimExpiresAtMs: input.claimExpiresAtMs,
          claimId: input.claimId,
          input: input.input,
          operation,
        });
        if (reclaimed) {
          return { operation: reclaimed, outcome: "claimed" };
        }
        break;
      }
      case "pending": {
        const pending = await settlePendingCenterAgentPublicationOperation({
          input: input.input,
          operation,
        });
        if (pending) {
          return pending;
        }
        break;
      }
      default:
        throw new Error("Center Agent publication has an unsupported status.");
    }
  }
  throw new Error(
    "Center Agent publication could not settle a concurrent claim transition."
  );
}

async function reclaimFailedCenterAgentPublicationOperation(input: {
  claimExpiresAtMs: number;
  claimId: string;
  input: BeginCenterAgentPublicationOperationInput;
  operation: CenterAgentPublicationOperationRecord;
}): Promise<CenterAgentPublicationOperationRecord | null> {
  const reclaimed = await input.input.db
    .prepare(
      `
        UPDATE center_agent_publication_operations
        SET
          status = 'pending',
          claim_id = ?,
          claim_expires_at_ms = ?,
          updated_at_ms = ?
        WHERE id = ? AND status = 'failed'
      `
    )
    .bind(
      input.claimId,
      input.claimExpiresAtMs,
      input.input.nowMs,
      input.operation.id
    )
    .run();
  if (Number(reclaimed.meta?.changes ?? 0) !== 1) {
    return null;
  }
  const claimed = await requireCenterAgentPublicationOperation({
    db: input.input.db,
    input: input.input,
  });
  if (claimed.status !== "pending" || claimed.claimId !== input.claimId) {
    throw new Error(
      "Center Agent publication retry did not preserve its current claim."
    );
  }
  return claimed;
}

async function settlePendingCenterAgentPublicationOperation(input: {
  input: BeginCenterAgentPublicationOperationInput;
  operation: CenterAgentPublicationOperationRecord;
}): Promise<BeginCenterAgentPublicationOperationResult | null> {
  const { operation } = input;
  if (!(operation.claimId && operation.claimExpiresAtMs !== null)) {
    throw new Error(
      "Center Agent publication has an incomplete pending claim."
    );
  }
  if (operation.claimExpiresAtMs > input.input.nowMs) {
    return { operation, outcome: "pending_in_progress" };
  }
  const closed = await input.input.db
    .prepare(
      `
        UPDATE center_agent_publication_operations
        SET
          status = 'outcome_unknown',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE id = ?
          AND status = 'pending'
          AND claim_id = ?
          AND claim_expires_at_ms <= ?
      `
    )
    .bind(input.input.nowMs, operation.id, operation.claimId, input.input.nowMs)
    .run();
  if (Number(closed.meta?.changes ?? 0) !== 1) {
    return null;
  }
  const outcomeUnknown = await requireCenterAgentPublicationOperation({
    db: input.input.db,
    input: input.input,
  });
  return { operation: outcomeUnknown, outcome: "outcome_unknown" };
}

export async function completeCenterAgentPublicationOperation(input: {
  claimId: string;
  db: D1Database;
  nowMs: number;
  operationId: string;
  responseJson: string;
}): Promise<void> {
  const result = await input.db
    .prepare(
      `
        UPDATE center_agent_publication_operations
        SET
          response_json = ?,
          status = 'completed',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE id = ?
          AND status = 'pending'
          AND claim_id = ?
      `
    )
    .bind(input.responseJson, input.nowMs, input.operationId, input.claimId)
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new Error(
      "Center Agent publication could not be completed by the current claim."
    );
  }
}

export async function failCenterAgentPublicationOperation(input: {
  claimId: string;
  db: D1Database;
  nowMs: number;
  operationId: string;
  outcome: "failed" | "outcome_unknown";
}): Promise<void> {
  const result = await input.db
    .prepare(
      `
        UPDATE center_agent_publication_operations
        SET
          status = ?,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE id = ?
          AND status = 'pending'
          AND claim_id = ?
      `
    )
    .bind(input.outcome, input.nowMs, input.operationId, input.claimId)
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new Error(
      "Center Agent publication outcome could not be recorded by the current claim."
    );
  }
}

async function requireCenterAgentPublicationOperation(input: {
  db: D1Database;
  input: {
    actorProfileId: string;
    destinationId: string;
    destinationKind: CenterAgentPublicationDestinationKind;
    operationKey: string;
    organizationId: string;
    source: CenterAgentPublicationSource;
  };
}): Promise<CenterAgentPublicationOperationRecord> {
  const row = await input.db
    .prepare(
      `
        SELECT *
        FROM center_agent_publication_operations
        WHERE organization_id = ?
          AND actor_profile_id = ?
          AND source_kind = ?
          AND source_id = ?
          AND source_revision = ?
          AND operation_key = ?
          AND destination_kind = ?
          AND destination_id = ?
        LIMIT 1
      `
    )
    .bind(
      input.input.organizationId,
      input.input.actorProfileId,
      input.input.source.kind,
      input.input.source.sourceId,
      input.input.source.sourceRevision,
      input.input.operationKey,
      input.input.destinationKind,
      input.input.destinationId
    )
    .first<CenterAgentPublicationOperationRow>();
  if (!row) {
    throw new Error("Center Agent publication operation could not be claimed.");
  }
  return mapOperation(row);
}

function assertSamePublicationRequest(
  operation: CenterAgentPublicationOperationRecord,
  input: {
    representedUserId: string;
    requestSignature: string;
  }
): void {
  if (
    operation.representedUserId === input.representedUserId &&
    operation.requestSignature === input.requestSignature
  ) {
    return;
  }
  throw publicationConflict(
    "This publication operation was already used for different content or a different represented member."
  );
}

function mapOperation(
  row: CenterAgentPublicationOperationRow
): CenterAgentPublicationOperationRecord {
  return {
    actorProfileId: row.actor_profile_id,
    claimExpiresAtMs:
      row.claim_expires_at_ms === null ? null : Number(row.claim_expires_at_ms),
    claimId: row.claim_id,
    createdAtMs: Number(row.created_at_ms),
    destinationId: row.destination_id,
    destinationKind: row.destination_kind,
    id: row.id,
    organizationId: row.organization_id,
    operationKey: row.operation_key,
    representedUserId: row.represented_user_id,
    requestSignature: row.request_signature,
    responseJson: row.response_json,
    source: {
      kind: row.source_kind,
      sourceId: row.source_id,
      sourceRevision: row.source_revision,
    },
    status: row.status,
    updatedAtMs: Number(row.updated_at_ms),
  };
}

function publicationConflict(reason: string): Error {
  return createCoreRpcHttpError({
    code: "center_agent.publication_conflict",
    reason,
    status: 409,
  });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function stableJson(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError(
      "Center Agent publication payload is not serializable."
    );
  }
  return serialized;
}
