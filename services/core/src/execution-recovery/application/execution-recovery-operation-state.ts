import { executeExecutionRecoveryResponseSchema } from "@openmeld/schemas";
import type { ExecuteExecutionRecoveryResponse } from "@openmeld/schemas/types";

type ExecutionRecoveryOperationTransaction = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
};

export type ExecutionRecoveryOperationStorage = {
  transaction<T>(
    run: (transaction: ExecutionRecoveryOperationTransaction) => Promise<T>
  ): Promise<T>;
};

type ExecutionRecoveryOperationAliasRecord = {
  claimStorageKey: string;
  commandJson: string;
  createdAtMs: number;
  v: 1;
};

type ExecutionRecoveryOperationAttempt = {
  attemptId: string;
  effectStartedAtMs: number | null;
  leaseExpiresAtMs: number;
  phase: "effect_started" | "reserved";
  startedAtMs: number;
};

type ExecutionRecoveryOperationRecord = {
  attemptCount: number;
  commandJson: string;
  createdAtMs: number;
  currentAttempt: ExecutionRecoveryOperationAttempt | null;
  effectOperationId: string;
  response: ExecuteExecutionRecoveryResponse | null;
  status: "completed" | "in_progress" | "outcome_unknown" | "safe_to_retry";
  updatedAtMs: number;
  v: 3;
};

type V1ExecutionRecoveryOperationRecord = {
  commandJson: string;
  createdAtMs: number;
  response: ExecuteExecutionRecoveryResponse | null;
  status: "completed" | "in_progress";
  updatedAtMs: number;
  v: 1;
};

type V2ExecutionRecoveryOperationRecord = Omit<
  ExecutionRecoveryOperationRecord,
  "currentAttempt" | "v"
> & {
  currentAttempt: {
    attemptId: string;
    leaseExpiresAtMs: number;
    startedAtMs: number;
  } | null;
  v: 2;
};

export type BeginExecutionRecoveryOperationResult =
  | {
      attemptId: string;
      effectOperationId: string;
      status: "claimed";
    }
  | {
      effectOperationId: string;
      status: "in_progress" | "outcome_unknown";
    }
  | {
      effectOperationId: string;
      response: ExecuteExecutionRecoveryResponse;
      status: "completed";
    };

export async function inspectExecutionRecoveryOperation(
  storage: ExecutionRecoveryOperationStorage,
  input: {
    claimStorageKey: string;
    commandJson: string;
    operationStorageKey: string;
  }
): Promise<
  | { status: "absent" }
  | {
      response: ExecuteExecutionRecoveryResponse | null;
      status: "completed" | "in_progress" | "outcome_unknown" | "safe_to_retry";
    }
> {
  return await storage.transaction(async (transaction) => {
    const alias = parseAliasRecord(
      await transaction.get<unknown>(input.operationStorageKey)
    );
    if (
      alias &&
      (alias.claimStorageKey !== input.claimStorageKey ||
        alias.commandJson !== input.commandJson)
    ) {
      throw new Error("execution_recovery.operation_conflict");
    }
    const stored = parseOperationRecord(
      await transaction.get<unknown>(input.claimStorageKey),
      {
        claimStorageKey: input.claimStorageKey,
      }
    );
    if (!stored) {
      return { status: "absent" as const };
    }
    if (stored.commandJson !== input.commandJson) {
      throw new Error("execution_recovery.claim_hash_collision");
    }
    return {
      response:
        stored.status === "completed" ? requireCompletedResponse(stored) : null,
      status: stored.status,
    };
  });
}

