import {
  buildProfileSpaceHistoryListPath,
  buildProfileSpaceHistoryStatusPath,
  buildProfileSpaceHistoryUpsertPath,
  createFetchTransport,
  createOpenMeldApiClient,
  createProfileSpaceHistoryApi,
  OpenMeldApiClientHttpError,
  OpenMeldApiClientInvalidResponseError,
  resolveProfileSpaceHistoryGatewayHost,
} from "@openmeld/api-client";
import type {
  OpenMeldRequestContext,
  PatchProfileSpaceHistoryStatusBody,
  PatchProfileSpaceHistoryStatusResponse,
  ProfileSpaceHistoryRecord,
  ProfileSpaceHistoryStatus,
  UpsertProfileSpaceHistoryBody,
  UpsertProfileSpaceHistoryResponse,
} from "@openmeld/schemas";
import { normalizeBaseUrl } from "../protocol/urls";
import { buildOpenMeldRequestContextHeadersWithAuth } from "./request-headers";

const PROFILE_SPACE_HISTORY_TIMEOUT_MS = 10_000;

export class ProfileSpaceHistoryApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly endpoint: string;
  readonly canFallbackToLocal: boolean;

  constructor(input: {
    message: string;
    endpoint: string;
    status?: number | null;
    code?: string | null;
    canFallbackToLocal?: boolean;
  }) {
    super(input.message);
    this.name = "ProfileSpaceHistoryApiError";
    this.status =
      typeof input.status === "number" ? Math.trunc(input.status) : null;
    this.code = normalizeOptionalText(input.code);
    this.endpoint = input.endpoint;
    this.canFallbackToLocal = input.canFallbackToLocal === true;
  }
}

export async function listProfileSpaceHistory(input: {
  baseUrl: string;
  requestContext: OpenMeldRequestContext;
  openMeldProfileId: string;
  profileName?: string;
  statuses?: ProfileSpaceHistoryStatus[];
  pinned?: boolean;
  limit?: number;
}): Promise<ProfileSpaceHistoryRecord[]> {
  const gatewayHost = resolveGatewayHost(input.baseUrl);
  const endpoint = toAbsoluteEndpoint({
    baseUrl: input.baseUrl,
    path: buildProfileSpaceHistoryListPath({
      profileId: input.openMeldProfileId,
      gatewayHost,
      ...(input.statuses === undefined ? {} : { statuses: input.statuses }),
      ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }),
  });

  try {
    return [
      ...(await createApi(input.baseUrl).listProfileSpaceHistory({
        requestContext: input.requestContext,
        profileId: input.openMeldProfileId,
        gatewayHost,
        ...(input.statuses === undefined ? {} : { statuses: input.statuses }),
        ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        timeoutMs: PROFILE_SPACE_HISTORY_TIMEOUT_MS,
      })),
    ];
  } catch (error) {
    throw toProfileSpaceHistoryApiError({
      error,
      endpoint,
      invalidResponseCanFallbackToLocal: true,
    });
  }
}

export async function upsertProfileSpaceHistory(input: {
  baseUrl: string;
  requestContext: OpenMeldRequestContext;
  openMeldProfileId: string;
  profileName?: string;
  spaceId: string;
  body: UpsertProfileSpaceHistoryBody;
}): Promise<UpsertProfileSpaceHistoryResponse> {
  const endpoint = toAbsoluteEndpoint({
    baseUrl: input.baseUrl,
    path: buildProfileSpaceHistoryUpsertPath({
      profileId: input.openMeldProfileId,
      spaceId: input.spaceId,
    }),
  });

  try {
    return await createApi(input.baseUrl).upsertProfileSpaceHistory({
      requestContext: input.requestContext,
      profileId: input.openMeldProfileId,
      spaceId: input.spaceId,
      body: input.body,
      timeoutMs: PROFILE_SPACE_HISTORY_TIMEOUT_MS,
    });
  } catch (error) {
    throw toProfileSpaceHistoryApiError({
      error,
      endpoint,
      invalidResponseCanFallbackToLocal: false,
    });
  }
}

export async function updateProfileSpaceHistoryStatus(input: {
  baseUrl: string;
  requestContext: OpenMeldRequestContext;
  openMeldProfileId: string;
  profileName?: string;
  spaceId: string;
  body: PatchProfileSpaceHistoryStatusBody;
}): Promise<PatchProfileSpaceHistoryStatusResponse> {
  const endpoint = toAbsoluteEndpoint({
    baseUrl: input.baseUrl,
    path: buildProfileSpaceHistoryStatusPath({
      profileId: input.openMeldProfileId,
      spaceId: input.spaceId,
    }),
  });

  try {
    return await createApi(input.baseUrl).updateProfileSpaceHistoryStatus({
      requestContext: input.requestContext,
      profileId: input.openMeldProfileId,
      spaceId: input.spaceId,
      body: input.body,
      timeoutMs: PROFILE_SPACE_HISTORY_TIMEOUT_MS,
    });
  } catch (error) {
    throw toProfileSpaceHistoryApiError({
      error,
      endpoint,
      invalidResponseCanFallbackToLocal: false,
    });
  }
}

