export type OpenCodeOutputLineParseResult = {
  errorMessage: string | null;
  isErrorResult: boolean | null;
  resultText: string | null;
  sessionId: string | null;
  terminal: boolean;
};

export type OpenCodeOutputDocumentParseResult = {
  errorMessage: string | null;
  isErrorResult: boolean | null;
  outputText: string | null;
  sessionId: string | null;
};

const OPENCODE_SESSION_ID_PATHS = [
  ["sessionID"],
  ["sessionId"],
  ["session_id"],
  ["session", "id"],
  ["metadata", "sessionID"],
  ["metadata", "sessionId"],
  ["metadata", "session_id"],
  ["context", "sessionID"],
  ["context", "sessionId"],
  ["context", "session_id"],
] as const;

const OPENCODE_TEXT_PATHS = [
  ["part", "text"],
  ["text"],
  ["content"],
  ["message"],
  ["delta", "text"],
  ["data", "text"],
  ["data", "content"],
  ["payload", "text"],
  ["payload", "content"],
] as const;

const OPENCODE_ERROR_MESSAGE_PATHS = [
  ["error", "message"],
  ["error", "text"],
  ["error", "data", "message"],
  ["error", "data", "error"],
  ["error", "cause", "message"],
  ["error"],
  ["errors", "0", "message"],
  ["message"],
  ["data", "error", "message"],
  ["data", "error", "text"],
  ["data", "error", "data", "message"],
  ["data", "error"],
  ["data", "message"],
] as const;

export function parseOpenCodeOutputLine(
  line: string
): OpenCodeOutputLineParseResult | null {
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

  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  if (!record) {
    return null;
  }

  const isErrorResult = resolveIsErrorResult(record);
  const errorMessage = resolveErrorMessage(record, isErrorResult);
  const resultText = resolveResultText(record, isErrorResult);
  const sessionId = resolveSessionId(record);

  if (
    !errorMessage &&
    resultText === null &&
    sessionId === null &&
    isErrorResult === null
  ) {
    return null;
  }

  return {
    errorMessage,
    isErrorResult,
    resultText,
    sessionId,
    terminal: isErrorResult === true,
  };
}

export function parseOpenCodeOutputDocument(
  text: string
): OpenCodeOutputDocumentParseResult | null {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return null;
  }

  const lines = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }

  let outputText = "";
  let sessionId: string | null = null;
  let errorMessage: string | null = null;
  let isErrorResult: boolean | null = null;
  let parsedAnyLine = false;

  for (const line of lines) {
    const parsedLine = parseOpenCodeOutputLine(line);
    if (!parsedLine) {
      continue;
    }
    parsedAnyLine = true;
    if (parsedLine.sessionId) {
      sessionId = parsedLine.sessionId;
    }
    if (parsedLine.resultText) {
      outputText += parsedLine.resultText;
    }
    if (parsedLine.errorMessage) {
      errorMessage = parsedLine.errorMessage;
    }
    if (parsedLine.isErrorResult !== null) {
      isErrorResult = parsedLine.isErrorResult;
    }
  }

  if (!parsedAnyLine) {
    return null;
  }

  return {
    errorMessage,
    isErrorResult,
    outputText: normalizeOptionalText(outputText),
    sessionId,
  };
}

function resolveSessionId(record: Record<string, unknown>): string | null {
  return resolveStringByPaths(record, OPENCODE_SESSION_ID_PATHS);
}

function resolveResultText(
  record: Record<string, unknown>,
  isErrorResult: boolean | null
): string | null {
  if (isErrorResult === true) {
    return null;
  }
  if (record.type !== "text") {
    return null;
  }
  return resolveTextByPaths(record, OPENCODE_TEXT_PATHS);
}

function resolveErrorMessage(
  record: Record<string, unknown>,
  isErrorResult: boolean | null
): string | null {
  if (isErrorResult !== true) {
    return null;
  }
  return resolveStringByPaths(record, OPENCODE_ERROR_MESSAGE_PATHS);
}

function resolveIsErrorResult(record: Record<string, unknown>): boolean | null {
  if (record.type === "error") {
    return true;
  }
  if (typeof record.is_error === "boolean") {
    return record.is_error;
  }
  if (typeof record.isError === "boolean") {
    return record.isError;
  }
  if (typeof record.ok === "boolean") {
    return !record.ok;
  }
  if (typeof record.success === "boolean") {
    return !record.success;
  }

  const status = normalizeOptionalText(record.status)?.toLowerCase();
  if (status === "error" || status === "failed" || status === "fail") {
    return true;
  }
  if (status === "ok" || status === "success" || status === "completed") {
    return false;
  }
  return null;
}

function resolveStringByPaths(
  record: Record<string, unknown>,
  paths: readonly (readonly string[])[]
): string | null {
  for (const path of paths) {
    let current: unknown = record;
    for (const segment of path) {
      if (current && typeof current === "object" && !Array.isArray(current)) {
        current = (current as Record<string, unknown>)[segment];
        continue;
      }
      current = undefined;
      break;
    }
    const normalized = normalizeScalarText(current);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function resolveTextByPaths(
  record: Record<string, unknown>,
  paths: readonly (readonly string[])[]
): string | null {
  for (const path of paths) {
    let current: unknown = record;
    for (const segment of path) {
      if (current && typeof current === "object" && !Array.isArray(current)) {
        current = (current as Record<string, unknown>)[segment];
        continue;
      }
      current = undefined;
      break;
    }
    if (typeof current === "string" && current.length > 0) {
      return current;
    }
  }
  return null;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeScalarText(value: unknown): string | null {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    return null;
  }
  return normalizeOptionalText(value);
}