export async function beginExecutionRecoveryOperation(
  storage: ExecutionRecoveryOperationStorage,
  input: {
    attemptId: string;
    claimStorageKey: string;
    commandJson: string;
    effectOperationId?: string;
    leaseDurationMs: number;
    nowMs: number;
    operationId: string;
    operationStorageKey: string;
  }
): Promise<BeginExecutionRecoveryOperationResult> {
  assertNonEmpty(input.attemptId, "attempt ID");
  assertNonEmpty(input.claimStorageKey, "claim storage key");
  assertNonEmpty(input.commandJson, "command JSON");
  assertNonEmpty(input.operationId, "operation ID");
  assertNonEmpty(input.operationStorageKey, "operation storage key");
  if (!(Number.isFinite(input.leaseDurationMs) && input.leaseDurationMs > 0)) {
    throw new Error("execution_recovery.operation_lease_invalid");
  }
  const effectOperationId =
    input.effectOperationId?.trim() || input.claimStorageKey;

  return await storage.transaction(async (transaction) => {
    const alias = parseAliasRecord(
      await transaction.get<unknown>(input.operationStorageKey)
    );
    assertOperationAliasMatches(alias, input);

    const stored = parseOperationRecord(
      await transaction.get<unknown>(input.claimStorageKey),
      {
        claimStorageKey: input.claimStorageKey,
      }
    );
    assertOperationRecordMatches(stored, input.commandJson);
    if (!alias) {
      await transaction.put<ExecutionRecoveryOperationAliasRecord>(
        input.operationStorageKey,
        {
          claimStorageKey: input.claimStorageKey,
          commandJson: input.commandJson,
          createdAtMs: input.nowMs,
          v: 1,
        }
      );
    }
    const existing = await resolveExistingBeginOperation({
      input,
      stored,
      transaction,
    });
    if (existing) {
      return existing;
    }

    const next: ExecutionRecoveryOperationRecord = {
      attemptCount: (stored?.attemptCount ?? 0) + 1,
      commandJson: input.commandJson,
      createdAtMs: stored?.createdAtMs ?? input.nowMs,
      currentAttempt: {
        attemptId: input.attemptId,
        effectStartedAtMs: null,
        leaseExpiresAtMs: input.nowMs + input.leaseDurationMs,
        phase: "reserved",
        startedAtMs: input.nowMs,
      },
      effectOperationId: stored?.effectOperationId ?? effectOperationId,
      response: null,
      status: "in_progress",
      updatedAtMs: input.nowMs,
      v: 3,
    };
    await transaction.put(input.claimStorageKey, next);
    return {
      attemptId: input.attemptId,
      effectOperationId: next.effectOperationId,
      status: "claimed" as const,
    };
  });
}

async function resolveExistingBeginOperation(input: {
  input: Parameters<typeof beginExecutionRecoveryOperation>[1];
  stored: ExecutionRecoveryOperationRecord | null;
  transaction: ExecutionRecoveryOperationTransaction;
}): Promise<BeginExecutionRecoveryOperationResult | null> {
  const { stored } = input;
  if (stored?.status === "completed") {
    return {
      effectOperationId: stored.effectOperationId,
      response: requireCompletedResponse(stored),
      status: "completed",
    };
  }
  if (
    stored?.status === "in_progress" &&
    stored.currentAttempt &&
    stored.currentAttempt.leaseExpiresAtMs > input.input.nowMs
  ) {
    return {
      effectOperationId: stored.effectOperationId,
      status: "in_progress",
    };
  }
  if (
    stored?.status === "in_progress" &&
    stored.currentAttempt?.phase === "reserved"
  ) {
    return null;
  }
  if (stored?.status === "safe_to_retry") {
    return null;
  }
  if (!stored) {
    return null;
  }
  if (stored.status !== "outcome_unknown") {
    await input.transaction.put<ExecutionRecoveryOperationRecord>(
      input.input.claimStorageKey,
      {
        ...stored,
        currentAttempt: null,
        status: "outcome_unknown",
        updatedAtMs: input.input.nowMs,
      }
    );
  }
  return {
    effectOperationId: stored.effectOperationId,
    status: "outcome_unknown",
  };
}

function assertOperationAliasMatches(
  alias: ExecutionRecoveryOperationAliasRecord | null,
  input: Pick<
    Parameters<typeof beginExecutionRecoveryOperation>[1],
    "claimStorageKey" | "commandJson"
  >
): void {
  if (
    alias &&
    (alias.claimStorageKey !== input.claimStorageKey ||
      alias.commandJson !== input.commandJson)
  ) {
    throw new Error("execution_recovery.operation_conflict");
  }
}

function assertOperationRecordMatches(
  stored: ExecutionRecoveryOperationRecord | null,
  commandJson: string
): void {
  if (stored && stored.commandJson !== commandJson) {
    throw new Error("execution_recovery.claim_hash_collision");
  }
}

export async function markExecutionRecoveryOperationEffectStarted(
  storage: ExecutionRecoveryOperationStorage,
  input: {
    attemptId: string;
    claimStorageKey: string;
    commandJson: string;
    nowMs: number;
  }
): Promise<void> {
  await storage.transaction(async (transaction) => {
    const stored = requireOperationRecord(
      await transaction.get<unknown>(input.claimStorageKey),
      input.claimStorageKey,
      input.commandJson
    );
    assertCurrentAttempt(stored, input.attemptId);
    const currentAttempt = stored.currentAttempt;
    if (!currentAttempt) {
      throw new Error("execution_recovery.operation_attempt_fenced");
    }
    if (currentAttempt.phase === "effect_started") {
      return;
    }
    await transaction.put<ExecutionRecoveryOperationRecord>(
      input.claimStorageKey,
      {
        ...stored,
        currentAttempt: {
          ...currentAttempt,
          effectStartedAtMs: input.nowMs,
          phase: "effect_started",
        },
        updatedAtMs: input.nowMs,
      }
    );
  });
}

