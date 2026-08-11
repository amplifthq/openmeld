import type { AdapterErrorType } from "@openmeld/adapter-core";
import { classifyRuntimePermissionDenialMessage } from "@openmeld/adapter-core";

export function classifyOpenCodeFailureMessage(input: {
  isContextLost: (message: string) => boolean;
  message: string;
}): {
  code: string;
  errorType: AdapterErrorType;
  message: string;
} {
  const normalized = input.message.trim();
  const lowered = normalized.toLowerCase();

  const permissionDenial = classifyRuntimePermissionDenialMessage({
    message: normalized,
    source: "opencode",
  });
  if (permissionDenial) {
    return permissionDenial;
  }

  if (input.isContextLost(normalized)) {
    return {
      code: "context.lost",
      errorType: "adapter",
      message: `context.lost: ${normalized}`,
    };
  }

  if (
    lowered.includes("not logged in") ||
    lowered.includes("unauthorized") ||
    lowered.includes("authentication") ||
    lowered.includes("credentials")
  ) {
    return {
      code: "auth.required",
      errorType: "auth",
      message: `auth.required: ${normalized}`,
    };
  }

  if (
    lowered.includes("unsupported model") ||
    lowered.includes("model is not supported") ||
    lowered.includes("invalid model") ||
    lowered.includes("model not found")
  ) {
    return {
      code: "model.unsupported",
      errorType: "config",
      message: `model.unsupported: ${normalized}`,
    };
  }

  if (isInsufficientBalanceFailure(lowered)) {
    return {
      code: "provider.insufficient_balance",
      errorType: "adapter",
      message: `provider.insufficient_balance: ${normalized}`,
    };
  }

  if (isProviderUnavailableFailure(lowered)) {
    return {
      code: "provider.unavailable",
      errorType: "network",
      message: `provider.unavailable: ${normalized}`,
    };
  }

  if (lowered.includes("rate") || lowered.includes("quota")) {
    return {
      code: "provider.rate_limited",
      errorType: "network",
      message: `provider.rate_limited: ${normalized}`,
    };
  }

  return {
    code: "upstream_unreachable",
    errorType: "adapter",
    message: `upstream_unreachable: ${normalized}`,
  };
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
