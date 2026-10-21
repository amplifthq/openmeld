import type {
  PoolClient,
  PostgresDatabase,
  QueryConfig,
  QueryResult,
  QueryResultRow,
} from "@openmeld/db/postgresql";
import type {
  CredentialConfirmationStatus,
  SensitiveOperation,
  SensitiveOperationAuditEvent,
  SensitiveOperationOutcome,
  SensitiveOperationSourceKind,
} from "@openmeld/schemas";

/** The database or the client of an open transaction. */
export type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    query: QueryConfig
  ): Promise<QueryResult<T>>;
};

export function asQueryable(db: PostgresDatabase | PoolClient): Queryable {
  return db as Queryable;
}

export type CredentialConfirmationRecord = {
  id: string;
  organizationId: string;
  ownerUserId: string;
  operation: SensitiveOperation;
  agentProfileId: string | null;
  requestDigest: string;
  blockingRootProfileId: string | null;
  status: CredentialConfirmationStatus;
  createdAtMs: number;
  expiresAtMs: number;
  decidedAtMs: number | null;
  consumedAtMs: number | null;
};

const CONFIRMATION_COLUMNS = `id, organization_id, owner_user_id, operation,
  agent_profile_id, request_digest, blocking_root_profile_id, status,
  created_at_ms, expires_at_ms, decided_at_ms, consumed_at_ms`;

type ConfirmationRow = {
  id: string;
  organization_id: string;
  owner_user_id: string;
  operation: SensitiveOperation;
  agent_profile_id: string | null;
  request_digest: string;
  blocking_root_profile_id: string | null;
  status: CredentialConfirmationStatus;
  created_at_ms: string | number;
  expires_at_ms: string | number;
  decided_at_ms: string | number | null;
  consumed_at_ms: string | number | null;
};

function toConfirmationRecord(
  row: ConfirmationRow
): CredentialConfirmationRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
    operation: row.operation,
    agentProfileId: row.agent_profile_id,
    requestDigest: row.request_digest,
    blockingRootProfileId: row.blocking_root_profile_id,
    status: row.status,
    createdAtMs: Number(row.created_at_ms),
    expiresAtMs: Number(row.expires_at_ms),
    decidedAtMs: row.decided_at_ms === null ? null : Number(row.decided_at_ms),
    consumedAtMs:
      row.consumed_at_ms === null ? null : Number(row.consumed_at_ms),
  };
}

/** Marks this binding's open confirmations that ran out of time. */
export async function expireCredentialConfirmations(input: {
  db: Queryable;
  nowMs: number;
  organizationId: string;
  ownerUserId: string;
  requestDigest: string;
}): Promise<CredentialConfirmationRecord[]> {
  const result = await input.db.query<ConfirmationRow>({
    text: `UPDATE "openmeld"."sensitive_operation_confirmations"
      SET status = 'expired'
      WHERE owner_user_id = $1 AND organization_id = $2
        AND request_digest = $3 AND status IN ('pending', 'approved')
        AND expires_at_ms <= $4
      RETURNING ${CONFIRMATION_COLUMNS}`,
    values: [
      input.ownerUserId,
      input.organizationId,
      input.requestDigest,
      input.nowMs,
    ],
  });
  return result.rows.map(toConfirmationRecord);
}

/** The newest live confirmation for one owner, Organization and request. */
export async function readLiveCredentialConfirmation(input: {
  db: Queryable;
  nowMs: number;
  organizationId: string;
  ownerUserId: string;
  requestDigest: string;
}): Promise<CredentialConfirmationRecord | null> {
  const result = await input.db.query<ConfirmationRow>({
    text: `SELECT ${CONFIRMATION_COLUMNS}
      FROM "openmeld"."sensitive_operation_confirmations"
      WHERE owner_user_id = $1 AND organization_id = $2
        AND request_digest = $3
        AND status IN ('pending', 'approved', 'declined')
        AND expires_at_ms > $4
      ORDER BY created_at_ms DESC
      LIMIT 1`,
    values: [
      input.ownerUserId,
      input.organizationId,
      input.requestDigest,
      input.nowMs,
    ],
  });
  const row = result.rows[0];
  return row ? toConfirmationRecord(row) : null;
}

