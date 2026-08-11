import {
  OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID,
  OPENMELD_HEADER_AGENT_CONTROLLER_REF,
  OPENMELD_HEADER_AUTO_RELAY_DEPTH,
  OPENMELD_HEADER_CALLER_PRINCIPAL_ID,
  OPENMELD_HEADER_DISPATCH_CHAIN_ID,
  OPENMELD_HEADER_FORWARDED_BY,
  OPENMELD_HEADER_OWNER_NAME,
  OPENMELD_HEADER_OWNER_USER_ID,
  OPENMELD_HEADER_PROFILE_HANDLE,
  OPENMELD_HEADER_PROFILE_ID,
  OPENMELD_HEADER_PROFILE_KIND,
  OPENMELD_HEADER_PROFILE_NAME,
  OPENMELD_HEADER_REQUEST_ID,
  OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID,
  OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG,
  OPENMELD_HEADER_SPACE_PASSWORD,
  OPENMELD_HEADER_VISITED_PROFILE_IDS,
  OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH,
} from "@openmeld/gateway-contract";
import { normalizeSpacePasswordText } from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { normalizeApiBaseUrl } from "./base-url";
import { readApiClientJsonResponse, readApiClientTextResponse } from "./errors";
import type {
  OpenMeldApiClientStreamTransport,
  OpenMeldApiClientTransport,
} from "./transport";

const AUTHORIZATION_HEADER = "authorization";
const RESERVED_HEADERS = new Set(
  [
    AUTHORIZATION_HEADER,
    OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID,
    OPENMELD_HEADER_AUTO_RELAY_DEPTH,
    OPENMELD_HEADER_CALLER_PRINCIPAL_ID,
    OPENMELD_HEADER_AGENT_CONTROLLER_REF,
    OPENMELD_HEADER_DISPATCH_CHAIN_ID,
    OPENMELD_HEADER_FORWARDED_BY,
    OPENMELD_HEADER_OWNER_NAME,
    OPENMELD_HEADER_OWNER_USER_ID,
    OPENMELD_HEADER_PROFILE_HANDLE,
    OPENMELD_HEADER_PROFILE_ID,
    OPENMELD_HEADER_PROFILE_KIND,
    OPENMELD_HEADER_PROFILE_NAME,
    OPENMELD_HEADER_REQUEST_ID,
    OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID,
    OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG,
    OPENMELD_HEADER_SPACE_PASSWORD,
    OPENMELD_HEADER_VISITED_PROFILE_IDS,
    OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH,
  ].map((value) => value.toLowerCase())
);

type SafeParseResult<T> = { success: true; data: T } | { success: false };

type ResponseSchema<T> = {
  safeParse: (value: unknown) => SafeParseResult<T>;
};

