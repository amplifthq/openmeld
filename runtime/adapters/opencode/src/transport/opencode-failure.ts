import type {
  AdapterErrorType,
  AdapterProviderAccessEvidence,
} from "@openmeld/adapter-core";
import {
  classifyRuntimePermissionDenialMessage,
  createProviderOriginalError,
} from "@openmeld/adapter-core";

export function classifyOpenCodeFailureMessage(input: {
  includeOriginalError?: boolean;
  isContextLost: (message: string) => boolean;
  message: string;
}): {
  code: string;
  errorType: AdapterErrorType;
  message: string;
  originalError?: string;
  providerAccessEvidence?: AdapterProviderAccessEvidence;
} {
  const normalized = input.message.trim();
  const lowered = normalized.toLowerCase();
  const originalError = input.includeOriginalError
    ? createProviderOriginalError(normalized)
    : null;
  const withOriginalError = <T extends object>(
    value: T
  ): T & {
    originalError?: string;
  } => ({
    ...value,
    ...(originalError ? { originalError } : {}),
  });

  const permissionDenial = classifyRuntimePermissionDenialMessage({
    message: normalized,
    source: "opencode",
  });
  if (permissionDenial) {
    return withOriginalError(permissionDenial);
  }

  if (input.isContextLost(normalized)) {
    return withOriginalError({
      code: "context.lost",
      errorType: "adapter",
      message: `context.lost: ${normalized}`,
    });
  }

  if (
    lowered.includes("not logged in") ||
    lowered.includes("unauthorized") ||
    lowered.includes("authentication") ||
    lowered.includes("credentials")
  ) {
    return withOriginalError({
      code: "auth.required",
      errorType: "auth",
      message: `auth.required: ${normalized}`,
    });
  }

  if (
    lowered.includes("unsupported model") ||
    lowered.includes("model is not supported") ||
    lowered.includes("invalid model") ||
    lowered.includes("model not found")
  ) {
    return withOriginalError({
      code: "model.unsupported",
      errorType: "config",
      message: `model.unsupported: ${normalized}`,
    });
  }

  if (isInsufficientBalanceFailure(lowered)) {
    return withOriginalError({
      code: "provider.insufficient_balance",
      errorType: "adapter",
      message: `provider.insufficient_balance: ${normalized}`,
      providerAccessEvidence: buildProviderAccessEvidence(
        "provider_account.capacity_exhausted"
      ),
    });
  }

  if (isDefinitiveHardQuotaFailure(lowered)) {
    return withOriginalError({
      code: "quota.exceeded",
      errorType: "adapter",
      message: `quota.exceeded: ${normalized}`,
      providerAccessEvidence: buildProviderAccessEvidence(
        "provider_account.capacity_exhausted"
      ),
    });
  }

  if (isTransientRateLimitFailure(lowered)) {
    return withOriginalError({
      code: "provider.rate_limited",
      errorType: "network",
      message: `provider.rate_limited: ${normalized}`,
    });
  }

  if (isSubscriptionAccessFailure(lowered)) {
    return withOriginalError({
      code: "provider.subscription_access_unavailable",
      errorType: "adapter",
      message: `provider.subscription_access_unavailable: ${normalized}`,
      providerAccessEvidence: buildProviderAccessEvidence(
        "provider_account.subscription_access_unavailable"
      ),
    });
  }

  if (isProviderUnavailableFailure(lowered)) {
    return withOriginalError({
      code: "provider.unavailable",
      errorType: "network",
      message: `provider.unavailable: ${normalized}`,
    });
  }

  if (isHardQuotaFailure(lowered)) {
    return withOriginalError({
      code: "quota.exceeded",
      errorType: "adapter",
      message: `quota.exceeded: ${normalized}`,
      providerAccessEvidence: buildProviderAccessEvidence(
        "provider_account.capacity_exhausted"
      ),
    });
  }

  return withOriginalError({
    code: "upstream_unreachable",
    errorType: "adapter",
    message: `upstream_unreachable: ${normalized}`,
  });
}

function buildProviderAccessEvidence(
  reasonCode: AdapterProviderAccessEvidence["reasonCode"]
): AdapterProviderAccessEvidence {
  return {
    observedAtMs: Date.now(),
    provider: "opencode",
    reasonCode,
    source: "wake_failure",
  };
}

function isHardQuotaFailure(value: string): boolean {
  return (
    isDefinitiveHardQuotaFailure(value) ||
    value.includes("usage limit") ||
    value.includes("usage_limit")
  );
}

function isDefinitiveHardQuotaFailure(value: string): boolean {
  return (
    value.includes("insufficient quota") ||
    value.includes("insufficient_quota") ||
    value.includes("quota exceeded") ||
    value.includes("exceeded your current quota")
  );
}

function isSubscriptionAccessFailure(value: string): boolean {
  return (
    value.includes("not included in your subscription") ||
    value.includes("not available on your plan") ||
    value.includes("subscription does not include") ||
    value.includes("subscription access") ||
    value.includes("upgrade your plan")
  );
}

function isTransientRateLimitFailure(value: string): boolean {
  return (
    value.includes("429") ||
    value.includes("rate limit") ||
    value.includes("too many requests")
  );
}

function isInsufficientBalanceFailure(value: string): boolean {
  return (
    value.includes("insufficient balance") ||
    value.includes("insufficient_balance") ||
    value.includes("not enough credits") ||
    value.includes("out of credits") ||
    value.includes("credits exhausted") ||
    value.includes("credit balance") ||
    value.includes("account balance") ||
    value.includes("balance is too low") ||
    value.includes("payment required")
  );
}

function isProviderUnavailableFailure(value: string): boolean {
  return (
    value.includes("bad gateway") ||
    value.includes("gateway timeout") ||
    value.includes("service unavailable") ||
    value.includes("provider unavailable") ||
    value.includes("socket hang up") ||
    value.includes("econnreset") ||
    value.includes("etimedout")
  );
}
