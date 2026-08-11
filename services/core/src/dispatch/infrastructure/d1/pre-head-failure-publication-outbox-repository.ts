import {
  openMeldRequestContextSchema,
  parseOpenMeldDaemonDispatchQueueIngress,
  profileSchema,
  signalSystemNoticeDataSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonDispatchQueueMessage,
  OpenMeldRequestContext,
  Profile,
  SignalSystemNoticeData,
} from "@openmeld/schemas/types";
import type { SpaceAccessContext } from "@openmeld/space";
import { OPENMELD_DAEMON_DISPATCH_STATE } from "../../rules/dispatch-lifecycle-contract";

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const PRE_HEAD_FAILURE_PUBLICATION_PENDING_ERROR_CODE =
  "dispatch.pre_head_failure_publication_pending" as const;
const PRE_HEAD_FAILURE_PUBLICATION_INTENT_MODEL_VERSION =
  "openmeld.dispatch.pre_head_failure_publication_intent.v2" as const;
export const PRE_HEAD_FAILURE_PUBLICATION_CLAIM_LEASE_MS = 5 * 60_000;
const PRE_HEAD_FAILURE_REPLY_PREVIEW = "Original message";

export type PreHeadFailurePublicationCommand = {
  context: OpenMeldRequestContext;
  data: SignalSystemNoticeData;
  profile: Profile;
  spaceAccess: SpaceAccessContext;
  spaceId: string;
};

export type PreHeadFailurePublicationIntent = {
  attemptId: string;
  attemptCount: number;
  claimExpiresAtMs: number | null;
  claimId: string | null;
  createdAtMs: number;
  dispatchId: string;
  errorCode: string;
  errorMessage: string | null;
  failureContext: "preflight_terminal";
  finalStatus:
    | typeof OPENMELD_DAEMON_DISPATCH_STATE.blocked
    | typeof OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal;
  idempotencyKey: string;
  modelVersion: typeof PRE_HEAD_FAILURE_PUBLICATION_INTENT_MODEL_VERSION;
  nextAttemptAtMs: number;
  publicationCommand: PreHeadFailurePublicationCommand;
  recordProfileNotFoundObservation: boolean;
  redriveMessage: OpenMeldDaemonDispatchQueueMessage;
  stateVersion: number;
};

export const createPreHeadFailurePublicationIntent = (input: {
  attemptId: string;
  createdAtMs: number;
  dispatchMessage: OpenMeldDaemonDispatchQueueMessage;
  errorCode: string;
  errorMessage?: string | null;
  finalStatus: PreHeadFailurePublicationIntent["finalStatus"];
  idempotencyKey: string;
  publicationCommand: PreHeadFailurePublicationCommand;
  recordProfileNotFoundObservation?: boolean;
}): PreHeadFailurePublicationIntent => {
  const redriveMessage = createPreHeadFailureRedriveMessage(
    input.dispatchMessage
  );
  const idempotencyKey = requireNonEmptyText(
    input.idempotencyKey,
    "idempotencyKey"
  );
  if (redriveMessage.idempotencyKey !== idempotencyKey) {
    throw new Error(
      "dispatch.pre_head_failure_publication_intent_invalid:idempotencyKey"
    );
  }
  const createdAtMs = Math.max(0, Math.trunc(input.createdAtMs));
  return parsePreHeadFailurePublicationIntent({
    attemptCount: 0,
    attemptId: requireNonEmptyText(input.attemptId, "attemptId"),
    claimExpiresAtMs: null,
    claimId: null,
    createdAtMs,
    dispatchId: redriveMessage.dispatchId,
    errorCode: requireNonEmptyText(input.errorCode, "errorCode"),
    errorMessage: normalizeString(input.errorMessage) ?? null,
    failureContext: "preflight_terminal",
    finalStatus: input.finalStatus,
    idempotencyKey,
    modelVersion: PRE_HEAD_FAILURE_PUBLICATION_INTENT_MODEL_VERSION,
    nextAttemptAtMs: createdAtMs,
    publicationCommand: input.publicationCommand,
    recordProfileNotFoundObservation:
      input.recordProfileNotFoundObservation === true,
    redriveMessage,
    stateVersion: 0,
  });
};

