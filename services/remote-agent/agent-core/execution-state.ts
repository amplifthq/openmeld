import {
  remoteAgentWorkerAdmissionStopIntentSchema,
  remoteAgentWorkerCancellationResponseSchema,
  remoteAgentWorkerExecutionQueryResponseSchema,
  remoteAgentWorkerExecutionStateSchema,
  remoteAgentWorkLoopCheckpointSchema,
} from "@openmeld/schemas";
import type {
  RemoteAgentWorkerCancellationResponse,
  RemoteAgentWorkerExecutionProgressKind,
  RemoteAgentWorkerExecutionQuery,
  RemoteAgentWorkerExecutionQueryResponse,
  RemoteAgentWorkerExecutionState,
  RemoteAgentWorkLoopCheckpoint,
} from "@openmeld/schemas/types";
import {
  buildRemoteAgentCallbackContextKey,
  type RemoteAgentStorage,
  readRemoteAgentCallbackContext,
} from "./callback-context";
import { normalizeRemoteAgentCompletedAnswer } from "./completed-answer";
import {
  createRemoteAgentTerminalFailureFact,
  parseRemoteAgentTerminalFailureFact,
  type RemoteAgentTerminalFailureFact,
} from "./terminal-failure";
import type { RemoteAgentTurnUsage } from "./usage";

const EXECUTION_STATE_PREFIX = "openmeld:remote-agent:execution-state:";
const ADMISSION_STOP_INTENT_PREFIX = "openmeld:remote-agent:admission-stop:";

type RemoteAgentStoredExecutionState = RemoteAgentWorkerExecutionState & {
  completedText?: string;
  terminalFailure?: RemoteAgentTerminalFailureFact;
  requestedFailure?: RemoteAgentTerminalFailureFact;
  workLoopCheckpoint?: RemoteAgentWorkLoopCheckpoint;
};

type RemoteAgentStoredExecutionRead =
  | {
      completedText: string | null;
      execution: RemoteAgentWorkerExecutionState;
      status: "found";
      stored: RemoteAgentStoredExecutionState;
      terminalFailure: RemoteAgentTerminalFailureFact | null;
    }
  | { status: "not_found" }
  | {
      reasonCode: "remote_agent.execution_identity_mismatch";
      status: "identity_mismatch";
    };

export type RemoteAgentCompletionMetadata = {
  modelId: string | null;
  usage: RemoteAgentTurnUsage | null;
};

export type RemoteAgentTerminalExecutionOutcome = {
  completionMetadata?: RemoteAgentCompletionMetadata;
} & (
  | {
      status: "checkpoint";
      execution: RemoteAgentWorkerExecutionState;
      checkpoint: RemoteAgentWorkLoopCheckpoint;
      completedText: null;
    }
  | {
      completedText: string;
      execution: RemoteAgentWorkerExecutionState;
      status: "completed";
    }
  | {
      completedText: null;
      execution: RemoteAgentWorkerExecutionState;
      failure: RemoteAgentTerminalFailureFact;
      status: "aborted" | "failed";
    }
);

type CompleteRemoteAgentExecutionStateInput = {
  completionMetadata?: RemoteAgentCompletionMetadata;
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  storage: RemoteAgentStorage;
} & (
  | {
      status: "checkpoint";
      checkpoint: RemoteAgentWorkLoopCheckpoint;
      completedText?: never;
      terminalFailure?: never;
    }
  | { completedText: string; status: "completed"; terminalFailure?: never }
  | {
      completedText?: never;
      status: "failed" | "aborted";
      terminalFailure?: RemoteAgentTerminalFailureFact;
    }
);

export const REMOTE_AGENT_TERMINAL_EXECUTION_OWNER_MISSING_REASON_CODE =
  "remote_agent.terminal_execution_owner_missing";

export class RemoteAgentTerminalExecutionOwnerMissingError extends Error {
  readonly code = REMOTE_AGENT_TERMINAL_EXECUTION_OWNER_MISSING_REASON_CODE;
  readonly submissionId: string;

