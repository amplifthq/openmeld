import type { SpaceMeta } from "@openmeld/protocol";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { buildOpenMeldRequestContextHeadersWithAuth } from "../config/request-headers";
import { toSpaceMetaUrl } from "../protocol/urls";
import { fetchSpaceRequestWithTimeout } from "./fetch-with-timeout";
import { readGatewayTextResponse } from "./gateway-response";
import { parseSpaceMetaResponse } from "./space-meta-response";

type SpaceMetaApiInput = {
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  password?: string;
};

export async function fetchSpaceMeta(
  input: SpaceMetaApiInput
): Promise<SpaceMeta> {
  const endpoint = toSpaceMetaUrl(input.baseUrl, input.space);
  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.fetch_meta",
    init: {
      method: "GET",
      headers: await buildOpenMeldRequestContextHeadersWithAuth({
        requestUrl: endpoint,
        requestContext: input.requestContext,
        spacePassword: input.password,
      }),
    },
  });
  const raw = await readGatewayTextResponse({ response });

  return parseSpaceMetaResponse({
    raw,
    endpoint,
    operation: "fetchSpaceMeta",
  });
}

export async function updateSpaceMeta(
  input: SpaceMetaApiInput & {
    purpose?: string;
    guide?: string;
  }
): Promise<SpaceMeta> {
  const endpoint = toSpaceMetaUrl(input.baseUrl, input.space);
  const headers = await buildOpenMeldRequestContextHeadersWithAuth({
    requestUrl: endpoint,
    requestContext: input.requestContext,
    spacePassword: input.password,
  });
  headers["content-type"] = "application/json";

  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.update_meta",
    init: {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
        ...(input.guide === undefined ? {} : { guide: input.guide }),
      }),
    },
  });
  const raw = await readGatewayTextResponse({ response });

  return parseSpaceMetaResponse({
    raw,
    endpoint,
    operation: "updateSpaceMeta",
  });
}
