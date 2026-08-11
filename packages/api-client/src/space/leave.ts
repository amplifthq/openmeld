import { leaveSpaceResponseSchema } from "@openmeld/schemas";
import type { LeaveSpaceResponse } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceLeavePath } from "./routes";
import type { SpaceRequestInput } from "./types";

export async function leaveSpace(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput
): Promise<LeaveSpaceResponse> {
  return await client.requestJson({
    url: buildSpaceLeavePath(input.spaceId),
    operation: "space.leave",
    method: "POST",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: leaveSpaceResponseSchema,
    invalidMessage: "invalid leave space response",
  });
}
