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
  if (input.outcome.status === "completed") {
    return {
      continuation: false,
      message: {
        parts: [{ text: input.outcome.completedText, type: "text" }],
      },
      modelId: input.modelId,
      requestId: input.requestId,
      status: "completed",
      usage: input.usage,
    };
  }
  return {
    continuation: false,
    failureCode: input.outcome.failure.code,
    failureDetail: input.outcome.failure.detail,
    failureReasonCode: input.outcome.failure.reasonCode,
    message: { parts: [] },
    modelId: input.modelId,
    requestId: input.requestId,
    status: input.outcome.status === "aborted" ? "aborted" : "error",
    usage: input.usage,
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
    if (projected.lastUsage) {
      await putRemoteAgentUsageRecord(
        input.storage,
        buildRemoteAgentUsageRecord({
          context: projected,
          modelId: projected.modelId ?? null,
          nowMs: input.nowMs,
          usage: projected.lastUsage,
        })
      );
    }
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
  const projected = await handleRemoteAgentChatResponse({
    coreWorker: input.coreWorker,
    nowMs: () => input.nowMs,
    result,
    storage: input.storage,
  });
  return { context: projected ?? existing, result };
}
