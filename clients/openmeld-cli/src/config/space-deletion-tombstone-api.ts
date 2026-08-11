import type {
  OpenMeldRequestContext,
  QuerySpaceDeletionTombstonesBody,
  SpaceDeletionTombstoneRecord,
  UpsertSpaceDeletionTombstoneBody,
  UpsertSpaceDeletionTombstoneResponse,
} from "@openmeld/schemas";
import {
  querySpaceDeletionTombstonesResponseSchema,
  upsertSpaceDeletionTombstoneResponseSchema,
} from "@openmeld/schemas";
import { normalizeBaseUrl } from "../protocol/urls";
import { buildOpenMeldRequestContextHeadersWithAuth } from "./request-headers";

const SPACE_DELETION_TOMBSTONE_TIMEOUT_MS = 10_000;

export class SpaceDeletionTombstoneApiError extends Error {
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
    this.name = "SpaceDeletionTombstoneApiError";
    this.status =
      typeof input.status === "number" ? Math.trunc(input.status) : null;
    this.code = normalizeOptionalText(input.code);
    this.endpoint = input.endpoint;
    this.canFallbackToLocal = input.canFallbackToLocal === true;
  }
}

export async function querySpaceDeletionTombstones(input: {
  baseUrl: string;
  requestContext: OpenMeldRequestContext;
  openMeldProfileId?: string;
  profileName?: string;
  body: QuerySpaceDeletionTombstonesBody;
}): Promise<SpaceDeletionTombstoneRecord[]> {
  const endpoint = toSpaceDeletionTombstonesQueryEndpoint(input.baseUrl);
  const headers = await buildOpenMeldRequestContextHeadersWithAuth({
    requestUrl: endpoint,
    requestContext: input.requestContext,
  });

  const rawResponse = await requestSpaceDeletionTombstoneEndpoint({
    endpoint,
    method: "POST",
    headers,
    body: input.body,
  });
  const parsed = querySpaceDeletionTombstonesResponseSchema.safeParse(
    rawResponse.payload
  );
  if (!parsed.success) {
    throw new SpaceDeletionTombstoneApiError({
      endpoint,
      status: rawResponse.status,
      code: "space_deletion_tombstone.response_invalid",
      message: "invalid space deletion tombstone query response",
      canFallbackToLocal: true,
    });
  }
  return parsed.data.items;
}

export async function upsertSpaceDeletionTombstone(input: {
  baseUrl: string;
  requestContext: OpenMeldRequestContext;
  openMeldProfileId?: string;
  profileName?: string;
  spaceId: string;
  body: UpsertSpaceDeletionTombstoneBody;
}): Promise<UpsertSpaceDeletionTombstoneResponse> {
  const endpoint = toSpaceDeletionTombstoneUpsertEndpoint({
    baseUrl: input.baseUrl,
    spaceId: input.spaceId,
  });
  const headers = await buildOpenMeldRequestContextHeadersWithAuth({
    requestUrl: endpoint,
    requestContext: input.requestContext,
  });

  const rawResponse = await requestSpaceDeletionTombstoneEndpoint({
    endpoint,
    method: "PUT",
    headers,
    body: input.body,
  });
  const parsed = upsertSpaceDeletionTombstoneResponseSchema.safeParse(
    rawResponse.payload
  );
  if (!parsed.success) {
    throw new SpaceDeletionTombstoneApiError({
      endpoint,
      status: rawResponse.status,
      code: "space_deletion_tombstone.response_invalid",
      message: "invalid space deletion tombstone upsert response",
    });
  }
  return parsed.data;
}

function toSpaceDeletionTombstonesQueryEndpoint(baseUrl: string): string {
  const endpoint = new URL(normalizeBaseUrl(baseUrl));
  endpoint.pathname = "/v1/spaces/deletion-tombstones/query";
  return endpoint.toString();
}

function toSpaceDeletionTombstoneUpsertEndpoint(input: {
  baseUrl: string;
  spaceId: string;
}): string {
  const endpoint = new URL(normalizeBaseUrl(input.baseUrl));
  endpoint.pathname = `/v1/spaces/${encodeURIComponent(input.spaceId)}/deletion-tombstone`;
  return endpoint.toString();
}

async function requestSpaceDeletionTombstoneEndpoint(input: {
  endpoint: string;
  method: "POST" | "PUT";
  headers: Record<string, string>;
  body: QuerySpaceDeletionTombstonesBody | UpsertSpaceDeletionTombstoneBody;
}): Promise<{ status: number; payload: unknown }> {
  const headers = {
    ...input.headers,
    "content-type": "application/json",
  };

  let response: Response;
  try {
    response = await fetch(input.endpoint, {
      method: input.method,
      headers,
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(SPACE_DELETION_TOMBSTONE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SpaceDeletionTombstoneApiError({
      endpoint: input.endpoint,
      code: "space_deletion_tombstone.network_error",
      message: toNetworkErrorMessage(error),
      canFallbackToLocal: input.method === "POST",
    });
  }

  let raw = "";
  try {
    raw = await response.text();
  } catch (error) {
    throw new SpaceDeletionTombstoneApiError({
      endpoint: input.endpoint,
      status: response.status,
      code: "space_deletion_tombstone.network_error",
      message: toNetworkErrorMessage(error),
      canFallbackToLocal: input.method === "POST",
    });
  }

  const payload = parseJson(raw);
  if (!response.ok) {
    const code = readErrorField(payload, "code");
    throw new SpaceDeletionTombstoneApiError({
      endpoint: input.endpoint,
      status: response.status,
      code,
      message: extractErrorMessage(payload, raw, response.status),
      canFallbackToLocal: input.method === "POST" && response.status >= 500,
    });
  }

  return {
    status: response.status,
    payload,
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function readErrorField(
  payload: unknown,
  field: "code" | "message"
): string | null {
  if (!(payload && typeof payload === "object")) {
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
  return `space deletion tombstone request failed with status ${status}`;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toNetworkErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = normalizeOptionalText(error.message);
    if (message) {
      return message;
    }
  }
  return "network request failed";
}
