import {
  OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
  OPENMELD_SPACE_ADDRESSING_VERSION,
} from "@openmeld/gateway-contract";
import { getSpaceDispatchResultResponseSchema } from "@openmeld/schemas";
import type {
  DispatchResult,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { buildOpenMeldRequestContextHeadersWithAuth } from "../config/request-headers";
import { toSpaceResultUrl } from "../protocol/urls";
import { parseJsonResponse } from "./api-json";
import { fetchSpaceRequestWithTimeout } from "./fetch-with-timeout";
import { readGatewayTextResponse } from "./gateway-response";

export async function fetchSpaceDispatchResult(input: {
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  dispatchId?: string;
  resultRef?: string;
  password?: string;
}): Promise<DispatchResult> {
  const endpoint = new URL(toSpaceResultUrl(input.baseUrl, input.space));
  if (input.dispatchId) {
    endpoint.searchParams.set("dispatchId", input.dispatchId);
  }
  if (input.resultRef) {
    endpoint.searchParams.set("resultRef", input.resultRef);
  }

  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint.toString(),
    operation: "space.result.read",
    init: {
      headers: {
        ...(await buildOpenMeldRequestContextHeadersWithAuth({
          requestUrl: endpoint.toString(),
          requestContext: input.requestContext,
          spacePassword: input.password,
        })),
        [OPENMELD_HEADER_SPACE_ADDRESSING_VERSION]:
          OPENMELD_SPACE_ADDRESSING_VERSION,
      },
    },
  });
  const raw = await readGatewayTextResponse({ response });

  const parsed = getSpaceDispatchResultResponseSchema.safeParse(
    parseJsonResponse(raw)
  );
  if (!parsed.success) {
    throw new Error("invalid space dispatch result response");
  }
  return parsed.data;
}
