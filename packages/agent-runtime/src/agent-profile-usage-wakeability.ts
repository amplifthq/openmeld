import { AGENT_CONTROLLER_USAGE_LIMIT_STALE_AFTER_MS } from "@openmeld/schemas";
import type { AgentControllerUsageLimit } from "@openmeld/schemas/types";
import {
  AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
  resolveAgentControllerUsageLimitSupport,
} from "./agent-controller-usage-limit-support";
import type { RuntimeAgentControllerReportStatus } from "./runtime-registry-contract";

export const AGENT_PROFILE_USAGE_EXHAUSTED_REASON_CODE =
  "usage_exhausted" as const;
export const AGENT_PROFILE_USAGE_CHECKING_REASON_CODE =
  "usage_checking" as const;

export type AgentProfileUsageWakeabilityReport = {
  expiresAtMs: number;
  status: RuntimeAgentControllerReportStatus;
  usageLimits?: readonly AgentControllerUsageLimit[];
  usageLimitsSupportMatrixVersion?: number;
};

export type AgentProfileUsageWakeability =
  | {
      blocksNewWork: true;
      reasonCode: "usage_exhausted";
      status: "unavailable";
    }
  | {
      blocksNewWork: true;
      reasonCode: "usage_checking";
      status: "checking";
    }
  | { blocksNewWork: false; reasonCode: null; status: "available" };

export type AgentProfileUsageRecoveryAvailability = {
  available: boolean;
};

export function resolveAgentProfileUsageWakeability(input: {
  agentControllerRef: string;
  nowMs: number;
  report?: AgentProfileUsageWakeabilityReport | null;
}): AgentProfileUsageWakeability {
  if (
    resolveAgentControllerUsageLimitSupport(input.agentControllerRef) !==
    "native"
  ) {
    return ALLOWS_NEW_WORK;
  }
  const report = input.report;
  if (!report) {
    return CHECKING_USAGE;
  }
  const supportedUsageLimits = report.usageLimits?.filter(
    (usageLimit) => usageLimit.status !== "unsupported"
  );
  if (report.usageLimits?.length && !supportedUsageLimits?.length) {
    return ALLOWS_NEW_WORK;
  }
  if (!supportedUsageLimits?.length) {
    return report.usageLimitsSupportMatrixVersion ===
      AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION
      ? CHECKING_USAGE
      : ALLOWS_NEW_WORK;
  }

  if (report.status !== "ready" || report.expiresAtMs <= input.nowMs) {
    return CHECKING_USAGE;
  }

  const usageExhausted = supportedUsageLimits.some((usageLimit) =>
    isReliableFreshExhaustedUsage({
      nowMs: input.nowMs,
      usageLimit,
    })
  );
  if (usageExhausted) {
    return {
      blocksNewWork: true,
      reasonCode: AGENT_PROFILE_USAGE_EXHAUSTED_REASON_CODE,
      status: "unavailable",
    };
  }
  const allSupportedUsageAvailable = supportedUsageLimits.every((usageLimit) =>
    isReliableFreshAvailableUsage({
      nowMs: input.nowMs,
      usageLimit,
    })
  );
  return allSupportedUsageAvailable ? ALLOWS_NEW_WORK : CHECKING_USAGE;
}

export function resolveAgentProfileUsageRecoveryAvailability(input: {
  agentControllerRef: string;
  nowMs: number;
  report?: AgentProfileUsageWakeabilityReport | null;
}): AgentProfileUsageRecoveryAvailability {
  if (
    resolveAgentControllerUsageLimitSupport(input.agentControllerRef) !==
    "native"
  ) {
    return USAGE_RECOVERY_UNAVAILABLE;
  }
  const report = input.report;
  const supportedUsageLimits = report?.usageLimits?.filter(
    (usageLimit) => usageLimit.status !== "unsupported"
  );
  if (
    !report ||
    report.status !== "ready" ||
    report.expiresAtMs <= input.nowMs ||
    !supportedUsageLimits?.length
  ) {
    return USAGE_RECOVERY_UNAVAILABLE;
  }

  return supportedUsageLimits.every((usageLimit) =>
    isReliableFreshAvailableUsage({ nowMs: input.nowMs, usageLimit })
  )
    ? USAGE_RECOVERY_AVAILABLE
    : USAGE_RECOVERY_UNAVAILABLE;
}

const ALLOWS_NEW_WORK = {
  blocksNewWork: false,
  reasonCode: null,
  status: "available",
} as const;
const CHECKING_USAGE = {
  blocksNewWork: true,
  reasonCode: AGENT_PROFILE_USAGE_CHECKING_REASON_CODE,
  status: "checking",
} as const;
const USAGE_RECOVERY_AVAILABLE = { available: true } as const;
const USAGE_RECOVERY_UNAVAILABLE = { available: false } as const;

function isReliableFreshAvailableUsage(input: {
  nowMs: number;
  usageLimit: AgentControllerUsageLimit;
}): boolean {
  return (
    input.usageLimit.status === "available" && isFreshCurrentUsageLimit(input)
  );
}

function isReliableFreshExhaustedUsage(input: {
  nowMs: number;
  usageLimit: AgentControllerUsageLimit;
}): boolean {
  if (input.usageLimit.status !== "exhausted") {
    return false;
  }

  return isFreshCurrentUsageLimit(input);
}

function isFreshCurrentUsageLimit(input: {
  nowMs: number;
  usageLimit: AgentControllerUsageLimit;
}): boolean {
  const observedAtMs = Date.parse(input.usageLimit.observedAt);
  if (
    !Number.isFinite(observedAtMs) ||
    observedAtMs + AGENT_CONTROLLER_USAGE_LIMIT_STALE_AFTER_MS <= input.nowMs
  ) {
    return false;
  }

  const resetsAtMs = input.usageLimit.resetsAt
    ? Date.parse(input.usageLimit.resetsAt)
    : null;
  return (
    resetsAtMs === null ||
    (Number.isFinite(resetsAtMs) && resetsAtMs > input.nowMs)
  );
}