export function resolveGatewayHost(baseUrl: string): string {
  return resolveProfileSpaceHistoryGatewayHost(baseUrl);
}

function createApi(baseUrl: string) {
  return createProfileSpaceHistoryApi(
    createOpenMeldApiClient({
      baseUrl,
      transport: createFetchTransport({
        fetch,
        defaultTimeoutMs: PROFILE_SPACE_HISTORY_TIMEOUT_MS,
      }),
      getRequestContextHeaders: async ({ requestUrl, requestContext }) =>
        await buildOpenMeldRequestContextHeadersWithAuth({
          requestUrl,
          requestContext,
        }),
    })
  );
}

function toAbsoluteEndpoint(input: { baseUrl: string; path: string }): string {
  return new URL(input.path, `${normalizeBaseUrl(input.baseUrl)}/`).toString();
}

function toProfileSpaceHistoryApiError(input: {
  error: unknown;
  endpoint: string;
  invalidResponseCanFallbackToLocal: boolean;
}): ProfileSpaceHistoryApiError {
  if (input.error instanceof ProfileSpaceHistoryApiError) {
    return input.error;
  }

  if (input.error instanceof OpenMeldApiClientInvalidResponseError) {
    return new ProfileSpaceHistoryApiError({
      endpoint: input.endpoint,
      status: input.error.status,
      code: "profile_space_history.response_invalid",
      message: input.error.message,
      canFallbackToLocal: input.invalidResponseCanFallbackToLocal,
    });
  }

  if (input.error instanceof OpenMeldApiClientHttpError) {
    const parsedRawBody = parseJson(input.error.rawBody);
    const code =
      readErrorField(parsedRawBody, "code") ??
      input.error.upstreamCode ??
      input.error.code;
    const message = extractHttpErrorMessage(input.error);
    return new ProfileSpaceHistoryApiError({
      endpoint: input.endpoint,
      status: input.error.status,
      code,
      message,
      canFallbackToLocal: shouldFallbackToLocal({
        status: input.error.status,
        code,
        message,
      }),
    });
  }

  const genericCode = readGenericErrorCode(input.error);
  if (
    genericCode === "network.timeout" ||
    genericCode === "network.request_failed"
  ) {
    return new ProfileSpaceHistoryApiError({
      endpoint: input.endpoint,
      status: readGenericErrorStatus(input.error),
      code: "profile_space_history.network_error",
      message: toNetworkErrorMessage(input.error),
      canFallbackToLocal: true,
    });
  }

  return new ProfileSpaceHistoryApiError({
    endpoint: input.endpoint,
    code: "profile_space_history.network_error",
    message: toNetworkErrorMessage(input.error),
    canFallbackToLocal: true,
  });
}

function extractHttpErrorMessage(error: OpenMeldApiClientHttpError): string {
  const raw = normalizeOptionalText(error.rawBody);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return extractErrorMessage(parsed, raw, error.status);
    } catch {
      return raw;
    }
  }
  return `profile-space-history request failed with status ${error.status}`;
}

function extractErrorMessage(
  payload: unknown,
  raw: string,
  status: number
): string {
  const message = readErrorField(payload, "message");
  if (message) {
    return message;
  }
  const fallback = normalizeOptionalText(raw);
  if (fallback) {
    return fallback;
  }
  return `profile-space-history request failed with status ${status}`;
}

function readErrorField(
  payload: unknown,
  field: "code" | "message"
): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record[field] === "string") {
    return normalizeOptionalText(record[field]);
  }
  if (
    record.error &&
    typeof record.error === "object" &&
    typeof (record.error as Record<string, unknown>)[field] === "string"
  ) {
    return normalizeOptionalText(
      (record.error as Record<string, unknown>)[field]
    );
  }
  return null;
}

function shouldFallbackToLocal(input: {
  status: number;
  code: string | null;
  message: string;
}): boolean {
  if (
    input.status === 401 ||
    input.status === 403 ||
    input.code === "auth.unauthenticated"
  ) {
    return false;
  }
  if (isProfileMissing404(input)) {
    return false;
  }
  if (input.status >= 500) {
    return true;
  }
  if (input.status === 408 || input.status === 429) {
    return true;
  }
  if (input.status === 404 && input.code !== "profile.not_found") {
    return true;
  }
  return false;
}

function isProfileMissing404(input: {
  status: number;
  code: string | null;
  message: string;
}): boolean {
  if (input.status !== 404) {
    return false;
  }
  if (input.code === "profile.not_found") {
    return true;
  }
  if (input.code && input.code !== "upstream_error") {
    return false;
  }

  const normalizedMessage = normalizeOptionalText(input.message)?.toLowerCase();
  if (!normalizedMessage?.includes("profile")) {
    return false;
  }

  return (
    normalizedMessage.includes("not found") ||
    normalizedMessage.includes("disabled") ||
    normalizedMessage.includes("inactive") ||
    normalizedMessage.includes("deleted")
  );
}

function readGenericErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? normalizeOptionalText(code) : null;
}

function readGenericErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function toNetworkErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = normalizeOptionalText(error.message);
    if (message) {
      return message;
    }
    return error.name;
  }
  return "network error";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
