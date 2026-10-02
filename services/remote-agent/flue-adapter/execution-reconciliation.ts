import type { AgentSubmissionProjection } from "@flue/runtime/internal";
import type {
  RemoteAgentWorkerExecutionQuery,
  RemoteAgentWorkerExecutionQueryResponse,
} from "@openmeld/schemas/types";
import {
  listDueRetryableCallbackContexts,
  listRemoteAgentCallbackContexts,
  type RemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  completeRemoteAgentExecutionState,
  RemoteAgentTerminalExecutionOwnerMissingError,
  readRemoteAgentExecutionState,
  readRemoteAgentRequestedExecutionFailure,
  resolveRemoteAgentTerminalExecutionOutcome,
} from "../agent-core/execution-state";
import {
  buildRemoteAgentTerminalCallbackResult,
  projectRemoteAgentTerminalOutcomeToCallback,
} from "../agent-core/terminal-callback-projection";
import { createRemoteAgentTerminalFailureFact } from "../agent-core/terminal-failure";
import { normalizeFluePromptUsage } from "../agent-core/usage";
import { finishRemoteAgentComputerCommands } from "./execution-cleanup";

export type FlueSubmissionLifecycle = Pick<
  AgentSubmissionProjection,
  "error" | "status" | "completedOutput" | "terminalMetadata"
>;

export async function reconcileSettledRemoteAgentExecutions(input: {
  env?: { AGENT_COMPUTER?: unknown };
  coreWorker?: RemoteAgentCoreWorkerBinding;
  nowMs?: () => number;
  readSubmission: (
    submissionId: string
  ) => Promise<FlueSubmissionLifecycle | null>;
  retryableContexts?: readonly RemoteAgentCallbackContext[];
  storage: RemoteAgentStorage;
}): Promise<{ reconciled: number }> {
  const nowMs = input.nowMs?.() ?? Date.now();
  const [pendingContexts, retryableContexts] = await Promise.all([
    listRemoteAgentCallbackContexts(input.storage, ["pending"]),
    input.retryableContexts
      ? Promise.resolve(input.retryableContexts)
      : listDueRetryableCallbackContexts(input.storage, nowMs),
  ]);
  const candidates = new Map(
    [...pendingContexts, ...retryableContexts]
      .filter(
        (context) =>
          context.callbackStatus === "pending" ||
          context.callbackStatus === "retryable"
      )
      .map((context) => [context.submissionId, context] as const)
  );
  let reconciled = 0;
  for (const context of candidates.values()) {
    try {
      const result = await reconcileRemoteAgentExecution({
        env: input.env,
        coreWorker: input.coreWorker,
        identity: {
          idempotencyKey: context.idempotencyKey,
          organizationId: context.organizationId,
          spaceId: context.spaceId,
          submissionId: context.submissionId,
          v: 1,
        },
        nowMs: () => nowMs,
        readSubmission: input.readSubmission,
        storage: input.storage,
      });
      if (
        result.status === "found" &&
        (result.execution.status === "completed" ||
          result.execution.status === "failed" ||
          result.execution.status === "aborted")
      ) {
        reconciled += 1;
      }
    } catch (error) {
      console.error("[remote_agent.execution.reconciliation_failed]", {
        error: error instanceof Error ? error.message : String(error),
        submissionId: context.submissionId,
      });
    }
  }
  return { reconciled };
}

export async function reconcileRemoteAgentExecution(input: {
  env?: { AGENT_COMPUTER?: unknown };
  coreWorker?: RemoteAgentCoreWorkerBinding;
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs?: () => number;
  readSubmission: (
    submissionId: string
  ) => Promise<FlueSubmissionLifecycle | null>;
  storage: RemoteAgentStorage;
}): Promise<RemoteAgentWorkerExecutionQueryResponse> {
  const current = await readRemoteAgentExecutionState({
    identity: input.identity,
    storage: input.storage,
  });
  if (current.status !== "found") {
    return current;
  }
  if (
    current.execution.status === "completed" ||
    current.execution.status === "failed" ||
    current.execution.status === "aborted"
  ) {
    await projectRemoteAgentTerminalExecution({
      coreWorker: input.coreWorker,
      execution: current.execution,
      identity: input.identity,
      nowMs: input.nowMs?.() ?? Date.now(),
      storage: input.storage,
    });
    return await readRemoteAgentExecutionState({
      identity: input.identity,
      storage: input.storage,
    });
  }

  const submission = await input.readSubmission(input.identity.submissionId);
  if (submission?.status !== "settled") {
    return current;
  }

  const cancelled = current.execution.status === "cancellation_requested";
  if (
    submission.terminalMetadata &&
    submission.terminalMetadata.submissionId !== input.identity.submissionId
  ) {
    throw new Error(
      "Remote Agent terminal consumption has mismatched execution identity."
    );
  }
  const requestedFailure =
    await readRemoteAgentRequestedExecutionFailure(input);
  // A crash can leave Flue canonically complete before the application stores
  // its terminal owner. Recover only an exact canonical result, never a
  // partial visible stream, and use the same cleanup/CAS/publication path.
  if (!(cancelled || submission.error || requestedFailure)) {
    if (submission.completedOutput) {
      await reconcileCompletedRemoteAgentExecution({
        ...input,
        output: submission.completedOutput,
      });
      return await readRemoteAgentExecutionState(input);
    }
    return current;
  }

  const nowMs = input.nowMs?.() ?? Date.now();

  await finishRemoteAgentComputerCommands({
    context: await readRemoteAgentCallbackContext(
      input.storage,
      input.identity.submissionId
    ),
    env: input.env,
    storage: input.storage,
  });

  const settledExecution = await completeRemoteAgentExecutionState({
    ...(submission.terminalMetadata
      ? {
          completionMetadata: normalizeTerminalMetadata(
            submission.terminalMetadata
          ),
        }
      : {}),
    identity: input.identity,
    nowMs,
    status: cancelled ? "aborted" : "failed",
    storage: input.storage,
    terminalFailure:
      requestedFailure ??
      createRemoteAgentTerminalFailureFact({
        error: cancelled
          ? (current.execution.cancellationReason ??
            "Remote Agent execution was cancelled.")
          : submission.error,
        status: cancelled ? "aborted" : "failed",
      }),
  });
  await projectRemoteAgentTerminalExecution({
    coreWorker: input.coreWorker,
    execution: settledExecution,
    identity: input.identity,
    nowMs,
    storage: input.storage,
  });

  return await readRemoteAgentExecutionState({
    identity: input.identity,
    storage: input.storage,
  });
}