export async function insertCredentialConfirmation(input: {
  db: Queryable;
  record: Omit<
    CredentialConfirmationRecord,
    "status" | "decidedAtMs" | "consumedAtMs"
  >;
}): Promise<CredentialConfirmationRecord | null> {
  const { record } = input;
  const result = await input.db.query<ConfirmationRow>({
    text: `INSERT INTO "openmeld"."sensitive_operation_confirmations"
        (id, organization_id, owner_user_id, operation, agent_profile_id,
         request_digest, blocking_root_profile_id, status, created_at_ms,
         expires_at_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
      ON CONFLICT (id) DO NOTHING
      RETURNING ${CONFIRMATION_COLUMNS}`,
    values: [
      record.id,
      record.organizationId,
      record.ownerUserId,
      record.operation,
      record.agentProfileId,
      record.requestDigest,
      record.blockingRootProfileId,
      record.createdAtMs,
      record.expiresAtMs,
    ],
  });
  const row = result.rows[0];
  return row ? toConfirmationRecord(row) : null;
}

/** Uses an approved confirmation once. False when another call used it. */
export async function consumeCredentialConfirmation(input: {
  db: Queryable;
  id: string;
  nowMs: number;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `UPDATE "openmeld"."sensitive_operation_confirmations"
      SET status = 'consumed', consumed_at_ms = $2
      WHERE id = $1 AND status = 'approved' AND expires_at_ms > $2`,
    values: [input.id, input.nowMs],
  });
  return (result.rowCount ?? 0) === 1;
}

export async function decideCredentialConfirmationRecord(input: {
  db: Queryable;
  id: string;
  nowMs: number;
  ownerUserId: string;
  status: "approved" | "declined";
}): Promise<CredentialConfirmationRecord | null> {
  const result = await input.db.query<ConfirmationRow>({
    text: `UPDATE "openmeld"."sensitive_operation_confirmations"
      SET status = $4, decided_at_ms = $3
      WHERE id = $1 AND owner_user_id = $2 AND status = 'pending'
        AND expires_at_ms > $3
      RETURNING ${CONFIRMATION_COLUMNS}`,
    values: [input.id, input.ownerUserId, input.nowMs, input.status],
  });
  const row = result.rows[0];
  return row ? toConfirmationRecord(row) : null;
}

/** One confirmation, readable only by its owner. */
export async function readOwnedCredentialConfirmation(input: {
  db: Queryable;
  id: string;
  ownerUserId: string;
}): Promise<
  (CredentialConfirmationRecord & { agentProfileName: string | null }) | null
> {
  const result = await input.db.query<
    ConfirmationRow & { agent_profile_name: string | null }
  >({
    text: `SELECT ${CONFIRMATION_COLUMNS.split(",")
      .map((column) => `confirmation.${column.trim()}`)
      .join(", ")}, profile.profile_name AS agent_profile_name
      FROM "openmeld"."sensitive_operation_confirmations" AS confirmation
      LEFT JOIN "openmeld"."openmeld_profiles" AS profile
        ON profile.profile_id = confirmation.agent_profile_id
      WHERE confirmation.id = $1 AND confirmation.owner_user_id = $2`,
    values: [input.id, input.ownerUserId],
  });
  const row = result.rows[0];
  return row
    ? {
        ...toConfirmationRecord(row),
        agentProfileName: row.agent_profile_name?.trim() || null,
      }
    : null;
}

export async function readProfileNames(input: {
  db: Queryable;
  profileIds: readonly string[];
}): Promise<Map<string, string>> {
  const ids = [...new Set(input.profileIds)];
  const names = new Map<string, string>();
  if (ids.length === 0) {
    return names;
  }
  const result = await input.db.query<{
    profile_id: string;
    profile_name: string | null;
  }>({
    text: `SELECT profile_id, profile_name
      FROM "openmeld"."openmeld_profiles"
      WHERE profile_id = ANY($1::text[])`,
    values: [ids],
  });
  for (const row of result.rows) {
    const name = row.profile_name?.trim();
    if (name) {
      names.set(row.profile_id, name);
    }
  }
  return names;
}

