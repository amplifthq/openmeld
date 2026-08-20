import type { AdapterProviderUsageLimit } from "@openmeld/adapter-core";

const SECONDS_PER_MILLISECOND = 1000;

const WINDOW_DISPLAY_BY_TYPE = {
  five_hour: {
    key: "claude-code:five-hour",
    label: "5-hour usage limit",
  },
  seven_day: {
    key: "claude-code:seven-day",
    label: "Weekly usage limit",
  },
  seven_day_opus: {
    key: "claude-code:seven-day-opus",
    label: "Opus weekly usage limit",
  },
  seven_day_sonnet: {
    key: "claude-code:seven-day-sonnet",
    label: "Sonnet weekly usage limit",
  },
} as const;

type SupportedClaudeRateLimitType = keyof typeof WINDOW_DISPLAY_BY_TYPE;

export function projectClaudeCodeUsageLimits(input: {
  event: unknown;
  observedAt: string;
}): AdapterProviderUsageLimit[] {
  const event = toRecord(input.event);
  if (event?.type !== "rate_limit_event") {
    return [];
  }

  const info = toRecord(event.rate_limit_info);
  const rateLimitType = readRateLimitType(info?.rateLimitType);
  if (!rateLimitType) {
    return [];
  }

  const usedPercent = readUsedPercent(info?.utilization);
  const providerStatus = readProviderStatus(info?.status);
  if (usedPercent === null && providerStatus !== "rejected") {
    return [];
  }

  const display = WINDOW_DISPLAY_BY_TYPE[rateLimitType];
  return [
    {
      key: display.key,
      label: display.label,
      observedAt: input.observedAt,
      resetsAt: readResetTime(info?.resetsAt),
      status:
        providerStatus === "rejected" || usedPercent === 100
          ? "exhausted"
          : "available",
      usedPercent,
    },
  ];
}

function readRateLimitType(
  value: unknown
): SupportedClaudeRateLimitType | null {
  return typeof value === "string" && value in WINDOW_DISPLAY_BY_TYPE
    ? (value as SupportedClaudeRateLimitType)
    : null;
}

function readProviderStatus(
  value: unknown
): "allowed" | "allowed_warning" | "rejected" | null {
  return value === "allowed" ||
    value === "allowed_warning" ||
    value === "rejected"
    ? value
    : null;
}

function readUsedPercent(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    return null;
  }
  return value * 100;
}

function readResetTime(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const date = new Date(value * SECONDS_PER_MILLISECOND);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
