const TRAILING_SLASHES_REGEX = /\/+$/;
const ROOT_PATH_REGEX = /^\/+$/;

export function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (!ROOT_PATH_REGEX.test(url.pathname)) {
    throw new Error("baseUrl must be origin-only (no path prefix)");
  }
  if (url.search || url.hash) {
    throw new Error("baseUrl must be origin-only (no query or hash)");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(TRAILING_SLASHES_REGEX, "");
}

export function toSpaceSignalsUrl(baseUrl: string, space: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/signals`;
  return url.toString();
}

export function toSpaceCreateUrl(baseUrl: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = "/v1/spaces";
  return url.toString();
}

export function toSpaceDeleteUrl(baseUrl: string, space: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}`;
  return url.toString();
}

export function toSpaceMetaUrl(baseUrl: string, space: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/meta`;
  return url.toString();
}

export function toSpaceContractUrl(baseUrl: string, space: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/contract`;
  return url.toString();
}

export function toSpaceBoardUrl(baseUrl: string, space: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/board`;
  return url.toString();
}

export function toSpaceUpdatesUrl(baseUrl: string, space: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/updates`;
  return url.toString();
}

export function toSpaceStatusUrl(baseUrl: string, space: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/status`;
  return url.toString();
}

export function toSpaceResultUrl(baseUrl: string, space: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/result`;
  return url.toString();
}

export function toSpaceMembersUrl(baseUrl: string, space: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/members`;
  return url.toString();
}

export function toSpaceRemoveMembersUrl(
  baseUrl: string,
  space: string
): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/members/remove`;
  return url.toString();
}

export function toSpaceLeaveUrl(baseUrl: string, space: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/leave`;
  return url.toString();
}

export function toSpaceDispatchTraceUrl(
  baseUrl: string,
  space: string,
  dispatchId: string,
  options: {
    includeRemoteAgentRuntimeDiagnostics?: boolean;
  } = {}
): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/dispatches/${encodeURIComponent(dispatchId)}/trace`;
  if (options.includeRemoteAgentRuntimeDiagnostics === true) {
    url.searchParams.set("includeRemoteAgentRuntimeDiagnostics", "true");
  }
  return url.toString();
}

export function toSpaceDispatchLookupUrl(
  baseUrl: string,
  space: string
): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/dispatches/lookup`;
  return url.toString();
}

export function toDaemonRouteObservationUrl(
  baseUrl: string,
  profileId: string
): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/daemon/routes/${encodeURIComponent(profileId)}`;
  return url.toString();
}

export function toSpacePasswordUrl(baseUrl: string, space: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/password`;
  return url.toString();
}

export function toSpaceCursorUrl(
  baseUrl: string,
  space: string,
  profileId: string
): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  url.pathname = `/v1/spaces/${encodeURIComponent(space)}/cursors/${encodeURIComponent(profileId)}`;
  return url.toString();
}

export function toSpaceWsUrl(baseUrl: string, space: string): string {
  const http = new URL(normalizeBaseUrl(baseUrl));
  let wsScheme: "ws:" | "wss:";
  if (http.protocol === "http:") {
    wsScheme = "ws:";
  } else if (http.protocol === "https:") {
    wsScheme = "wss:";
  } else if (http.protocol === "ws:" || http.protocol === "wss:") {
    wsScheme = http.protocol;
  } else {
    throw new Error(
      `unsupported baseUrl protocol for websocket URL: ${http.protocol}`
    );
  }
  return `${wsScheme}//${http.host}/v1/spaces/${encodeURIComponent(space)}/stream`;
}
