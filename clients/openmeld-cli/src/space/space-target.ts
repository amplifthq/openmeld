import { resolveSpaceWebGatewayOrigin } from "./web-url";

const SPACE_ID_HEX_REGEX = /^[0-9a-f]{64}$/i;
const INVALID_SPACE_TARGET_MESSAGE =
  "Space target must be a 64-character Space ID or an OpenMeld Space URL.";

export type ParsedSpaceTarget = {
  baseUrl?: string;
  profileId?: string;
  spaceId: string;
};

export function parseSpaceTarget(
  value: string,
  options?: { baseUrl?: string }
): ParsedSpaceTarget {
  const explicitBaseUrl = normalizeOptionalString(options?.baseUrl);
  const target = parseSpaceTargetValue(value, !explicitBaseUrl);
  return {
    ...target,
    ...(explicitBaseUrl ? { baseUrl: explicitBaseUrl } : {}),
  };
}

function parseSpaceTargetValue(
  value: string,
  deriveBaseUrl: boolean
): ParsedSpaceTarget {
  const raw = normalizeOptionalString(value);
  if (!raw) {
    throw new Error(INVALID_SPACE_TARGET_MESSAGE);
  }
  if (SPACE_ID_HEX_REGEX.test(raw)) {
    return { spaceId: raw };
  }

  const isPathOnly = raw.startsWith("/");
  let url: URL;
  let segments: string[];
  try {
    url = isPathOnly ? new URL(raw, "https://openmeld.ai") : new URL(raw);
    segments = url.pathname
      .split("/")
      .map((segment) => decodeURIComponent(segment.trim()))
      .filter((segment) => segment.length > 0);
  } catch {
    throw new Error(INVALID_SPACE_TARGET_MESSAGE);
  }
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
    ...(isPathOnly || !deriveBaseUrl
      ? {}
      : { baseUrl: resolveSpaceWebGatewayOrigin(url) }),
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
  const target = parseSpaceTarget(input.space, { baseUrl: input.baseUrl });
  const explicitProfile = normalizeOptionalString(input.profile);
  const profile = explicitProfile ?? target.profileId;
  return {
    space: target.spaceId,
    ...(target.baseUrl ? { baseUrl: target.baseUrl } : {}),
    ...(profile ? { profile } : {}),
  };
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
