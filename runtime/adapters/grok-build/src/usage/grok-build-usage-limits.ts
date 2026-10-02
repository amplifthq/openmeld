import {
  type AdapterProviderUsageLimit,
  createUnavailableProviderUsageLimits,
} from "@openmeld/adapter-core";

const GROK_BUILD_USAGE_LIMIT_KEY = "grok-build:included-credits";

export function projectGrokBuildUsageLimits(input: {
  observedAt: string;
  response: unknown;
}): AdapterProviderUsageLimit[] {
  const config = toRecord(toRecord(input.response)?.config);
  const currentPeriod = toRecord(config?.currentPeriod);
  const resetsAt = readResetTime(currentPeriod?.end);
  // Grok's proto3 float has implicit presence: a validated active unified
  // billing period omits creditUsagePercent when its value is zero.
  const usedPercent =
    config &&
    !("creditUsagePercent" in config) &&
    config.isUnifiedBillingUser === true &&
    isActiveBillingPeriod(currentPeriod, input.observedAt)
      ? 0
      : readUsedPercent(config?.creditUsagePercent);
  if (usedPercent === null) {
    return createUnavailableProviderUsageLimits(input.observedAt, undefined, {
      reason: "not_reported",
      resetsAt,
    });
  }

  return [
    {
      key: GROK_BUILD_USAGE_LIMIT_KEY,
      label: resolvePeriodLabel(currentPeriod?.type),
      observedAt: input.observedAt,
      resetsAt,
      status: usedPercent === 100 ? "exhausted" : "available",
      usedPercent,
    },
  ];
}

function isActiveBillingPeriod(
  period: Record<string, unknown> | null,
  observedAt: string
): boolean {
  const start = readResetTime(period?.start);
  const end = readResetTime(period?.end);
  const type =
    typeof period?.type === "string" ? period.type.toLowerCase() : "";
  const knownType = [
    "weekly",
    "monthly",
    "usage_period_type_weekly",
    "usage_period_type_monthly",
  ].includes(type);
  const nowMs = Date.parse(observedAt);
  return Boolean(
    knownType &&
      start &&
      end &&
      Number.isFinite(nowMs) &&
      Date.parse(start) <= nowMs &&
      nowMs < Date.parse(end)
  );
}

function readUsedPercent(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
    ? value
    : null;
}

function readResetTime(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function resolvePeriodLabel(value: unknown): string {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized === "weekly" || normalized === "usage_period_type_weekly") {
    return "Weekly usage limit";
  }
  if (normalized === "monthly" || normalized === "usage_period_type_monthly") {
    return "Monthly usage limit";
  }
  return "Included credits";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