  constructor(submissionId: string) {
    super(
      `${REMOTE_AGENT_TERMINAL_EXECUTION_OWNER_MISSING_REASON_CODE}:${submissionId}`
    );
    this.name = "RemoteAgentTerminalExecutionOwnerMissingError";
    this.submissionId = submissionId;
  }
}

export class RemoteAgentExecutionCancelledError extends Error {
  constructor() {
    super("Remote Agent execution was cancelled before this action could run.");
    this.name = "RemoteAgentExecutionCancelledError";
  }
}

export function buildRemoteAgentExecutionStateKey(
  submissionId: string
): string {
  return `${EXECUTION_STATE_PREFIX}${submissionId}`;
}

export function buildRemoteAgentExecutionIdentity(input: {
  idempotencyKey: string;
  organizationId: string;
  spaceId: string;
  submissionId: string;
}): RemoteAgentWorkerExecutionQuery {
  return {
    idempotencyKey: input.idempotencyKey,
    organizationId: input.organizationId,
    spaceId: input.spaceId,
    submissionId: input.submissionId,
    v: 1,
  };
}

export async function initializeRemoteAgentExecutionState(input: {
  acceptedAtMs: number;
  identity: RemoteAgentWorkerExecutionQuery;
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentWorkerExecutionState> {
  await assertRemoteAgentAdmissionNotStopped(input);
  const existing = await readRemoteAgentStoredExecutionState({
    identity: input.identity,
    storage: input.storage,
  });
  if (existing.status === "found") {
    await assertRemoteAgentAdmissionNotStopped(input);
    return existing.execution;
  }
  if (existing.status === "identity_mismatch") {
    throw new Error(
      "Remote Agent execution identity does not match its durable state."
    );
  }
  const state = remoteAgentWorkerExecutionStateSchema.parse({
    ...input.identity,
    acceptedAtMs: input.acceptedAtMs,
    cancellationReason: null,
    completedAtMs: null,
    lastProgressAtMs: input.acceptedAtMs,
    lastProgressKind: "admitted",
    status: "pending",
  });
  const created = await input.storage.putIfAbsent(
    buildRemoteAgentExecutionStateKey(input.identity.submissionId),
    state
  );
  if (created) {
    // Stop may have arrived after the first read but before this conditional
    // insert. Keep the ordinary cancellation row for terminal reconciliation;
    // never let the late initializer turn durable Stop into a pending admission.
    try {
      await assertRemoteAgentAdmissionNotStopped(input);
    } catch (error) {
      if (error instanceof RemoteAgentExecutionCancelledError) {
        await requestRemoteAgentExecutionCancellation({
          ...input,
          nowMs: input.acceptedAtMs,
          summaryRecoveryId: (await readRemoteAgentAdmissionStopIntent(input))
            ?.summaryRecoveryId,
        });
      }
      throw error;
    }
    return state;
  }
  const raced = await readRemoteAgentStoredExecutionState({
    identity: input.identity,
    storage: input.storage,
  });
  if (raced.status !== "found") {
    throw new Error(
      "Remote Agent execution state was not readable after creation."
    );
  }
  await assertRemoteAgentAdmissionNotStopped(input);
  return raced.execution;
}

export async function readRemoteAgentExecutionState(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  storage: Pick<RemoteAgentStorage, "get">;
}): Promise<RemoteAgentWorkerExecutionQueryResponse> {
  const stored = await readRemoteAgentStoredExecutionState(input);
  if (stored.status !== "found") {
    return remoteAgentWorkerExecutionQueryResponseSchema.parse(stored);
  }
  const terminal =
    stored.execution.status === "completed" ||
    stored.execution.status === "failed" ||
    stored.execution.status === "aborted";
  const context = terminal
    ? await readRemoteAgentCallbackContext(
        input.storage,
        input.identity.submissionId
      )
    : null;
  if (
    context &&
    (context.organizationId !== input.identity.organizationId ||
      context.spaceId !== input.identity.spaceId ||
      context.idempotencyKey !== input.identity.idempotencyKey)
  ) {
    throw new Error(
      "Remote Agent result projection has mismatched callback authority."
    );
  }
  return remoteAgentWorkerExecutionQueryResponseSchema.parse({
    execution: stored.execution,
    status: "found",
    ...(terminal
      ? {
          result: {
            status: stored.execution.status,
            text:
              stored.execution.status === "completed"
                ? stored.completedText
                : (stored.terminalFailure?.explanationText ?? null),
            failureCode: stored.terminalFailure?.code ?? null,
            ...(stored.terminalFailure?.computerCleanup
              ? { computerCleanup: stored.terminalFailure.computerCleanup }
              : {}),
            files: context?.outputFiles ?? [],
            attachments: context?.outputAttachments ?? [],
          },
        }
      : {}),
  });
}

export async function readRemoteAgentCompletedExecutionAnswer(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  storage: Pick<RemoteAgentStorage, "get">;
}): Promise<string | null> {
  const stored = await readRemoteAgentStoredExecutionState(input);
  if (stored.status === "identity_mismatch") {
    throw new Error(
      "Remote Agent execution identity does not match its durable state."
    );
  }
  return stored.status === "found" && stored.execution.status === "completed"
    ? stored.completedText
    : null;
}

