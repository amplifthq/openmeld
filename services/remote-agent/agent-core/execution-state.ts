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

const EXECUTION_STATE_PREFIX = "openmeld:remote-agent:execution-state:";

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
  const existing = await readRemoteAgentExecutionState({
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
  const raced = await readRemoteAgentExecutionState({
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
  const stored = await input.storage.get<unknown>(
    buildRemoteAgentExecutionStateKey(input.identity.submissionId)
  );
  if (stored === undefined) {
    return remoteAgentWorkerExecutionQueryResponseSchema.parse({
      status: "not_found",
    });
  }
  const execution = remoteAgentWorkerExecutionStateSchema.parse(stored);
  if (!executionIdentityMatches(execution, input.identity)) {
    return remoteAgentWorkerExecutionQueryResponseSchema.parse({
      reasonCode: "remote_agent.execution_identity_mismatch",
      status: "identity_mismatch",
    });
  }
  return remoteAgentWorkerExecutionQueryResponseSchema.parse({
    execution,
    status: "found",
  });
}

export async function markRemoteAgentExecutionProgress(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  progressKind: RemoteAgentWorkerExecutionProgressKind;
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentWorkerExecutionState | null> {
  while (true) {
    const result = await readRemoteAgentExecutionState(input);
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
        expected: result.execution,
        identity: input.identity,
        next,
        storage: input.storage,
      })
    ) {
      return next;
    }
  }
}

export async function completeRemoteAgentExecutionState(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  status: "completed" | "failed" | "aborted";
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentWorkerExecutionState | null> {
  while (true) {
    const result = await readRemoteAgentExecutionState(input);
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
    if (
      await compareAndSetRemoteAgentExecutionState({
        expected: result.execution,
        identity: input.identity,
        next,
        storage: input.storage,
      })
    ) {
      return next;
    }
  }
}

export async function requestRemoteAgentExecutionCancellation(input: {
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  reason?: string;
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentWorkerCancellationResponse> {
  while (true) {
    const result = await readRemoteAgentExecutionState(input);
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
        expected: result.execution,
        identity: input.identity,
        next: execution,
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
  expected: RemoteAgentWorkerExecutionState;
  identity: RemoteAgentWorkerExecutionQuery;
  next: RemoteAgentWorkerExecutionState;
  storage: RemoteAgentStorage;
}): Promise<boolean> {
  return input.storage.compareAndSet(
    buildRemoteAgentExecutionStateKey(input.identity.submissionId),
    input.expected,
    input.next
  );
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
