import { getSpaceStatusResponseSchema } from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import { currentSpaceAccessHeaders } from "./access-version";
import { buildSpaceStatusPath } from "./routes";
import type { SpaceRequestInput } from "./types";

export async function getSpaceStatus(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput
) {
  return await client.requestJson({
    url: buildSpaceStatusPath(input.spaceId),
    operation: "space.status.read",
    headers: currentSpaceAccessHeaders(),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: getSpaceStatusResponseSchema,
    invalidMessage: "invalid space status response",
  });
}
