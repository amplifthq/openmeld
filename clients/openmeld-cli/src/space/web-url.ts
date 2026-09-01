import { isLoopbackHostname } from "../config/loopback-hostname";

export function buildSpaceWebUrl(
  baseUrl: string,
  organizationSlug: string,
  spaceId: string,
  options?: {
    profileId?: string;
  }
): string {
  const url = new URL(resolveGatewayWebOrigin(baseUrl));
  const orgSlug = requireOrganizationSlug(organizationSlug);
  url.pathname = `/o/${encodeURIComponent(orgSlug)}/spaces/${encodeURIComponent(spaceId)}`;
  url.search = "";
  const profileId = normalizeOptionalText(options?.profileId);
  if (profileId) {
    url.searchParams.set("profileId", profileId);
  }
  url.hash = "";
  return url.toString();
}

export function resolveGatewayWebOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (isLoopbackHostname(url.hostname) && url.port === LOCAL_GATEWAY_PORT) {
    url.port = LOCAL_WEB_PORT;
  }
  const pair = OPENMELD_ORIGIN_HOST_PAIRS.find(
    ({ gateway }) => gateway === url.hostname
  );
  if (pair) {
    url.hostname = pair.web;
    url.port = "";
    url.protocol = "https:";
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.origin;
}

export function resolveSpaceWebGatewayOrigin(spaceUrl: URL): string {
  const url = new URL(spaceUrl.toString());
  const pair = OPENMELD_ORIGIN_HOST_PAIRS.find(
    ({ web }) => web === url.hostname
  );
  if (pair) {
    if (url.protocol !== "https:" || url.port.length > 0) {
      throw new Error(TRUSTED_SPACE_WEB_ORIGIN_ERROR);
    }
    url.hostname = pair.gateway;
  } else if (
    isLoopbackHostname(url.hostname) &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.port === LOCAL_WEB_PORT
  ) {
    url.port = LOCAL_GATEWAY_PORT;
  } else {
    throw new Error(TRUSTED_SPACE_WEB_ORIGIN_ERROR);
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.origin;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function requireOrganizationSlug(value: unknown): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(
      "Active organization slug is required to build a Space URL."
    );
  }
  return normalized;
}
const OPENMELD_ORIGIN_HOST_PAIRS = [
  { gateway: "gateway.openmeld.ai", web: "openmeld.ai" },
  {
    gateway: "gateway.staging.openmeld.ai",
    web: "staging.openmeld.ai",
  },
  { gateway: "gateway.openmeld.invalid", web: "openmeld.invalid" },
] as const;

const LOCAL_GATEWAY_PORT = "8080";
const LOCAL_WEB_PORT = "3000";
const TRUSTED_SPACE_WEB_ORIGIN_ERROR =
  "Space URL must use a trusted OpenMeld Web origin. For a custom local environment, pass --gateway-url explicitly.";
