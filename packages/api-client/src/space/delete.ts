import { deleteSpaceResponseSchema } from "@openmeld/schemas";
import type { DeleteSpaceResponse } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceDeletePath } from "./routes";
import type { SpaceRequestInput } from "./types";

export async function deleteSpace(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput
): Promise<DeleteSpaceResponse> {
  return await client.requestJson({
    url: buildSpaceDeletePath(input.spaceId),
    operation: "space.delete",
    method: "DELETE",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: deleteSpaceResponseSchema,
    invalidMessage: "invalid delete space response",
  });
}
