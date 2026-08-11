import { normalizeApiBaseUrl } from "./base-url";

export function publicSpaceUrls(baseUrl: string): {
  status: (spaceId: string) => string;
  members: (spaceId: string) => string;
  signals: (spaceId: string) => string;
} {
  const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);

  return {
    status: (spaceId) =>
      buildPublicSpaceUrl(normalizedBaseUrl, spaceId, "status"),
    members: (spaceId) =>
      buildPublicSpaceUrl(normalizedBaseUrl, spaceId, "members"),
    signals: (spaceId) =>
      buildPublicSpaceUrl(normalizedBaseUrl, spaceId, "signals"),
  };
}

function buildPublicSpaceUrl(
  baseUrl: string,
  spaceId: string,
  segment: "status" | "members" | "signals"
): string {
  const url = new URL(baseUrl);
  url.pathname = `/v1/spaces/${encodeURIComponent(spaceId)}/${segment}`;
  return url.toString();
}
