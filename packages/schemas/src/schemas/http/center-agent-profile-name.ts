export const DEFAULT_CENTER_AGENT_PROFILE_NAME = "Center Agent";

// Product intent: include the Organization name so its Center Agent stays recognizable across Organizations.
export function buildDefaultCenterAgentProfileName(
  organizationName: string | null | undefined
): string {
  const normalizedOrganizationName =
    normalizeOrganizationName(organizationName);
  if (!normalizedOrganizationName) {
    return DEFAULT_CENTER_AGENT_PROFILE_NAME;
  }
  const normalizedLowerName =
    normalizedOrganizationName.toLocaleLowerCase("en-US");
  const defaultLowerName =
    DEFAULT_CENTER_AGENT_PROFILE_NAME.toLocaleLowerCase("en-US");
  if (
    normalizedLowerName === defaultLowerName ||
    normalizedLowerName.endsWith(` ${defaultLowerName}`)
  ) {
    return normalizedOrganizationName;
  }
  return `${normalizedOrganizationName} ${DEFAULT_CENTER_AGENT_PROFILE_NAME}`;
}

function normalizeOrganizationName(
  organizationName: string | null | undefined
): string | null {
  const normalized = organizationName?.trim();
  return normalized ? normalized : null;
}
