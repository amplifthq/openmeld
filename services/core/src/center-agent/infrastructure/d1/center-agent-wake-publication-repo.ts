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
  signal: Extract<SignalEnvelope, { type: "signal.text" }> | null;
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
  db: D1Database;
  nowMs: number;
}): Promise<CenterAgentWakePublicationRecord> {
  const command = centerAgentWakePublicationCommandSchema.parse(input.command);
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const commandJson = serializeJson(command);
  await input.db
    .prepare(
      `
        INSERT INTO center_agent_wake_publications (
          publication_id,
          delegation_id,
          organization_id,
          space_id,
          command_json,
          state,
          attempt_count,
          next_attempt_at_ms,
          last_error,
          claim_id,
          claim_expires_at_ms,
          accepted_at_ms,
          signal_json,
          completed_at_ms,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
        ON CONFLICT(publication_id) DO NOTHING
      `
    )
    .bind(
      command.clientMessageId,
      command.delegationId,
      command.organizationId,
      command.spaceId,
      commandJson,
      nowMs,
      nowMs,
      nowMs
    )
    .run();
  const record = await readCenterAgentWakePublication({
    db: input.db,
    publicationId: command.clientMessageId,
  });
  if (!record) {
    throw new Error("Center Agent Wake publication write lost its row");
  }
  if (
    record.delegationId !== command.delegationId ||
    record.organizationId !== command.organizationId ||
    record.spaceId !== command.spaceId ||
    serializeJson(record.command) !== commandJson
  ) {
    throw new Error(
      "Center Agent Wake publication id was reused with different input"
    );
  }
  return record;
}

export async function readCenterAgentWakePublication(input: {
  db: D1Database;
  publicationId: string;
}): Promise<CenterAgentWakePublicationRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT *
        FROM center_agent_wake_publications
        WHERE publication_id = ?
        LIMIT 1
      `
    )
    .bind(requireNonEmpty(input.publicationId, "publicationId"))
    .first<CenterAgentWakePublicationRow>();
  return row ? mapRow(row) : null;
}

export async function listDueCenterAgentWakePublications(input: {
  db: D1Database;
  limit?: number;
  nowMs: number;
}): Promise<CenterAgentWakePublicationRecord[]> {
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const limit = normalizeLimit(input.limit);
  const rows = await input.db
    .prepare(
      `
        SELECT *
        FROM center_agent_wake_publications
        WHERE state IN ('pending', 'accepted')
          AND next_attempt_at_ms <= ?
          AND (claim_id IS NULL OR claim_expires_at_ms <= ?)
        ORDER BY next_attempt_at_ms ASC, created_at_ms ASC, publication_id ASC
        LIMIT ?
      `
    )
    .bind(nowMs, nowMs, limit)
    .all<CenterAgentWakePublicationRow>();
  return (rows.results ?? []).map(mapRow);
}

export async function claimCenterAgentWakePublication(input: {
  claimExpiresAtMs: number;
  claimId: string;
  db: D1Database;
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
  const result = await input.db
    .prepare(
      `
        UPDATE center_agent_wake_publications
        SET
          claim_id = ?,
          claim_expires_at_ms = ?,
          updated_at_ms = ?
        WHERE publication_id = ?
          AND state IN ('pending', 'accepted')
          AND (claim_id IS NULL OR claim_expires_at_ms <= ?)
      `
    )
    .bind(claimId, claimExpiresAtMs, nowMs, publicationId, nowMs)
    .run();
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
  db: D1Database;
  nowMs: number;
  publicationId: string;
  signal: Extract<SignalEnvelope, { type: "signal.text" }>;
}): Promise<CenterAgentWakePublicationRecord> {
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const signalJson = serializeJson(
    signalTextEnvelopeSchema.parse(input.signal)
  );
  const result = await input.db
    .prepare(
      `
        UPDATE center_agent_wake_publications
        SET
          state = 'accepted',
          accepted_at_ms = COALESCE(accepted_at_ms, ?),
          signal_json = COALESCE(signal_json, ?),
          last_error = NULL,
          updated_at_ms = ?
        WHERE publication_id = ?
          AND state IN ('pending', 'accepted')
          AND claim_id = ?
      `
    )
    .bind(
      nowMs,
      signalJson,
      nowMs,
      requireNonEmpty(input.publicationId, "publicationId"),
      requireNonEmpty(input.claimId, "claimId")
    )
    .run();
  assertClaimTransition(result, input.publicationId);
  return await requireClaimedRecord(input);
}

export async function rescheduleCenterAgentWakePublication(input: {
  claimId: string;
  db: D1Database;
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
  const result = await input.db
    .prepare(
      `
        UPDATE center_agent_wake_publications
        SET
          attempt_count = attempt_count + 1,
          next_attempt_at_ms = ?,
          last_error = ?,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE publication_id = ?
          AND state IN ('pending', 'accepted')
          AND claim_id = ?
      `
    )
    .bind(
      nextAttemptAtMs,
      normalizeError(input.error),
      nowMs,
      requireNonEmpty(input.publicationId, "publicationId"),
      requireNonEmpty(input.claimId, "claimId")
    )
    .run();
  assertClaimTransition(result, input.publicationId);
  return await requireReleasedRecord(input);
}

export async function markCenterAgentWakePublicationCompleted(input: {
  claimId: string;
  db: D1Database;
  nowMs: number;
  publicationId: string;
}): Promise<CenterAgentWakePublicationRecord> {
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const result = await input.db
    .prepare(
      `
        UPDATE center_agent_wake_publications
        SET
          state = 'completed',
          completed_at_ms = COALESCE(completed_at_ms, ?),
          last_error = NULL,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE publication_id = ?
          AND state = 'accepted'
          AND claim_id = ?
      `
    )
    .bind(
      nowMs,
      nowMs,
      requireNonEmpty(input.publicationId, "publicationId"),
      requireNonEmpty(input.claimId, "claimId")
    )
    .run();
  assertClaimTransition(result, input.publicationId);
  return await requireReleasedRecord(input);
}

export async function markCenterAgentWakePublicationFailed(input: {
  claimId: string;
  db: D1Database;
  error: string;
  nowMs: number;
  publicationId: string;
}): Promise<CenterAgentWakePublicationRecord> {
  const nowMs = requireTimestamp(input.nowMs, "nowMs");
  const result = await input.db
    .prepare(
      `
        UPDATE center_agent_wake_publications
        SET
          state = 'failed',
          completed_at_ms = COALESCE(completed_at_ms, ?),
          last_error = ?,
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          updated_at_ms = ?
        WHERE publication_id = ?
          AND state IN ('pending', 'accepted')
          AND claim_id = ?
      `
    )
    .bind(
      nowMs,
      normalizeError(input.error),
      nowMs,
      requireNonEmpty(input.publicationId, "publicationId"),
      requireNonEmpty(input.claimId, "claimId")
    )
    .run();
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
  db: D1Database;
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
  db: D1Database;
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
  db: D1Database;
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

function changes(result: D1Result<unknown>): number {
  return Math.max(0, Math.trunc(Number(result.meta?.changes ?? 0)));
}

function assertClaimTransition(
  result: D1Result<unknown>,
  publicationId: string
): void {
  if (changes(result) === 0) {
    throw new CenterAgentWakePublicationClaimLostError(publicationId);
  }
}
