import {
  type PatchSpaceContractBody,
  patchSpaceContractResponseSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  SpaceContract,
} from "@openmeld/schemas/types";
import { buildOpenMeldRequestContextHeadersWithAuth } from "../config/request-headers";
import { toSpaceContractUrl } from "../protocol/urls";
import { fetchSpaceRequestWithTimeout } from "./fetch-with-timeout";
import { readGatewayJsonResponse } from "./gateway-response";

export async function patchSpaceContract(input: {
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  contractPatch: PatchSpaceContractBody;
  password?: string;
}): Promise<SpaceContract> {
  const endpoint = toSpaceContractUrl(input.baseUrl, input.space);
  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.contract.patch",
    init: {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(await buildOpenMeldRequestContextHeadersWithAuth({
          requestUrl: endpoint,
          requestContext: input.requestContext,
          spacePassword: input.password,
        })),
      },
      body: JSON.stringify(input.contractPatch),
    },
  });
  return await readGatewayJsonResponse({
    response,
    schema: patchSpaceContractResponseSchema,
    invalidMessage: "invalid patched space contract response",
  });
}