export type OpenMeldApiClientRequestOptions = {
  url: string;
  operation: string;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
  requestContext?: OpenMeldRequestContext;
  spacePassword?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type OpenMeldApiClientConfig = {
  baseUrl: string;
  transport: OpenMeldApiClientTransport;
  getAuthHeaders?: (input: {
    requestUrl: string;
  }) => Promise<Record<string, string>>;
  getRequestContextHeaders?: (input: {
    requestUrl: string;
    requestContext: OpenMeldRequestContext;
    spacePassword?: string;
  }) => Promise<Record<string, string>>;
  streamTransport?: OpenMeldApiClientStreamTransport;
};

export type OpenMeldApiClientFoundation = {
  requestResponse: (
    input: OpenMeldApiClientRequestOptions
  ) => Promise<Response>;
  requestJson: <T>(
    input: OpenMeldApiClientRequestOptions & {
      schema: ResponseSchema<T>;
      invalidMessage: string;
    }
  ) => Promise<T>;
  requestText: (input: OpenMeldApiClientRequestOptions) => Promise<string>;
};

export function createOpenMeldApiClient(
  config: OpenMeldApiClientConfig
): OpenMeldApiClientFoundation {
  const normalizedBaseUrl = normalizeApiBaseUrl(config.baseUrl);

  return {
    requestResponse: async (input: OpenMeldApiClientRequestOptions) =>
      await performRequest({
        config,
        baseUrl: normalizedBaseUrl,
        input,
      }),
    requestJson: async <T>(
      input: OpenMeldApiClientRequestOptions & {
        schema: ResponseSchema<T>;
        invalidMessage: string;
      }
    ): Promise<T> => {
      const response = await performRequest({
        config,
        baseUrl: normalizedBaseUrl,
        input,
      });
      return await readApiClientJsonResponse({
        response,
        schema: input.schema,
        invalidMessage: input.invalidMessage,
        operation: input.operation,
      });
    },
    requestText: async (
      input: OpenMeldApiClientRequestOptions
    ): Promise<string> => {
      const response = await performRequest({
        config,
        baseUrl: normalizedBaseUrl,
        input,
      });
      return await readApiClientTextResponse({ response });
    },
  };
}

async function performRequest(input: {
  config: OpenMeldApiClientConfig;
  baseUrl: string;
  input: OpenMeldApiClientRequestOptions;
}): Promise<Response> {
  const requestUrl = resolveRequestUrl(input.baseUrl, input.input.url);
  const headers = await resolveRequestHeaders({
    config: input.config,
    requestUrl,
    requestContext: input.input.requestContext,
    spacePassword: input.input.spacePassword,
    requestHeaders: input.input.headers,
  });

  return await input.config.transport({
    url: requestUrl,
    operation: input.input.operation,
    timeoutMs: input.input.timeoutMs,
    init: {
      method: input.input.method,
      headers,
      body: input.input.body ?? undefined,
      signal: input.input.signal,
    },
  });
}

async function resolveRequestHeaders(input: {
  config: OpenMeldApiClientConfig;
  requestUrl: string;
  requestContext?: OpenMeldRequestContext;
  spacePassword?: string;
  requestHeaders?: Record<string, string>;
}): Promise<Record<string, string>> {
  assertNoReservedHeaderOverrides(input.requestHeaders);

  const authHeaders = normalizeHeaderRecord(
    input.config.getAuthHeaders
      ? await input.config.getAuthHeaders({ requestUrl: input.requestUrl })
      : {}
  );
  const requestContextHeaders = normalizeHeaderRecord(
    input.requestContext && input.config.getRequestContextHeaders
      ? await input.config.getRequestContextHeaders({
          requestUrl: input.requestUrl,
          requestContext: input.requestContext,
          ...(input.spacePassword === undefined
            ? {}
            : { spacePassword: input.spacePassword }),
        })
      : {}
  );
  const requestHeaders = normalizeHeaderRecord(input.requestHeaders ?? {});
  const spacePassword =
    input.spacePassword === undefined
      ? undefined
      : normalizeSpacePasswordText(input.spacePassword);

  return {
    ...authHeaders,
    ...requestContextHeaders,
    ...(spacePassword
      ? { [OPENMELD_HEADER_SPACE_PASSWORD]: spacePassword }
      : {}),
    ...requestHeaders,
  };
}

function resolveRequestUrl(baseUrl: string, candidate: string): string {
  return new URL(candidate, `${baseUrl}/`).toString();
}

function assertNoReservedHeaderOverrides(
  headers: Record<string, string> | undefined
): void {
  if (!headers) {
    return;
  }

  for (const headerName of Object.keys(headers)) {
    if (!RESERVED_HEADERS.has(headerName.toLowerCase())) {
      continue;
    }
    throw new Error(
      `request headers must not override reserved header: ${headerName}`
    );
  }
}

function normalizeHeaderRecord(
  headers: Record<string, string>
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = String(key).trim();
    if (normalizedKey.length === 0) {
      continue;
    }
    normalized[normalizedKey] = String(value);
  }

  return normalized;
}