export async function completeExecutionRecoveryOperationAttempt(
  storage: ExecutionRecoveryOperationStorage,
  input: {
    attemptId: string;
    claimStorageKey: string;
    commandJson: string;
    nowMs: number;
    response: ExecuteExecutionRecoveryResponse;
  }
): Promise<void> {
  const response = executeExecutionRecoveryResponseSchema.parse(input.response);
  await storage.transaction(async (transaction) => {
    const stored = requireOperationRecord(
      await transaction.get<unknown>(input.claimStorageKey),
      input.claimStorageKey,
      input.commandJson
    );
    if (stored.status === "completed") {
      assertSameResponse(requireCompletedResponse(stored), response);
      return;
    }
    assertCurrentAttempt(stored, input.attemptId);
    assertEffectStarted(stored);
    await transaction.put<ExecutionRecoveryOperationRecord>(
      input.claimStorageKey,
      {
        ...stored,
        currentAttempt: null,
        response,
        status: "completed",
        updatedAtMs: input.nowMs,
      }
    );
  });
}

export async function reconcileExecutionRecoveryOperationSucceeded(
  storage: ExecutionRecoveryOperationStorage,
  input: {
    claimStorageKey: string;
    commandJson: string;
    nowMs: number;
    response: ExecuteExecutionRecoveryResponse;
  }
): Promise<boolean> {
  const response = executeExecutionRecoveryResponseSchema.parse(input.response);
  return await storage.transaction(async (transaction) => {
    const stored = parseOperationRecord(
      await transaction.get<unknown>(input.claimStorageKey),
      {
        claimStorageKey: input.claimStorageKey,
      }
    );
    if (!stored) {
      return false;
    }
    if (stored.commandJson !== input.commandJson) {
      throw new Error("execution_recovery.claim_hash_collision");
    }
    if (stored.status === "completed") {
      assertSameResponse(requireCompletedResponse(stored), response);
      return true;
    }
    await transaction.put<ExecutionRecoveryOperationRecord>(
      input.claimStorageKey,
      {
        ...stored,
        currentAttempt: null,
        response,
        status: "completed",
        updatedAtMs: input.nowMs,
      }
    );
    return true;
  });
}

export async function failExecutionRecoveryOperationAttempt(
  storage: ExecutionRecoveryOperationStorage,
  input: {
    attemptId: string;
    claimStorageKey: string;
    commandJson: string;
    nowMs: number;
  }
): Promise<void> {
  await storage.transaction(async (transaction) => {
    const stored = requireOperationRecord(
      await transaction.get<unknown>(input.claimStorageKey),
      input.claimStorageKey,
      input.commandJson
    );
    assertCurrentAttempt(stored, input.attemptId);
    const outcome =
      stored.currentAttempt?.phase === "reserved"
        ? "safe_to_retry"
        : "outcome_unknown";
    await transaction.put<ExecutionRecoveryOperationRecord>(
      input.claimStorageKey,
      {
        ...stored,
        currentAttempt: null,
        status: outcome,
        updatedAtMs: input.nowMs,
      }
    );
  });
}

function requireOperationRecord(
  value: unknown,
  claimStorageKey: string,
  commandJson: string
): ExecutionRecoveryOperationRecord {
  const record = parseOperationRecord(value, { claimStorageKey });
  if (!record) {
    throw new Error("execution_recovery.operation_reservation_missing");
  }
  if (record.commandJson !== commandJson) {
    throw new Error("execution_recovery.claim_hash_collision");
  }
  return record;
}

function parseAliasRecord(
  value: unknown
): ExecutionRecoveryOperationAliasRecord | null {
  if (value === undefined) {
    return null;
  }
  if (!(value && typeof value === "object" && !Array.isArray(value))) {
    throw new Error("execution_recovery.operation_alias_record_invalid");
  }
  const record = value as Partial<ExecutionRecoveryOperationAliasRecord>;
  if (
    record.v !== 1 ||
    typeof record.claimStorageKey !== "string" ||
    !record.claimStorageKey ||
    typeof record.commandJson !== "string" ||
    !record.commandJson ||
    typeof record.createdAtMs !== "number" ||
    !Number.isFinite(record.createdAtMs)
  ) {
    throw new Error("execution_recovery.operation_alias_record_invalid");
  }
  return record as ExecutionRecoveryOperationAliasRecord;
}

