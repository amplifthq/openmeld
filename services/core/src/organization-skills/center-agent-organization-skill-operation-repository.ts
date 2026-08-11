import { createCoreRpcHttpError } from "../rpc/errors";

const CENTER_AGENT_ORGANIZATION_SKILL_OPERATION_LEASE_MS = 5 * 60_000;

export type CenterAgentOrganizationSkillOperationRecord = {
  completedAt: number | null;
  createdAt: number;
  operationKey: string;
  organizationId: string;
  requestSignature: string;
  responseJson: string | null;
};

export type BeginCenterAgentOrganizationSkillOperationResult = {
  operation: CenterAgentOrganizationSkillOperationRecord;
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

export async function buildCenterAgentOrganizationSkillRequestSignature(
  value: unknown
): Promise<string> {
  return await sha256Hex(stableJson(value));
}

export async function beginCenterAgentOrganizationSkillOperation(input: {
  db: D1Database;
  nowMs: number;
  operationKey: string;
  organizationId: string;
  requestSignature: string;
}): Promise<BeginCenterAgentOrganizationSkillOperationResult> {
  const insert = await input.db
    .prepare(
      `
        INSERT OR IGNORE INTO center_agent_organization_skill_operations (
          completed_at,
          created_at,
          operation_id,
          organization_id,
          request_signature,
          response_json
        ) VALUES (NULL, ?, ?, ?, ?, NULL)
      `
    )
    .bind(
      input.nowMs,
      input.operationKey,
      input.organizationId,
      input.requestSignature
    )
    .run();
  const operation = await requireOperation({
    db: input.db,
    operationKey: input.operationKey,
    organizationId: input.organizationId,
  });
  requireRequestMatch(operation, input.requestSignature);
  if (Number(insert.meta.changes ?? 0) === 1) {
    return { operation, outcome: "claimed" };
  }
  if (operation.completedAt !== null) {
    return { operation, outcome: "completed_replay" };
  }
  const takeover = await input.db
    .prepare(
      `
        UPDATE center_agent_organization_skill_operations
        SET created_at = ?
        WHERE organization_id = ?
          AND operation_id = ?
          AND request_signature = ?
          AND completed_at IS NULL
          AND created_at <= ?
      `
    )
    .bind(
      input.nowMs,
      input.organizationId,
      input.operationKey,
      input.requestSignature,
      input.nowMs - CENTER_AGENT_ORGANIZATION_SKILL_OPERATION_LEASE_MS
    )
    .run();
  if (Number(takeover.meta.changes ?? 0) !== 1) {
    return { operation, outcome: "pending_in_progress" };
  }
  return {
    operation: await requireOperation({
      db: input.db,
      operationKey: input.operationKey,
      organizationId: input.organizationId,
    }),
    outcome: "claimed",
  };
}

export function prepareCompleteCenterAgentOrganizationSkillOperationStatement(input: {
  db: D1Database;
  nowMs: number;
  operation: CenterAgentOrganizationSkillOperationRecord;
  responseJson: string;
}): D1PreparedStatement {
  return input.db
    .prepare(
      `
        UPDATE center_agent_organization_skill_operations
        SET completed_at = ?, response_json = ?
        WHERE organization_id = ?
          AND operation_id = ?
          AND request_signature = ?
          AND completed_at IS NULL
      `
    )
    .bind(
      input.nowMs,
      input.responseJson,
      input.operation.organizationId,
      input.operation.operationKey,
      input.operation.requestSignature
    );
}

export async function deletePendingCenterAgentOrganizationSkillOperation(input: {
  db: D1Database;
  operation: CenterAgentOrganizationSkillOperationRecord;
}): Promise<void> {
  await input.db
    .prepare(
      `
        DELETE FROM center_agent_organization_skill_operations
        WHERE organization_id = ?
          AND operation_id = ?
          AND request_signature = ?
          AND completed_at IS NULL
      `
    )
    .bind(
      input.operation.organizationId,
      input.operation.operationKey,
      input.operation.requestSignature
    )
    .run();
}

export async function readCenterAgentOrganizationSkillOperation(input: {
  db: D1Database;
  operationKey: string;
  organizationId: string;
}): Promise<CenterAgentOrganizationSkillOperationRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT *
        FROM center_agent_organization_skill_operations
        WHERE organization_id = ? AND operation_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.operationKey)
    .first<OperationRow>();
  return row ? fromRow(row) : null;
}

export function requireCenterAgentOrganizationSkillRequestMatch(
  operation: CenterAgentOrganizationSkillOperationRecord,
  requestSignature: string
): void {
  requireRequestMatch(operation, requestSignature);
}

async function requireOperation(input: {
  db: D1Database;
  operationKey: string;
  organizationId: string;
}): Promise<CenterAgentOrganizationSkillOperationRecord> {
  const operation = await readCenterAgentOrganizationSkillOperation(input);
  if (!operation) {
    throw new Error("Center Agent Organization Skill operation is missing.");
  }
  return operation;
}

function requireRequestMatch(
  operation: CenterAgentOrganizationSkillOperationRecord,
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

function fromRow(
  row: OperationRow
): CenterAgentOrganizationSkillOperationRecord {
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
