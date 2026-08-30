import type {
  AdapterErrorType,
  AdapterProviderAccessEvidence,
} from "@openmeld/adapter-core";
import { createProviderOriginalError } from "@openmeld/adapter-core";

export type CodexProviderFailureClassification = {
  code: string;
  errorType: AdapterErrorType;
  originalError?: string;
  providerAccessEvidence?: AdapterProviderAccessEvidence;
};

/**
 * Codex provider-account failure classification shared by the CLI and
 * app-server transports so both surface the same `usage_exhausted` /
 * `rate_limited` / `auth.required` codes for the same provider failure.
 *
 * Wording covers both the ChatGPT-subscription Codex ("You've hit your usage
 * limit … purchase more credits") and API-key billing wording. Captured real
 * responses:
 * - app-server turn.error: `{ message: "You've hit your usage limit. …", codexErrorInfo: "usageLimitExceeded" }`
 * - exec turn.failed: `{ error: { message: "You've hit your usage limit. …" } }`
 */
export function isCodexUsageExhaustedFailure(value: string): boolean {
  return (
    value.includes("usage limit") ||
    value.includes("purchase more credits") ||
    value.includes("insufficient_quota") ||
    value.includes("insufficient balance") ||
    value.includes("insufficient_balance") ||
    value.includes("quota exceeded") ||
    value.includes("exceeded your current quota") ||
    value.includes("not enough credits") ||
    value.includes("out of credits") ||
    value.includes("credits exhausted") ||
    value.includes("balance is too low") ||
    value.includes("payment required") ||
    value.includes("billing")
  );
}

export function isCodexRateLimitFailure(value: string): boolean {
  return (
    value.includes("429") ||
    value.includes("rate limit") ||
    value.includes("too many requests")
  );
}

export function isCodexAuthFailure(value: string): boolean {
  return (
    value.includes("401") ||
    value.includes("unauthorized") ||
    value.includes("missing bearer") ||
    value.includes("not logged in") ||
    value.includes("authentication")
  );
}

export function isCodexSubscriptionAccessFailure(value: string): boolean {
  return (
    value.includes("not included in your subscription") ||
    value.includes("not available on your plan") ||
    value.includes("subscription does not include") ||
    value.includes("subscription access") ||
    value.includes("upgrade your plan")
  );
}

/**
 * Classify a Codex provider-account failure from the failure message and, when
 * available, the app-server structured `codexErrorInfo` enum. Only enum values
 * proven from a real app-server capture are mapped; unknown enum values fall
 * through to message-based classification so an unverified enum never silently
 * changes behavior.
 */
export function classifyCodexProviderAccountFailure(input: {
  message: string;
  codexErrorInfo?: string | null;
}): CodexProviderFailureClassification | null {
  const codexErrorInfo = normalizeOptionalText(
    input.codexErrorInfo
  )?.toLowerCase();
  if (codexErrorInfo === "usagelimitexceeded") {
    return buildHardProviderFailure({
      code: "usage_exhausted",
      originalError: createProviderOriginalError(input.message),
      reasonCode: "usage_exhausted",
    });
  }

  const lowered = input.message.toLowerCase();
  if (isCodexRateLimitFailure(lowered)) {
    return withOriginalError(
      { code: "rate_limited", errorType: "adapter" },
      input.message
    );
  }
  if (isCodexSubscriptionAccessFailure(lowered)) {
    return buildHardProviderFailure({
      code: "provider.subscription_access_unavailable",
      originalError: createProviderOriginalError(input.message),
      reasonCode: "provider_account.subscription_access_unavailable",
    });
  }
  if (isCodexUsageExhaustedFailure(lowered)) {
    return withOriginalError(
      { code: "usage_exhausted", errorType: "adapter" },
      input.message
    );
  }
  if (isCodexAuthFailure(lowered)) {
    return withOriginalError(
      { code: "auth.required", errorType: "auth" },
      input.message
    );
  }
  return null;
}

function buildHardProviderFailure(input: {
  code: string;
  originalError: string | null;
  reasonCode: AdapterProviderAccessEvidence["reasonCode"];
}): CodexProviderFailureClassification {
  return {
    code: input.code,
    errorType: "adapter",
    ...(input.originalError ? { originalError: input.originalError } : {}),
    providerAccessEvidence: {
      observedAtMs: Date.now(),
      provider: "codex",
      reasonCode: input.reasonCode,
      source: "wake_failure",
    },
  };
}

function withOriginalError(
  classification: CodexProviderFailureClassification,
  message: string
): CodexProviderFailureClassification {
  const originalError = createProviderOriginalError(message);
  return {
    ...classification,
    ...(originalError ? { originalError } : {}),
  };
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
