const ORGANIZATION_USAGE_OVERVIEW_PATH =
  "/v1/organizations/current/usage/overview";

export function buildOrganizationAiUsageQueryPath(): string {
  return "/v1/organizations/current/usage/query";
}

export function buildOrganizationUsageOverviewPath(): string {
  return ORGANIZATION_USAGE_OVERVIEW_PATH;
}
