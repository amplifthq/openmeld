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
  if (isLoopbackHostname(url.hostname) && url.port === "8080") {
    url.port = "3000";
  }
  if (url.hostname === "gateway.openmeld.ai") {
    url.hostname = "openmeld.ai";
    url.port = "";
    url.protocol = "https:";
  }
  if (url.hostname === "gateway.openmeld.invalid") {
    url.hostname = "openmeld.invalid";
    url.port = "";
    url.protocol = "https:";
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.origin;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
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
