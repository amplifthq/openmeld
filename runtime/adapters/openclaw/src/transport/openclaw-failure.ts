import type { AdapterErrorType } from "@openmeld/adapter-core";
import {
  classifyRuntimePermissionDenialMessage,
  createProviderOriginalError,
} from "@openmeld/adapter-core";

export type OpenClawFailureClassification = {
  code: string;
  errorType: AdapterErrorType;
  message: string;
  originalError?: string;
};

const HTTP_401_TOKEN_RE = /\b401\b/;
const HTTP_429_TOKEN_RE = /\b429\b/;

export function classifyOpenClawFailureMessage(input: {
  includeOriginalError?: boolean;
  message: string;
  isContextLost?: (message: string) => boolean;
}): OpenClawFailureClassification {
  const normalizedMessage =
    normalizeOpenClawFailureMessage(input.message) ?? "openclaw command failed";
  const lowered = normalizedMessage.toLowerCase();
  const originalError = input.includeOriginalError
    ? createProviderOriginalError(normalizedMessage)
    : null;
  const withOriginalError = (
    value: OpenClawFailureClassification
  ): OpenClawFailureClassification => ({
    ...value,
    ...(originalError ? { originalError } : {}),
  });

  const permissionDenial = classifyRuntimePermissionDenialMessage({
    message: normalizedMessage,
    source: "openclaw",
  });
  if (permissionDenial) {
    return withOriginalError(permissionDenial);
  }

  if (isUnsupportedModelFailure(lowered)) {
    return withOriginalError({
      code: "model.unsupported",
      errorType: "config",
      message: normalizedMessage,
    });
  }
  if (isAuthFailure(lowered)) {
    return withOriginalError({
      code: "auth.required",
      errorType: "auth",
      message: normalizedMessage,
    });
  }
  if (isQuotaFailure(lowered)) {
    return withOriginalError({
      code: "quota.exceeded",
      errorType: "adapter",
      message: normalizedMessage,
    });
  }
  if (isRateLimitFailure(lowered)) {
    return withOriginalError({
      code: "rate_limited",
      errorType: "adapter",
      message: normalizedMessage,
    });
  }
  if (input.isContextLost?.(normalizedMessage)) {
    return withOriginalError({
      code: "context.lost",
      errorType: "adapter",
      message: normalizedMessage,
    });
  }
  if (isInputSelectorFailure(lowered)) {
    return withOriginalError({
      code: "schema.invalid",
      errorType: "config",
      message: normalizedMessage,
    });
  }
  return withOriginalError({
    code: "upstream_unreachable",
    errorType: "adapter",
    message: normalizedMessage,
  });
}

export function normalizeOpenClawFailureMessage(
  value: string | null | undefined
): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }

  return extractJsonFailureDetail(normalized) ?? normalized;
}

function extractJsonFailureDetail(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    return (
      normalizeOptionalText(record.detail) ??
      normalizeOptionalText(record.message) ??
      (record.error &&
      typeof record.error === "object" &&
      !Array.isArray(record.error)
        ? normalizeOptionalText(
            (record.error as Record<string, unknown>).message
          )
        : null)
    );
  } catch {
    return null;
  }
}

function isUnsupportedModelFailure(value: string): boolean {
  return (
    (value.includes("model is not supported") &&
      value.includes("chatgpt account")) ||
    value.includes("unsupported model")
  );
}

function isAuthFailure(value: string): boolean {
  return (
    value.includes("not logged in") ||
    value.includes("please run /login") ||
    value.includes("authentication_failed") ||
    value.includes("unauthorized") ||
    HTTP_401_TOKEN_RE.test(value) ||
    value.includes("api key") ||
    value.includes("missing credentials") ||
    value.includes("missing token")
  );
}

function isQuotaFailure(value: string): boolean {
  return (
    value.includes("insufficient_quota") ||
    value.includes("insufficient balance") ||
    value.includes("insufficient_balance") ||
    value.includes("quota exceeded") ||
    value.includes("not enough credits") ||
    value.includes("out of credits") ||
    value.includes("credits exhausted") ||
    value.includes("balance is too low") ||
    value.includes("billing") ||
    value.includes("payment required")
  );
}

function isRateLimitFailure(value: string): boolean {
  return (
    value.includes("rate limit") ||
    value.includes("too many requests") ||
    HTTP_429_TOKEN_RE.test(value) ||
    value.includes("throttl")
  );
}

function isInputSelectorFailure(value: string): boolean {
  return (
    (value.includes("pass --to") &&
      value.includes("--session-id") &&
      value.includes("--agent")) ||
    value.includes("unknown agent") ||
    value.includes("agent not found")
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}
