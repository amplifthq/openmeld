import { looksLikeRuntimePermissionDenialMessage } from "@openmeld/adapter-core";

export type OpenClawOutputLineParseResult = {
  errorMessage: string | null;
  isErrorResult: boolean | null;
  resultText: string | null;
  sessionId: string | null;
  terminal: boolean;
};

export type OpenClawOutputDocumentParseResult = {
  errorMessage: string | null;
  isErrorResult: boolean | null;
  outputText: string | null;
  sessionId: string | null;
};

const OPENCLAW_SESSION_ID_PATHS = [
  ["session_id"],
  ["sessionId"],
  ["metadata", "session_id"],
  ["metadata", "sessionId"],
  ["session", "id"],
  ["context", "session_id"],
  ["context", "sessionId"],
  ["reply", "session_id"],
  ["reply", "sessionId"],
] as const;

const OPENCLAW_RESULT_TEXT_PATHS = [
  ["reply", "text"],
  ["result"],
  ["output"],
  ["text"],
  ["response", "text"],
  ["response"],
  ["content"],
  ["data", "result"],
  ["data", "output"],
  ["data", "text"],
  ["payload", "result"],
  ["payload", "output"],
] as const;

const OPENCLAW_ERROR_MESSAGE_PATHS = [
  ["error", "message"],
  ["error", "text"],
  ["error"],
  ["errors", "0", "message"],
  ["message"],
  ["result"],
  ["data", "error"],
  ["data", "message"],
] as const;

export function parseOpenClawOutputLine(
  line: string
): OpenClawOutputLineParseResult | null {
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

  if (!errorMessage && resultText === null && sessionId === null) {
    return null;
  }

  return {
    errorMessage,
    isErrorResult,
    resultText,
    sessionId,
    terminal:
      errorMessage !== null || resultText !== null || isErrorResult !== null,
  };
}

export function parseOpenClawOutputDocument(
  text: string
): OpenClawOutputDocumentParseResult | null {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedText);
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
  const outputText = resolveDocumentOutputText(record, isErrorResult);
  const sessionId = resolveDocumentSessionId(record);

  if (!errorMessage && outputText === null && sessionId === null) {
    return null;
  }

  return {
    errorMessage,
    isErrorResult,
    outputText,
    sessionId,
  };
}

function resolveSessionId(record: Record<string, unknown>): string | null {
  return resolveStringByPaths(record, OPENCLAW_SESSION_ID_PATHS);
}

function resolveDocumentSessionId(
  record: Record<string, unknown>
): string | null {
  return (
    resolveStringByPaths(record, [
      ...OPENCLAW_SESSION_ID_PATHS,
      ["meta", "agentMeta", "sessionId"],
      ["meta", "sessionId"],
    ]) ?? null
  );
}

function resolveResultText(
  record: Record<string, unknown>,
  isErrorResult: boolean | null
): string | null {
  if (isErrorResult === true) {
    return null;
  }
  return resolveStringByPaths(record, OPENCLAW_RESULT_TEXT_PATHS);
}

function resolveDocumentOutputText(
  record: Record<string, unknown>,
  isErrorResult: boolean | null
): string | null {
  if (isErrorResult === true) {
    return null;
  }

  const payloadText = resolvePayloadsText(record.payloads);
  if (payloadText) {
    return payloadText;
  }

  return resolveResultText(record, isErrorResult);
}

function resolveErrorMessage(
  record: Record<string, unknown>,
  isErrorResult: boolean | null
): string | null {
  const fromKnownPaths = resolveStringByPaths(
    record,
    OPENCLAW_ERROR_MESSAGE_PATHS
  );
  if (
    fromKnownPaths &&
    (isErrorResult === true || looksLikeErrorSignal(fromKnownPaths))
  ) {
    return fromKnownPaths;
  }

  if (isErrorResult === true) {
    const fallback = resolveStringByPaths(record, OPENCLAW_RESULT_TEXT_PATHS);
    if (fallback) {
      return fallback;
    }
  }

  return null;
}

function resolveIsErrorResult(record: Record<string, unknown>): boolean | null {
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

  const type = normalizeOptionalText(record.type)?.toLowerCase();
  if (type === "error" || type === "failure") {
    return true;
  }
  if (type === "result" || type === "success") {
    return false;
  }

  if (record.error !== undefined || record.errors !== undefined) {
    return true;
  }

  return null;
}

function resolveStringByPaths(
  record: Record<string, unknown>,
  paths: readonly (readonly string[])[]
): string | null {
  for (const path of paths) {
    const value = getByPath(record, path);
    const normalized = normalizeCandidateValue(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function resolvePayloadsText(payloads: unknown): string | null {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return null;
  }

  const lines: string[] = [];
  for (const entry of payloads) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const text = normalizeCandidateValue(
      (entry as Record<string, unknown>).text
    );
    if (text) {
      lines.push(text);
    }
  }

  if (lines.length === 0) {
    return null;
  }
  return lines.join("\n\n");
}

function getByPath(
  record: Record<string, unknown>,
  path: readonly string[]
): unknown {
  let current: unknown = record;
  for (const segment of path) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    return undefined;
  }
  return current;
}

function normalizeCandidateValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
  }
  return null;
}

function looksLikeErrorSignal(value: string): boolean {
  const lowered = value.toLowerCase();
  return (
    lowered.includes("error") ||
    lowered.includes("failed") ||
    looksLikeRuntimePermissionDenialMessage(value) ||
    lowered.includes("unauthorized") ||
    lowered.includes("not logged in") ||
    lowered.includes("invalid")
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
