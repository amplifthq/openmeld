import { resolveProfileSpaceHistoryGatewayHost } from "../profile-space-history/routes";

const ACCOUNT_SPACE_INDEX_DEFAULT_LIMIT = 500;

export function resolveAccountSpaceIndexGatewayHost(baseUrl: string): string {
  return resolveProfileSpaceHistoryGatewayHost(baseUrl);
}

export function buildAccountSpaceActiveWakeSummaryPath(input: {
  gatewayHost: string;
  selectedProfileId: string;
}): string {
  const url = new URL(
    "/v1/account/spaces/active-wake-summary",
    "https://openmeld.local"
  );
  url.searchParams.set("gatewayHost", input.gatewayHost);
  url.searchParams.set("selectedProfileId", input.selectedProfileId);
  return `${url.pathname}${url.search}`;
}

export function buildAccountSpaceIndexPath(input: {
  gatewayHost: string;
  includeDirectMessageProfileIds?: boolean;
  includePurposes?: boolean;
  includeMemberPreviews?: boolean;
  limit?: number;
  scope: "account" | "profile";
  selectedProfileId: string;
  includeRecentlyDeletedItems?: boolean;
}): string {
  const url = new URL("/v1/account/spaces", "https://openmeld.local");
  url.searchParams.set("gatewayHost", input.gatewayHost);
  url.searchParams.set("scope", input.scope);
  url.searchParams.set("selectedProfileId", input.selectedProfileId);
  url.searchParams.set(
    "limit",
    String(Math.max(1, input.limit ?? ACCOUNT_SPACE_INDEX_DEFAULT_LIMIT))
  );
  // Opt-in fields: append only when explicitly requested so strict legacy
  // callers keep receiving the legacy response shape.
  if (input.includeRecentlyDeletedItems === true) {
    url.searchParams.set("includeRecentlyDeletedItems", "true");
  }
  if (input.includeDirectMessageProfileIds === true) {
    url.searchParams.set("includeDirectMessageProfileIds", "true");
  }
  if (input.includePurposes === true) {
    url.searchParams.set("includePurposes", "true");
  }
  if (input.includeMemberPreviews === true) {
    url.searchParams.set("includeMemberPreviews", "true");
  }
  return `${url.pathname}${url.search}`;
}
