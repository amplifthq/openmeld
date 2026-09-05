import type { AdapterProviderUsageLimit } from "@openmeld/adapter-core";

const SECONDS_PER_MILLISECOND = 1000;

const SUPPORTED_RATE_LIMIT_TYPES = [
  "five_hour",
  "seven_day",
  "seven_day_opus",
  "seven_day_sonnet",
] as const;

type SupportedClaudeRateLimitType = (typeof SUPPORTED_RATE_LIMIT_TYPES)[number];

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
} as const satisfies Record<
  SupportedClaudeRateLimitType,
  { key: string; label: string }
>;

export function projectClaudeCodeUsageLimits(input: {
  event: unknown;
  observedAt: string;
}): AdapterProviderUsageLimit[] {
  const event = toRecord(input.event);
  if (event?.type !== "rate_limit_event") {
    return [];
  }

  const info = toRecord(event.rate_limit_info);
  if (!info) {
    return [];
  }

  const unifiedWindows = toRecord(info.unifiedWindows);
  const unifiedLimits = unifiedWindows
    ? SUPPORTED_RATE_LIMIT_TYPES.flatMap((rateLimitType) =>
        projectUsageLimit({
          observedAt: input.observedAt,
          rateLimitType,
          window: toRecord(unifiedWindows[rateLimitType]),
        })
      )
    : [];
  if (unifiedLimits.length > 0) {
    return unifiedLimits;
  }

  const rateLimitType = readRateLimitType(info?.rateLimitType);
  if (!rateLimitType) {
    return [];
  }

  return projectUsageLimit({
    observedAt: input.observedAt,
    rateLimitType,
    window: info,
  });
}

function projectUsageLimit(input: {
  observedAt: string;
  rateLimitType: SupportedClaudeRateLimitType;
  window: Record<string, unknown> | null;
}): AdapterProviderUsageLimit[] {
  const usedPercent = readUsedPercent(input.window?.utilization);
  if (usedPercent === null) {
    return [];
  }

  const display = WINDOW_DISPLAY_BY_TYPE[input.rateLimitType];
  return [
    {
      key: display.key,
      label: display.label,
      observedAt: input.observedAt,
      resetsAt: readResetTime(input.window?.resetsAt),
      status: usedPercent === 100 ? "exhausted" : "available",
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

function readUsedPercent(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    return null;
  }
  return Number((value * 100).toFixed(12));
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
