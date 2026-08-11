import { getSpaceUpdatesResponseSchema } from "@openmeld/schemas";
import type {
  GetSpaceUpdatesResponse,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { buildOpenMeldRequestContextHeadersWithAuth } from "../config/request-headers";
import { toSpaceUpdatesUrl } from "../protocol/urls";
import { parseJsonResponse } from "./api-json";
import { fetchSpaceRequestWithTimeout } from "./fetch-with-timeout";
import { readGatewayTextResponse } from "./gateway-response";

export async function fetchSpaceUpdates(input: {
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  afterSignalId: string;
  limit: number;
  password?: string;
}): Promise<GetSpaceUpdatesResponse> {
  const endpoint = new URL(toSpaceUpdatesUrl(input.baseUrl, input.space));
  endpoint.searchParams.set("afterSignalId", input.afterSignalId);
  endpoint.searchParams.set("limit", String(input.limit));

  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint.toString(),
    operation: "space.updates.read",
    init: {
      headers: await buildOpenMeldRequestContextHeadersWithAuth({
        requestUrl: endpoint.toString(),
        requestContext: input.requestContext,
        spacePassword: input.password,
      }),
    },
  });
  const raw = await readGatewayTextResponse({ response });

  const parsed = getSpaceUpdatesResponseSchema.safeParse(
    parseJsonResponse(raw)
  );
  if (!parsed.success) {
    throw new Error("invalid space updates response");
  }
  return parsed.data;
}
