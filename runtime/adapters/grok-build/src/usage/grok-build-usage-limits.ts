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
  const usedPercent = readUsedPercent(config?.creditUsagePercent);
  if (usedPercent === null) {
    return createUnavailableProviderUsageLimits(input.observedAt);
  }

  const currentPeriod = toRecord(config?.currentPeriod);
  return [
    {
      key: GROK_BUILD_USAGE_LIMIT_KEY,
      label: resolvePeriodLabel(currentPeriod?.type),
      observedAt: input.observedAt,
      resetsAt: readResetTime(currentPeriod?.end),
      status: usedPercent === 100 ? "exhausted" : "available",
      usedPercent,
    },
  ];
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
