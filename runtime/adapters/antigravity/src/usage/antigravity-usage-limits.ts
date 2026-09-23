import {
  type AdapterProviderUsageLimit,
  createUnavailableProviderUsageLimits,
} from "@openmeld/adapter-core";

const LINE_BREAK_PATTERN = /\r?\n/u;
const USAGE_LINE_PATTERN =
  /^([^\t]+)\tWeekly Limit Remaining\t(\d{1,3})%\t([^\t]+)$/u;

export function parseAntigravityUsageLimits(input: {
  observedAt: string;
  output: string;
}): AdapterProviderUsageLimit[] {
  const limits = input.output
    .split(LINE_BREAK_PATTERN)
    .map((line) => parseUsageLine(line, input.observedAt))
    .filter((limit): limit is AdapterProviderUsageLimit => limit !== null);
  return limits.length > 0
    ? limits
    : createUnavailableProviderUsageLimits(input.observedAt);
}

function parseUsageLine(
  line: string,
  observedAt: string
): AdapterProviderUsageLimit | null {
  const match = line.trim().match(USAGE_LINE_PATTERN);
  if (!match) {
    return null;
  }
  const [, rawLabel, rawRemainingPercent, rawResetsAt] = match;
  const remainingPercent = Number(rawRemainingPercent);
  const resetTime = Date.parse(rawResetsAt ?? "");
  if (
    !(rawLabel && Number.isFinite(remainingPercent)) ||
    remainingPercent < 0 ||
    remainingPercent > 100 ||
    !Number.isFinite(resetTime)
  ) {
    return null;
  }
  const label = rawLabel.trim();
  const providerId = label.toLowerCase().startsWith("gemini")
    ? "antigravity-gemini"
    : "antigravity-other";
  const usedPercent = 100 - remainingPercent;
  return {
    key: `${providerId}:weekly`,
    label: "Weekly usage",
    observedAt,
    provider: {
      displayName: label,
      id: providerId,
    },
    resetsAt: new Date(resetTime).toISOString(),
    status: remainingPercent === 0 ? "exhausted" : "available",
    usedPercent,
  };
}
