import {
  attemptRemoteAgentCallbackDelivery,
  buildRemoteAgentUsageRecord,
  handleRemoteAgentChatResponse,
  projectRemoteAgentCompletedAnswer,
  putRemoteAgentUsageRecord,
  type RemoteAgentAssistantCompletionResult,
  type RemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
  readRemoteAgentCallbackContext,
  updateRemoteAgentCallbackContext,
} from "./callback-context";
import type { RemoteAgentTerminalExecutionOutcome } from "./execution-state";
import type { RemoteAgentTurnUsage } from "./usage";

export const REMOTE_AGENT_TERMINAL_CALLBACK_PROJECTION_MISSING_REASON_CODE =
  "remote_agent.terminal_callback_projection_missing";

export class RemoteAgentTerminalCallbackProjectionMissingError extends Error {
  readonly code = REMOTE_AGENT_TERMINAL_CALLBACK_PROJECTION_MISSING_REASON_CODE;
  readonly submissionId: string;

  constructor(submissionId: string) {
    super(
      `${REMOTE_AGENT_TERMINAL_CALLBACK_PROJECTION_MISSING_REASON_CODE}:${submissionId}`
    );
    this.name = "RemoteAgentTerminalCallbackProjectionMissingError";
    this.submissionId = submissionId;
  }
}

export function buildRemoteAgentTerminalCallbackResult(input: {
  modelId?: string | null;
  outcome: RemoteAgentTerminalExecutionOutcome;
  requestId: string;
  usage?: RemoteAgentTurnUsage | null;
}): RemoteAgentAssistantCompletionResult {
  // New completions persist these existing callback fields in the same CAS
  // as their execution owner. A losing observation cannot replace the winner's
  // model/usage; legacy outcomes keep the prior caller-supplied behavior.
  const modelId = input.outcome.completionMetadata
    ? input.outcome.completionMetadata.modelId
    : input.modelId;
  const usage = input.outcome.completionMetadata
    ? input.outcome.completionMetadata.usage
    : input.usage;
  if (input.outcome.status === "checkpoint") {
    return {
      continuation: true,
      message: { parts: [] },
      requestId: input.requestId,
      status: "completed",
      modelId,
      usage,
    };
  }
  if (input.outcome.status === "completed") {
    return {
      continuation: false,
      message: {
        parts: [{ text: input.outcome.completedText, type: "text" }],
      },
      modelId,
      requestId: input.requestId,
      status: "completed",
      usage,
    };
  }
  return {
    continuation: false,
    failureCode: input.outcome.failure.code,
    failureDetail: input.outcome.failure.detail,
    failureReasonCode: input.outcome.failure.reasonCode,
    message: { parts: [] },
    modelId,
    requestId: input.requestId,
    status: input.outcome.status === "aborted" ? "aborted" : "error",
    usage,
  };
}

export async function projectRemoteAgentTerminalOutcomeToCallback(input: {
  coreWorker?: RemoteAgentCoreWorkerBinding;
  nowMs: number;
  outcome: RemoteAgentTerminalExecutionOutcome;
  result: RemoteAgentAssistantCompletionResult;
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<{
  context: RemoteAgentCallbackContext;
  result: RemoteAgentAssistantCompletionResult;
}> {
  const existing = await readRemoteAgentCallbackContext(
    input.storage,
    input.submissionId
  );
  if (!existing) {
    throw new RemoteAgentTerminalCallbackProjectionMissingError(
      input.submissionId
    );
  }
  const result = input.result;
  if (input.outcome.status === "checkpoint") {
    if (
      existing.callbackStatus === "completed" ||
      existing.callbackStatus === "rejected"
    ) {
      return { context: existing, result };
    }
    const checkpoint = input.outcome.checkpoint;
    const context = await updateRemoteAgentCallbackContext({
      storage: input.storage,
      submissionId: input.submissionId,
      update: (current) => ({
        ...current,
        workLoopCheckpoint: checkpoint,
        lastUsage: result.usage ?? current.lastUsage,
        modelId: result.modelId ?? current.modelId ?? null,
      }),
    });
    await persistProjectedUsage({ ...input, context });
    return {
      context: await attemptRemoteAgentCallbackDelivery({
        context,
        storage: input.storage,
        coreWorker: input.coreWorker,
        nowMs: input.nowMs,
      }),
      result,
    };
  }
  if (input.outcome.status === "completed") {
    const projected = await projectRemoteAgentCompletedAnswer({
      modelId: result.modelId,
      storage: input.storage,
      submissionId: input.submissionId,
      text: input.outcome.completedText,
      usage: result.usage,
    });
    if (
      projected.callbackStatus === "completed" ||
      projected.callbackStatus === "rejected"
    ) {
      return { context: projected, result };
    }
    await persistProjectedUsage({ ...input, context: projected });
    console.info("[remote_agent.execution.answer_projected]", {
      dispatchId: projected.dispatchId,
      idempotencyKey: projected.idempotencyKey,
      spaceId: projected.spaceId,
      submissionId: projected.submissionId,
      triggerMessageId: projected.triggerMessageId,
    });
    return {
      context: await attemptRemoteAgentCallbackDelivery({
        context: projected,
        coreWorker: input.coreWorker,
        nowMs: input.nowMs,
        storage: input.storage,
      }),
      result,
    };
  }
  // Failed and stopped work can still have recorded model consumption.
  // Preserve it before delivery using the same retry-stable owner timestamp.
  await persistProjectedUsage({ ...input, context: existing });
  const projected = await handleRemoteAgentChatResponse({
    coreWorker: input.coreWorker,
    nowMs: () => input.nowMs,
    result,
    storage: input.storage,
  });
  return { context: projected ?? existing, result };
}

async function persistProjectedUsage(input: {
  context: RemoteAgentCallbackContext;
  outcome: RemoteAgentTerminalExecutionOutcome;
  storage: RemoteAgentStorage;
  nowMs: number;
}): Promise<void> {
  if (input.context.lastUsage) {
    await putRemoteAgentUsageRecord(
      input.storage,
      buildRemoteAgentUsageRecord({
        context: input.context,
        modelId: input.context.modelId ?? null,
        // Retries are delivery attempts, not additional model consumption.
        // Use the terminal owner's stable timestamp for the existing usage key.
        nowMs: input.outcome.execution.completedAtMs ?? input.nowMs,
        usage: input.context.lastUsage,
      })
    );
  }
}
