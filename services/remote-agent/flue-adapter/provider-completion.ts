import { remoteAgentProviderCompletionSchema } from "@openmeld/schemas";
import type { ProviderAttemptCompletion } from "./provider-stream-retry";

const SAFE_RESPONSE_ID = /^[A-Za-z0-9_.:/-]{1,256}$/u;
const RAW_STOP_REASONS = new Set([
  "stop",
  "length",
  "tool_calls",
  "function_call",
  "content_filter",
  "error",
]);

export function projectProviderCompletion(
  input: ProviderAttemptCompletion & {
    callId: string;
    submissionId: string | null;
  }
) {
  const message =
    input.event.type === "done" ? input.event.message : input.event.error;
  let textChars = 0;
  let thinkingChars = 0;
  let toolCallCount = 0;
  let rawStopReason: string | null = null;
  if (message.rawStopReason) {
    rawStopReason = RAW_STOP_REASONS.has(message.rawStopReason)
      ? message.rawStopReason
      : "unknown";
  }
  for (const part of message.content) {
    if (part.type === "text") {
      textChars += part.text.trim().length;
    }
    if (part.type === "thinking") {
      thinkingChars += part.thinking.trim().length;
    }
    if (part.type === "toolCall") {
      toolCallCount += 1;
    }
  }
  return remoteAgentProviderCompletionSchema.parse({
    event: "remote_agent.provider.completion",
    v: 1,
    callId: input.callId,
    submissionId: input.submissionId,
    attemptNo: input.attemptNo,
    durationMs: input.durationMs,
    observedAtMs: Date.now(),
    modelId: message.model,
    responseId:
      message.responseId && SAFE_RESPONSE_ID.test(message.responseId)
        ? message.responseId
        : null,
    terminalEvent: input.event.type,
    stopReason: input.event.reason,
    rawStopReason,
    textChars,
    thinkingChars,
    toolCallCount,
    inputTokens: message.usage.input,
    outputTokens: message.usage.output,
    cacheReadTokens: message.usage.cacheRead,
    cacheWriteTokens: message.usage.cacheWrite,
    totalTokens: message.usage.totalTokens,
  });
}

export function providerCompletionOperation(
  completion: ReturnType<typeof projectProviderCompletion>
): string {
  let content = "empty";
  if (completion.thinkingChars > 0) {
    content = "thinking";
  }
  if (completion.textChars > 0) {
    content = "text";
  }
  if (completion.toolCallCount > 0) {
    content = "tool";
  }
  let outcome = "completed";
  if (completion.attemptNo === 2) {
    outcome = providerCompletionSucceeded(completion)
      ? "recovered"
      : "recovery_exhausted";
  }
  return `${outcome}_${content}_${completion.stopReason}`;
}

export function providerCompletionSucceeded(
  completion: ReturnType<typeof projectProviderCompletion>
): boolean {
  return (
    completion.terminalEvent === "done" &&
    (completion.stopReason === "stop" || completion.stopReason === "toolUse") &&
    (completion.textChars > 0 || completion.toolCallCount > 0)
  );
}
