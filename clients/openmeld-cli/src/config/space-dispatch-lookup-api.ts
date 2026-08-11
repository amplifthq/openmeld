import {
  type GetSpaceDispatchLookupResponse,
  getSpaceDispatchLookupResponseSchema,
  type OpenMeldRequestContext,
} from "@openmeld/schemas";
import { toSpaceDispatchLookupUrl } from "../protocol/urls";
import { fetchSpaceRequestWithTimeout } from "../space/fetch-with-timeout";
import { readGatewayJsonResponse } from "../space/gateway-response";
import { buildOpenMeldRequestContextHeadersWithAuth } from "./request-headers";

export async function fetchSpaceDispatchLookup(input: {
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  sourceSignalId?: string;
  clientMessageId?: string;
  targetProfileId?: string;
  password?: string;
}): Promise<GetSpaceDispatchLookupResponse> {
  const endpoint = new URL(
    toSpaceDispatchLookupUrl(input.baseUrl, input.space)
  );
  if (typeof input.sourceSignalId === "string") {
    endpoint.searchParams.set("sourceSignalId", input.sourceSignalId);
  }
  if (typeof input.clientMessageId === "string") {
    endpoint.searchParams.set("clientMessageId", input.clientMessageId);
  }
  if (typeof input.targetProfileId === "string") {
    endpoint.searchParams.set("targetProfileId", input.targetProfileId);
  }
  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint.toString(),
    operation: "space.dispatch_lookup",
    init: {
      headers: await buildOpenMeldRequestContextHeadersWithAuth({
        requestUrl: endpoint.toString(),
        requestContext: input.requestContext,
        spacePassword: input.password,
      }),
    },
  });
  return await readGatewayJsonResponse({
    response,
    schema: getSpaceDispatchLookupResponseSchema,
    invalidMessage: "invalid space dispatch lookup response",
  });
}
