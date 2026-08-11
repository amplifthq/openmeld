import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import { GatewayHttpError } from "./gateway-response";

const HTTP_ERROR_MESSAGE_REGEX = /^HTTP\s+(\d{3})\s*:\s*([\s\S]*)$/i;
const MIN_HTTP_STATUS = 100;
const MAX_HTTP_STATUS = 599;

export type ParsedHttpFailure = {
  status: number;
  body: string;
  code: string;
  message: string;
  upstreamCode: string | null;
};

export function parseHttpFailure(error: unknown): ParsedHttpFailure | null {
  if (
    error instanceof OpenMeldApiClientHttpError ||
    error instanceof GatewayHttpError
  ) {
    const payload = safeJsonParse(error.rawBody);
    const body = error.rawBody;
    return {
      status: error.status,
      body,
      code: resolveHttpErrorCode(payload, error.code),
      message: resolveHttpErrorMessage(payload, error.message),
      upstreamCode: resolveHttpErrorField(payload, "upstreamCode") ?? null,
    };
  }

  const rawMessage = toErrorMessage(error);
  const match = HTTP_ERROR_MESSAGE_REGEX.exec(rawMessage.trim());
  if (!match) {
    return null;
  }

  const status = Number.parseInt(match[1] ?? "", 10);
  if (
    !Number.isFinite(status) ||
    status < MIN_HTTP_STATUS ||
    status > MAX_HTTP_STATUS
  ) {
    return null;
  }

  const body = match[2] ?? "";
  const payload = safeJsonParse(body);
  return {
    status,
    body,
    code: resolveHttpErrorCode(payload),
    message: resolveHttpErrorMessage(payload),
    upstreamCode: resolveHttpErrorField(payload, "upstreamCode") ?? null,
  };
}

function resolveHttpErrorField(
  payload: unknown,
  field: "code" | "message" | "upstreamCode"
): string | null {
  return normalizeOptionalText(readHttpErrorField(payload, field));
}

function resolveHttpErrorCode(payload: unknown, fallback?: string): string {
  return resolveHttpErrorField(payload, "code") ?? fallback ?? "";
}

function resolveHttpErrorMessage(payload: unknown, fallback?: string): string {
  return resolveHttpErrorField(payload, "message") ?? fallback ?? "";
}

function readHttpErrorField(
  payload: unknown,
  field: "code" | "message" | "upstreamCode"
): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as {
    code?: unknown;
    message?: unknown;
    upstreamCode?: unknown;
    error?: {
      code?: unknown;
      message?: unknown;
      upstreamCode?: unknown;
    } | null;
  };

  if (typeof record[field] === "string") {
    return record[field];
  }

  if (record.error && typeof record.error[field] === "string") {
    return record.error[field] ?? "";
  }

  return "";
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