async function readRemoteAgentStoredExecutionState(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  storage: Pick<RemoteAgentStorage, "get">;
}): Promise<RemoteAgentStoredExecutionRead> {
  const stored = await input.storage.get<unknown>(
    buildRemoteAgentExecutionStateKey(input.identity.submissionId)
  );
  if (stored === undefined) {
    return { status: "not_found" };
  }
  if (!(stored && typeof stored === "object") || Array.isArray(stored)) {
    remoteAgentWorkerExecutionStateSchema.parse(stored);
  }
  const {
    completedText: storedCompletedText,
    terminalFailure: storedTerminalFailure,
    requestedFailure: storedRequestedFailure,
    workLoopCheckpoint: storedCheckpoint,
    ...executionInput
  } = stored as Record<string, unknown>;
  const execution = remoteAgentWorkerExecutionStateSchema.parse(executionInput);
  if (!executionIdentityMatches(execution, input.identity)) {
    return {
      reasonCode: "remote_agent.execution_identity_mismatch",
      status: "identity_mismatch",
    };
  }
  const completedText = parseStoredCompletedText(storedCompletedText);
  parseRemoteAgentTerminalFailureFact(storedRequestedFailure);
  if (storedCheckpoint !== undefined) {
    remoteAgentWorkLoopCheckpointSchema.parse(storedCheckpoint);
    if (execution.status !== "completed" || completedText) {
      throw new Error(
        "Remote Agent checkpoint conflicts with its execution outcome."
      );
    }
  }
  const terminalFailure = parseRemoteAgentTerminalFailureFact(
    storedTerminalFailure
  );
  if (completedText && execution.status !== "completed") {
    throw new Error(
      "Remote Agent durable answer exists without a completed execution."
    );
  }
  if (
    terminalFailure &&
    execution.status !== "failed" &&
    execution.status !== "aborted"
  ) {
    throw new Error(
      "Remote Agent durable terminal failure exists without a failed or aborted execution."
    );
  }
  return {
    completedText,
    execution,
    status: "found",
    stored: stored as RemoteAgentStoredExecutionState,
    terminalFailure,
  };
}

/** Fence further tools without claiming the live runtime has settled. */
export async function requestRemoteAgentExecutionFailure(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  failure: RemoteAgentTerminalFailureFact;
  storage: RemoteAgentStorage;
}): Promise<void> {
  while (true) {
    const result = await readRemoteAgentStoredExecutionState(input);
    if (result.status !== "found") {
      throw new Error(
        "Remote Agent failure requires its matching execution owner."
      );
    }
    if (
      isTerminalStatus(result.execution.status) ||
      result.stored.requestedFailure
    ) {
      return;
    }
    if (
      await input.storage.compareAndSet(
        buildRemoteAgentExecutionStateKey(input.identity.submissionId),
        result.stored,
        { ...result.stored, requestedFailure: input.failure }
      )
    ) {
      return;
    }
  }
}

