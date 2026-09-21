export type AntigravityStreamEvent =
  | {
      event: "init";
      conversationId: string;
    }
  | {
      event: "step_update";
      conversationId: string;
      state: "ACTIVE" | "DONE";
      stepIndex: number;
      stepType: string;
      textDelta: string | null;
      toolError: string | null;
      toolInput: unknown;
      toolName: string | null;
    }
  | {
      event: "result";
      conversationId: string;
      error: string | null;
      response: string;
      status: string;
      usage: AntigravityTokenUsage | null;
    };

export type AntigravityTokenUsage = {
  cacheReadTokens: number;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
};

export function parseAntigravityOutputLine(
  line: string
): AntigravityStreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const record = toRecord(value);
  if (record?.event === "init") {
    const init = toRecord(record.init);
    const conversationId = readText(record.conversation_id);
    if (!(init && conversationId)) {
      return null;
    }
    return { event: "init", conversationId };
  }
  if (record?.event === "step_update") {
    const step = toRecord(record.step_update);
    const conversationId = readText(step?.conversation_id);
    const state = step?.state;
    const stepIndex = step?.step_index;
    const stepType = readText(step?.step_type);
    if (
      !conversationId ||
      (state !== "ACTIVE" && state !== "DONE") ||
      typeof stepIndex !== "number" ||
      !Number.isInteger(stepIndex) ||
      !stepType
    ) {
      return null;
    }
    const toolInfo = toRecord(step?.tool_info);
    const toolError = toRecord(toolInfo?.error);
    return {
      conversationId,
      event: "step_update",
      state,
      stepIndex,
      stepType,
      textDelta: readText(step?.text_delta),
      toolError: readText(toolError?.message),
      toolInput: toolInfo?.parameters,
      toolName: readText(step?.tool_name) ?? readText(toolInfo?.name),
    };
  }
  if (record?.event === "result") {
    const result = toRecord(record.result);
    const conversationId = readText(result?.conversation_id) ?? "";
    const status = readText(result?.status);
    if (!(result && status)) {
      return null;
    }
    return {
      conversationId,
      error: readText(result.error),
      event: "result",
      response: typeof result.response === "string" ? result.response : "",
      status,
      usage: parseTokenUsage(result.usage),
    };
  }
  return null;
}

function parseTokenUsage(value: unknown): AntigravityTokenUsage | null {
  const usage = toRecord(value);
  if (!usage) {
    return null;
  }
  const inputTokens = readNonNegativeNumber(usage.input_tokens);
  const outputTokens = readNonNegativeNumber(usage.output_tokens);
  const thinkingTokens = readNonNegativeNumber(usage.thinking_tokens);
  const cacheReadTokens = readNonNegativeNumber(usage.cache_read_tokens);
  const totalTokens = readNonNegativeNumber(usage.total_tokens);
  if (
    inputTokens === null ||
    outputTokens === null ||
    thinkingTokens === null ||
    cacheReadTokens === null ||
    totalTokens === null
  ) {
    return null;
  }
  return {
    cacheReadTokens,
    inputTokens,
    outputTokens,
    thinkingTokens,
    totalTokens,
  };
}

function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
