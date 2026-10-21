import {
  createOpenMeldApiClient,
  type OpenMeldApiClientFoundation,
} from "@openmeld/api-client";
import {
  buildOpenMeldRequestContextHeaders,
  OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID,
} from "@openmeld/gateway-contract";
import { buildRequestAuthHeaders } from "../config/request-headers";
import { sendWithCredentialConfirmation } from "../config/sensitive-operation-credentials";
import { fetchSpaceRequestWithTimeout } from "./fetch-with-timeout";

export function createCliApiClientFoundation(
  baseUrl: string,
  options: {
    onAuthHeadersResolved?: (headers: Record<string, string>) => void;
    organizationId?: string;
    expectedOwnerUserId?: string;
  } = {}
): OpenMeldApiClientFoundation {
  return createOpenMeldApiClient({
    baseUrl,
    transport: async (request) =>
      await sendWithCredentialConfirmation({
        baseUrl,
        headers: (request.init?.headers ?? {}) as Record<string, string>,
        method: request.init?.method,
        readConfirmation: async ({ url }) =>
          await fetchSpaceRequestWithTimeout({
            url,
            operation: "credential_confirmation.read",
            init: {
              method: "GET",
              headers: await buildRequestAuthHeaders({
                requestUrl: url,
                expectedOwnerUserId: options.expectedOwnerUserId,
              }),
            },
          }),
        send: async (headers) =>
          await fetchSpaceRequestWithTimeout({
            url: request.url,
            operation: request.operation,
            init: { ...request.init, headers },
            timeoutMs: request.timeoutMs,
          }),
      }),
    getAuthHeaders: async ({ requestUrl }) => {
      const headers = await buildRequestAuthHeaders({
        requestUrl,
        expectedOwnerUserId: options.expectedOwnerUserId,
      });
      if (options.organizationId) {
        headers[OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID] =
          options.organizationId;
      }
      options.onAuthHeadersResolved?.(headers);
      return headers;
    },
    getRequestContextHeaders: async ({ requestContext, spacePassword }) =>
      buildOpenMeldRequestContextHeaders({
        requestContext,
        ...(spacePassword === undefined ? {} : { spacePassword }),
      }),
  });
}
