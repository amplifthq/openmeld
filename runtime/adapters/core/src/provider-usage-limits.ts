import type {
  AgentControllerUsageAdmission,
  AgentControllerUsageLimit,
} from "@openmeld/schemas/types";

const PROVIDER_USAGE_LIMIT_KEY = "provider";
const PROVIDER_USAGE_LIMIT_LABEL = "Usage limits";

export type AdapterProviderUsageLimit = AgentControllerUsageLimit;
export type AdapterProviderUsageAdmission = AgentControllerUsageAdmission;

export type AdapterUsageProvider = NonNullable<
  AgentControllerUsageLimit["provider"]
>;

export function createUnsupportedProviderUsageLimits(
  observedAt: string,
  provider?: AdapterUsageProvider
): AdapterProviderUsageLimit[] {
  return [
    createProviderUsageLimitWithoutFacts("unsupported", observedAt, provider),
  ];
}

export function createUnavailableProviderUsageLimits(
  observedAt: string,
  provider?: AdapterUsageProvider,
  details?: Partial<Pick<AdapterProviderUsageLimit, "reason" | "resetsAt">>
): AdapterProviderUsageLimit[] {
  return [
    {
      ...createProviderUsageLimitWithoutFacts(
        "unavailable",
        observedAt,
        provider
      ),
      ...details,
    },
  ];
}

function createProviderUsageLimitWithoutFacts(
  status: "unavailable" | "unsupported",
  observedAt: string,
  provider?: AdapterUsageProvider
): AdapterProviderUsageLimit {
  return {
    key: provider
      ? `${provider.id}:${PROVIDER_USAGE_LIMIT_KEY}`
      : PROVIDER_USAGE_LIMIT_KEY,
    label: PROVIDER_USAGE_LIMIT_LABEL,
    observedAt,
    ...(provider ? { provider } : {}),
    resetsAt: null,
    status,
    usedPercent: null,
  };
}
