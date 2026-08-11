import { spaceBoardResponseSchema } from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  SpaceBoardResponse,
} from "@openmeld/schemas/types";
import { buildOpenMeldRequestContextHeadersWithAuth } from "../config/request-headers";
import { toSpaceBoardUrl } from "../protocol/urls";
import { fetchSpaceRequestWithTimeout } from "./fetch-with-timeout";
import { readGatewayJsonResponse } from "./gateway-response";

export async function fetchSpaceBoard(input: {
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  password?: string;
}): Promise<SpaceBoardResponse> {
  const endpoint = toSpaceBoardUrl(input.baseUrl, input.space);
  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.board.read",
    init: {
      headers: await buildOpenMeldRequestContextHeadersWithAuth({
        requestUrl: endpoint,
        requestContext: input.requestContext,
        spacePassword: input.password,
      }),
    },
  });
  return await readGatewayJsonResponse({
    response,
    schema: spaceBoardResponseSchema,
    invalidMessage: "invalid Space Board response",
  });
}
