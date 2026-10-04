import type {
  PostgresDatabase,
  QueryConfig,
  QueryResult,
} from "@openmeld/db/postgresql";
import type { SignalEnvelope } from "@openmeld/protocol";
import {
  centerAgentWakePublicationCommandSchema,
  signalTextEnvelopeSchema,
} from "@openmeld/schemas";
import type { CenterAgentWakePublicationCommand } from "@openmeld/schemas/types";
export type { CenterAgentWakePublicationCommand };
export type CenterAgentWakePublicationState =
  | "pending"
  | "accepted"
  | "completed"
  | "failed";
export type CenterAgentWakePublicationRecord = {
  acceptedAtMs: number | null;
  attemptCount: number;
  claimExpiresAtMs: number | null;
  claimId: string | null;
  command: CenterAgentWakePublicationCommand;
  completedAtMs: number | null;
  createdAtMs: number;
  delegationId: string;
  lastError: string | null;
  nextAttemptAtMs: number;
  organizationId: string;
  publicationId: string;
  signal: Extract<
    SignalEnvelope,
    {
      type: "signal.text";
    }
  > | null;
  spaceId: string;
  state: CenterAgentWakePublicationState;
  updatedAtMs: number;
};
type CenterAgentWakePublicationRow = {
  accepted_at_ms: number | null;
  attempt_count: number;
  claim_expires_at_ms: number | null;
  claim_id: string | null;
  command_json: string;
  completed_at_ms: number | null;
  created_at_ms: number;
  delegation_id: string;
  last_error: string | null;
  next_attempt_at_ms: number;
  organization_id: string;
  publication_id: string;
  signal_json: string | null;
  space_id: string;
  state: string;
  updated_at_ms: number;
};
export async function prepareCenterAgentWakePublicationRecord(input: {
  command: CenterAgentWakePublicationCommand;
  db: PostgresDatabase;
  nowMs: number;
}): Promise<CenterAgentWakePublicationRecord> {
  const [record] = await prepareCenterAgentWakePublicationRecords({
    commands: [input.command],
    db: input.db,
    nowMs: input.nowMs,
  });
  if (!record) {
    throw new Error("Center Agent Wake publication write lost its row");
  }
  return record;
}

// Persist the complete fan-out before any Space can accept a Wake. Recovery
// reads this same immutable set, including destinations not attempted yet.
export async function prepareCenterAgentWakePublicationRecords(input: {
  commands: CenterAgentWakePublicationCommand[];
  db: PostgresDatabase;
  nowMs: number;
}): Promise<CenterAgentWakePublicationRecord[]> {
  const commands = input.commands.map((command) =>
    centerAgentWakePublicationCommandSchema.parse(command)
  );
  const first = commands[0];
  if (!first) {
    throw new Error(
      "A Wake publication batch requires at least one destination"
    );
  }
  const isBatch = commands.length > 1;
  if (
    new Set(commands.map((command) => command.clientMessageId)).size !==
      commands.length ||
    commands.some(
      (command) =>
        command.delegationId !== first.delegationId ||
        command.organizationId !== first.organizationId ||
        command.parentSubmissionId !== first.parentSubmissionId ||
        command.completionMode !== first.completionMode ||
        (isBatch && command.batchRootPublicationId !== first.clientMessageId)
    )
  ) {
    throw new Error("Wake publications must belong to one complete delegation");
  }
  if (
    isBatch &&
    serializeJson(first.batchPublicationIds) !==
      serializeJson(commands.map((command) => command.clientMessageId))
  ) {
    throw new Error(
      "The root publication must declare the complete destination set"
    );
  }
  await input.db.transaction(async (client) => {
    for (const command of commands) {
      await client.query(
        preparePublicationInsert({
          command,
          nowMs: input.nowMs,
          ...(isBatch && command !== first ? { rootCommand: first } : {}),
        })
      );
    }
  });
  const records = await listCenterAgentWakePublicationsByDelegation({
    db: input.db,
    delegationId: first.delegationId,
  });
  if (
    records.length !== commands.length ||
    commands.some((command) => {
      const record = records.find(
        (entry) => entry.publicationId === command.clientMessageId
      );
      return (
        !record || serializeJson(record.command) !== serializeJson(command)
      );
    })
  ) {
    throw new Error(
      "Center Agent Wake publication id was reused with different input"
    );
  }
  return commands.map((command) => {
    const record = records.find(
      (entry) => entry.publicationId === command.clientMessageId
    );
    if (!record) {
      throw new Error("Center Agent Wake publication write lost its row");
    }
    return record;
  });
}