export const createPreHeadFailureRedriveMessage = (
  message: OpenMeldDaemonDispatchQueueMessage
): OpenMeldDaemonDispatchQueueMessage => {
  const {
    sourceMessageEnvelope: _sourceMessageEnvelope,
    sourceSignalSnapshot: _sourceSignalSnapshot,
    spacePassword: _spacePassword,
    ...persistableMessage
  } = message;
  return parsePreHeadFailureRedriveMessage({
    ...persistableMessage,
    ...(message.replyToSnapshot
      ? {
          replyToSnapshot: {
            ...message.replyToSnapshot,
            previewText: PRE_HEAD_FAILURE_REPLY_PREVIEW,
          },
        }
      : {}),
  });
};

export const ensurePreHeadFailurePublicationIntent = async (input: {
  db: D1Database;
  intent: PreHeadFailurePublicationIntent;
}): Promise<PreHeadFailurePublicationIntent> => {
  const intent = parsePreHeadFailurePublicationIntent(input.intent);
  await input.db
    .prepare(
      `
        INSERT OR IGNORE INTO openMeldDaemon_pre_head_failure_publication_outbox (
          dispatch_id,
          idempotency_key,
          attempt_id,
          created_at_ms,
          model_version,
          failure_context,
          final_status,
          error_code,
          error_message,
          record_profile_not_found_observation,
          publication_command_json,
          redrive_message_json,
          status,
          attempt_count,
          next_attempt_at_ms,
          claim_id,
          claim_expires_at_ms,
          state_version,
          completed_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, ?, NULL, ?)
      `
    )
    .bind(
      intent.dispatchId,
      intent.idempotencyKey,
      intent.attemptId,
      intent.createdAtMs,
      intent.modelVersion,
      intent.failureContext,
      intent.finalStatus,
      intent.errorCode,
      intent.errorMessage,
      intent.recordProfileNotFoundObservation ? 1 : 0,
      JSON.stringify(intent.publicationCommand),
      JSON.stringify(intent.redriveMessage),
      intent.attemptCount,
      intent.nextAttemptAtMs,
      intent.stateVersion,
      intent.createdAtMs
    )
    .run();

  const stored = await readPreHeadFailurePublicationIntent({
    db: input.db,
    dispatchId: intent.dispatchId,
  });
  if (!stored) {
    throw new Error("dispatch.pre_head_failure_publication_intent_missing");
  }
  if (
    stored.attemptId !== intent.attemptId ||
    stored.idempotencyKey !== intent.idempotencyKey ||
    JSON.stringify(stored.publicationCommand) !==
      JSON.stringify(intent.publicationCommand) ||
    JSON.stringify(stored.redriveMessage) !==
      JSON.stringify(intent.redriveMessage)
  ) {
    throw new Error("dispatch.pre_head_failure_publication_intent_conflict");
  }
  return stored;
};

export const readPendingPreHeadFailurePublicationIntent = async (input: {
  db: D1Database;
  dispatchId: string;
}): Promise<PreHeadFailurePublicationIntent | null> => {
  const state = await readPreHeadFailurePublicationState({
    db: input.db,
    dispatchId: input.dispatchId,
  });
  return state.status === "pending" ? state.intent : null;
};

export type PreHeadFailurePublicationState =
  | { status: "missing" }
  | { status: "completed" }
  | { intent: PreHeadFailurePublicationIntent; status: "pending" };

export const readPreHeadFailurePublicationState = async (input: {
  db: D1Database;
  dispatchId: string;
}): Promise<PreHeadFailurePublicationState> => {
  const dispatchId = requireNonEmptyText(input.dispatchId, "dispatchId");
  const row = await readPreHeadFailurePublicationOutboxRow({
    db: input.db,
    dispatchId,
  });
  if (!row) {
    return { status: "missing" };
  }
  if (row.status === "completed") {
    return { status: "completed" };
  }
  return {
    intent: parsePreHeadFailurePublicationOutboxRow(row),
    status: "pending",
  };
};

