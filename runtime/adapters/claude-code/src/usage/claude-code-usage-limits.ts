import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { AdapterProviderUsageLimit } from "@openmeld/adapter-core";
import { createUnavailableProviderUsageLimits } from "@openmeld/adapter-core";

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

// The SDK account endpoint reports percentages; stream events report fractions.
// Keep these contracts separate to avoid turning 0.9% into 90%.
export function projectClaudeCodeAccountUsageLimits(input: {
  value: SDKControlGetUsageResponse;
  observedAt: string;
}): AdapterProviderUsageLimit[] {
  if (input.value.rate_limits_available === false) {
    return createUnavailableProviderUsageLimits(input.observedAt, undefined, {
      reason: "not_applicable",
    });
  }
  if (input.value.rate_limits_available !== true) {
    return createUnavailableProviderUsageLimits(input.observedAt, undefined, {
      reason: "not_reported",
    });
  }
  const windows = input.value.rate_limits;
  const limits: AdapterProviderUsageLimit[] = [];
  const addWindow = (
    key: string,
    label: string,
    window:
      | { utilization: number | null; resets_at: string | null }
      | null
      | undefined
  ) => {
    if (
      !window ||
      limits.length >= 32 ||
      limits.some((limit) => limit.key === key)
    ) {
      return;
    }
    const value = window.utilization;
    const usedPercent =
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 100
        ? value
        : null;
    const resetMs = window.resets_at
      ? Date.parse(window.resets_at)
      : Number.NaN;
    let status: AdapterProviderUsageLimit["status"] = "unavailable";
    if (usedPercent !== null) {
      status = usedPercent === 100 ? "exhausted" : "available";
    }
    limits.push({
      key,
      label,
      observedAt: input.observedAt,
      resetsAt: Number.isFinite(resetMs)
        ? new Date(resetMs).toISOString()
        : null,
      usedPercent,
      status,
      ...(usedPercent === null ? { reason: "not_reported" as const } : {}),
    });
  };
  for (const type of SUPPORTED_RATE_LIMIT_TYPES) {
    const display = WINDOW_DISPLAY_BY_TYPE[type];
    addWindow(display.key, display.label, windows?.[type]);
  }
  addWindow(
    "claude-code:seven-day-oauth-apps",
    "OAuth apps weekly usage limit",
    windows?.seven_day_oauth_apps
  );
  for (const window of windows?.model_scoped ?? []) {
    const name = window.display_name?.trim();
    if (!name || name.length > 200) {
      continue;
    }
    const key = `claude-code:seven-day-${encodeURIComponent(name.toLowerCase())}`;
    if (key.length <= 256) {
      addWindow(key, `${name} weekly usage limit`, window);
    }
  }
  return limits.length > 0
    ? limits
    : createUnavailableProviderUsageLimits(input.observedAt, undefined, {
        reason: "not_reported",
      });
}

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
