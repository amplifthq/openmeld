import {
  OPENMELD_DAEMON_DISPATCH_CONTRACT_VERSION,
  OPENMELD_DAEMON_DISPATCH_QUEUE_SCHEMA_VERSION,
  parseOpenMeldDaemonDispatchQueueIngress,
  projectTargetWakeLifecycleIdentity,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonDispatchQueueMessage,
  TargetWakeLifecycleIdentity,
} from "@openmeld/schemas/types";
import {
  createDispatchChainContext,
  createNextDispatchChainContext,
} from "../../../dispatch/rules/dispatch-chain-context";
import { buildIdempotencyKey } from "../../../dispatch/rules/dispatch-idempotency";
export const OPENMELD_DAEMON_OUTBOX_STATUS_PENDING = "pending" as const;
export const OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF = "handed_off" as const;
export const OPENMELD_DAEMON_OUTBOX_STATUS_CANCELLED = "cancelled" as const;
// Existing Space Durable Objects persist this historical value and column name.
// Keep that encoding inside the repository boundary; application code sees the
// transport-neutral `handed_off` fact for both direct and Queue delivery.
const PERSISTED_OUTBOX_STATUS_QUEUED = "queued" as const;
export const OPENMELD_DAEMON_DISPATCH_SNAPSHOT_MAX_BYTES = 32_768;
export const OPENMELD_DAEMON_DISPATCH_SNAPSHOT_OVERSIZE_ERROR_CODE =
  "dispatch.snapshot.oversize" as const;
const MAX_CLIENT_MESSAGE_OUTBOX_SCAN_ROWS = 500;
const MAX_ACTIVE_SPACE_OUTBOX_SCAN_ROWS = 500;
export type OpenMeldDaemonOutboxStatus =
  | typeof OPENMELD_DAEMON_OUTBOX_STATUS_PENDING
  | typeof OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF
  | typeof OPENMELD_DAEMON_OUTBOX_STATUS_CANCELLED;
export type OpenMeldDaemonDispatchOutboxRecoveryCandidate =
  OpenMeldDaemonDispatchQueueMessage & {
    outboxStatus: OpenMeldDaemonOutboxStatus;
    createdAtMs: number;
    handedOffAtMs: number | null;
  };
export type OpenMeldDaemonDispatchOutboxRecord =
  OpenMeldDaemonDispatchQueueMessage & {
    status: OpenMeldDaemonOutboxStatus;
    payloadJson: string;
    createdAtMs: number;
    handedOffAtMs: number | null;
  };
export type DispatchSourceSignalSnapshotInput = Omit<
  NonNullable<OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"]>,
  "profileMentionLabel"
> & {
  profileMentionLabel?: string | null;
};
export type OpenMeldDaemonDispatchOutboxHandoffSeedInsertResult =
  | {
      status: "inserted";
      record: OpenMeldDaemonDispatchOutboxRecord;
    }
  | {
      status: "idempotent_existing";
      record: OpenMeldDaemonDispatchOutboxRecoveryCandidate;
    }
  | {
      existing: OpenMeldDaemonDispatchOutboxRecoveryCandidate | null;
      reasonCode:
        | "handoff_seed_existing_mismatch"
        | "handoff_seed_existing_unreadable";
      status: "conflict";
    };
