export type ClaudeOutputLineParseResult = {
  errorMessage: string | null;
  isErrorResult: boolean | null;
  previewDeltaText: string | null;
  resultText: string | null;
  sessionId: string | null;
  terminal: boolean;
};

export function parseClaudeOutputLine(
  line: string
): ClaudeOutputLineParseResult | null {
  const normalizedLine = line.trim();
  if (!normalizedLine) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedLine);
  } catch {
    return null;
  }

  const record = toObjectRecord(parsed);
  if (!record) {
    return null;
  }

  const sessionId = normalizeOptionalText(record.session_id);
  const resultText = normalizeOptionalText(record.result);
  const isErrorResult =
    typeof record.is_error === "boolean" ? record.is_error : null;

  if (record.type === "result") {
    return {
      errorMessage: isErrorResult ? resultText : null,
      isErrorResult,
      previewDeltaText: null,
      resultText,
      sessionId,
      terminal: true,
    };
  }

  if (record.type === "error") {
    return {
      errorMessage: normalizeOptionalText(record.message),
      isErrorResult: true,
      previewDeltaText: null,
      resultText: null,
      sessionId,
      terminal: true,
    };
  }

  if (record.type === "stream_event") {
    const streamEventResult = parseClaudeStreamEvent(record, sessionId);
    if (streamEventResult) {
      return streamEventResult;
    }
  }

  return null;
}

function parseClaudeStreamEvent(
  record: Record<string, unknown>,
  sessionId: string | null
): ClaudeOutputLineParseResult | null {
  const event = toObjectRecord(record.event);
  if (!event) {
    return null;
  }

  const eventType = normalizeOptionalText(event.type);
  if (eventType === "message_start") {
    return {
      errorMessage: null,
      isErrorResult: null,
      previewDeltaText: null,
      resultText: null,
      sessionId,
      terminal: false,
    };
  }
  if (eventType !== "content_block_delta") {
    return null;
  }

  const delta = toObjectRecord(event.delta);
  if (delta?.type !== "text_delta") {
    return null;
  }

  return {
    errorMessage: null,
    isErrorResult: null,
    previewDeltaText: preserveOptionalText(delta.text),
    resultText: null,
    sessionId,
    terminal: false,
  };
}

function toObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
}

function preserveOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.length > 0 ? value : null;
}