async function reconcileCompletedRemoteAgentExecution(input: {
  env?: { AGENT_COMPUTER?: unknown };
  coreWorker?: RemoteAgentCoreWorkerBinding;
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs?: () => number;
  storage: RemoteAgentStorage;
  output: NonNullable<AgentSubmissionProjection["completedOutput"]>;
}): Promise<void> {
  if (input.output.submissionId !== input.identity.submissionId) {
    throw new Error(
      "Remote Agent canonical result has mismatched execution identity."
    );
  }
  const context = await readRemoteAgentCallbackContext(
    input.storage,
    input.identity.submissionId
  );
  if (!context) {
    throw new Error("Remote Agent canonical result has no callback context.");
  }
  if (
    context.organizationId !== input.identity.organizationId ||
    context.spaceId !== input.identity.spaceId ||
    context.idempotencyKey !== input.identity.idempotencyKey
  ) {
    throw new Error(
      "Remote Agent canonical result has mismatched callback authority."
    );
  }
  await finishRemoteAgentComputerCommands({ ...input, context });
  const nowMs = input.nowMs?.() ?? Date.now();
  const completionMetadata = normalizeTerminalMetadata(input.output);
  const common = {
    identity: input.identity,
    storage: input.storage,
    nowMs,
    completionMetadata,
  };
  let execution: Awaited<ReturnType<typeof completeRemoteAgentExecutionState>>;
  if (context.workLoopCheckpoint) {
    execution = await completeRemoteAgentExecutionState({
      ...common,
      status: "checkpoint",
      checkpoint: context.workLoopCheckpoint,
    });
  } else if (input.output.text.trim()) {
    execution = await completeRemoteAgentExecutionState({
      ...common,
      status: "completed",
      completedText: input.output.text,
    });
  } else {
    execution = await completeRemoteAgentExecutionState({
      ...common,
      status: "failed",
      terminalFailure: createRemoteAgentTerminalFailureFact({
        status: "failed",
        error: "Canonical execution completed without an assistant answer.",
      }),
    });
  }
  await projectRemoteAgentTerminalExecution({ ...input, execution, nowMs });
}

function normalizeTerminalMetadata(
  metadata: NonNullable<AgentSubmissionProjection["terminalMetadata"]>
) {
  const model = metadata.model;
  let modelId: string | null = null;
  if (model?.id) {
    modelId = model.provider ? `${model.provider}/${model.id}` : model.id;
  }
  return {
    modelId,
    usage: normalizeFluePromptUsage(metadata.usage),
  };
}

async function projectRemoteAgentTerminalExecution(input: {
  coreWorker?: RemoteAgentCoreWorkerBinding;
  execution: Awaited<ReturnType<typeof completeRemoteAgentExecutionState>>;
  identity: RemoteAgentWorkerExecutionQuery;
  nowMs: number;
  storage: RemoteAgentStorage;
}): Promise<void> {
  const outcome = await resolveRemoteAgentTerminalExecutionOutcome({
    execution: input.execution,
    identity: input.identity,
    nowMs: input.nowMs,
    storage: input.storage,
  });
  if (!outcome) {
    throw new RemoteAgentTerminalExecutionOwnerMissingError(
      input.identity.submissionId
    );
  }
  const result = buildRemoteAgentTerminalCallbackResult({
    outcome,
    requestId: input.identity.submissionId,
  });
  await projectRemoteAgentTerminalOutcomeToCallback({
    coreWorker: input.coreWorker,
    nowMs: input.nowMs,
    outcome,
    result,
    storage: input.storage,
    submissionId: input.identity.submissionId,
  });
}
