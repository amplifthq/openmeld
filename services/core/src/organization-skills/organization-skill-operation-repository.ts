import type { PostgresDatabase, QueryConfig } from "@openmeld/db/postgresql";
import { createCoreRpcHttpError } from "../rpc/errors";

const ORGANIZATION_SKILL_OPERATION_LEASE_MS = 5 * 60_000;
export type OrganizationSkillOperationKind = "center_agent" | "human_import";
function operationTable(kind: OrganizationSkillOperationKind): string {
  return kind === "center_agent"
    ? '"openmeld"."center_agent_organization_skill_operations"'
    : '"openmeld"."organization_skill_import_operations"';
}
export type OrganizationSkillOperationRecord = {
  completedAt: number | null;
  createdAt: number;
  operationKey: string;
  organizationId: string;
  requestSignature: string;
  responseJson: string | null;
};
export type BeginOrganizationSkillOperationResult = {
  operation: OrganizationSkillOperationRecord;
  outcome: "claimed" | "completed_replay" | "pending_in_progress";
};
type OperationRow = {
  completed_at: number | null;
  created_at: number;
  operation_id: string;
  organization_id: string;
  request_signature: string;
  response_json: string | null;
};
export async function buildCenterAgentOrganizationSkillOperationKey(input: {
  action: string;
  actorProfileId: string;
  operationId: string;
  organizationId: string;
  representedUserId: string;
}): Promise<string> {
  return `center_agent_org_skill_${await sha256Hex(stableJson(input))}`;
}
export async function buildHumanOrganizationSkillImportOperationKey(input: {
  actorProfileId: string;
  operationId: string;
  organizationId: string;
  userId: string;
}): Promise<string> {
  return `human_org_skill_import_${await sha256Hex(stableJson(input))}`;
}
export async function buildOrganizationSkillRequestSignature(
  value: unknown
): Promise<string> {
  return await sha256Hex(stableJson(value));
}
export async function beginOrganizationSkillOperation(input: {
  db: PostgresDatabase;
  kind: OrganizationSkillOperationKind;
  nowMs: number;
  operationKey: string;
  organizationId: string;
  requestSignature: string;
}): Promise<BeginOrganizationSkillOperationResult> {
  const table = operationTable(input.kind);
  const insert = await input.db.query({
    text: `
        INSERT INTO ${table} (
          completed_at,
          created_at,
          operation_id,
          organization_id,
          request_signature,
          response_json
        ) VALUES (NULL, $1, $2, $3, $4, NULL) ON CONFLICT DO NOTHING`,
    values: [
      input.nowMs,
      input.operationKey,
      input.organizationId,
      input.requestSignature,
    ],
  });
  const operation = await requireOperation({
    db: input.db,
    kind: input.kind,
    operationKey: input.operationKey,
    organizationId: input.organizationId,
  });
  requireRequestMatch(operation, input.requestSignature);
  if (Number(insert.rowCount ?? 0) === 1) {
    return { operation, outcome: "claimed" };
  }
  if (operation.completedAt !== null) {
    return { operation, outcome: "completed_replay" };
  }
  const takeover = await input.db.query({
    text: `
        UPDATE ${table}
        SET created_at = $1
        WHERE organization_id = $2
          AND operation_id = $3
          AND request_signature = $4
          AND completed_at IS NULL
          AND created_at <= $5
      `,
    values: [
      input.nowMs,
      input.organizationId,
      input.operationKey,
      input.requestSignature,
      input.nowMs - ORGANIZATION_SKILL_OPERATION_LEASE_MS,
    ],
  });
  if (Number(takeover.rowCount ?? 0) !== 1) {
    return { operation, outcome: "pending_in_progress" };
  }
  return {
    operation: await requireOperation({
      db: input.db,
      kind: input.kind,
      operationKey: input.operationKey,
      organizationId: input.organizationId,
    }),
    outcome: "claimed",
  };
}
export function prepareCompleteOrganizationSkillOperationStatement(input: {
  db: PostgresDatabase;
  kind: OrganizationSkillOperationKind;
  nowMs: number;
  operation: OrganizationSkillOperationRecord;
  responseJson: string;
}): QueryConfig {
  return {
    text: `
        UPDATE ${operationTable(input.kind)}
        SET completed_at = $1, response_json = $2
        WHERE organization_id = $3
          AND operation_id = $4
          AND request_signature = $5
          AND completed_at IS NULL
          AND created_at = $6
      `,
    values: [
      input.nowMs,
      input.responseJson,
      input.operation.organizationId,
      input.operation.operationKey,
      input.operation.requestSignature,
      input.operation.createdAt,
    ],
  };
}
export async function deletePendingOrganizationSkillOperation(input: {
  db: PostgresDatabase;
  kind: OrganizationSkillOperationKind;
  operation: OrganizationSkillOperationRecord;
}): Promise<void> {
  await input.db.query({
    text: `
        DELETE FROM ${operationTable(input.kind)}
        WHERE organization_id = $1
          AND operation_id = $2
          AND request_signature = $3
          AND completed_at IS NULL
          AND created_at = $4
      `,
    values: [
      input.operation.organizationId,
      input.operation.operationKey,
      input.operation.requestSignature,
      input.operation.createdAt,
    ],
  });
}
export async function readOrganizationSkillOperation(input: {
  db: PostgresDatabase;
  kind: OrganizationSkillOperationKind;
  operationKey: string;
  organizationId: string;
}): Promise<OrganizationSkillOperationRecord | null> {
  const row = await input.db
    .query<OperationRow>({
      text: `
        SELECT *
        FROM ${operationTable(input.kind)}
        WHERE organization_id = $1 AND operation_id = $2
        LIMIT 1
      `,
      values: [input.organizationId, input.operationKey],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? fromRow(row) : null;
}
export function requireOrganizationSkillRequestMatch(
  operation: OrganizationSkillOperationRecord,
  requestSignature: string
): void {
  requireRequestMatch(operation, requestSignature);
}
async function requireOperation(input: {
  db: PostgresDatabase;
  kind: OrganizationSkillOperationKind;
  operationKey: string;
  organizationId: string;
}): Promise<OrganizationSkillOperationRecord> {
  const operation = await readOrganizationSkillOperation(input);
  if (!operation) {
    throw new Error("Organization Skill operation is missing.");
  }
  return operation;
}
function requireRequestMatch(
  operation: OrganizationSkillOperationRecord,
  requestSignature: string
): void {
  if (operation.requestSignature === requestSignature) {
    return;
  }
  throw createCoreRpcHttpError({
    code: "organization_skill.operation_conflict",
    reason:
      "This Organization Skill operation ID was already used for a different request.",
    status: 409,
  });
}
function fromRow(row: OperationRow): OrganizationSkillOperationRecord {
  return {
    completedAt: row.completed_at,
    createdAt: row.created_at,
    operationKey: row.operation_id,
    organizationId: row.organization_id,
    requestSignature: row.request_signature,
    responseJson: row.response_json,
  };
}
function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => {
          if (left < right) {
            return -1;
          }
          return left > right ? 1 : 0;
        })
        .map(([key, item]) => [key, sortJson(item)])
    );
  }
  return value;
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
