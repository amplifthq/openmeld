import type { PostgresDatabase, QueryConfig } from "@openmeld/db/postgresql";
import { createCoreRpcHttpError } from "../rpc/errors";
export type CenterAgentProjectOperationKind =
  | "create_project"
  | "remove_project"
  | "set_agent_profile_default_project"
  | "update_project";
export type CenterAgentProjectOperationScope = {
  actorProfileId: string;
  operationId: string;
  operationKind: CenterAgentProjectOperationKind;
  organizationId: string;
  representedUserId: string;
};
export type CenterAgentProjectOperationRecord =
  CenterAgentProjectOperationScope & {
    createdAtMs: number;
    id: string;
    requestSignature: string;
    responseJson: string | null;
    status: "completed" | "pending";
    targetResourceId: string;
    updatedAtMs: number;
  };
type CenterAgentProjectOperationRow = {
  actor_profile_id: string;
  created_at_ms: number;
  id: string;
  operation_id: string;
  operation_kind: CenterAgentProjectOperationKind;
  organization_id: string;
  represented_user_id: string;
  request_signature: string;
  response_json: string | null;
  status: "completed" | "pending";
  target_resource_id: string;
  updated_at_ms: number;
};
type CenterAgentProjectRemoveConfirmationRow = {
  actor_profile_id: string;
  consumed_at_ms: number | null;
  consumed_operation_id: string | null;
  created_at_ms: number;
  expires_at_ms: number;
  organization_id: string;
  prepared_request_id: string;
  project_id: string;
  project_updated_at_ms: number;
  represented_profile_id: string;
  represented_user_id: string;
  token_hash: string;
};
export type CenterAgentProjectRemoveConfirmation = {
  actorProfileId: string;
  consumedAtMs: number | null;
  consumedOperationId: string | null;
  createdAtMs: number;
  expiresAtMs: number;
  organizationId: string;
  preparedRequestId: string;
  projectId: string;
  projectUpdatedAtMs: number;
  representedProfileId: string;
  representedUserId: string;
  tokenHash: string;
};
const REMOVE_CONFIRMATION_TTL_MS = 15 * 60 * 1000;
export async function buildCenterAgentProjectRequestSignature(
  value: unknown
): Promise<string> {
  return await sha256Hex(stableJson(value));
}
export async function beginCenterAgentProjectOperation(input: {
  db: PostgresDatabase;
  nowMs: number;
  requestSignature: string;
  scope: CenterAgentProjectOperationScope;
  targetResourceId: string;
}): Promise<CenterAgentProjectOperationRecord> {
  const id = `center_agent_project_operation_${crypto.randomUUID()}`;
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."center_agent_project_operations" (
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
          created_at_ms,
          updated_at_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, 'pending', $9, $10) ON CONFLICT DO NOTHING`,
    values: [
      id,
      input.scope.organizationId,
      input.scope.actorProfileId,
      input.scope.representedUserId,
      input.scope.operationId,
      input.scope.operationKind,
      input.requestSignature,
      input.targetResourceId,
      input.nowMs,
      input.nowMs,
    ],
  });
  const operation = await readCenterAgentProjectOperation({
    db: input.db,
    scope: input.scope,
  });
  if (!operation) {
    throw new Error("Center Agent Project operation could not be claimed.");
  }
  if (operation.requestSignature !== input.requestSignature) {
    throw createCoreRpcHttpError({
      code: "project.operation_conflict",
      reason:
        "This Project operation ID was already used for a different request.",
      status: 409,
    });
  }
  return operation;
}
export function prepareCompleteCenterAgentProjectOperationStatement(input: {
  db: PostgresDatabase;
  nowMs: number;
  operationId: string;
  responseJson: string;
}): QueryConfig {
  return {
    text: `
        UPDATE "openmeld"."center_agent_project_operations"
        SET response_json = $1, status = 'completed', updated_at_ms = $2
        WHERE id = $3 AND status = 'pending'
      `,
    values: [input.responseJson, input.nowMs, input.operationId],
  };
}
export async function createCenterAgentProjectRemoveConfirmation(input: {
  actorProfileId: string;
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  preparedRequestId: string;
  projectId: string;
  projectUpdatedAtMs: number;
  representedProfileId: string;
  representedUserId: string;
}): Promise<{
  confirmation: CenterAgentProjectRemoveConfirmation;
  statement: QueryConfig;
  token: string;
}> {
  const token = `project_remove_${crypto.randomUUID()}_${crypto.randomUUID()}`;
  const tokenHash = await sha256Hex(token);
  const expiresAtMs = input.nowMs + REMOVE_CONFIRMATION_TTL_MS;
  const statement = {
    text: `
        INSERT INTO "openmeld"."center_agent_project_remove_confirmations" (
          token_hash,
          organization_id,
          actor_profile_id,
          represented_user_id,
          represented_profile_id,
          project_id,
          project_updated_at_ms,
          prepared_request_id,
          expires_at_ms,
          created_at_ms,
          consumed_at_ms,
          consumed_operation_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL)
      `,
    values: [
      tokenHash,
      input.organizationId,
      input.actorProfileId,
      input.representedUserId,
      input.representedProfileId,
      input.projectId,
      input.projectUpdatedAtMs,
      input.preparedRequestId,
      expiresAtMs,
      input.nowMs,
    ],
  };
  return {
    confirmation: {
      actorProfileId: input.actorProfileId,
      consumedAtMs: null,
      consumedOperationId: null,
      createdAtMs: input.nowMs,
      expiresAtMs,
      organizationId: input.organizationId,
      preparedRequestId: input.preparedRequestId,
      projectId: input.projectId,
      projectUpdatedAtMs: input.projectUpdatedAtMs,
      representedProfileId: input.representedProfileId,
      representedUserId: input.representedUserId,
      tokenHash,
    },
    statement,
    token,
  };
}
export async function readCenterAgentProjectRemoveConfirmation(input: {
  db: PostgresDatabase;
  token: string;
}): Promise<CenterAgentProjectRemoveConfirmation | null> {
  const tokenHash = await sha256Hex(input.token);
  const row = await input.db
    .query<CenterAgentProjectRemoveConfirmationRow>({
      text: `
        SELECT *
        FROM "openmeld"."center_agent_project_remove_confirmations"
        WHERE token_hash = $1
        LIMIT 1
      `,
      values: [tokenHash],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapRemoveConfirmation(row) : null;
}
export async function claimCenterAgentProjectRemoveConfirmation(input: {
  confirmation: CenterAgentProjectRemoveConfirmation;
  db: PostgresDatabase;
  nowMs: number;
  operationId: string;
}): Promise<void> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."center_agent_project_remove_confirmations"
        SET consumed_at_ms = $1, consumed_operation_id = $2
        WHERE token_hash = $3
          AND (
            consumed_operation_id IS NULL
            OR consumed_operation_id = $4
          )
      `,
    values: [
      input.nowMs,
      input.operationId,
      input.confirmation.tokenHash,
      input.operationId,
    ],
  });
  if (Number(result.rowCount ?? 0) !== 1) {
    throw invalidRemoveConfirmationError();
  }
}
export function invalidRemoveConfirmationError(): Error {
  return createCoreRpcHttpError({
    code: "project.remove_confirmation_invalid",
    reason:
      "This Project removal confirmation is invalid, expired, or already used.",
    status: 409,
  });
}
async function readCenterAgentProjectOperation(input: {
  db: PostgresDatabase;
  scope: CenterAgentProjectOperationScope;
}): Promise<CenterAgentProjectOperationRecord | null> {
  const row = await input.db
    .query<CenterAgentProjectOperationRow>({
      text: `
        SELECT *
        FROM "openmeld"."center_agent_project_operations"
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
function mapOperation(
  row: CenterAgentProjectOperationRow
): CenterAgentProjectOperationRecord {
  return {
    actorProfileId: row.actor_profile_id,
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
function mapRemoveConfirmation(
  row: CenterAgentProjectRemoveConfirmationRow
): CenterAgentProjectRemoveConfirmation {
  return {
    actorProfileId: row.actor_profile_id,
    consumedAtMs:
      row.consumed_at_ms === null ? null : Number(row.consumed_at_ms),
    consumedOperationId: row.consumed_operation_id,
    createdAtMs: Number(row.created_at_ms),
    expiresAtMs: Number(row.expires_at_ms),
    organizationId: row.organization_id,
    preparedRequestId: row.prepared_request_id,
    projectId: row.project_id,
    projectUpdatedAtMs: Number(row.project_updated_at_ms),
    representedProfileId: row.represented_profile_id,
    representedUserId: row.represented_user_id,
    tokenHash: row.token_hash,
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
      "Center Agent Project operation payload is not serializable."
    );
  }
  return serialized;
}
