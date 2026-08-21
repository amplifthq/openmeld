export const CURRENT_DEVICE_ROUTE = "/v1/devices/current";

export function buildLocalRuntimeEnrollmentRoute(deviceId: string): string {
  return `/v1/local-runtimes/${encodeURIComponent(deviceId)}/enrollment`;
}

export const LOCAL_RUNTIME_ENROLLMENT_ROUTE_PATTERN =
  "/v1/local-runtimes/:deviceId/enrollment";
export const FORGET_CURRENT_COMPUTER_ROUTE = "/v1/devices/current/forget";
export const CURRENT_LOCAL_RUNTIME_REPLY_READINESS_ROUTE =
  "/v1/local-runtimes/current/reply-readiness";
export const CURRENT_LOCAL_RUNTIME_OBSERVED_METADATA_ROUTE =
  "/v1/local-runtimes/current/observed-metadata";
export const CURRENT_LOCAL_AGENT_CATALOG_REFRESH_ROUTE =
  "/v1/local-runtimes/current/local-agents/refresh-catalog";
export function buildCurrentAgentProfileWorkspaceRoute(
  agentProfileId: string
): string {
  return `/v1/local-runtimes/current/agent-profiles/${encodeURIComponent(agentProfileId)}/workspace`;
}
export function buildCurrentLocalAgentEnabledRoute(agentId: string): string {
  return `/v1/local-runtimes/current/local-agents/${encodeURIComponent(agentId)}/enabled`;
}
export function buildCurrentLocalAgentInstallationsRoute(
  agentId: string
): string {
  return `/v1/local-runtimes/current/local-agents/${encodeURIComponent(agentId)}/installations`;
}
export const LOCAL_RUNTIMES_ROUTE = "/v1/local-runtimes";

export function buildLocalRuntimesRoute(input?: {
  connectionIdentityAdoption?: string;
  includeUsageLimits?: "true";
}): string {
  if (!(input?.connectionIdentityAdoption || input?.includeUsageLimits)) {
    return LOCAL_RUNTIMES_ROUTE;
  }
  const params = new URLSearchParams();
  if (input.connectionIdentityAdoption) {
    params.set("connectionIdentityAdoption", input.connectionIdentityAdoption);
  }
  if (input.includeUsageLimits) {
    params.set("includeUsageLimits", input.includeUsageLimits);
  }
  return `${LOCAL_RUNTIMES_ROUTE}?${params.toString()}`;
}

export function buildForgetComputerRoute(deviceId: string): string {
  return `/v1/devices/${encodeURIComponent(deviceId)}/forget`;
}

export function buildCurrentDeviceObservedMetadataRoute(
  deviceId: string
): string {
  return `/v1/devices/${encodeURIComponent(deviceId)}/observed-metadata`;
}

export function buildLocalRuntimeDisplayNameRoute(deviceId: string): string {
  return `/v1/local-runtimes/${encodeURIComponent(deviceId)}/display-name`;
}
