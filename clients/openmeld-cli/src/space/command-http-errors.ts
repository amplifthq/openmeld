import { parseHttpFailure } from "./http-failure";

const HTTP_STATUS_IN_TEXT_REGEX = /^HTTP\s+(\d{3}):/i;

export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function parseHttpErrorMessage(error: unknown): {
  status: number;
  body: string;
  code: string;
  message: string;
} | null {
  return parseHttpFailure(error);
}

export function resolveUpstreamStatus(input: {
  status: number;
  body: string;
  message: string;
}): number {
  if (input.status !== 502) {
    return input.status;
  }

  const wrapped = resolveStatusFromText(input.message);
  if (wrapped !== null) {
    return wrapped;
  }
  const fromBody = resolveStatusFromText(input.body);
  if (fromBody !== null) {
    return fromBody;
  }
  return input.status;
}

function resolveStatusFromText(value: string): number | null {
  const match = HTTP_STATUS_IN_TEXT_REGEX.exec(value.trim());
  if (!match) {
    return null;
  }
  const status = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(status) ? status : null;
}

export function readHttpErrorField(
  payload: unknown,
  field: "code" | "message"
): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload as {
    code?: unknown;
    message?: unknown;
    error?: { code?: unknown; message?: unknown } | null;
  };
  if (typeof record[field] === "string") {
    return record[field];
  }
  if (record.error && typeof record.error[field] === "string") {
    return record.error[field] ?? "";
  }
  return "";
}

export function readHttpRequestId(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const record = payload as {
    requestId?: unknown;
    error?: { requestId?: unknown } | null;
  };
  if (typeof record.requestId === "string") {
    return record.requestId;
  }
  if (record.error && typeof record.error.requestId === "string") {
    return record.error.requestId;
  }
  return "";
}

export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
