import type { AgentControllerUsageLimit } from "@openmeld/schemas/types";

const PROVIDER_USAGE_LIMIT_KEY = "provider";
const PROVIDER_USAGE_LIMIT_LABEL = "Usage limits";

export type AdapterProviderUsageLimit = AgentControllerUsageLimit;

export function createUnsupportedProviderUsageLimits(
  observedAt: string
): AdapterProviderUsageLimit[] {
  return [createProviderUsageLimitWithoutFacts("unsupported", observedAt)];
}

export function createUnavailableProviderUsageLimits(
  observedAt: string
): AdapterProviderUsageLimit[] {
  return [createProviderUsageLimitWithoutFacts("unavailable", observedAt)];
}

function createProviderUsageLimitWithoutFacts(
  status: "unavailable" | "unsupported",
  observedAt: string
): AdapterProviderUsageLimit {
  return {
    key: PROVIDER_USAGE_LIMIT_KEY,
    label: PROVIDER_USAGE_LIMIT_LABEL,
    observedAt,
    resetsAt: null,
    status,
    usedPercent: null,
  };
}