export async function readRemoteAgentRequestedExecutionFailure(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  storage: Pick<RemoteAgentStorage, "get">;
}): Promise<RemoteAgentTerminalFailureFact | null> {
  const result = await readRemoteAgentStoredExecutionState(input);
  if (result.status === "identity_mismatch") {
    throw new Error(
      "Remote Agent execution identity does not match its durable state."
    );
  }
  return result.status === "found"
    ? (result.stored.requestedFailure ?? null)
    : null;
}

export async function markRemoteAgentExecutionProgress(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  progressKind: RemoteAgentWorkerExecutionProgressKind;
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentWorkerExecutionState | null> {
  while (true) {
    const result = await readRemoteAgentStoredExecutionState(input);
    if (result.status === "not_found") {
      return null;
    }
    if (result.status === "identity_mismatch") {
      throw new Error(
        "Remote Agent execution identity does not match its durable state."
      );
    }
    if (
      isTerminalStatus(result.execution.status) ||
      result.execution.status === "cancellation_requested"
    ) {
      return result.execution;
    }
    const next = remoteAgentWorkerExecutionStateSchema.parse({
      ...result.execution,
      lastProgressAtMs: Math.max(
        result.execution.lastProgressAtMs,
        input.nowMs
      ),
      lastProgressKind: input.progressKind,
      status: "running",
    });
    if (
      await compareAndSetRemoteAgentExecutionState({
        expected: result.stored,
        identity: input.identity,
        next: {
          completedText: null,
          execution: next,
          terminalFailure: null,
        },
        storage: input.storage,
      })
    ) {
      return next;
    }
  }
}

export async function completeRemoteAgentExecutionState(
  input: CompleteRemoteAgentExecutionStateInput
): Promise<RemoteAgentWorkerExecutionState | null> {
  const requestedCompletedText =
    input.status === "completed"
      ? normalizeCompletedExecutionText(input.completedText)
      : null;
  const requestedTerminalFailure = resolveRequestedTerminalFailure(input);
  if (input.status !== "completed" && input.completedText !== undefined) {
    throw new Error(
      "Remote Agent failed or aborted execution cannot store a completed answer."
    );
  }
  while (true) {
    const result = await readRemoteAgentStoredExecutionState(input);
    if (result.status === "not_found") {
      return null;
    }
    if (result.status === "identity_mismatch") {
      throw new Error(
        "Remote Agent execution identity does not match its durable state."
      );
    }
    if (isTerminalStatus(result.execution.status)) {
      return result.execution;
    }
    const settledStatus = resolveSettledExecutionStatus(input, result.stored);
    const next = remoteAgentWorkerExecutionStateSchema.parse({
      ...result.execution,
      completedAtMs: input.nowMs,
      lastProgressAtMs: Math.max(
        result.execution.lastProgressAtMs,
        input.nowMs
      ),
      lastProgressKind: progressKindForSettledStatus(settledStatus),
      status: settledStatus,
    });
    const terminalFailure = resolveSettledTerminalFailure({
      execution: result.execution,
      computerCleanup: requestedTerminalFailure?.computerCleanup,
      requestedTerminalFailure:
        result.stored.requestedFailure ?? requestedTerminalFailure,
      settledStatus,
    });
    if (
      await compareAndSetRemoteAgentExecutionState({
        expected: result.stored,
        identity: input.identity,
        next: {
          completionMetadata: input.completionMetadata,
          workLoopCheckpoint: settledCheckpoint(input, settledStatus),
          completedText:
            settledStatus === "completed" ? requestedCompletedText : null,
          execution: next,
          terminalFailure,
        },
        storage: input.storage,
      })
    ) {
      return next;
    }
  }
}

function resolveSettledExecutionStatus(
  input: CompleteRemoteAgentExecutionStateInput,
  stored: RemoteAgentStoredExecutionState
): "aborted" | "completed" | "failed" {
  if (stored.status === "cancellation_requested") {
    return "aborted";
  }
  if (stored.requestedFailure) {
    return "failed";
  }
  return input.status === "checkpoint" ? "completed" : input.status;
}

function settledCheckpoint(
  input: CompleteRemoteAgentExecutionStateInput,
  status: string
): RemoteAgentWorkLoopCheckpoint | undefined {
  if (status === "completed" && input.status === "checkpoint") {
    return remoteAgentWorkLoopCheckpointSchema.parse(input.checkpoint);
  }
  return undefined;
}

function resolveRequestedTerminalFailure(
  input: CompleteRemoteAgentExecutionStateInput
): RemoteAgentTerminalFailureFact | null {
  if (input.status === "completed" || input.status === "checkpoint") {
    return null;
  }
  return (
    input.terminalFailure ??
    createRemoteAgentTerminalFailureFact({ status: input.status })
  );
}

function resolveSettledTerminalFailure(input: {
  execution: RemoteAgentWorkerExecutionState;
  computerCleanup?: RemoteAgentTerminalFailureFact["computerCleanup"];
  requestedTerminalFailure: RemoteAgentTerminalFailureFact | null;
  settledStatus: "aborted" | "completed" | "failed";
}): RemoteAgentTerminalFailureFact | null {
  if (input.settledStatus === "completed") {
    return null;
  }
  if (input.settledStatus === "failed") {
    return input.requestedTerminalFailure
      ? {
          ...input.requestedTerminalFailure,
          ...(input.computerCleanup
            ? { computerCleanup: input.computerCleanup }
            : {}),
        }
      : null;
  }
  return {
    ...createRemoteAgentTerminalFailureFact({
      ...(input.execution.cancellationReason
        ? { error: input.execution.cancellationReason }
        : {}),
      status: "aborted",
    }),
    ...(input.computerCleanup
      ? { computerCleanup: input.computerCleanup }
      : {}),
  };
}

export async function repairRemoteAgentCompletedExecutionWithoutAnswer(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentWorkerExecutionState | null> {
  while (true) {
    const result = await readRemoteAgentStoredExecutionState(input);
    if (result.status === "not_found") {
      return null;
    }
    if (result.status === "identity_mismatch") {
      throw new Error(
        "Remote Agent execution identity does not match its durable state."
      );
    }
    if (
      result.execution.status !== "completed" ||
      result.completedText ||
      result.stored.workLoopCheckpoint
    ) {
      return result.execution;
    }
    const failed = remoteAgentWorkerExecutionStateSchema.parse({
      ...result.execution,
      lastProgressAtMs: Math.max(
        result.execution.lastProgressAtMs,
        input.nowMs
      ),
      lastProgressKind: "prompt_failed",
      status: "failed",
    });
    if (
      await compareAndSetRemoteAgentExecutionState({
        expected: result.stored,
        identity: input.identity,
        next: {
          completedText: null,
          execution: failed,
          terminalFailure: createRemoteAgentTerminalFailureFact({
            error: "Remote Agent execution completed without a durable answer.",
            status: "failed",
          }),
        },
        storage: input.storage,
      })
    ) {
      return failed;
    }
  }
}

export async function resolveRemoteAgentTerminalExecutionOutcome(input: {
  execution: RemoteAgentWorkerExecutionState | null;
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentTerminalExecutionOutcome | null> {
  let execution = input.execution;
  while (execution) {
    const stored = await readRemoteAgentStoredExecutionState(input);
    if (stored.status === "not_found") {
      return null;
    }
    if (stored.status === "identity_mismatch") {
      throw new Error(
        "Remote Agent execution identity does not match its durable state."
      );
    }
    execution = stored.execution;
    const completionMetadata = await readTerminalCompletionMetadata(input);
    if (execution.status === "failed" || execution.status === "aborted") {
      return {
        ...completionMetadata,
        completedText: null,
        execution,
        failure:
          stored.terminalFailure ??
          createRemoteAgentTerminalFailureFact({
            error: execution.cancellationReason ?? undefined,
            status: execution.status,
          }),
        status: execution.status,
      };
    }
    if (execution.status !== "completed") {
      throw new Error(
        "Remote Agent terminal outcome requires a terminal execution owner."
      );
    }
    if (stored.stored.workLoopCheckpoint) {
      return {
        ...completionMetadata,
        status: "checkpoint",
        execution,
        completedText: null,
        checkpoint: stored.stored.workLoopCheckpoint,
      };
    }
    if (await adoptLegacyRemoteAgentCheckpoint({ ...input, stored })) {
      continue;
    }
    const completedText = stored.completedText;
    if (completedText) {
      return {
        ...completionMetadata,
        completedText,
        execution,
        status: "completed",
      };
    }
    execution = await repairRemoteAgentCompletedExecutionWithoutAnswer({
      identity: input.identity,
      nowMs: input.nowMs,
      storage: input.storage,
    });
  }
  return null;
}

async function adoptLegacyRemoteAgentCheckpoint(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  storage: RemoteAgentStorage;
  stored: Extract<RemoteAgentStoredExecutionRead, { status: "found" }>;
}): Promise<boolean> {
  const context = await readRemoteAgentCallbackContext(
    input.storage,
    input.identity.submissionId
  );
  if (!context?.workLoopCheckpoint) {
    return false;
  }
  await compareAndSetRemoteAgentExecutionState({
    expected: input.stored.stored,
    identity: input.identity,
    storage: input.storage,
    next: {
      execution: input.stored.execution,
      completedText: null,
      terminalFailure: null,
      workLoopCheckpoint: context.workLoopCheckpoint,
    },
  });
  // Re-read the CAS winner, including cancellation or failure if it won.
  return true;
}

export async function requestRemoteAgentExecutionCancellation(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  reason?: string;
  summaryRecoveryId?: string;
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentWorkerCancellationResponse> {
  let admissionFenced = false;
  while (true) {
    const result = await readRemoteAgentStoredExecutionState(input);
    if (result.status === "not_found" && !admissionFenced) {
      await persistAdmissionStopIntent(input);
      admissionFenced = true;
      // Initialization may have raced the intent write. Reread so an existing
      // execution still receives the ordinary cancellation transition.
      continue;
    }
    if (result.status !== "found") {
      return remoteAgentWorkerCancellationResponseSchema.parse(result);
    }
    if (
      result.execution.status === "cancellation_requested" ||
      result.execution.status === "aborted"
    ) {
      await persistAdmissionStopIntent(input);
      return remoteAgentWorkerCancellationResponseSchema.parse({
        execution: result.execution,
        status:
          result.execution.status === "aborted"
            ? "already_cancelled"
            : "cancellation_requested",
      });
    }
    if (isTerminalStatus(result.execution.status)) {
      // A completed result cannot become stopped. Retain it, while fencing the
      // old idempotency identity before a member chooses a separate attempt.
      await persistAdmissionStopIntent(input);
      return remoteAgentWorkerCancellationResponseSchema.parse({
        execution: result.execution,
        status: "not_stoppable",
      });
    }
    const execution = remoteAgentWorkerExecutionStateSchema.parse({
      ...result.execution,
      cancellationReason: input.reason?.trim() || null,
      lastProgressAtMs: Math.max(
        result.execution.lastProgressAtMs,
        input.nowMs
      ),
      lastProgressKind: "cancellation_requested",
      status: "cancellation_requested",
    });
    if (
      await compareAndSetRemoteAgentExecutionState({
        expected: result.stored,
        identity: input.identity,
        next: {
          completedText: null,
          execution,
          terminalFailure: null,
        },
        storage: input.storage,
      })
    ) {
      await persistAdmissionStopIntent(input);
      return remoteAgentWorkerCancellationResponseSchema.parse({
        execution,
        status: "cancellation_requested",
      });
    }
  }
}

async function persistAdmissionStopIntent(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  reason?: string;
  summaryRecoveryId?: string;
  storage: RemoteAgentStorage;
}): Promise<void> {
  // The identity fence never expires or reopens. User Stop can only strengthen
  // a recovery fence by removing its structured recovery provenance.
  // Like execution tombstones it has no expiry that could reopen old work.
  await input.storage.putIfAbsent(
    buildAdmissionStopIntentKey(input.identity),
    remoteAgentWorkerAdmissionStopIntentSchema.parse({
      v: 1,
      organizationId: input.identity.organizationId,
      spaceId: input.identity.spaceId,
      idempotencyKey: input.identity.idempotencyKey,
      requestedAtMs: input.nowMs,
      reason: input.reason?.trim() || null,
      ...(input.summaryRecoveryId
        ? { summaryRecoveryId: input.summaryRecoveryId }
        : {}),
    })
  );
  if (!input.summaryRecoveryId) {
    const key = buildAdmissionStopIntentKey(input.identity);
    while (true) {
      const stored = await input.storage.get(key);
      const current = remoteAgentWorkerAdmissionStopIntentSchema.parse(stored);
      if (!current.summaryRecoveryId) {
        return;
      }
      const { summaryRecoveryId: _recoveryId, ...userStop } = current;
      if (await input.storage.compareAndSet(key, stored, userStop)) {
        return;
      }
    }
  }
}

export async function assertRemoteAgentExecutionCanContinue(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  storage: Pick<RemoteAgentStorage, "get">;
}): Promise<void> {
  await assertRemoteAgentAdmissionNotStopped(input);
  const result = await readRemoteAgentStoredExecutionState(input);
  if (result.status === "identity_mismatch") {
    throw new Error(
      "Remote Agent execution identity does not match its durable state."
    );
  }
  if (
    result.status === "found" &&
    (result.execution.status === "cancellation_requested" ||
      result.execution.status === "aborted")
  ) {
    throw new RemoteAgentExecutionCancelledError();
  }
  if (result.status === "found" && result.stored.requestedFailure) {
    throw new Error(
      `Remote Agent tool execution is fenced: ${result.stored.requestedFailure.code}`
    );
  }
  if (result.status === "found" && isTerminalStatus(result.execution.status)) {
    throw new Error(
      "Remote Agent execution has already settled; no further tools may run."
    );
  }
}

function buildAdmissionStopIntentKey(
  identity: RemoteAgentWorkerExecutionQuery
): string {
  return `${ADMISSION_STOP_INTENT_PREFIX}${JSON.stringify([
    identity.organizationId,
    identity.spaceId,
    identity.idempotencyKey,
  ])}`;
}

export async function assertRemoteAgentAdmissionNotStopped(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  storage: Pick<RemoteAgentStorage, "get">;
}): Promise<void> {
  if (await readRemoteAgentAdmissionStopIntent(input)) {
    throw new RemoteAgentExecutionCancelledError();
  }
}

export async function readRemoteAgentAdmissionStopIntent(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  storage: Pick<RemoteAgentStorage, "get">;
}) {
  const value = await input.storage.get(
    buildAdmissionStopIntentKey(input.identity)
  );
  if (value === undefined) {
    return null;
  }
  const intent = remoteAgentWorkerAdmissionStopIntentSchema.safeParse(value);
  if (
    !intent.success ||
    intent.data.organizationId !== input.identity.organizationId ||
    intent.data.spaceId !== input.identity.spaceId ||
    intent.data.idempotencyKey !== input.identity.idempotencyKey
  ) {
    throw new Error("Remote Agent admission Stop intent has invalid identity.");
  }
  return intent.data;
}