export const listDuePreHeadFailurePublicationIntents = async (input: {
  db: D1Database;
  limit: number;
  nowMs: number;
}): Promise<PreHeadFailurePublicationIntent[]> => {
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
  const rows = await input.db
    .prepare(
      `
        SELECT
          dispatch_id AS dispatchId,
          idempotency_key AS idempotencyKey,
          attempt_id AS attemptId,
          created_at_ms AS createdAtMs,
          model_version AS modelVersion,
          failure_context AS failureContext,
          final_status AS finalStatus,
          error_code AS errorCode,
          error_message AS errorMessage,
          record_profile_not_found_observation AS recordProfileNotFoundObservation,
          publication_command_json AS publicationCommandJson,
          redrive_message_json AS redriveMessageJson,
          status,
          attempt_count AS attemptCount,
          next_attempt_at_ms AS nextAttemptAtMs,
          claim_id AS claimId,
          claim_expires_at_ms AS claimExpiresAtMs,
          state_version AS stateVersion,
          completed_at_ms AS completedAtMs,
          updated_at_ms AS updatedAtMs
        FROM openMeldDaemon_pre_head_failure_publication_outbox
        WHERE status = 'pending'
          AND next_attempt_at_ms <= ?
          AND (claim_expires_at_ms IS NULL OR claim_expires_at_ms <= ?)
        ORDER BY next_attempt_at_ms ASC, created_at_ms ASC
        LIMIT ?
      `
    )
    .bind(input.nowMs, input.nowMs, limit)
    .all<PreHeadFailurePublicationOutboxRow>();
  return rows.results
    .map(parsePreHeadFailurePublicationOutboxRow)
    .filter(
      (intent) =>
        intent.nextAttemptAtMs <= input.nowMs &&
        (intent.claimExpiresAtMs === null ||
          intent.claimExpiresAtMs <= input.nowMs)
    )
    .sort(
      (left, right) =>
        left.nextAttemptAtMs - right.nextAttemptAtMs ||
        left.createdAtMs - right.createdAtMs
    )
    .slice(0, limit);
};

export type ClaimPreHeadFailurePublicationIntentResult =
  | { intent: PreHeadFailurePublicationIntent; outcome: "claimed" }
  | { outcome: "busy" }
  | { outcome: "completed" }
  | { outcome: "missing" };

export const claimPreHeadFailurePublicationIntent = async (input: {
  claimId: string;
  db: D1Database;
  dispatchId: string;
  nowMs: number;
}): Promise<ClaimPreHeadFailurePublicationIntentResult> => {
  const state = await readPreHeadFailurePublicationState({
    db: input.db,
    dispatchId: input.dispatchId,
  });
  if (state.status !== "pending") {
    return { outcome: state.status };
  }
  if (
    state.intent.nextAttemptAtMs > input.nowMs ||
    (state.intent.claimExpiresAtMs !== null &&
      state.intent.claimExpiresAtMs > input.nowMs)
  ) {
    return { outcome: "busy" };
  }
  const claimed = parsePreHeadFailurePublicationIntent({
    ...state.intent,
    claimExpiresAtMs: input.nowMs + PRE_HEAD_FAILURE_PUBLICATION_CLAIM_LEASE_MS,
    claimId: requireNonEmptyText(input.claimId, "claimId"),
    stateVersion: state.intent.stateVersion + 1,
  });
  const update = await updatePreHeadFailurePublicationIntent({
    db: input.db,
    expected: state.intent,
    next: claimed,
    nowMs: input.nowMs,
  });
  if (update) {
    return { intent: claimed, outcome: "claimed" };
  }
  const current = await readPreHeadFailurePublicationState({
    db: input.db,
    dispatchId: input.dispatchId,
  });
  return {
    outcome: current.status === "completed" ? "completed" : "busy",
  };
};

export const reschedulePreHeadFailurePublicationIntent = async (input: {
  db: D1Database;
  intent: PreHeadFailurePublicationIntent;
  nextAttemptAtMs: number;
  nowMs: number;
}): Promise<void> => {
  const intent = parsePreHeadFailurePublicationIntent(input.intent);
  if (!intent.claimId) {
    throw new Error(
      "dispatch.pre_head_failure_publication_reschedule_claim_missing"
    );
  }
  const rescheduled = parsePreHeadFailurePublicationIntent({
    ...intent,
    attemptCount: intent.attemptCount + 1,
    claimExpiresAtMs: null,
    claimId: null,
    nextAttemptAtMs: Math.max(
      Math.trunc(input.nextAttemptAtMs),
      Math.trunc(input.nowMs)
    ),
    stateVersion: intent.stateVersion + 1,
  });
  if (
    !(await updatePreHeadFailurePublicationIntent({
      db: input.db,
      expected: intent,
      next: rescheduled,
      nowMs: input.nowMs,
    }))
  ) {
    throw new Error(
      "dispatch.pre_head_failure_publication_reschedule_claim_lost"
    );
  }
};

