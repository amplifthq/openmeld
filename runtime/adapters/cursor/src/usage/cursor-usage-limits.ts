import {
  type AdapterProviderUsageLimit,
  createUnavailableProviderUsageLimits,
} from "@openmeld/adapter-core";

// DashboardService/GetCurrentPeriodUsage, as consumed by T3 Code. The supplied
// percentages include bonus usage; billing dollars are not a quota denominator.
export function projectCursorUsageLimits(input: {
  value: unknown;
  observedAt: string;
}): AdapterProviderUsageLimit[] {
  const response = record(input.value);
  const plan = record(response?.planUsage);
  const reset = Number(response?.billingCycleEnd);
  const resetDate = new Date(reset);
  const resetsAt =
    reset > 0 && Number.isFinite(resetDate.getTime())
      ? resetDate.toISOString()
      : null;
  const windows = [
    ["totalPercentUsed", "Plan usage"],
    ["autoPercentUsed", "Auto usage"],
    ["apiPercentUsed", "API usage"],
  ] as const;
  const limits = windows.flatMap(
    ([key, label]): AdapterProviderUsageLimit[] => {
      const value = plan?.[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return [];
      }
      const usedPercent = Math.min(value, 100);
      return [
        {
          key: `cursor:${key}`,
          label,
          observedAt: input.observedAt,
          resetsAt,
          usedPercent,
          status: usedPercent === 100 ? "exhausted" : "available",
        },
      ];
    }
  );
  return limits.length
    ? limits
    : createUnavailableProviderUsageLimits(input.observedAt, undefined, {
        reason: "not_reported",
        resetsAt,
      });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
