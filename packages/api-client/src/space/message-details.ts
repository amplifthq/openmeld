import { getSpaceMessageDetailsResponseSchema } from "@openmeld/schemas";
import type { GetSpaceMessageDetailsResponse } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceMessageDetailsPath } from "./routes";
import type { SpaceRequestInput } from "./types";

export async function getSpaceMessageDetails(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    includeThreadContext?: true;
    signalId: string;
    executionContextVersion?: 1;
    delegationVersion?: 1;
    delegationCursor?: string;
  }
): Promise<GetSpaceMessageDetailsResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("signalId", input.signalId);
  if (input.includeThreadContext) {
    searchParams.set("includeThreadContext", "true");
  }
  if (input.delegationVersion === 1) {
    searchParams.set("delegationVersion", "1");
  }
  if (input.delegationCursor) {
    searchParams.set("delegationCursor", input.delegationCursor);
  }
  if (input.executionContextVersion === 1) {
    searchParams.set("executionContextVersion", "1");
  }

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