function preparePublicationInsert(input: {
  command: CenterAgentWakePublicationCommand;
  nowMs: number;
  rootCommand?: CenterAgentWakePublicationCommand;
}): QueryConfig {
  const command = centerAgentWakePublicationCommandSchema.parse(input.command);
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  return {
    text: `
      INSERT INTO "openmeld"."center_agent_wake_publications" (
        publication_id, delegation_id, organization_id, space_id, command_json,
        state, attempt_count, next_attempt_at_ms, last_error, claim_id,
        claim_expires_at_ms, accepted_at_ms, signal_json, completed_at_ms,
        created_at_ms, updated_at_ms
      )
      SELECT $1, $2, $3, $4, $5, 'pending', 0, $6::bigint, NULL, NULL,
        NULL, NULL, NULL, NULL, $7::bigint, $8::bigint
      WHERE ${input.rootCommand ? 'EXISTS (SELECT 1 FROM "openmeld"."center_agent_wake_publications" WHERE publication_id = $9 AND command_json = $10)' : "1 = 1"}
      ON CONFLICT(publication_id) DO NOTHING
    `,
    values: [
      command.clientMessageId,
      command.delegationId,
      command.organizationId,
      command.spaceId,
      serializeJson(command),
      nowMs,
      nowMs,
      nowMs,
      ...(input.rootCommand
        ? [input.rootCommand.clientMessageId, serializeJson(input.rootCommand)]
        : []),
    ],
  };
}

