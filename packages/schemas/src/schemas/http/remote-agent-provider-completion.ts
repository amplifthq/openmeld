import * as z from "zod/v4";

const count = z.number().int().nonnegative();
export const remoteAgentProviderCompletionSchema = z.strictObject({
  event: z.literal("remote_agent.provider.completion"),
  v: z.literal(1),
  callId: z.string().uuid(),
  submissionId: z.string().max(512).nullable(),
  attemptNo: z.number().int().min(1).max(2),
  observedAtMs: count,
  durationMs: count,
  modelId: z.string().min(1).max(256),
  responseId: z.string().max(256).nullable(),
  terminalEvent: z.enum(["done", "error"]),
  stopReason: z.enum(["stop", "length", "toolUse", "error", "aborted"]),
  rawStopReason: z
    .enum([
      "stop",
      "length",
      "tool_calls",
      "function_call",
      "content_filter",
      "error",
      "unknown",
    ])
    .nullable(),
  textChars: count,
  thinkingChars: count,
  toolCallCount: count,
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  totalTokens: count,
});
