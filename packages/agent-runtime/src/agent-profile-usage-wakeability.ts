import { AGENT_CONTROLLER_USAGE_LIMIT_STALE_AFTER_MS } from "@openmeld/schemas";
import type { AgentControllerUsageLimit } from "@openmeld/schemas/types";
import type { RuntimeAgentControllerReportStatus } from "./runtime-registry-contract";

export const AGENT_PROFILE_USAGE_EXHAUSTED_REASON_CODE =
  "usage_exhausted" as const;

export type AgentProfileUsageWakeabilityReport = {
  expiresAtMs: number;
  status: RuntimeAgentControllerReportStatus;
  usageLimits?: readonly AgentControllerUsageLimit[];
};

export type AgentProfileUsageWakeability =
  | { blocksNewWork: true; reasonCode: "usage_exhausted" }
  | { blocksNewWork: false; reasonCode: null };

export type AgentProfileUsageRecoveryAvailability = {
  available: boolean;
};

export function resolveAgentProfileUsageWakeability(input: {
  nowMs: number;
  report?: AgentProfileUsageWakeabilityReport | null;
}): AgentProfileUsageWakeability {
  const report = input.report;
  if (
    !report ||
    report.status !== "ready" ||
    report.expiresAtMs <= input.nowMs
  ) {
    return ALLOWS_NEW_WORK;
  }

  const usageExhausted = report.usageLimits?.some((usageLimit) =>
    isReliableFreshExhaustedUsage({
      nowMs: input.nowMs,
      usageLimit,
    })
  );
  return usageExhausted
    ? {
        blocksNewWork: true,
        reasonCode: AGENT_PROFILE_USAGE_EXHAUSTED_REASON_CODE,
      }
    : ALLOWS_NEW_WORK;
}

export function resolveAgentProfileUsageRecoveryAvailability(input: {
  nowMs: number;
  report?: AgentProfileUsageWakeabilityReport | null;
}): AgentProfileUsageRecoveryAvailability {
  const report = input.report;
  if (
    !report ||
    report.status !== "ready" ||
    report.expiresAtMs <= input.nowMs ||
    !report.usageLimits?.length
  ) {
    return USAGE_RECOVERY_UNAVAILABLE;
  }

  return report.usageLimits.every((usageLimit) =>
    isReliableFreshAvailableUsage({ nowMs: input.nowMs, usageLimit })
  )
    ? USAGE_RECOVERY_AVAILABLE
    : USAGE_RECOVERY_UNAVAILABLE;
}

const ALLOWS_NEW_WORK = {
  blocksNewWork: false,
  reasonCode: null,
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
