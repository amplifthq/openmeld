import type { PostgresDatabase, QueryConfig } from "@openmeld/db/postgresql";
import { createCoreRpcHttpError } from "../rpc/errors";
export type CenterAgentOrganizationDocumentOperationKind =
  | "create_folder"
  | "move_document"
  | "rename_folder"
  | "save_document";
export type CenterAgentOrganizationDocumentOperationScope = {
  actorProfileId: string;
  operationId: string;
  operationKind: CenterAgentOrganizationDocumentOperationKind;
  organizationId: string;
  representedUserId: string;
};
export type CenterAgentOrganizationDocumentOperationRecord =
  CenterAgentOrganizationDocumentOperationScope & {
    claimExpiresAtMs: number | null;
    claimId: string | null;
    createdAtMs: number;
    id: string;
    requestSignature: string;
    responseJson: string | null;
    status: "completed" | "pending";
    targetResourceId: string;
    updatedAtMs: number;
  };
export type BeginCenterAgentOrganizationDocumentOperationResult = {
  operation: CenterAgentOrganizationDocumentOperationRecord;
  outcome: "claimed" | "completed_replay" | "pending_in_progress";
};
type CenterAgentOrganizationDocumentOperationRow = {
  actor_profile_id: string;
  claim_expires_at_ms: number | null;
  claim_id: string | null;
  created_at_ms: number;
  id: string;
  operation_id: string;
  operation_kind: CenterAgentOrganizationDocumentOperationKind;
  organization_id: string;
  represented_user_id: string;
  request_signature: string;
  response_json: string | null;
  status: "completed" | "pending";
  target_resource_id: string;
  updated_at_ms: number;
};
export const CENTER_AGENT_DOCUMENT_OPERATION_CLAIM_LEASE_MS = 5 * 60_000;
export async function buildCenterAgentOrganizationDocumentRequestSignature(
  value: unknown
): Promise<string> {
  return await sha256Hex(stableJson(value));
}
export async function beginCenterAgentOrganizationDocumentOperation(input: {
  db: PostgresDatabase;
  nowMs: number;
  requestSignature: string;
  scope: CenterAgentOrganizationDocumentOperationScope;
  targetResourceId: string;
}): Promise<BeginCenterAgentOrganizationDocumentOperationResult> {
  const id = `center_agent_org_document_operation_${crypto.randomUUID()}`;
  const claimId = `center_agent_org_document_claim_${crypto.randomUUID()}`;
  const claimExpiresAtMs =
    input.nowMs + CENTER_AGENT_DOCUMENT_OPERATION_CLAIM_LEASE_MS;
  const insert = await input.db.query({
    text: `
        INSERT INTO "openmeld"."center_agent_organization_document_operations" (
          id,
          organization_id,
          actor_profile_id,
          represented_user_id,
          operation_id,
          operation_kind,
          request_signature,
          target_resource_id,
          response_json,
          status,
          claim_id,
          claim_expires_at_ms,
          created_at_ms,
          updated_at_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 'pending', $9, $10, $11, $12) ON CONFLICT DO NOTHING`,
    values: [
      id,
      input.scope.organizationId,
      input.scope.actorProfileId,
      input.scope.representedUserId,
      input.scope.operationId,
      input.scope.operationKind,
      input.requestSignature,
      input.targetResourceId,
      claimId,
      claimExpiresAtMs,
      input.nowMs,
      input.nowMs,
    ],
  });
  const operation = await readCenterAgentOrganizationDocumentOperation({
    db: input.db,
    scope: input.scope,
  });
  if (!operation) {
    throw new Error("Center Agent document operation could not be claimed.");
  }
  requireCenterAgentOrganizationDocumentOperationRequestMatch({
    operation,
    requestSignature: input.requestSignature,
  });
  if (Number(insert.rowCount ?? 0) === 1) {
    if (operation.id !== id || operation.status !== "pending") {
      throw new Error(
        "Center Agent document operation claim did not preserve its inserted pending row."
      );
    }
    return { operation, outcome: "claimed" };
  }
  if (operation.status === "completed") {
    return { operation, outcome: "completed_replay" };
  }
  if ((operation.claimId === null) !== (operation.claimExpiresAtMs === null)) {
    throw new Error(
      "Center Agent document operation has an incomplete pending claim."
    );
  }
  const effectiveClaimExpiresAtMs =
    operation.claimExpiresAtMs ??
    operation.updatedAtMs + CENTER_AGENT_DOCUMENT_OPERATION_CLAIM_LEASE_MS;
  if (effectiveClaimExpiresAtMs > input.nowMs) {
    return { operation, outcome: "pending_in_progress" };
  }
  const legacyClaimCutoffMs =
    input.nowMs - CENTER_AGENT_DOCUMENT_OPERATION_CLAIM_LEASE_MS;
  const takeover = await input.db.query({
    text: `
        UPDATE "openmeld"."center_agent_organization_document_operations"
        SET
          claim_id = $1,
          claim_expires_at_ms = $2,
          updated_at_ms = $3
        WHERE id = $4
          AND status = 'pending'
          AND (
            (
              claim_id IS NOT NULL
              AND claim_expires_at_ms <= $5
            )
            OR (
              claim_id IS NULL
              AND claim_expires_at_ms IS NULL
              AND updated_at_ms <= $6
            )
          )
      `,
    values: [
      claimId,
      claimExpiresAtMs,
      input.nowMs,
      operation.id,
      input.nowMs,
      legacyClaimCutoffMs,
    ],
  });
  if (Number(takeover.rowCount ?? 0) !== 1) {
    const current = await readCenterAgentOrganizationDocumentOperation({
      db: input.db,
      scope: input.scope,
    });
    if (!current) {
      throw new Error(
        "Center Agent document operation disappeared during claim recovery."
      );
    }
    requireCenterAgentOrganizationDocumentOperationRequestMatch({
      operation: current,
      requestSignature: input.requestSignature,
    });
    return {
      operation: current,
      outcome:
        current.status === "completed"
          ? "completed_replay"
          : "pending_in_progress",
    };
  }
  const recovered = await readCenterAgentOrganizationDocumentOperation({
    db: input.db,
    scope: input.scope,
  });
  if (
    !recovered ||
    recovered.status !== "pending" ||
    recovered.claimId !== claimId
  ) {
    throw new Error(
      "Center Agent document operation recovery did not preserve its claim."
    );
  }
  return { operation: recovered, outcome: "claimed" };
}
export function prepareCompleteCenterAgentOrganizationDocumentOperationStatement(input: {
  db: PostgresDatabase;
  claimId: string;
  nowMs: number;
  operationRecordId: string;
  responseJson: string;
}): QueryConfig {
  return {
    text: `
        UPDATE "openmeld"."center_agent_organization_document_operations"
        SET
          response_json = $1,
          status = 'completed',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = $2
        WHERE id = $3
          AND status = 'pending'
          AND claim_id = $4
      `,
    values: [
      input.responseJson,
      input.nowMs,
      input.operationRecordId,
      input.claimId,
    ],
  };
}
export async function readCenterAgentOrganizationDocumentOperation(input: {
  db: PostgresDatabase;
  scope: CenterAgentOrganizationDocumentOperationScope;
}): Promise<CenterAgentOrganizationDocumentOperationRecord | null> {
  const row = await input.db
    .query<CenterAgentOrganizationDocumentOperationRow>({
      text: `
        SELECT *
        FROM "openmeld"."center_agent_organization_document_operations"
        WHERE organization_id = $1
          AND actor_profile_id = $2
          AND represented_user_id = $3
          AND operation_kind = $4
          AND operation_id = $5
        LIMIT 1
      `,
      values: [
        input.scope.organizationId,
        input.scope.actorProfileId,
        input.scope.representedUserId,
        input.scope.operationKind,
        input.scope.operationId,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapOperation(row) : null;
}
export function requireCenterAgentOrganizationDocumentOperationRequestMatch(input: {
  operation: CenterAgentOrganizationDocumentOperationRecord;
  requestSignature: string;
}): void {
  if (input.operation.requestSignature === input.requestSignature) {
    return;
  }
  throw createCoreRpcHttpError({
    code: "organization_document.operation_conflict",
    reason:
      "This Organization document operation ID was already used for a different request.",
    status: 409,
  });
}
function mapOperation(
  row: CenterAgentOrganizationDocumentOperationRow
): CenterAgentOrganizationDocumentOperationRecord {
  return {
    actorProfileId: row.actor_profile_id,
    claimExpiresAtMs:
      row.claim_expires_at_ms === null ? null : Number(row.claim_expires_at_ms),
    claimId: row.claim_id,
    createdAtMs: Number(row.created_at_ms),
    id: row.id,
    operationId: row.operation_id,
    operationKind: row.operation_kind,
    organizationId: row.organization_id,
    representedUserId: row.represented_user_id,
    requestSignature: row.request_signature,
    responseJson: row.response_json,
    status: row.status,
    targetResourceId: row.target_resource_id,
    updatedAtMs: Number(row.updated_at_ms),
  };
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
      "Center Agent Organization document operation payload is not serializable."
    );
  }
  return serialized;
}
