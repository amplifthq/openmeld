import {
  type DaemonRouteObservationResponse,
  daemonRouteObservationResponseSchema,
  type OpenMeldRequestContext,
} from "@openmeld/schemas";
import { toDaemonRouteObservationUrl } from "../protocol/urls";
import { fetchSpaceRequestWithTimeout } from "../space/fetch-with-timeout";
import { resolveBaseUrl } from "./base-url";
import { buildOpenMeldRequestContextHeadersWithAuth } from "./request-headers";

export class DaemonRouteObservationFetchError extends Error {
  readonly code: "lookup_failed" | "server_unsupported";
  readonly status: number | null;

  constructor(input: {
    code: "lookup_failed" | "server_unsupported";
    message: string;
    status?: number | null;
  }) {
    super(input.message);
    this.code = input.code;
    this.name = "DaemonRouteObservationFetchError";
    this.status = input.status ?? null;
  }
}

export async function fetchDaemonRouteObservation(input: {
  requestContext: OpenMeldRequestContext;
  baseUrl?: string;
  profileId: string;
}): Promise<DaemonRouteObservationResponse> {
  const baseUrl = await resolveBaseUrl(input.baseUrl);
  const endpoint = toDaemonRouteObservationUrl(baseUrl, input.profileId);
  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "daemon.route_observation",
    init: {
      headers: await buildOpenMeldRequestContextHeadersWithAuth({
        requestUrl: endpoint,
        requestContext: input.requestContext,
      }),
    },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new DaemonRouteObservationFetchError({
      code:
        response.status === 404 || response.status === 405
          ? "server_unsupported"
          : "lookup_failed",
      message: `HTTP ${response.status}: ${raw}`,
      status: response.status,
    });
  }

  const parsed = daemonRouteObservationResponseSchema.safeParse(parseJson(raw));
  if (!parsed.success) {
    throw new DaemonRouteObservationFetchError({
      code: "lookup_failed",
      message: "invalid daemon route observation response",
    });
  }
  return parsed.data;
}

function parseJson(raw: string): unknown {
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