export type SensitiveOperationAuditInsert = {
  id: string;
  organizationId: string;
  actorUserId: string;
  agentProfileId: string | null;
  operation: SensitiveOperation;
  sourceKind: SensitiveOperationSourceKind;
  chainRootProfileId: string | null;
  taskExecutionId: string | null;
  outcome: SensitiveOperationOutcome;
  reasonCode: string | null;
  confirmationId: string | null;
  createdAtMs: number;
};

export async function insertSensitiveOperationAuditEvent(input: {
  db: Queryable;
  event: SensitiveOperationAuditInsert;
}): Promise<void> {
  const { event } = input;
  await input.db.query({
    text: `INSERT INTO "openmeld"."sensitive_operation_audit_events"
        (id, organization_id, actor_user_id, agent_profile_id, operation,
         source_kind, chain_root_profile_id, task_execution_id, outcome,
         reason_code, confirmation_id, created_at_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    values: [
      event.id,
      event.organizationId,
      event.actorUserId,
      event.agentProfileId,
      event.operation,
      event.sourceKind,
      event.chainRootProfileId,
      event.taskExecutionId,
      event.outcome,
      event.reasonCode,
      event.confirmationId,
      event.createdAtMs,
    ],
  });
}

/**
 * The audit of the owner's MemberAgent: rows for its Profiles, newest first.
 * Null when the MemberAgent is not the caller's in this Organization.
 */
export async function listMemberAgentSensitiveOperationAudit(input: {
  db: Queryable;
  limit: number;
  memberAgentId: string;
  organizationId: string;
  ownerUserId: string;
}): Promise<SensitiveOperationAuditEvent[] | null> {
  const owner = await input.db.query<{ id: string }>({
    text: `SELECT id FROM "openmeld"."member_agents"
      WHERE id = $1 AND organization_id = $2 AND owner_user_id = $3`,
    values: [input.memberAgentId, input.organizationId, input.ownerUserId],
  });
  if (!owner.rows[0]) {
    return null;
  }
  const result = await input.db.query<{
    id: string;
    operation: SensitiveOperation;
    agent_profile_id: string | null;
    source_kind: SensitiveOperationSourceKind;
    actor_user_id: string;
    chain_root_profile_id: string | null;
    outcome: SensitiveOperationOutcome;
    reason_code: string | null;
    confirmation_id: string | null;
    created_at_ms: string | number;
  }>({
    text: `SELECT audit.id, audit.operation, audit.agent_profile_id,
        audit.source_kind, audit.actor_user_id, audit.chain_root_profile_id,
        audit.outcome, audit.reason_code, audit.confirmation_id,
        audit.created_at_ms
      FROM "openmeld"."sensitive_operation_audit_events" AS audit
      WHERE audit.organization_id = $2
        AND audit.agent_profile_id IN (
          SELECT profile.profile_id FROM "openmeld"."openmeld_profiles" AS profile
          WHERE profile.member_agent_id = $1
            AND profile.organization_id = $2
            AND profile.owner_user_id = $3
        )
      ORDER BY audit.created_at_ms DESC, audit.id DESC
      LIMIT $4`,
    values: [
      input.memberAgentId,
      input.organizationId,
      input.ownerUserId,
      input.limit,
    ],
  });
  return result.rows.map((row) => ({
    id: row.id,
    operation: row.operation,
    agentProfileId: row.agent_profile_id,
    sourceKind: row.source_kind,
    actorUserId: row.actor_user_id,
    chainRootProfileId: row.chain_root_profile_id,
    outcome: row.outcome,
    reasonCode: row.reason_code,
    confirmationId: row.confirmation_id,
    createdAtMs: Number(row.created_at_ms),
  }));
}
