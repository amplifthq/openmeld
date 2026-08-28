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

const EXECUTION_STATE_PREFIX = "openmeld:remote-agent:execution-state:";

type RemoteAgentStoredExecutionState = RemoteAgentWorkerExecutionState & {
  completedText?: string;
};

type RemoteAgentStoredExecutionRead =
  | {
      completedText: string | null;
      execution: RemoteAgentWorkerExecutionState;
      status: "found";
      stored: RemoteAgentStoredExecutionState;
    }
  | { status: "not_found" }
  | {
      reasonCode: "remote_agent.execution_identity_mismatch";
      status: "identity_mismatch";
    };

type FoundRemoteAgentStoredExecution = Extract<
  RemoteAgentStoredExecutionRead,
  { status: "found" }
>;

export type RemoteAgentTerminalExecutionOutcome =
  | {
      completedText: string;
      execution: RemoteAgentWorkerExecutionState;
      status: "completed";
    }
  | {
      completedText: null;
      execution: RemoteAgentWorkerExecutionState;
      status: "aborted" | "failed";
    };

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
  const { completedText: storedCompletedText, ...executionInput } =
    stored as Record<string, unknown>;
  const execution = remoteAgentWorkerExecutionStateSchema.parse(executionInput);
  if (!executionIdentityMatches(execution, input.identity)) {
    return {
      reasonCode: "remote_agent.execution_identity_mismatch",
      status: "identity_mismatch",
    };
  }
  const completedText = parseStoredCompletedText(storedCompletedText);
  if (completedText && execution.status !== "completed") {
    throw new Error(
      "Remote Agent durable answer exists without a completed execution."
    );
  }
  return {
    completedText,
    execution,
    status: "found",
    stored: stored as RemoteAgentStoredExecutionState,
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
        next: { execution: next, completedText: null },
        storage: input.storage,
      })
    ) {
      return next;
    }
  }
}

export async function completeRemoteAgentExecutionState(
  input: {
    identity: RemoteAgentWorkerExecutionQuery;
    nowMs: number;
    storage: RemoteAgentStorage;
  } & (
    | { completedText: string; status: "completed" }
    | { completedText?: never; status: "failed" | "aborted" }
  )
): Promise<RemoteAgentWorkerExecutionState | null> {
  const requestedCompletedText =
    input.status === "completed"
      ? normalizeCompletedExecutionText(input.completedText)
      : null;
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
      return resolveExistingTerminalExecution({
        requestedCompletedText,
        requestedStatus: input.status,
        result,
      });
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
    if (
      await compareAndSetRemoteAgentExecutionState({
        expected: result.stored,
        identity: input.identity,
        next: {
          completedText:
            settledStatus === "completed" ? requestedCompletedText : null,
          execution: next,
        },
        storage: input.storage,
      })
    ) {
      return next;
    }
  }
}

function resolveExistingTerminalExecution(input: {
  requestedCompletedText: string | null;
  requestedStatus: "completed" | "failed" | "aborted";
  result: FoundRemoteAgentStoredExecution;
}): RemoteAgentWorkerExecutionState {
  if (
    input.result.execution.status !== "completed" ||
    input.requestedStatus !== "completed"
  ) {
    return input.result.execution;
  }
  if (!input.requestedCompletedText) {
    throw new Error(
      "Remote Agent completed execution requires a final answer."
    );
  }
  if (
    input.result.completedText &&
    input.result.completedText !== input.requestedCompletedText
  ) {
    throw new Error(
      "Remote Agent completed execution received a conflicting final answer."
    );
  }
  return input.result.execution;
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
        next: { completedText: null, execution: failed },
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
    if (execution.status === "failed" || execution.status === "aborted") {
      return {
        completedText: null,
        execution,
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
        next: { completedText: null, execution },
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
  };
  storage: RemoteAgentStorage;
}): Promise<boolean> {
  return input.storage.compareAndSet(
    buildRemoteAgentExecutionStateKey(input.identity.submissionId),
    input.expected,
    input.next.completedText
      ? { ...input.next.execution, completedText: input.next.completedText }
      : input.next.execution
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
