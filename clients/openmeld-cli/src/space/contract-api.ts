import { getSpaceContractResponseSchema } from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  SpaceContract,
} from "@openmeld/schemas/types";
import { buildOpenMeldRequestContextHeadersWithAuth } from "../config/request-headers";
import { toSpaceContractUrl } from "../protocol/urls";
import { fetchSpaceRequestWithTimeout } from "./fetch-with-timeout";
import { readGatewayJsonResponse } from "./gateway-response";

export async function fetchSpaceContract(input: {
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  password?: string;
}): Promise<SpaceContract> {
  const endpoint = toSpaceContractUrl(input.baseUrl, input.space);
  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.contract.read",
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
    schema: getSpaceContractResponseSchema,
    invalidMessage: "invalid space contract response",
  });
}