type OpenMeldDaemonDispatchOutboxPersistedRow = {
  payload_json: string;
  status: string;
  created_at_ms: number;
  queued_at_ms: number | null;
};
export type OpenMeldDaemonDispatchOutboxPoisonFailureState = {
  failureCount: number;
  poisoned: boolean;
};
class DispatchSnapshotOversizeError extends Error {
  readonly code = OPENMELD_DAEMON_DISPATCH_SNAPSHOT_OVERSIZE_ERROR_CODE;
}
export const createDispatchOutboxRecord = (input: {
  contextSelection?: OpenMeldDaemonDispatchQueueMessage["contextSelection"];
  requestChain?: OpenMeldDaemonDispatchQueueMessage["requestChain"];
  bindingState: "bound" | "missing";
  bindingEnabled: boolean;
  agentControllerRef?: string | null;
  contextIdMappingSpec?: OpenMeldDaemonDispatchQueueMessage["contextIdMappingSpec"];
  continuitySnapshot?: OpenMeldDaemonDispatchQueueMessage["continuitySnapshot"];
  dispatchPolicy: OpenMeldDaemonDispatchQueueMessage["dispatchPolicy"];
  dispatchOwner?: OpenMeldDaemonDispatchQueueMessage["dispatchOwner"];
  transportMode?: OpenMeldDaemonDispatchQueueMessage["transportMode"];
  spacePassword?: OpenMeldDaemonDispatchQueueMessage["spacePassword"];
  ruleId: OpenMeldDaemonDispatchQueueMessage["ruleId"];
  ruleReason: OpenMeldDaemonDispatchQueueMessage["ruleReason"];
  ruleSource: OpenMeldDaemonDispatchQueueMessage["ruleSource"];
  sourceAutoRelayDepth?: number;
  sourceDispatchChainId?: string;
  sourceSignalSnapshot: DispatchSourceSignalSnapshotInput;
  deviceWait?: OpenMeldDaemonDispatchQueueMessage["deviceWait"];
  sourceMessageEnvelope?:
    | OpenMeldDaemonDispatchQueueMessage["sourceMessageEnvelope"]
    | null;
  replyToSnapshot?:
    | OpenMeldDaemonDispatchQueueMessage["replyToSnapshot"]
    | null;
  threadContext?: OpenMeldDaemonDispatchQueueMessage["threadContext"] | null;
  spaceNameSnapshot?: string | null;
  sourceProfileNameSnapshot?: string | null;
  targetProfileNameSnapshot?: string | null;
  sourceVisitedProfileIds?: string[];
  senderProfileId: string;
  spaceId: string;
  organizationId?: string;
  spaceContractSnapshot?: OpenMeldDaemonDispatchQueueMessage["spaceContractSnapshot"];
  sourceEventId: string;
  sourceClientMessageId?: string | null;
  targetProfileId: string;
  targetProfileMentionLabel?: string | null;
  nowMs: number;
}): OpenMeldDaemonDispatchOutboxRecord => {
  const idempotencyKey = buildIdempotencyKey({
    sourceEventId: input.sourceEventId,
    targetProfileId: input.targetProfileId,
  });
  const normalizedAgentControllerRef = normalizeOptionalSnapshot(
    input.agentControllerRef
  );
  const transportMode =
    input.transportMode === "local-cli" ? "local-cli" : null;
  const spacePassword = normalizeOptionalSnapshot(input.spacePassword);
  const organizationId = normalizeOptionalSnapshot(input.organizationId);
  const contextIdMappingSpec = input.contextIdMappingSpec ?? null;
  const dispatchSnapshot: OpenMeldDaemonDispatchQueueMessage["dispatchSnapshot"] =
    {
      dispatchPolicy: input.dispatchPolicy,
      ruleSource: input.ruleSource,
      ruleId: input.ruleId,
      ruleReason: input.ruleReason,
      targetBindingState: input.bindingState,
      targetBindingEnabled: input.bindingEnabled,
    };
  assertDispatchSnapshotWithinBudget(dispatchSnapshot);
  const dispatchId = crypto.randomUUID();
  const sourceSignalText = input.sourceSignalSnapshot.text.trim();
  if (sourceSignalText.length === 0) {
    throw new Error("sourceSignalSnapshot.text is required");
  }
  const dispatchChainContext = resolveDispatchChainContextForOutbox({
    dispatchId,
    senderProfileId: input.senderProfileId,
    sourceAutoRelayDepth: input.sourceAutoRelayDepth,
    sourceDispatchChainId: input.sourceDispatchChainId,
    sourceVisitedProfileIds: input.sourceVisitedProfileIds,
  });
  const sourceSignalSnapshot = buildSourceSignalSnapshot({
    requestTimeContext: input.sourceSignalSnapshot.requestTimeContext,
    callerContext: input.sourceSignalSnapshot.callerContext,
    quotedMessage: input.sourceSignalSnapshot.quotedMessage,
    contextMessages: input.sourceSignalSnapshot.contextMessages,
    pinnedFiles: input.sourceSignalSnapshot.pinnedFiles,
    attachments: input.sourceSignalSnapshot.attachments,
    files: input.sourceSignalSnapshot.files,
    workHandoff: input.sourceSignalSnapshot.workHandoff,
    evidenceRefs: input.sourceSignalSnapshot.evidenceRefs,
    centerAgentInteractionSource:
      input.sourceSignalSnapshot.centerAgentInteractionSource,
    profileId: input.sourceSignalSnapshot.profileId,
    profileKind: input.sourceSignalSnapshot.profileKind,
    profileMentionLabel: input.sourceSignalSnapshot.profileMentionLabel,
    text: sourceSignalText,
  });
  const replyToSnapshot = buildReplyToSnapshot(input.replyToSnapshot);
  const message: OpenMeldDaemonDispatchQueueMessage = {
    ...(input.contextSelection
      ? { contextSelection: input.contextSelection }
      : {}),
    ...(input.deviceWait ? { deviceWait: input.deviceWait } : {}),
    v: OPENMELD_DAEMON_DISPATCH_QUEUE_SCHEMA_VERSION,
    dispatchId,
    spaceId: input.spaceId,
    ...(organizationId ? { organizationId } : {}),
    sourceEventId: input.sourceEventId,
    ...(typeof input.sourceClientMessageId === "string" &&
    input.sourceClientMessageId.trim().length > 0
      ? { sourceClientMessageId: input.sourceClientMessageId.trim() }
      : {}),
    targetProfileId: input.targetProfileId,
    ...(input.dispatchOwner ? { dispatchOwner: input.dispatchOwner } : {}),
    ...(typeof input.targetProfileMentionLabel === "string" &&
    input.targetProfileMentionLabel.trim().length > 0
      ? { targetProfileMentionLabel: input.targetProfileMentionLabel.trim() }
      : {}),
    dispatchChainId: dispatchChainContext.dispatchChainId,
    autoRelayDepth: dispatchChainContext.autoRelayDepth,
    visitedProfileIds: dispatchChainContext.visitedProfileIds,
    visitedProfileIdsHash: dispatchChainContext.visitedProfileIdsHash,
    ...(input.requestChain ? { requestChain: input.requestChain } : {}),
    dispatchContractVersion: OPENMELD_DAEMON_DISPATCH_CONTRACT_VERSION,
    dispatchPolicy: input.dispatchPolicy,
    ruleSource: input.ruleSource,
    ruleId: input.ruleId,
    ruleReason: input.ruleReason,
    taskId: crypto.randomUUID(),
    transportMode,
    ...(spacePassword ? { spacePassword } : {}),
    controllerSnapshot: {
      targetBindingState: input.bindingState,
      targetBindingEnabled: input.bindingEnabled,
      agentControllerRef: normalizedAgentControllerRef,
    },
    contextIdMappingSpec,
    dispatchRulesSnapshot: {
      dispatchPolicy: input.dispatchPolicy,
      ruleSource: input.ruleSource,
      ruleId: input.ruleId,
      ruleReason: input.ruleReason,
    },
    ...(input.spaceContractSnapshot
      ? { spaceContractSnapshot: input.spaceContractSnapshot }
      : {}),
    ...(input.continuitySnapshot
      ? { continuitySnapshot: input.continuitySnapshot }
      : {}),
    sourceSignalSnapshot,
    ...(input.sourceMessageEnvelope
      ? { sourceMessageEnvelope: input.sourceMessageEnvelope }
      : {}),
    ...(replyToSnapshot ? { replyToSnapshot } : {}),
    ...(input.threadContext ? { threadContext: input.threadContext } : {}),
    ...buildOutboxObservabilitySnapshotFields({
      sourceProfileNameSnapshot: input.sourceProfileNameSnapshot,
      spaceNameSnapshot: input.spaceNameSnapshot,
      targetProfileNameSnapshot: input.targetProfileNameSnapshot,
    }),
    dispatchSnapshot,
    idempotencyKey,
    outboxCreatedAtMs: input.nowMs,
    enqueuedAtMs: input.nowMs,
  };
  return {
    ...message,
    status: OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
    payloadJson: JSON.stringify(message),
    createdAtMs: input.nowMs,
    handedOffAtMs: null,
  };
};
const normalizeOptionalSnapshot = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};
const resolveDispatchChainContextForOutbox = (input: {
  dispatchId: string;
  senderProfileId: string;
  sourceAutoRelayDepth?: number;
  sourceDispatchChainId?: string;
  sourceVisitedProfileIds?: string[];
}) => {
  const dispatchChainId = normalizeOptionalSnapshot(
    input.sourceDispatchChainId
  );
  const senderProfileId = normalizeOptionalSnapshot(input.senderProfileId);
  if (
    typeof input.sourceAutoRelayDepth === "number" &&
    dispatchChainId &&
    senderProfileId &&
    Array.isArray(input.sourceVisitedProfileIds)
  ) {
    return createNextDispatchChainContext({
      autoRelayDepth: input.sourceAutoRelayDepth,
      dispatchChainId,
      senderProfileId,
      sourceVisitedProfileIds: input.sourceVisitedProfileIds,
    });
  }
  return createDispatchChainContext({
    dispatchId: input.dispatchId,
  });
};
const buildSourceSignalSnapshot = (input: {
  requestTimeContext?: DispatchSourceSignalSnapshotInput["requestTimeContext"];
  evidenceRefs?: DispatchSourceSignalSnapshotInput["evidenceRefs"];
  workHandoff?: DispatchSourceSignalSnapshotInput["workHandoff"];
  contextMessages?: DispatchSourceSignalSnapshotInput["contextMessages"];
  callerContext?: NonNullable<
    OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"]
  >["callerContext"];
  quotedMessage?: DispatchSourceSignalSnapshotInput["quotedMessage"];
  pinnedFiles?: DispatchSourceSignalSnapshotInput["pinnedFiles"];
  attachments?: NonNullable<
    OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"]
  >["attachments"];
  centerAgentInteractionSource?: NonNullable<
    OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"]
  >["centerAgentInteractionSource"];
  files?: NonNullable<
    OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"]
  >["files"];
  profileId: string | null;
  profileKind: "agent" | "human" | "system" | null;
  profileMentionLabel?: string | null;
  text: string;
}): OpenMeldDaemonDispatchQueueMessage["sourceSignalSnapshot"] => {
  const profileMentionLabel = normalizeOptionalSnapshot(
    input.profileMentionLabel
  );
  return {
    ...(input.requestTimeContext
      ? { requestTimeContext: input.requestTimeContext }
      : {}),
    ...(input.callerContext ? { callerContext: input.callerContext } : {}),
    ...(input.contextMessages?.length
      ? { contextMessages: input.contextMessages }
      : {}),
    ...(input.quotedMessage ? { quotedMessage: input.quotedMessage } : {}),
    ...(input.pinnedFiles?.length ? { pinnedFiles: input.pinnedFiles } : {}),
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
    ...(input.files && input.files.length > 0 ? { files: input.files } : {}),
    ...(input.workHandoff ? { workHandoff: input.workHandoff } : {}),
    ...(input.evidenceRefs ? { evidenceRefs: input.evidenceRefs } : {}),
    ...(input.centerAgentInteractionSource
      ? { centerAgentInteractionSource: input.centerAgentInteractionSource }
      : {}),
    text: input.text,
    profileId: input.profileId,
    profileKind: input.profileKind,
    ...(profileMentionLabel ? { profileMentionLabel } : {}),
  };
};
const buildReplyToSnapshot = (
  value:
    | OpenMeldDaemonDispatchQueueMessage["replyToSnapshot"]
    | null
    | undefined
): OpenMeldDaemonDispatchQueueMessage["replyToSnapshot"] | undefined => {
  const signalId = normalizeOptionalSnapshot(value?.signalId);
  const profileId = normalizeOptionalSnapshot(value?.profileId);
  const profileName = normalizeOptionalSnapshot(value?.profileName);
  const previewText = normalizeOptionalSnapshot(value?.previewText);
  if (!(signalId && profileId && profileName && previewText)) {
    return undefined;
  }
  return {
    signalId,
    profileId,
    profileKind:
      value?.profileKind === "agent" ||
      value?.profileKind === "human" ||
      value?.profileKind === "system"
        ? value.profileKind
        : null,
    profileName,
    previewText,
  };
};
const buildOutboxObservabilitySnapshotFields = (input: {
  spaceNameSnapshot?: string | null;
  sourceProfileNameSnapshot?: string | null;
  targetProfileNameSnapshot?: string | null;
}): Pick<
  OpenMeldDaemonDispatchQueueMessage,
  | "spaceNameSnapshot"
  | "sourceProfileNameSnapshot"
  | "targetProfileNameSnapshot"