export async function listCenterAgentWakePublicationsByDelegation(input: {
  db: PostgresDatabase;
  delegationId: string;
}): Promise<CenterAgentWakePublicationRecord[]> {
  const rows = await input.db.query<CenterAgentWakePublicationRow>({
    text: `
      SELECT * FROM "openmeld"."center_agent_wake_publications"
      WHERE delegation_id = $1 ORDER BY publication_id ASC
    `,
    values: [requireNonEmpty(input.delegationId, "delegationId")],
  });
  return rows.rows.map(mapRow);
}
export async function readCenterAgentWakePublication(input: {
  db: PostgresDatabase;
  publicationId: string;
}): Promise<CenterAgentWakePublicationRecord | null> {
  const row = await input.db
    .query<CenterAgentWakePublicationRow>({
      text: `
        SELECT *
        FROM "openmeld"."center_agent_wake_publications"
        WHERE publication_id = $1
        LIMIT 1
      `,
      values: [requireNonEmpty(input.publicationId, "publicationId")],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapRow(row) : null;
}
export async function listDueCenterAgentWakePublications(input: {
  db: PostgresDatabase;
  limit?: number;
  nowMs: number;
}): Promise<CenterAgentWakePublicationRecord[]> {
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const limit = normalizeLimit(input.limit);
  const rows = await input.db.query<CenterAgentWakePublicationRow>({
    text: `
        SELECT *
        FROM "openmeld"."center_agent_wake_publications"
        WHERE state IN ('pending', 'accepted')
          AND next_attempt_at_ms <= $1
          AND (claim_id IS NULL OR claim_expires_at_ms <= $2)
        ORDER BY next_attempt_at_ms ASC NULLS FIRST, created_at_ms ASC NULLS FIRST, publication_id ASC NULLS FIRST
        LIMIT $3
      `,
    values: [nowMs, nowMs, limit],
  });
  return (rows.rows ?? []).map(mapRow);
}
export async function claimCenterAgentWakePublication(input: {
  claimExpiresAtMs: number;
  claimId: string;
  db: PostgresDatabase;
  nowMs: number;
  publicationId: string;
}): Promise<CenterAgentWakePublicationRecord | null> {
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const claimExpiresAtMs = requireTimestamp(
    input.claimExpiresAtMs,
    "claimExpiresAtMs"
  );
  if (claimExpiresAtMs <= nowMs) {
    throw new Error("claimExpiresAtMs must be after nowMs");
  }
  const claimId = requireNonEmpty(input.claimId, "claimId");
  const publicationId = requireNonEmpty(input.publicationId, "publicationId");
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."center_agent_wake_publications"
        SET
          claim_id = $1,
          claim_expires_at_ms = $2,
          updated_at_ms = $3
        WHERE publication_id = $4
          AND state IN ('pending', 'accepted')
          AND (claim_id IS NULL OR claim_expires_at_ms <= $5)
      `,
    values: [claimId, claimExpiresAtMs, nowMs, publicationId, nowMs],
  });
  if (changes(result) === 0) {
    return null;
  }
  const record = await requireRecord({ db: input.db, publicationId });
  if (
    record.claimId !== claimId ||
    record.claimExpiresAtMs !== claimExpiresAtMs
  ) {
    throw new CenterAgentWakePublicationClaimLostError(publicationId);
  }
  return record;
}
export async function markCenterAgentWakePublicationAccepted(input: {
  claimId: string;
  db: PostgresDatabase;
  nowMs: number;
  publicationId: string;
  signal: Extract<
    SignalEnvelope,
    {
      type: "signal.text";
    }
  >;
}): Promise<CenterAgentWakePublicationRecord> {
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const signalJson = serializeJson(
    signalTextEnvelopeSchema.parse(input.signal)
  );
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."center_agent_wake_publications"
        SET
          state = 'accepted',
          accepted_at_ms = COALESCE(accepted_at_ms, $1),
          signal_json = COALESCE(signal_json, $2),
          last_error = NULL,
          updated_at_ms = $3
        WHERE publication_id = $4
          AND state IN ('pending', 'accepted')
          AND claim_id = $5
      `,
    values: [
      nowMs,
      signalJson,
      nowMs,
      requireNonEmpty(input.publicationId, "publicationId"),
      requireNonEmpty(input.claimId, "claimId"),
    ],
  });
  assertClaimTransition(result, input.publicationId);
  return await requireClaimedRecord(input);
}
export async function rescheduleCenterAgentWakePublication(input: {
  claimId: string;
  db: PostgresDatabase;
  error: string;
  nextAttemptAtMs: number;
  nowMs: number;
  publicationId: string;
}): Promise<CenterAgentWakePublicationRecord> {
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const nextAttemptAtMs = requireTimestamp(
    input.nextAttemptAtMs,
    "nextAttemptAtMs"
  );
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."center_agent_wake_publications"
        SET
          attempt_count = attempt_count + 1,
          next_attempt_at_ms = $1,
          last_error = $2,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = $3
        WHERE publication_id = $4
          AND state IN ('pending', 'accepted')
          AND claim_id = $5
      `,
    values: [
      nextAttemptAtMs,
      normalizeError(input.error),
      nowMs,
      requireNonEmpty(input.publicationId, "publicationId"),
      requireNonEmpty(input.claimId, "claimId"),
    ],
  });
  assertClaimTransition(result, input.publicationId);
  return await requireReleasedRecord(input);
}
export async function markCenterAgentWakePublicationCompleted(input: {
  claimId: string;
  db: PostgresDatabase;
  nowMs: number;
  publicationId: string;
}): Promise<CenterAgentWakePublicationRecord> {
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."center_agent_wake_publications"
        SET
          state = 'completed',
          completed_at_ms = COALESCE(completed_at_ms, $1),
          last_error = NULL,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = $2
        WHERE publication_id = $3
          AND state = 'accepted'
          AND claim_id = $4
      `,
    values: [
      nowMs,
      nowMs,
      requireNonEmpty(input.publicationId, "publicationId"),
      requireNonEmpty(input.claimId, "claimId"),
    ],
  });
  assertClaimTransition(result, input.publicationId);
  return await requireReleasedRecord(input);
}
export async function markCenterAgentWakePublicationFailed(input: {
  claimId: string;
  db: PostgresDatabase;
  error: string;
  nowMs: number;
  publicationId: string;
}): Promise<CenterAgentWakePublicationRecord> {
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."center_agent_wake_publications"
        SET
          state = 'failed',
          completed_at_ms = COALESCE(completed_at_ms, $1),
          last_error = $2,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = $3
        WHERE publication_id = $4
          AND state IN ('pending', 'accepted')
          AND claim_id = $5
      `,
    values: [
      nowMs,
      normalizeError(input.error),
      nowMs,
      requireNonEmpty(input.publicationId, "publicationId"),
      requireNonEmpty(input.claimId, "claimId"),
    ],
  });
  assertClaimTransition(result, input.publicationId);
  return await requireReleasedRecord(input);
}
function mapRow(
  row: CenterAgentWakePublicationRow
): CenterAgentWakePublicationRecord {
  const command = centerAgentWakePublicationCommandSchema.parse(
    parseJson(row.command_json)
  );
  if (
    row.publication_id !== command.clientMessageId ||
    row.delegation_id !== command.delegationId ||
    row.organization_id !== command.organizationId ||
    row.space_id !== command.spaceId
  ) {
    throw new Error("Center Agent Wake publication storage is inconsistent");
  }
  const state = parseState(row.state);
  const signal = row.signal_json
    ? signalTextEnvelopeSchema.parse(parseJson(row.signal_json))
    : null;
  if ((state === "accepted" || state === "completed") && signal === null) {
    throw new Error(
      "Accepted Center Agent Wake publication is missing its Space signal"
    );
  }
  return {
    acceptedAtMs: nullableTimestamp(row.accepted_at_ms, "acceptedAtMs"),
    attemptCount: requireNonNegativeInteger(row.attempt_count, "attemptCount"),
    claimExpiresAtMs: nullableTimestamp(
      row.claim_expires_at_ms,
      "claimExpiresAtMs"
    ),
    claimId: nullableNonEmpty(row.claim_id, "claimId"),
    command,
    completedAtMs: nullableTimestamp(row.completed_at_ms, "completedAtMs"),
    createdAtMs: requireTimestamp(row.created_at_ms, "createdAtMs"),
    delegationId: command.delegationId,
    lastError: row.last_error,
    nextAttemptAtMs: requireTimestamp(
      row.next_attempt_at_ms,
      "nextAttemptAtMs"
    ),
    organizationId: command.organizationId,
    publicationId: command.clientMessageId,
    signal,
    spaceId: command.spaceId,
    state,
    updatedAtMs: requireTimestamp(row.updated_at_ms, "updatedAtMs"),
  };
}
async function requireRecord(input: {
  db: PostgresDatabase;
  publicationId: string;
}): Promise<CenterAgentWakePublicationRecord> {
  const record = await readCenterAgentWakePublication(input);
  if (!record) {
    throw new Error("Center Agent Wake publication row is missing");
  }
  return record;
}
async function requireClaimedRecord(input: {
  claimId: string;
  db: PostgresDatabase;
  publicationId: string;
}): Promise<CenterAgentWakePublicationRecord> {
  const record = await requireRecord(input);
  if (record.claimId !== input.claimId) {
    throw new CenterAgentWakePublicationClaimLostError(input.publicationId);
  }
  return record;
}
async function requireReleasedRecord(input: {
  claimId: string;
  db: PostgresDatabase;
  publicationId: string;
}): Promise<CenterAgentWakePublicationRecord> {
  const record = await requireRecord(input);
  if (record.claimId !== null) {
    throw new CenterAgentWakePublicationClaimLostError(input.publicationId);
  }
  return record;
}
export class CenterAgentWakePublicationClaimLostError extends Error {
  readonly retryable = true;
  constructor(publicationId: string) {
    super(`Center Agent Wake publication claim was lost: ${publicationId}`);
    this.name = "CenterAgentWakePublicationClaimLostError";
  }
}
function parseState(value: unknown): CenterAgentWakePublicationState {
  if (
    value === "pending" ||
    value === "accepted" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }
  throw new Error(`Unsupported Center Agent Wake publication state: ${value}`);
}
function normalizeLimit(value: number | undefined): number {
  if (value === undefined) {
    return 50;
  }
  if (!(Number.isInteger(value) && value > 0)) {
    throw new Error("limit must be a positive integer");
  }
  return Math.min(value, 100);
}
function requireNonEmpty(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}
function requireTimestamp(value: unknown, field: string): number {
  if (!(typeof value === "number" && Number.isInteger(value) && value >= 0)) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}
function requireNonNegativeInteger(value: unknown, field: string): number {
  return requireTimestamp(value, field);
}
function nullableTimestamp(value: unknown, field: string): number | null {
  return value === null ? null : requireTimestamp(value, field);
}
function nullableNonEmpty(value: unknown, field: string): string | null {
  return value === null ? null : requireNonEmpty(value, field);
}
function parseJson(value: string): unknown {
  return JSON.parse(value);
}
function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}
function normalizeError(value: unknown): string {
  const normalized = String(value ?? "").trim();
  return (normalized || "Unknown publication failure").slice(0, 2000);
}
function changes(result: QueryResult<Record<string, unknown>>): number {
  return Math.max(0, Math.trunc(Number(result.rowCount ?? 0)));
}
function assertClaimTransition(
  result: QueryResult<Record<string, unknown>>,
  publicationId: string
): void {
  if (changes(result) === 0) {
    throw new CenterAgentWakePublicationClaimLostError(publicationId);
  }
}
