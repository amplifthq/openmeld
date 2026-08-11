import {
  createAccountSpaceIndexApi,
  createFetchTransport,
  createOpenMeldApiClient,
  resolveAccountSpaceIndexGatewayHost,
} from "@openmeld/api-client";
import type {
  AccountSpaceIndexResponse,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { buildOpenMeldRequestContextHeadersWithAuth } from "./request-headers";

const ACCOUNT_SPACE_INDEX_TIMEOUT_MS = 10_000;

export async function listAccountSpaceIndex(input: {
  baseUrl: string;
  requestContext: OpenMeldRequestContext;
  includePurposes?: boolean;
  limit?: number;
  scope: "account" | "profile";
  selectedProfileId: string;
}): Promise<AccountSpaceIndexResponse> {
  return await createAccountSpaceIndexApi(
    createOpenMeldApiClient({
      baseUrl: input.baseUrl,
      transport: createFetchTransport({
        fetch,
        defaultTimeoutMs: ACCOUNT_SPACE_INDEX_TIMEOUT_MS,
      }),
      getRequestContextHeaders: async ({ requestUrl, requestContext }) =>
        await buildOpenMeldRequestContextHeadersWithAuth({
          requestUrl,
          requestContext,
        }),
    })
  ).listAccountSpaces({
    requestContext: input.requestContext,
    gatewayHost: resolveAccountSpaceIndexGatewayHost(input.baseUrl),
    ...(input.includePurposes === true ? { includePurposes: true } : {}),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    scope: input.scope,
    selectedProfileId: input.selectedProfileId,
    timeoutMs: ACCOUNT_SPACE_INDEX_TIMEOUT_MS,
  });
}
