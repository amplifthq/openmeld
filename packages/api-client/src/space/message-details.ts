import { getSpaceMessageDetailsResponseSchema } from "@openmeld/schemas";
import type { GetSpaceMessageDetailsResponse } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceMessageDetailsPath } from "./routes";
import type { SpaceRequestInput } from "./types";

export async function getSpaceMessageDetails(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    signalId: string;
  }
): Promise<GetSpaceMessageDetailsResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("signalId", input.signalId);

  return await client.requestJson({
    url: `${buildSpaceMessageDetailsPath(input.spaceId)}?${searchParams.toString()}`,
    operation: "space.message_details",
    method: "GET",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: getSpaceMessageDetailsResponseSchema,
    invalidMessage: "invalid message details response",
  });
}