export const markPreHeadFailurePublicationCompleted = async (input: {
  completedAtMs: number;
  db: D1Database;
  intent: PreHeadFailurePublicationIntent;
}): Promise<void> => {
  const intent = parsePreHeadFailurePublicationIntent(input.intent);
  if (!intent.claimId) {
    throw new Error(
      "dispatch.pre_head_failure_publication_completion_claim_missing"
    );
  }
  const completedAtMs = Math.max(0, Math.trunc(input.completedAtMs));
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_pre_head_failure_publication_outbox
        SET
          status = 'completed',
          claim_id = NULL,
          claim_expires_at_ms = NULL,
          state_version = state_version + 1,
          completed_at_ms = ?,
          updated_at_ms = ?
        WHERE dispatch_id = ?
          AND status = 'pending'
          AND state_version = ?
          AND claim_id = ?
          AND claim_expires_at_ms = ?
      `
    )
    .bind(
      completedAtMs,
      completedAtMs,
      intent.dispatchId,
      intent.stateVersion,
      intent.claimId,
      intent.claimExpiresAtMs
    )
    .run();
  if (Number(result.meta?.changes ?? 0) === 1) {
    return;
  }
  const state = await readPreHeadFailurePublicationState({
    db: input.db,
    dispatchId: intent.dispatchId,
  });
  if (state.status !== "completed") {
    throw new Error(
      "dispatch.pre_head_failure_publication_completion_claim_lost"
    );
  }
};

const updatePreHeadFailurePublicationIntent = async (input: {
  db: D1Database;
  expected: PreHeadFailurePublicationIntent;
  next: PreHeadFailurePublicationIntent;
  nowMs: number;
}): Promise<boolean> => {
  if (input.next.stateVersion !== input.expected.stateVersion + 1) {
    throw new Error(
      "dispatch.pre_head_failure_publication_state_version_invalid"
    );
  }
  const result = await input.db
    .prepare(
      `
        UPDATE openMeldDaemon_pre_head_failure_publication_outbox
        SET
          attempt_count = ?,
          next_attempt_at_ms = ?,
          claim_id = ?,
          claim_expires_at_ms = ?,
          state_version = ?,
          updated_at_ms = ?
        WHERE dispatch_id = ?
          AND status = 'pending'
          AND state_version = ?
          AND claim_id IS ?
          AND claim_expires_at_ms IS ?
      `
    )
    .bind(
      input.next.attemptCount,
      input.next.nextAttemptAtMs,
      input.next.claimId,
      input.next.claimExpiresAtMs,
      input.next.stateVersion,
      Math.max(0, Math.trunc(input.nowMs)),
      input.expected.dispatchId,
      input.expected.stateVersion,
      input.expected.claimId,
      input.expected.claimExpiresAtMs
    )
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
};

const readPreHeadFailurePublicationIntent = async (input: {
  db: D1Database;
  dispatchId: string;
}): Promise<PreHeadFailurePublicationIntent | null> => {
  const row = await readPreHeadFailurePublicationOutboxRow({
    db: input.db,
    dispatchId: input.dispatchId,
  });
  return row?.status === "pending"
    ? parsePreHeadFailurePublicationOutboxRow(row)
    : null;
};

type PreHeadFailurePublicationOutboxRow = {
  attemptCount: unknown;
  attemptId: unknown;
  claimExpiresAtMs: unknown;
  claimId: unknown;
  completedAtMs: unknown;
  createdAtMs: unknown;
  dispatchId: unknown;
  errorCode: unknown;
  errorMessage: unknown;
  failureContext: unknown;
  finalStatus: unknown;
  idempotencyKey: unknown;
  modelVersion: unknown;
  nextAttemptAtMs: unknown;
  publicationCommandJson: unknown;
  recordProfileNotFoundObservation: unknown;
  redriveMessageJson: unknown;
  stateVersion: unknown;
  status: unknown;
  updatedAtMs: unknown;
};

const readPreHeadFailurePublicationOutboxRow = async (input: {
  db: D1Database;
  dispatchId: string;
}): Promise<PreHeadFailurePublicationOutboxRow | null> =>
  await input.db
    .prepare(
      `
        SELECT
          dispatch_id AS dispatchId,
          idempotency_key AS idempotencyKey,
          attempt_id AS attemptId,
          created_at_ms AS createdAtMs,
          model_version AS modelVersion,
          failure_context AS failureContext,
          final_status AS finalStatus,
          error_code AS errorCode,
          error_message AS errorMessage,
          record_profile_not_found_observation AS recordProfileNotFoundObservation,
          publication_command_json AS publicationCommandJson,
          redrive_message_json AS redriveMessageJson,
          status,
          attempt_count AS attemptCount,
          next_attempt_at_ms AS nextAttemptAtMs,
          claim_id AS claimId,
          claim_expires_at_ms AS claimExpiresAtMs,
          state_version AS stateVersion,
          completed_at_ms AS completedAtMs,
          updated_at_ms AS updatedAtMs
        FROM openMeldDaemon_pre_head_failure_publication_outbox
        WHERE dispatch_id = ?
        LIMIT 1
      `
    )
    .bind(requireNonEmptyText(input.dispatchId, "dispatchId"))
    .first<PreHeadFailurePublicationOutboxRow>();

const parsePreHeadFailurePublicationOutboxRow = (
  row: PreHeadFailurePublicationOutboxRow
): PreHeadFailurePublicationIntent =>
  parsePreHeadFailurePublicationIntent({
    attemptCount: row.attemptCount,
    attemptId: row.attemptId,
    claimExpiresAtMs: row.claimExpiresAtMs,
    claimId: row.claimId,
    createdAtMs: row.createdAtMs,
    dispatchId: row.dispatchId,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    failureContext: row.failureContext,
    finalStatus: row.finalStatus,
    idempotencyKey: row.idempotencyKey,
    modelVersion: row.modelVersion,
    nextAttemptAtMs: row.nextAttemptAtMs,
    publicationCommand: parsePreHeadFailurePublicationPayloadJson(
      row.publicationCommandJson
    ),
    recordProfileNotFoundObservation:
      Number(row.recordProfileNotFoundObservation) === 1,
    redriveMessage: parsePreHeadFailurePublicationPayloadJson(
      row.redriveMessageJson
    ),
    stateVersion: row.stateVersion,
  });

const parsePreHeadFailurePublicationIntent = (
  value: unknown
): PreHeadFailurePublicationIntent => {
  if (!(value && typeof value === "object")) {
    throw new Error("dispatch.pre_head_failure_publication_intent_invalid");
  }
  const record = value as Partial<PreHeadFailurePublicationIntent>;
  const finalStatus =
    record.finalStatus === OPENMELD_DAEMON_DISPATCH_STATE.blocked ||
    record.finalStatus === OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal
      ? record.finalStatus
      : null;
  if (
    record.modelVersion !== PRE_HEAD_FAILURE_PUBLICATION_INTENT_MODEL_VERSION ||
    record.failureContext !== "preflight_terminal" ||
    !finalStatus
  ) {
    throw new Error("dispatch.pre_head_failure_publication_intent_invalid");
  }
  const redriveMessage = parsePreHeadFailureRedriveMessage(
    record.redriveMessage
  );
  const publicationCommand = parsePreHeadFailurePublicationCommand(
    record.publicationCommand
  );
  const dispatchId = requireNonEmptyText(record.dispatchId, "dispatchId");
  const idempotencyKey = requireNonEmptyText(
    record.idempotencyKey,
    "idempotencyKey"
  );
  const errorCode = requireNonEmptyText(record.errorCode, "errorCode");
  const claimId = normalizeString(record.claimId) ?? null;
  const claimExpiresAtMs =
    record.claimExpiresAtMs === null
      ? null
      : parseNonNegativeInteger(record.claimExpiresAtMs, "claimExpiresAtMs");
  if (
    dispatchId !== redriveMessage.dispatchId ||
    idempotencyKey !== redriveMessage.idempotencyKey ||
    publicationCommand.spaceId !== redriveMessage.spaceId ||
    publicationCommand.data.dispatchId !== dispatchId ||
    publicationCommand.data.actorProfileId !== redriveMessage.targetProfileId ||
    publicationCommand.data.reasonCode !== errorCode ||
    publicationCommand.data.noticeType !== "terminal_failure" ||
    publicationCommand.data.failureStage !== "execution" ||
    JSON.stringify(publicationCommand.data.replyTo ?? null) !==
      JSON.stringify(redriveMessage.replyToSnapshot ?? null) ||
    publicationCommand.spaceAccess.actor.kind !== "dispatch_continuation" ||
    publicationCommand.spaceAccess.actor.dispatchId !== dispatchId ||
    publicationCommand.spaceAccess.actor.sourceSignalId !==
      redriveMessage.sourceEventId ||
    publicationCommand.spaceAccess.actor.targetProfileId !==
      redriveMessage.targetProfileId ||
    publicationCommand.spaceAccess.proof.kind !== "none" ||
    (claimId === null) !== (claimExpiresAtMs === null)
  ) {
    throw new Error("dispatch.pre_head_failure_publication_intent_invalid");
  }
  return {
    attemptCount: parseNonNegativeInteger(record.attemptCount, "attemptCount"),
    attemptId: requireNonEmptyText(record.attemptId, "attemptId"),
    claimExpiresAtMs,
    claimId,
    createdAtMs: parseNonNegativeInteger(record.createdAtMs, "createdAtMs"),
    dispatchId,
    errorCode,
    errorMessage: normalizeString(record.errorMessage) ?? null,
    failureContext: "preflight_terminal",
    finalStatus,
    idempotencyKey,
    modelVersion: PRE_HEAD_FAILURE_PUBLICATION_INTENT_MODEL_VERSION,
    nextAttemptAtMs: parseNonNegativeInteger(
      record.nextAttemptAtMs,
      "nextAttemptAtMs"
    ),
    publicationCommand,
    recordProfileNotFoundObservation:
      record.recordProfileNotFoundObservation === true,
    redriveMessage,
    stateVersion: parseNonNegativeInteger(record.stateVersion, "stateVersion"),
  };
};

const parsePreHeadFailurePublicationCommand = (
  value: unknown
): PreHeadFailurePublicationCommand => {
  if (!(value && typeof value === "object") || Array.isArray(value)) {
    throw new Error("dispatch.pre_head_failure_publication_intent_invalid");
  }
  const record = value as Partial<PreHeadFailurePublicationCommand>;
  const context = openMeldRequestContextSchema.safeParse(record.context);
  const data = signalSystemNoticeDataSchema.safeParse(record.data);
  const profile = profileSchema.safeParse(record.profile);
  const spaceId = normalizeString(record.spaceId);
  const spaceAccess = record.spaceAccess;
  if (
    !(
      context.success &&
      data.success &&
      profile.success &&
      spaceId &&
      spaceAccess &&
      typeof spaceAccess === "object"
    ) ||
    Array.isArray(spaceAccess)
  ) {
    throw new Error("dispatch.pre_head_failure_publication_intent_invalid");
  }
  const typedSpaceAccess = spaceAccess as SpaceAccessContext;
  const spaceAccessRequestContext =
    typedSpaceAccess.actor?.kind === "dispatch_continuation"
      ? openMeldRequestContextSchema.safeParse(
          typedSpaceAccess.actor.requestContext
        )
      : null;
  if (
    typedSpaceAccess.spaceId !== spaceId ||
    typedSpaceAccess.actor?.kind !== "dispatch_continuation" ||
    typedSpaceAccess.proof?.kind !== "none" ||
    !spaceAccessRequestContext?.success ||
    JSON.stringify(spaceAccessRequestContext.data) !==
      JSON.stringify(context.data)
  ) {
    throw new Error("dispatch.pre_head_failure_publication_intent_invalid");
  }
  return {
    context: context.data,
    data: data.data,
    profile: profile.data,
    spaceAccess: typedSpaceAccess,
    spaceId,
  };
};

const parsePreHeadFailureRedriveMessage = (
  value: unknown
): OpenMeldDaemonDispatchQueueMessage => {
  const parsed = parseOpenMeldDaemonDispatchQueueIngress(value);
  if (
    parsed.kind !== "current_v2" ||
    parsed.message.spacePassword ||
    parsed.message.sourceMessageEnvelope ||
    parsed.message.sourceSignalSnapshot ||
    (parsed.message.replyToSnapshot &&
      parsed.message.replyToSnapshot.previewText !==
        PRE_HEAD_FAILURE_REPLY_PREVIEW)
  ) {
    throw new Error("dispatch.pre_head_failure_publication_intent_invalid");
  }
  return parsed.message;
};

const parsePreHeadFailurePublicationPayloadJson = (value: unknown): unknown => {
  const payloadJson = normalizeString(value);
  if (!payloadJson) {
    throw new Error("dispatch.pre_head_failure_publication_intent_invalid");
  }
  try {
    return JSON.parse(payloadJson);
  } catch {
    throw new Error("dispatch.pre_head_failure_publication_intent_invalid");
  }
};

const parseNonNegativeInteger = (value: unknown, field: string): number => {
  const number = Number(value);
  if (!(Number.isSafeInteger(number) && number >= 0)) {
    throw new Error(
      `dispatch.pre_head_failure_publication_intent_invalid:${field}`
    );
  }
  return number;
};

const requireNonEmptyText = (value: unknown, field: string): string => {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(
      `dispatch.pre_head_failure_publication_intent_invalid:${field}`
    );
  }
  return normalized;
};
