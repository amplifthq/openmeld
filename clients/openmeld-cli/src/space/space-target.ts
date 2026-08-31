const SPACE_ID_HEX_REGEX = /^[0-9a-f]{64}$/i;
const TRAILING_SLASH_REGEX = /\/$/u;

export type ParsedSpaceTarget = {
  baseUrl?: string;
  profileId?: string;
  spaceId: string;
};

export function parseSpaceTarget(value: string): ParsedSpaceTarget {
  const raw = normalizeOptionalString(value);
  if (!raw) {
    throw new Error("Space ID or Space URL is required.");
  }
  if (SPACE_ID_HEX_REGEX.test(raw)) {
    return { spaceId: raw };
  }

  const isPathOnly = raw.startsWith("/");
  let url: URL;
  try {
    url = isPathOnly ? new URL(raw, "https://openmeld.ai") : new URL(raw);
  } catch {
    throw new Error(
      "Space target must be a 64-character Space ID or an OpenMeld Space URL."
    );
  }
  const segments = url.pathname
    .split("/")
    .map((segment) => decodeURIComponent(segment.trim()))
    .filter((segment) => segment.length > 0);
  const spacesIndex = segments.indexOf("spaces");
  const spaceId = spacesIndex >= 0 ? segments[spacesIndex + 1] : undefined;
  if (!(spaceId && SPACE_ID_HEX_REGEX.test(spaceId))) {
    throw new Error(
      "Space URL must include /o/<org-slug>/spaces/<space-id> with a full 64-character Space ID. Legacy /spaces/<space-id> and /app/spaces/<space-id> inputs are still accepted."
    );
  }
  const profileId = normalizeOptionalString(url.searchParams.get("profileId"));
  return {
    spaceId,
    ...(profileId ? { profileId } : {}),
    ...(isPathOnly ? {} : { baseUrl: deriveGatewayUrlFromSpaceUrl(url) }),
  };
}

export function resolveSpaceReadCommandTarget(input: {
  baseUrl?: string;
  profile?: string;
  space: string;
}): {
  baseUrl?: string;
  profile?: string;
  space: string;
} {
  const target = parseSpaceTarget(input.space);
  const explicitBaseUrl = normalizeOptionalString(input.baseUrl);
  const explicitProfile = normalizeOptionalString(input.profile);
  const baseUrl = explicitBaseUrl ?? target.baseUrl;
  const profile = explicitProfile ?? target.profileId;
  return {
    space: target.spaceId,
    ...(baseUrl ? { baseUrl } : {}),
    ...(profile ? { profile } : {}),
  };
}

function deriveGatewayUrlFromSpaceUrl(url: URL): string {
  const gatewayUrl = new URL(url.toString());
  gatewayUrl.pathname = "/";
  gatewayUrl.search = "";
  gatewayUrl.hash = "";
  if (gatewayUrl.hostname === "openmeld.ai") {
    gatewayUrl.hostname = "gateway.openmeld.ai";
    gatewayUrl.protocol = "https:";
    gatewayUrl.port = "";
  } else if (
    isLoopbackHostname(gatewayUrl.hostname) &&
    gatewayUrl.port === "3000"
  ) {
    gatewayUrl.port = "8080";
  }
  return gatewayUrl.toString().replace(TRAILING_SLASH_REGEX, "");
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
