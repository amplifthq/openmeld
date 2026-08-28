import {
  remoteAgentWorkerCancellationResponseSchema,
  remoteAgentWorkerExecutionQueryResponseSchema,
  remoteAgentWorkerExecutionStateSchema,
} from "@openmeld/schemas";
import type {
  RemoteAgentWorkerCancellationResponse,
  RemoteAgentWorkerExecutionProgressKind,
  RemoteAgentWorkerExecutionQuery,
  RemoteAgentWorkerExecutionQueryResponse,
  RemoteAgentWorkerExecutionState,
} from "@openmeld/schemas/types";
import type { RemoteAgentStorage } from "./callback-context";
import { normalizeRemoteAgentCompletedAnswer } from "./completed-answer";
import {
  createRemoteAgentTerminalFailureFact,
  parseRemoteAgentTerminalFailureFact,
  type RemoteAgentTerminalFailureFact,
} from "./terminal-failure";

const EXECUTION_STATE_PREFIX = "openmeld:remote-agent:execution-state:";

type RemoteAgentStoredExecutionState = RemoteAgentWorkerExecutionState & {
  completedText?: string;
  terminalFailure?: RemoteAgentTerminalFailureFact;
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

export type RemoteAgentTerminalExecutionOutcome =
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
    };

type CompleteRemoteAgentExecutionStateInput = {
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  storage: RemoteAgentStorage;
} & (
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
  const existing = await readRemoteAgentStoredExecutionState({
    identity: input.identity,
    storage: input.storage,
  });
  if (existing.status === "found") {
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
  return remoteAgentWorkerExecutionQueryResponseSchema.parse({
    execution: stored.execution,
    status: "found",
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
    const settledStatus =
      result.execution.status === "cancellation_requested"
        ? "aborted"
        : input.status;
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
      requestedTerminalFailure,
      settledStatus,
    });
    if (
      await compareAndSetRemoteAgentExecutionState({
        expected: result.stored,
        identity: input.identity,
        next: {
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

function resolveRequestedTerminalFailure(
  input: CompleteRemoteAgentExecutionStateInput
): RemoteAgentTerminalFailureFact | null {
  if (input.status === "completed") {
    return null;
  }
  return (
    input.terminalFailure ??
    createRemoteAgentTerminalFailureFact({ status: input.status })
  );
}

function resolveSettledTerminalFailure(input: {
  execution: RemoteAgentWorkerExecutionState;
  requestedTerminalFailure: RemoteAgentTerminalFailureFact | null;
  settledStatus: "aborted" | "completed" | "failed";
}): RemoteAgentTerminalFailureFact | null {
  if (input.settledStatus === "completed") {
    return null;
  }
  if (input.settledStatus === "failed") {
    return input.requestedTerminalFailure;
  }
  return createRemoteAgentTerminalFailureFact({
    ...(input.execution.cancellationReason
      ? { error: input.execution.cancellationReason }
      : {}),
    status: "aborted",
  });
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
    if (result.execution.status !== "completed" || result.completedText) {
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
    if (execution.status === "failed" || execution.status === "aborted") {
      return {
        completedText: null,
        execution,
        failure:
          stored.terminalFailure ??
          createRemoteAgentTerminalFailureFact({
            ...(execution.status === "aborted" && execution.cancellationReason
              ? { error: execution.cancellationReason }
              : {}),
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
    const completedText = await readRemoteAgentCompletedExecutionAnswer({
      identity: input.identity,
      storage: input.storage,
    });
    if (completedText) {
      return { completedText, execution, status: "completed" };
    }
    execution = await repairRemoteAgentCompletedExecutionWithoutAnswer({
      identity: input.identity,
      nowMs: input.nowMs,
      storage: input.storage,
    });
  }
  return null;
}

export async function requestRemoteAgentExecutionCancellation(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  reason?: string;
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentWorkerCancellationResponse> {
  while (true) {
    const result = await readRemoteAgentStoredExecutionState(input);
    if (result.status !== "found") {
      return remoteAgentWorkerCancellationResponseSchema.parse(result);
    }
    if (
      result.execution.status === "cancellation_requested" ||
      result.execution.status === "aborted"
    ) {
      return remoteAgentWorkerCancellationResponseSchema.parse({
        execution: result.execution,
        status: "already_cancelled",
      });
    }
    if (isTerminalStatus(result.execution.status)) {
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
      return remoteAgentWorkerCancellationResponseSchema.parse({
        execution,
        status: "cancellation_requested",
      });
    }
  }
}

export async function assertRemoteAgentExecutionCanContinue(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  storage: Pick<RemoteAgentStorage, "get">;
}): Promise<void> {
  const result = await readRemoteAgentExecutionState(input);
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
}

function executionIdentityMatches(
  state: RemoteAgentWorkerExecutionState,
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

function compareAndSetRemoteAgentExecutionState(input: {
  expected: RemoteAgentStoredExecutionState;
  identity: RemoteAgentWorkerExecutionQuery;
  next: {
    completedText: string | null;
    execution: RemoteAgentWorkerExecutionState;
    terminalFailure: RemoteAgentTerminalFailureFact | null;
  };
  storage: RemoteAgentStorage;
}): Promise<boolean> {
  return input.storage.compareAndSet(
    buildRemoteAgentExecutionStateKey(input.identity.submissionId),
    input.expected,
    {
      ...input.next.execution,
      ...(input.next.completedText
        ? { completedText: input.next.completedText }
        : {}),
      ...(input.next.terminalFailure
        ? { terminalFailure: input.next.terminalFailure }
        : {}),
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
