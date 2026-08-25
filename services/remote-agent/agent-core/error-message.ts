const ERROR_MESSAGE_KEYS = [
  "message",
  "error",
  "detail",
  "details",
  "reason",
  "cause",
  "errorInfo",
] as const;
const ERROR_CLASSIFICATION_KEYS = ["code", "name", "type"] as const;

const UNHELPFUL_ERROR_MESSAGES = new Set([
  "",
  "[object Object]",
  "{}",
  "null",
  "undefined",
]);

const CONTEXT_WINDOW_EXCEEDED_PATTERNS = [
  /\bcontext_(?:length|window)_exceeded\b/i,
  /\bcontext (?:length|window) (?:has been |was )?exceeded\b/i,
  /\bmaximum context length is \d[\d,]* tokens\b/i,
  /\bmaximum prompt length is \d[\d,]*(?: tokens)?\b/i,
] as const;
const TOOL_RESULT_TOO_LARGE_PATTERNS = [
  /\bsqlite_toobig\b/i,
  /\bstring or blob too big\b/i,
] as const;

export function normalizeRemoteAgentErrorMessage(error: unknown): string {
  return normalizeErrorMessage(error) ?? "unknown error";
}

export function isRemoteAgentContextWindowExceeded(error: unknown): boolean {
  return hasContextWindowExceededSignal(error, new WeakSet(), 0);
}

export function isRemoteAgentToolResultTooLarge(error: unknown): boolean {
  const message = normalizeErrorMessage(error);
  return message
    ? TOOL_RESULT_TOO_LARGE_PATTERNS.some((pattern) => pattern.test(message))
    : false;
}

function normalizeErrorMessage(
  error: unknown,
  seen: WeakSet<object> = new WeakSet()
): string | null {
  if (error instanceof Error) {
    const message = normalizeText(error.message);
    if (message) {
      return message;
    }
    return (
      normalizeObjectErrorMessage(error, seen) ?? normalizeText(error.name)
    );
  }

  if (typeof error === "string") {
    return normalizeText(error);
  }

  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint"
  ) {
    return normalizeText(String(error));
  }

  if (!error || typeof error !== "object") {
    return null;
  }

  return normalizeObjectErrorMessage(error, seen);
}

function hasContextWindowExceededSignal(
  error: unknown,
  seen: WeakSet<object>,
  depth: number
): boolean {
  if (depth > 4) {
    return false;
  }
  if (
    typeof error === "string" ||
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint"
  ) {
    return CONTEXT_WINDOW_EXCEEDED_PATTERNS.some((pattern) =>
      pattern.test(String(error))
    );
  }
  if (!error || typeof error !== "object" || seen.has(error)) {
    return false;
  }
  seen.add(error);
  const record = error as Record<string, unknown>;
  return [...ERROR_CLASSIFICATION_KEYS, ...ERROR_MESSAGE_KEYS].some((key) =>
    hasContextWindowExceededSignal(record[key], seen, depth + 1)
  );
}

function normalizeObjectErrorMessage(
  error: object,
  seen: WeakSet<object>
): string | null {
  if (seen.has(error)) {
    return null;
  }
  seen.add(error);

  for (const key of ERROR_MESSAGE_KEYS) {
    const nested = normalizeErrorMessage(
      (error as Record<string, unknown>)[key],
      seen
    );
    if (nested) {
      return nested;
    }
  }

  try {
    return normalizeText(JSON.stringify(error));
  } catch {
    return normalizeText(String(error));
  }
}

function normalizeText(value: string): string | null {
  const normalized = value.trim();
  return UNHELPFUL_ERROR_MESSAGES.has(normalized) ? null : normalized;
}
