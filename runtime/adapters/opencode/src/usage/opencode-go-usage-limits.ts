import { createUnavailableProviderUsageLimits } from "@openmeld/adapter-core";

const OPENCODE_GO_PROVIDER = {
  displayName: "OpenCode Go",
  id: "opencode-go",
} as const;

type OpenCodeGoUsageWindow = {
  percent: number;
  resetsAt: string;
  status: "ok" | "rate-limited";
};

export type OpenCodeGoUsageResponse = {
  usage: {
    monthly: OpenCodeGoUsageWindow;
    rolling: OpenCodeGoUsageWindow;
    weekly: OpenCodeGoUsageWindow;
  };
};

export function parseOpenCodeGoUsageResponse(input: {
  observedAt: string;
  value: unknown;
}) {
  const record = toRecord(input.value);
  const usage = toRecord(record?.usage);
  const windows = [
    ["rolling", "5-hour usage"],
    ["weekly", "Weekly usage"],
    ["monthly", "Monthly usage"],
  ] as const;
  const parsed = windows.map(([key, label]) => {
    const value = toRecord(usage?.[key]);
    const percent = value?.percent;
    const resetsAt = value?.resetsAt;
    const sourceStatus = value?.status;
    if (
      typeof percent !== "number" ||
      !Number.isFinite(percent) ||
      percent < 0 ||
      percent > 100 ||
      typeof resetsAt !== "string" ||
      !Number.isFinite(Date.parse(resetsAt)) ||
      (sourceStatus !== "ok" && sourceStatus !== "rate-limited")
    ) {
      return null;
    }
    const exhausted = sourceStatus === "rate-limited" || percent === 100;
    return {
      key: `opencode-go:${key}`,
      label,
      observedAt: input.observedAt,
      provider: OPENCODE_GO_PROVIDER,
      resetsAt,
      status: exhausted ? ("exhausted" as const) : ("available" as const),
      usedPercent: exhausted ? 100 : percent,
    };
  });

  if (parsed.some((limit) => limit === null)) {
    return createUnavailableProviderUsageLimits(
      input.observedAt,
      OPENCODE_GO_PROVIDER
    );
  }
  return parsed.filter((limit) => limit !== null);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