> => {
  const spaceNameSnapshot = normalizeOptionalSnapshot(input.spaceNameSnapshot);
  const sourceProfileNameSnapshot = normalizeOptionalSnapshot(
    input.sourceProfileNameSnapshot
  );
  const targetProfileNameSnapshot = normalizeOptionalSnapshot(
    input.targetProfileNameSnapshot
  );
  return {
    ...(spaceNameSnapshot ? { spaceNameSnapshot } : {}),
    ...(sourceProfileNameSnapshot ? { sourceProfileNameSnapshot } : {}),
    ...(targetProfileNameSnapshot ? { targetProfileNameSnapshot } : {}),
  };
};
export const insertDispatchOutboxRecord = (
  sql: SqlStorage,
  record: OpenMeldDaemonDispatchOutboxRecord
): boolean => {
  const result = sql.exec(
    `
      INSERT OR IGNORE INTO openMeldDaemon_outbox (
        dispatch_id,
        space_id,
        source_event_id,
        target_profile_id,
        idempotency_key,
        payload_json,
        status,
        created_at_ms,
        queued_at_ms,
        native_admission_started_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    record.dispatchId,
    record.spaceId,
    record.sourceEventId,
    record.targetProfileId,
    record.idempotencyKey,
    record.payloadJson,
    toPersistedOpenMeldDaemonOutboxStatus(record.status),
    record.createdAtMs,
    record.handedOffAtMs,
    record.status === OPENMELD_DAEMON_OUTBOX_STATUS_PENDING ? 0 : null
  );
  return Number(result.rowsWritten ?? 0) > 0;
};
export const insertDispatchOutboxHandoffSeed = (
  sql: SqlStorage,
  record: OpenMeldDaemonDispatchOutboxRecord
): OpenMeldDaemonDispatchOutboxHandoffSeedInsertResult => {
  if (insertDispatchOutboxRecord(sql, record)) {
    return {
      status: "inserted",
      record,
    };
  }
  const existing = readDispatchOutboxRecordByIdempotencyKey(
    sql,
    record.idempotencyKey
  );
  if (!existing) {
    return {
      existing: null,
      reasonCode: "handoff_seed_existing_unreadable",
      status: "conflict",
    };
  }
  if (isEquivalentDispatchOutboxHandoffSeed(existing, record)) {
    return {
      status: "idempotent_existing",
      record: existing,
    };
  }
  return {
    existing,
    reasonCode: "handoff_seed_existing_mismatch",
    status: "conflict",
  };
};
export const markDispatchOutboxHandedOff = (
  sql: SqlStorage,
  input: {
    dispatchId: string;
    handedOffAtMs: number;
  }
): void => {
  sql.exec(
    `
      UPDATE openMeldDaemon_outbox
      SET
        status = ?,
        queued_at_ms = ?,
        poison_failure_count = 0,
        poisoned_at_ms = NULL,
        poison_reason_code = NULL
      WHERE dispatch_id = ?
        AND status IN (?, ?)
    `,
    PERSISTED_OUTBOX_STATUS_QUEUED,
    input.handedOffAtMs,
    input.dispatchId,
    OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
    PERSISTED_OUTBOX_STATUS_QUEUED
  );
};
export const markDispatchOutboxCancelled = (
  sql: SqlStorage,
  input: {
    dispatchId: string;
  }
): void => {
  sql.exec(
    `
      UPDATE openMeldDaemon_outbox
      SET
        status = ?,
        poison_failure_count = 0,
        poisoned_at_ms = NULL,
        poison_reason_code = NULL
      WHERE dispatch_id = ?
        AND status IN (?, ?)
    `,
    OPENMELD_DAEMON_OUTBOX_STATUS_CANCELLED,
    input.dispatchId,
    OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
    PERSISTED_OUTBOX_STATUS_QUEUED
  );
};
export const listPendingDispatchOutboxMessages = (
  sql: SqlStorage,
  limit: number
): OpenMeldDaemonDispatchQueueMessage[] => {
  const rows = sql
    .exec<{
      payload_json: string;
    }>(
      `
        SELECT payload_json
        FROM openMeldDaemon_outbox
        WHERE status = ?
        ORDER BY created_at_ms ASC
        LIMIT ?
      `,
      OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
      Math.max(1, limit)
    )
    .toArray();
  const messages: OpenMeldDaemonDispatchQueueMessage[] = [];
  for (const row of rows) {
    const rawJson = String(row.payload_json ?? "");
    if (rawJson.length === 0) {
      continue;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJson);
    } catch {
      continue;
    }
    const parsed = parseOpenMeldDaemonDispatchQueueIngress(parsedJson);
    if (parsed.kind !== "current_v2") {
      continue;
    }
    messages.push(parsed.message);
  }
  return messages;
};
export const hasPendingDispatchOutboxRecords = (sql: SqlStorage): boolean => {
  const rows = sql
    .exec<{
      dispatch_id: string;
    }>(
      `
        SELECT dispatch_id
        FROM openMeldDaemon_outbox
        WHERE status = ?
          AND poisoned_at_ms IS NULL
        LIMIT 1
      `,
      OPENMELD_DAEMON_OUTBOX_STATUS_PENDING
    )
    .toArray();
  return rows.length > 0;
};
/** Handoff is not completion. Poisoned rows already have a published failure. */
export const hasUnsettledDispatchOutboxRecords = (sql: SqlStorage): boolean =>
  sql
    .exec(
      "SELECT 1 FROM openMeldDaemon_outbox WHERE status IN (?, ?) AND poisoned_at_ms IS NULL LIMIT 1",
      OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
      PERSISTED_OUTBOX_STATUS_QUEUED
    )
    .toArray().length > 0;
export const listDispatchOutboxRecoveryCandidates = (
  sql: SqlStorage,
  input: {
    limit: number;
    handedOffRedriveBeforeMs: number;
  }
): OpenMeldDaemonDispatchOutboxRecoveryCandidate[] => {
  const rows = sql
    .exec<OpenMeldDaemonDispatchOutboxPersistedRow>(
      `
        SELECT payload_json, status, created_at_ms, queued_at_ms
        FROM openMeldDaemon_outbox
        WHERE (
            status = ?
            OR (status = ? AND queued_at_ms IS NOT NULL AND queued_at_ms <= ?)
          )
          AND poisoned_at_ms IS NULL
        ORDER BY
          CASE status WHEN ? THEN 0 ELSE 1 END,
          COALESCE(queued_at_ms, created_at_ms) ASC
        LIMIT ?
      `,
      OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
      PERSISTED_OUTBOX_STATUS_QUEUED,
      input.handedOffRedriveBeforeMs,
      OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
      Math.max(1, input.limit)
    )
    .toArray();
  const candidates: OpenMeldDaemonDispatchOutboxRecoveryCandidate[] = [];
  for (const row of rows) {
    const rawJson = String(row.payload_json ?? "");
    if (rawJson.length === 0) {
      continue;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJson);
    } catch {
      continue;
    }
    const parsed = parseOpenMeldDaemonDispatchQueueIngress(parsedJson);
    if (parsed.kind !== "current_v2") {
      continue;
    }
    const outboxStatus = normalizeOpenMeldDaemonOutboxStatus(row.status);
    if (
      !outboxStatus ||
      outboxStatus === OPENMELD_DAEMON_OUTBOX_STATUS_CANCELLED
    ) {
      continue;
    }
    candidates.push({
      ...parsed.message,
      outboxStatus,
      createdAtMs: Number(row.created_at_ms ?? 0),
      handedOffAtMs:
        typeof row.queued_at_ms === "number" ? row.queued_at_ms : null,
    });
  }
  return candidates;
};
export const clearDispatchOutboxPoisonFailure = (
  sql: SqlStorage,
  input: {
    dispatchId: string;
  }
): void => {
  sql.exec(
    `
      UPDATE openMeldDaemon_outbox
      SET
        poison_failure_count = 0,
        poisoned_at_ms = NULL,
        poison_reason_code = NULL
      WHERE dispatch_id = ?
        AND (
          poison_failure_count != 0
          OR poisoned_at_ms IS NOT NULL
          OR poison_reason_code IS NOT NULL
        )
    `,
    input.dispatchId
  );
};
export const recordDispatchOutboxCandidateFailure = (
  sql: SqlStorage,
  input: {
    dispatchId: string;
  }
): OpenMeldDaemonDispatchOutboxPoisonFailureState => {
  sql.exec(
    `
      UPDATE openMeldDaemon_outbox
      SET
        poison_failure_count = COALESCE(poison_failure_count, 0) + 1
      WHERE dispatch_id = ?
        AND poisoned_at_ms IS NULL
    `,
    input.dispatchId
  );
  return readDispatchOutboxPoisonFailureState(sql, input.dispatchId);
};
export const markDispatchOutboxPoisoned = (
  sql: SqlStorage,
  input: {
    dispatchId: string;
    poisonAfterFailureCount: number;
    poisonedAtMs: number;
    reasonCode: string;
  }
): OpenMeldDaemonDispatchOutboxPoisonFailureState => {
  sql.exec(
    `
      UPDATE openMeldDaemon_outbox
      SET
        poisoned_at_ms = COALESCE(poisoned_at_ms, ?),
        poison_reason_code = ?
      WHERE dispatch_id = ?
        AND COALESCE(poison_failure_count, 0) >= ?
        AND poisoned_at_ms IS NULL
    `,
    input.poisonedAtMs,
    input.reasonCode,
    input.dispatchId,
    input.poisonAfterFailureCount
  );
  return readDispatchOutboxPoisonFailureState(sql, input.dispatchId);
};
const readDispatchOutboxPoisonFailureState = (
  sql: SqlStorage,
  dispatchId: string
): OpenMeldDaemonDispatchOutboxPoisonFailureState => {
  const rows = sql
    .exec<{
      poison_failure_count: number | null;
      poisoned_at_ms: number | null;
    }>(
      `
        SELECT poison_failure_count, poisoned_at_ms
        FROM openMeldDaemon_outbox
        WHERE dispatch_id = ?
        LIMIT 1
      `,
      dispatchId
    )
    .toArray();
  const row = rows[0];
  return {
    failureCount: Number(row?.poison_failure_count ?? 0),
    poisoned: row?.poisoned_at_ms !== null && row?.poisoned_at_ms !== undefined,
  };
};
export const listActiveDispatchOutboxRecordsBySpace = (
  sql: SqlStorage,
  input: {
    limit?: number;
    sourceProfileId?: string;
    spaceId: string;
    targetProfileId?: string | null;
  }
): OpenMeldDaemonDispatchOutboxRecoveryCandidate[] => {
  const normalizedSpaceId = normalizeOptionalSnapshot(input.spaceId);
  if (!normalizedSpaceId) {
    return [];
  }
  const normalizedTargetProfileId = normalizeOptionalSnapshot(
    input.targetProfileId
  );
  const sourceProfileId = normalizeOptionalSnapshot(input.sourceProfileId);
  const limit = Math.max(
    1,
    Math.min(
      MAX_ACTIVE_SPACE_OUTBOX_SCAN_ROWS,
      Math.trunc(input.limit ?? MAX_ACTIVE_SPACE_OUTBOX_SCAN_ROWS)
    )
  );
  const whereTargetSql = normalizedTargetProfileId
    ? "AND target_profile_id = ?"
    : "";
  const whereSourceSql = sourceProfileId
    ? "AND json_extract(payload_json, '$.sourceSignalSnapshot.profileId') = ?"
    : "";
  const bindings = [
    OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
    PERSISTED_OUTBOX_STATUS_QUEUED,
    normalizedSpaceId,
    ...(normalizedTargetProfileId ? [normalizedTargetProfileId] : []),
    ...(sourceProfileId ? [sourceProfileId] : []),
    limit,
  ];
  const rows = sql
    .exec<OpenMeldDaemonDispatchOutboxPersistedRow>(
      `
        SELECT payload_json, status, created_at_ms, queued_at_ms
        FROM openMeldDaemon_outbox
        WHERE status IN (?, ?)
          AND space_id = ?
          ${whereTargetSql}
          ${whereSourceSql}
        ORDER BY COALESCE(queued_at_ms, created_at_ms) DESC
        LIMIT ?
      `,
      ...bindings
    )
    .toArray();
  const records: OpenMeldDaemonDispatchOutboxRecoveryCandidate[] = [];
  for (const row of rows) {
    const candidate = parseDispatchOutboxPersistedRow(row);
    if (!candidate || candidate.spaceId !== normalizedSpaceId) {
      continue;
    }
    if (
      candidate.outboxStatus !== OPENMELD_DAEMON_OUTBOX_STATUS_PENDING &&
      candidate.outboxStatus !== OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF
    ) {
      continue;
    }
    if (
      normalizedTargetProfileId &&
      candidate.targetProfileId !== normalizedTargetProfileId
    ) {
      continue;
    }
    records.push(candidate);
  }
  return records;
};
export const listDispatchOutboxRecordsByClientMessageId = (
  sql: SqlStorage,
  clientMessageId: string
): OpenMeldDaemonDispatchOutboxRecoveryCandidate[] => {
  const normalizedClientMessageId = normalizeOptionalSnapshot(clientMessageId);
  if (!normalizedClientMessageId) {
    return [];
  }
  const rows = sql
    .exec<{
      payload_json: string;
      status: string;
      created_at_ms: number;
      queued_at_ms: number | null;
    }>(
      `
        SELECT payload_json, status, created_at_ms, queued_at_ms
        FROM openMeldDaemon_outbox
        WHERE status IN (?, ?, ?)
        ORDER BY created_at_ms DESC
        LIMIT ?
      `,
      OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
      PERSISTED_OUTBOX_STATUS_QUEUED,
      OPENMELD_DAEMON_OUTBOX_STATUS_CANCELLED,
      MAX_CLIENT_MESSAGE_OUTBOX_SCAN_ROWS
    )
    .toArray();
  const records: OpenMeldDaemonDispatchOutboxRecoveryCandidate[] = [];
  for (const row of rows) {
    const candidate = parseDispatchOutboxPersistedRow(row);
    if (candidate?.sourceClientMessageId === normalizedClientMessageId) {
      records.push(candidate);
    }
  }
  return records;
};
export const listDispatchOutboxRecordsBySourceSignalId = (
  sql: SqlStorage,
  sourceSignalId: string
): OpenMeldDaemonDispatchOutboxRecoveryCandidate[] => {
  const normalizedSourceSignalId = normalizeOptionalSnapshot(sourceSignalId);
  if (!normalizedSourceSignalId) {
    return [];
  }
  const rows = sql
    .exec<{
      payload_json: string;
      status: string;
      created_at_ms: number;
      queued_at_ms: number | null;
    }>(
      `
        SELECT payload_json, status, created_at_ms, queued_at_ms
        FROM openMeldDaemon_outbox
        WHERE source_event_id = ? AND status IN (?, ?, ?)
        ORDER BY created_at_ms DESC
        LIMIT ?
      `,
      normalizedSourceSignalId,
      OPENMELD_DAEMON_OUTBOX_STATUS_PENDING,
      PERSISTED_OUTBOX_STATUS_QUEUED,
      OPENMELD_DAEMON_OUTBOX_STATUS_CANCELLED,
      MAX_CLIENT_MESSAGE_OUTBOX_SCAN_ROWS
    )
    .toArray();
  const records: OpenMeldDaemonDispatchOutboxRecoveryCandidate[] = [];
  for (const row of rows) {
    const candidate = parseDispatchOutboxPersistedRow(row);
    if (candidate?.sourceEventId === normalizedSourceSignalId) {
      records.push(candidate);
    }
  }
  return records;
};
export const listDispatchOutboxTargetWakeLifecycleIdentitiesByClientMessageId =
  (
    sql: SqlStorage,
    input: {
      clientMessageId: string;
      targetProfileId?: string | null;
    }
  ): TargetWakeLifecycleIdentity[] => {
    const normalizedTargetProfileId = normalizeOptionalSnapshot(
      input.targetProfileId
    );
    return listDispatchOutboxRecordsByClientMessageId(
      sql,
      input.clientMessageId
    )
      .filter((record) =>
        normalizedTargetProfileId
          ? record.targetProfileId === normalizedTargetProfileId
          : true
      )
      .map(projectDispatchOutboxTargetWakeLifecycleIdentity);
  };
export const readDispatchOutboxTargetWakeLifecycleIdentityBySource = (
  sql: SqlStorage,
  input: {
    sourceSignalId: string;
    targetProfileId: string;
  }
): TargetWakeLifecycleIdentity | null => {
  const sourceSignalId = normalizeOptionalSnapshot(input.sourceSignalId);
  const targetProfileId = normalizeOptionalSnapshot(input.targetProfileId);
  if (!(sourceSignalId && targetProfileId)) {
    return null;
  }
  const record = readDispatchOutboxRecordByIdempotencyKey(
    sql,
    buildIdempotencyKey({
      sourceEventId: sourceSignalId,
      targetProfileId,
    })
  );
  return record
    ? projectDispatchOutboxTargetWakeLifecycleIdentity(record)
    : null;
};
export const projectDispatchOutboxTargetWakeLifecycleIdentity = (
  record: Pick<
    OpenMeldDaemonDispatchQueueMessage,
    | "dispatchId"
    | "sourceClientMessageId"
    | "sourceEventId"
    | "spaceId"
    | "targetProfileId"
  >
): TargetWakeLifecycleIdentity =>
  projectTargetWakeLifecycleIdentity({
    clientMessageId: record.sourceClientMessageId ?? null,
    dispatchId: record.dispatchId,
    sourceSignalId: record.sourceEventId,
    spaceId: record.spaceId,
    targetProfileId: record.targetProfileId,
  });
export const readDispatchOutboxRecordByDispatchId = (
  sql: SqlStorage,
  dispatchId: string
): OpenMeldDaemonDispatchOutboxRecoveryCandidate | null => {
  const normalizedDispatchId = normalizeOptionalSnapshot(dispatchId);
  if (!normalizedDispatchId) {
    return null;
  }
  const row = sql
    .exec<OpenMeldDaemonDispatchOutboxPersistedRow>(
      `
        SELECT payload_json, status, created_at_ms, queued_at_ms
        FROM openMeldDaemon_outbox
        WHERE dispatch_id = ?
        LIMIT 1
      `,
      normalizedDispatchId
    )
    .toArray()[0];
  if (!row) {
    return null;
  }
  return parseDispatchOutboxPersistedRow(row);
};
export const readDispatchOutboxRecordByIdempotencyKey = (
  sql: SqlStorage,
  idempotencyKey: string
): OpenMeldDaemonDispatchOutboxRecoveryCandidate | null => {
  const normalizedIdempotencyKey = normalizeOptionalSnapshot(idempotencyKey);
  if (!normalizedIdempotencyKey) {
    return null;
  }
  const row = sql
    .exec<OpenMeldDaemonDispatchOutboxPersistedRow>(
      `
        SELECT payload_json, status, created_at_ms, queued_at_ms
        FROM openMeldDaemon_outbox
        WHERE idempotency_key = ?
        LIMIT 1
      `,
      normalizedIdempotencyKey
    )
    .toArray()[0];
  if (!row) {
    return null;
  }
  return parseDispatchOutboxPersistedRow(row);
};
const isEquivalentDispatchOutboxHandoffSeed = (
  existing: OpenMeldDaemonDispatchOutboxRecoveryCandidate,
  next: OpenMeldDaemonDispatchOutboxRecord
): boolean => {
  return (
    existing.idempotencyKey === next.idempotencyKey &&
    existing.spaceId === next.spaceId &&
    existing.sourceEventId === next.sourceEventId &&
    existing.targetProfileId === next.targetProfileId &&
    (existing.sourceClientMessageId ?? null) ===
      (next.sourceClientMessageId ?? null)
  );
};
function parseDispatchOutboxPersistedRow(
  row: OpenMeldDaemonDispatchOutboxPersistedRow
): OpenMeldDaemonDispatchOutboxRecoveryCandidate | null {
  const rawJson = String(row.payload_json ?? "");
  if (rawJson.length === 0) {
    return null;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawJson);
  } catch {
    return null;
  }
  const parsed = parseOpenMeldDaemonDispatchQueueIngress(parsedJson);
  const outboxStatus = normalizeOpenMeldDaemonOutboxStatus(row.status);
  if (parsed.kind !== "current_v2" || !outboxStatus) {
    return null;
  }
  return {
    ...parsed.message,
    outboxStatus,
    createdAtMs: Number(row.created_at_ms ?? 0),
    handedOffAtMs:
      typeof row.queued_at_ms === "number" ? row.queued_at_ms : null,
  };
}
function normalizeOpenMeldDaemonOutboxStatus(
  value: string
): OpenMeldDaemonOutboxStatus | null {
  if (value === OPENMELD_DAEMON_OUTBOX_STATUS_PENDING) {
    return OPENMELD_DAEMON_OUTBOX_STATUS_PENDING;
  }
  if (value === PERSISTED_OUTBOX_STATUS_QUEUED) {
    return OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF;
  }
  if (value === OPENMELD_DAEMON_OUTBOX_STATUS_CANCELLED) {
    return OPENMELD_DAEMON_OUTBOX_STATUS_CANCELLED;
  }
  return null;
}
function toPersistedOpenMeldDaemonOutboxStatus(
  value: OpenMeldDaemonOutboxStatus
): "pending" | "queued" | "cancelled" {
  return value === OPENMELD_DAEMON_OUTBOX_STATUS_HANDED_OFF
    ? PERSISTED_OUTBOX_STATUS_QUEUED
    : value;
}
export const deleteDispatchOutboxRecord = (
  sql: SqlStorage,
  input: {
    dispatchId: string;
  }
): void => {
  sql.exec(
    `
      DELETE FROM openMeldDaemon_outbox
      WHERE dispatch_id = ?
        AND status <> ?
    `,
    input.dispatchId,
    OPENMELD_DAEMON_OUTBOX_STATUS_CANCELLED
  );
};
const assertDispatchSnapshotWithinBudget = (
  snapshot: OpenMeldDaemonDispatchQueueMessage["dispatchSnapshot"]
): void => {
  const snapshotJson = JSON.stringify(snapshot);
  const snapshotBytes = new TextEncoder().encode(snapshotJson).length;
  if (snapshotBytes <= OPENMELD_DAEMON_DISPATCH_SNAPSHOT_MAX_BYTES) {
    return;
  }
  const errorMessage = `${OPENMELD_DAEMON_DISPATCH_SNAPSHOT_OVERSIZE_ERROR_CODE}: dispatch snapshot exceeds max bytes: ${snapshotBytes}/${OPENMELD_DAEMON_DISPATCH_SNAPSHOT_MAX_BYTES}`;
  throw new DispatchSnapshotOversizeError(errorMessage);
};