function executionIdentityMatches(
  state: Pick<
    RemoteAgentWorkerExecutionState,
    "v" | "organizationId" | "spaceId" | "submissionId" | "idempotencyKey"
  >,
  identity: RemoteAgentWorkerExecutionQuery
): boolean {
  return (
    state.v === identity.v &&
    state.organizationId === identity.organizationId &&
    state.spaceId === identity.spaceId &&
    state.submissionId === identity.submissionId &&
    state.idempotencyKey === identity.idempotencyKey
  );
}

async function readTerminalCompletionMetadata(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  storage: RemoteAgentStorage;
}): Promise<{ completionMetadata?: RemoteAgentCompletionMetadata }> {
  const context = await readRemoteAgentCallbackContext(
    input.storage,
    input.identity.submissionId
  );
  if (
    !context ||
    (context.modelId === undefined && context.lastUsage === undefined)
  ) {
    return {};
  }
  if (!executionIdentityMatches(context, input.identity)) {
    throw new Error(
      "Remote Agent completion metadata has different execution authority."
    );
  }
  return {
    completionMetadata: {
      modelId: context.modelId ?? null,
      usage: context.lastUsage ?? null,
    },
  };
}

async function compareAndSetRemoteAgentExecutionState(input: {
  expected: RemoteAgentStoredExecutionState;
  identity: RemoteAgentWorkerExecutionQuery;
  next: {
    completionMetadata?: RemoteAgentCompletionMetadata;
    workLoopCheckpoint?: RemoteAgentWorkLoopCheckpoint;
    completedText: string | null;
    execution: RemoteAgentWorkerExecutionState;
    terminalFailure: RemoteAgentTerminalFailureFact | null;
  };
  storage: RemoteAgentStorage;
}): Promise<boolean> {
  const nextValue = {
    ...input.next.execution,
    ...(!isTerminalStatus(input.next.execution.status) &&
    input.expected.requestedFailure
      ? { requestedFailure: input.expected.requestedFailure }
      : {}),
    ...(input.next.workLoopCheckpoint
      ? { workLoopCheckpoint: input.next.workLoopCheckpoint }
      : {}),
    ...(input.next.completedText
      ? { completedText: input.next.completedText }
      : {}),
    ...(input.next.terminalFailure
      ? { terminalFailure: input.next.terminalFailure }
      : {}),
  };
  const key = buildRemoteAgentExecutionStateKey(input.identity.submissionId);
  if (input.next.completionMetadata === undefined) {
    return await input.storage.compareAndSet(key, input.expected, nextValue);
  }
  const context = await readRemoteAgentCallbackContext(
    input.storage,
    input.identity.submissionId
  );
  if (
    !context ||
    context.submissionId !== input.identity.submissionId ||
    context.organizationId !== input.identity.organizationId ||
    context.spaceId !== input.identity.spaceId ||
    context.idempotencyKey !== input.identity.idempotencyKey
  ) {
    throw new Error(
      "Remote Agent terminal metadata requires its exact callback context."
    );
  }
  const { lastUsage: _previousUsage, ...previousContext } = context;
  const metadata = input.next.completionMetadata;
  return await input.storage.compareAndSetPair(
    { key, expectedValue: input.expected, nextValue },
    {
      key: buildRemoteAgentCallbackContextKey(input.identity.submissionId),
      expectedValue: context,
      nextValue: {
        ...previousContext,
        modelId: metadata.modelId,
        ...(metadata.usage === null ? {} : { lastUsage: metadata.usage }),
      },
    }
  );
}

function normalizeCompletedExecutionText(text: string | undefined): string {
  return normalizeRemoteAgentCompletedAnswer(text);
}

function parseStoredCompletedText(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("Remote Agent durable completed answer is invalid.");
  }
  const normalized = normalizeCompletedExecutionText(value);
  if (normalized !== value) {
    throw new Error("Remote Agent durable completed answer is not normalized.");
  }
  return value;
}

function isTerminalStatus(
  status: RemoteAgentWorkerExecutionState["status"]
): status is "completed" | "failed" | "aborted" {
  return status === "completed" || status === "failed" || status === "aborted";
}

function progressKindForSettledStatus(
  status: "completed" | "failed" | "aborted"
): RemoteAgentWorkerExecutionProgressKind {
  if (status === "completed") {
    return "prompt_completed";
  }
  if (status === "aborted") {
    return "aborted";
  }
  return "prompt_failed";
}