function parseOperationRecord(
  value: unknown,
  input: { claimStorageKey: string }
): ExecutionRecoveryOperationRecord | null {
  if (value === undefined) {
    return null;
  }
  if (!(value && typeof value === "object" && !Array.isArray(value))) {
    throw new Error("execution_recovery.operation_record_invalid");
  }
  const raw = value as Record<string, unknown>;
  if (raw.v === 1) {
    return migrateV1Record(raw, input.claimStorageKey);
  }
  if (raw.v === 2) {
    return migrateV2Record(raw);
  }
  if (raw.v !== 3) {
    throw new Error("execution_recovery.operation_record_invalid");
  }
  const response =
    raw.response === null
      ? null
      : executeExecutionRecoveryResponseSchema.safeParse(raw.response);
  const currentAttempt = parseAttempt(raw.currentAttempt);
  if (
    typeof raw.attemptCount !== "number" ||
    !Number.isInteger(raw.attemptCount) ||
    raw.attemptCount < 1 ||
    typeof raw.commandJson !== "string" ||
    !raw.commandJson ||
    typeof raw.createdAtMs !== "number" ||
    !Number.isFinite(raw.createdAtMs) ||
    typeof raw.effectOperationId !== "string" ||
    !raw.effectOperationId ||
    typeof raw.updatedAtMs !== "number" ||
    !Number.isFinite(raw.updatedAtMs) ||
    !isOperationStatus(raw.status) ||
    (raw.status === "in_progress" && !currentAttempt) ||
    (raw.status !== "in_progress" && currentAttempt !== null) ||
    (raw.status === "completed" && !response?.success) ||
    (raw.status !== "completed" && raw.response !== null)
  ) {
    throw new Error("execution_recovery.operation_record_invalid");
  }
  return {
    attemptCount: raw.attemptCount,
    commandJson: raw.commandJson,
    createdAtMs: raw.createdAtMs,
    currentAttempt,
    effectOperationId: raw.effectOperationId,
    response: response?.success ? response.data : null,
    status: raw.status,
    updatedAtMs: raw.updatedAtMs,
    v: 3,
  };
}

function migrateV1Record(
  raw: Record<string, unknown>,
  claimStorageKey: string
): ExecutionRecoveryOperationRecord {
  const legacy = raw as Partial<V1ExecutionRecoveryOperationRecord>;
  const response =
    legacy.response === null
      ? null
      : executeExecutionRecoveryResponseSchema.safeParse(legacy.response);
  if (
    typeof legacy.commandJson !== "string" ||
    !legacy.commandJson ||
    typeof legacy.createdAtMs !== "number" ||
    !Number.isFinite(legacy.createdAtMs) ||
    typeof legacy.updatedAtMs !== "number" ||
    !Number.isFinite(legacy.updatedAtMs) ||
    (legacy.status !== "completed" && legacy.status !== "in_progress") ||
    (legacy.status === "completed" && !response?.success) ||
    (legacy.status === "in_progress" && legacy.response !== null)
  ) {
    throw new Error("execution_recovery.operation_record_invalid");
  }
  return {
    attemptCount: 1,
    commandJson: legacy.commandJson,
    createdAtMs: legacy.createdAtMs,
    currentAttempt: null,
    effectOperationId: claimStorageKey,
    response: response?.success ? response.data : null,
    status: legacy.status === "completed" ? "completed" : "outcome_unknown",
    updatedAtMs: legacy.updatedAtMs,
    v: 3,
  };
}

function migrateV2Record(
  raw: Record<string, unknown>
): ExecutionRecoveryOperationRecord {
  const legacy = raw as Partial<V2ExecutionRecoveryOperationRecord>;
  const response =
    legacy.response === null
      ? null
      : executeExecutionRecoveryResponseSchema.safeParse(legacy.response);
  const legacyAttempt = parseV2Attempt(legacy.currentAttempt);
  if (
    typeof legacy.attemptCount !== "number" ||
    !Number.isInteger(legacy.attemptCount) ||
    legacy.attemptCount < 1 ||
    typeof legacy.commandJson !== "string" ||
    !legacy.commandJson ||
    typeof legacy.createdAtMs !== "number" ||
    !Number.isFinite(legacy.createdAtMs) ||
    typeof legacy.effectOperationId !== "string" ||
    !legacy.effectOperationId ||
    typeof legacy.updatedAtMs !== "number" ||
    !Number.isFinite(legacy.updatedAtMs) ||
    !isOperationStatus(legacy.status) ||
    (legacy.status === "in_progress" && !legacyAttempt) ||
    (legacy.status !== "in_progress" && legacy.currentAttempt !== null) ||
    (legacy.status === "completed" && !response?.success) ||
    (legacy.status !== "completed" && legacy.response !== null)
  ) {
    throw new Error("execution_recovery.operation_record_invalid");
  }
  return {
    attemptCount: legacy.attemptCount,
    commandJson: legacy.commandJson,
    createdAtMs: legacy.createdAtMs,
    currentAttempt:
      legacy.status === "in_progress" && legacyAttempt
        ? {
            ...legacyAttempt,
            effectStartedAtMs: legacyAttempt.startedAtMs,
            phase: "effect_started",
          }
        : null,
    effectOperationId: legacy.effectOperationId,
    response: response?.success ? response.data : null,
    status: legacy.status,
    updatedAtMs: legacy.updatedAtMs,
    v: 3,
  };
}

