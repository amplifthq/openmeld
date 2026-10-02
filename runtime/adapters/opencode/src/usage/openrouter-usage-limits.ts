import {
  type AdapterProviderUsageLimit,
  createUnavailableProviderUsageLimits,
} from "@openmeld/adapter-core";

const PROVIDER = { id: "openrouter", displayName: "OpenRouter" };

// GET /api/v1/key. Free-model requests and a bounded API key budget are
// independent limits. An unbounded budget does not mean unlimited free requests.
export function parseOpenRouterUsageResponse(input: {
  observedAt: string;
  value: unknown;
}): AdapterProviderUsageLimit[] {
  const data = record(record(input.value)?.data);
  const limits: AdapterProviderUsageLimit[] = [];
  const free = record(data?.free_model_daily_requests);
  const add = (key: string, label: string, used: unknown, limit: unknown) => {
    if (
      typeof limit !== "number" ||
      !Number.isFinite(limit) ||
      limit <= 0 ||
      typeof used !== "number" ||
      !Number.isFinite(used) ||
      used < 0
    ) {
      return;
    }
    const usedPercent = Math.min(100, (used / limit) * 100);
    limits.push({
      key: `openrouter:${key}`,
      label,
      provider: PROVIDER,
      observedAt: input.observedAt,
      resetsAt: null,
      usedPercent,
      status: usedPercent === 100 ? "exhausted" : "available",
    });
  };
  add(
    "free-model-daily",
    "Free models daily requests",
    free?.used,
    free?.limit
  );
  if (
    typeof data?.limit === "number" &&
    typeof data.limit_remaining === "number" &&
    data.limit_remaining >= 0 &&
    data.limit_remaining <= data.limit
  ) {
    add(
      "key-budget",
      "API key budget",
      data.limit - data.limit_remaining,
      data.limit
    );
  }
  return limits.length
    ? limits
    : createUnavailableProviderUsageLimits(input.observedAt, PROVIDER, {
        reason: "not_reported",
      });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
