import { normalizeApiBaseUrl } from "../base-url";

const PROFILE_SPACE_HISTORY_DEFAULT_LIMIT = 20;

export function resolveProfileSpaceHistoryGatewayHost(baseUrl: string): string {
  return new URL(normalizeApiBaseUrl(baseUrl)).host.toLowerCase();
}

export function buildProfileSpaceHistoryListPath(input: {
  profileId: string;
  gatewayHost: string;
  statuses?: readonly string[];
  pinned?: boolean;
  limit?: number;
}): string {
  const url = new URL(
    buildProfileSpaceHistoryBasePath(input.profileId),
    "https://openmeld.local"
  );
  url.searchParams.set("gatewayHost", input.gatewayHost);
  for (const status of input.statuses ?? ["active"]) {
    url.searchParams.append("status", status);
  }
  if (input.pinned !== undefined) {
    url.searchParams.set("pinned", String(input.pinned));
  }
  url.searchParams.set(
    "limit",
    String(Math.max(1, input.limit ?? PROFILE_SPACE_HISTORY_DEFAULT_LIMIT))
  );
  return `${url.pathname}${url.search}`;
}

export function buildProfileSpaceHistoryUpsertPath(input: {
  profileId: string;
  spaceId: string;
}): string {
  return `${buildProfileSpaceHistoryBasePath(input.profileId)}/${encodeURIComponent(input.spaceId)}`;
}

export function buildProfileSpaceHistoryStatusPath(input: {
  profileId: string;
  spaceId: string;
}): string {
  return `${buildProfileSpaceHistoryUpsertPath(input)}/status`;
}

function buildProfileSpaceHistoryBasePath(profileId: string): string {
  return `/v1/profiles/${encodeURIComponent(profileId)}/spaces`;
}