function parseAttempt(
  value: unknown
): ExecutionRecoveryOperationAttempt | null {
  if (value === null) {
    return null;
  }
  if (!(value && typeof value === "object" && !Array.isArray(value))) {
    return null;
  }
  const attempt = value as Partial<ExecutionRecoveryOperationAttempt>;
  if (
    typeof attempt.attemptId !== "string" ||
    !attempt.attemptId ||
    (attempt.phase !== "reserved" && attempt.phase !== "effect_started") ||
    (attempt.phase === "reserved" && attempt.effectStartedAtMs !== null) ||
    (attempt.phase === "effect_started" &&
      (typeof attempt.effectStartedAtMs !== "number" ||
        !Number.isFinite(attempt.effectStartedAtMs))) ||
    typeof attempt.leaseExpiresAtMs !== "number" ||
    !Number.isFinite(attempt.leaseExpiresAtMs) ||
    typeof attempt.startedAtMs !== "number" ||
    !Number.isFinite(attempt.startedAtMs) ||
    attempt.leaseExpiresAtMs <= attempt.startedAtMs ||
    (typeof attempt.effectStartedAtMs === "number" &&
      attempt.effectStartedAtMs < attempt.startedAtMs)
  ) {
    return null;
  }
  return attempt as ExecutionRecoveryOperationAttempt;
}

function parseV2Attempt(
  value: unknown
): V2ExecutionRecoveryOperationRecord["currentAttempt"] {
  if (value === null) {
    return null;
  }
  if (!(value && typeof value === "object" && !Array.isArray(value))) {
    return null;
  }
  const attempt = value as Partial<
    NonNullable<V2ExecutionRecoveryOperationRecord["currentAttempt"]>
  >;
  if (
    typeof attempt.attemptId !== "string" ||
    !attempt.attemptId ||
    typeof attempt.leaseExpiresAtMs !== "number" ||
    !Number.isFinite(attempt.leaseExpiresAtMs) ||
    typeof attempt.startedAtMs !== "number" ||
    !Number.isFinite(attempt.startedAtMs) ||
    attempt.leaseExpiresAtMs <= attempt.startedAtMs
  ) {
    return null;
  }
  return attempt as NonNullable<
    V2ExecutionRecoveryOperationRecord["currentAttempt"]
  >;
}

function assertCurrentAttempt(
  record: ExecutionRecoveryOperationRecord,
  attemptId: string
): void {
  if (
    record.status !== "in_progress" ||
    record.currentAttempt?.attemptId !== attemptId
  ) {
    throw new Error("execution_recovery.operation_attempt_fenced");
  }
}

function assertEffectStarted(record: ExecutionRecoveryOperationRecord): void {
  if (record.currentAttempt?.phase !== "effect_started") {
    throw new Error("execution_recovery.operation_effect_not_started");
  }
}

function requireCompletedResponse(
  record: ExecutionRecoveryOperationRecord
): ExecuteExecutionRecoveryResponse {
  if (!(record.status === "completed" && record.response)) {
    throw new Error("execution_recovery.operation_record_invalid");
  }
  return record.response;
}

function assertSameResponse(
  left: ExecuteExecutionRecoveryResponse,
  right: ExecuteExecutionRecoveryResponse
): void {
  if (
    stableJson({ ...left, operationId: null }) !==
    stableJson({ ...right, operationId: null })
  ) {
    throw new Error("execution_recovery.operation_response_conflict");
  }
}

function isOperationStatus(
  value: unknown
): value is ExecutionRecoveryOperationRecord["status"] {
  return (
    value === "completed" ||
    value === "in_progress" ||
    value === "outcome_unknown" ||
    value === "safe_to_retry"
  );
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`execution_recovery.${label.replaceAll(" ", "_")}_invalid`);
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (!(value && typeof value === "object")) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)])
  );
}
