import { normalizeBaseUrl } from "../protocol/urls";
import type { StoredAuthSession } from "./auth-session";
import { isLoopbackHostname } from "./loopback-hostname";

export type AuthRequestCompatibilityReason =
  | "invalid_request_url"
  | "invalid_auth_url"
  | "insecure_transport"
  | "host_mismatch"
  | "loopback"
  | "same_host"
  | "gateway_sibling";

export type AuthRequestCompatibility = {
  compatible: boolean;
  reason: AuthRequestCompatibilityReason;
  requestHost: string | null;
  authHost: string | null;
  expectedGatewayHost: string | null;
};

export function resolveAuthRequestCompatibility(input: {
  session: StoredAuthSession;
  requestUrl: string;
}): AuthRequestCompatibility {
  const requestUrl = parseUrlOrNull(input.requestUrl);
  if (!requestUrl) {
    return {
      compatible: false,
      reason: "invalid_request_url",
      requestHost: null,
      authHost: null,
      expectedGatewayHost: null,
    };
  }

  const authBaseUrl = parseUrlOrNull(input.session.authBaseUrl);
  if (!authBaseUrl) {
    return {
      compatible: false,
      reason: "invalid_auth_url",
      requestHost: requestUrl.host,
      authHost: null,
      expectedGatewayHost: null,
    };
  }

  const expectedGatewayHost = deriveGatewayHost(authBaseUrl);
  const requestHost = requestUrl.host;
  const authHost = authBaseUrl.host;

  if (
    (isLoopbackHostname(requestUrl.hostname) &&
      isLoopbackHostname(authBaseUrl.hostname)) ||
    // Isolated worktrees share a hostname across Auth and Gateway ports.
    // Never treat different named localhost lanes as interchangeable.
    (requestUrl.hostname.endsWith(".localhost") &&
      requestUrl.hostname === authBaseUrl.hostname &&
      isHttpTransportProtocol(authBaseUrl.protocol) &&
      ["http:", "https:", "ws:", "wss:"].includes(requestUrl.protocol))
  ) {
    return {
      compatible: true,
      reason: "loopback",
      requestHost,
      authHost,
      expectedGatewayHost,
    };
  }

  if (!isSecureTransportProtocol(requestUrl.protocol)) {
    return {
      compatible: false,
      reason: "insecure_transport",
      requestHost,
      authHost,
      expectedGatewayHost,
    };
  }

  if (requestHost === authHost) {
    return {
      compatible: true,
      reason: "same_host",
      requestHost,
      authHost,
      expectedGatewayHost,
    };
  }

  if (expectedGatewayHost && requestHost === expectedGatewayHost) {
    return {
      compatible: true,
      reason: "gateway_sibling",
      requestHost,
      authHost,
      expectedGatewayHost,
    };
  }

  return {
    compatible: false,
    reason: "host_mismatch",
    requestHost,
    authHost,
    expectedGatewayHost,
  };
}

export function deriveAuthBaseUrlFromGatewayUrl(
  gatewayUrl: string
): string | null {
  const parsed = parseUrlOrNull(gatewayUrl);
  if (!parsed) {
    return null;
  }
  if (!isHttpTransportProtocol(parsed.protocol)) {
    return null;
  }
  if (!parsed.hostname.startsWith("gateway.")) {
    return null;
  }

  const authUrl = new URL(parsed.toString());
  authUrl.hostname = `auth.${parsed.hostname.slice("gateway.".length)}`;
  authUrl.pathname = "/";
  authUrl.search = "";
  authUrl.hash = "";
  return normalizeBaseUrl(authUrl.toString());
}

function deriveGatewayHost(authBaseUrl: URL): string | null {
  if (!authBaseUrl.hostname.startsWith("auth.")) {
    return null;
  }

  const gatewayUrl = new URL(authBaseUrl.toString());
  gatewayUrl.hostname = `gateway.${authBaseUrl.hostname.slice("auth.".length)}`;
  return gatewayUrl.host;
}

function parseUrlOrNull(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isSecureTransportProtocol(protocol: string): boolean {
  return protocol === "https:" || protocol === "wss:";
}

function isHttpTransportProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}
