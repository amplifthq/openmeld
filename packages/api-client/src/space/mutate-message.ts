import {
  spaceMessageMutationBodySchema,
  spaceMessageMutationResponseSchema,
} from "@openmeld/schemas";
import type { SpaceMessageMutationBody } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import type { SpaceRequestInput } from "./types";

export function mutateSpaceMessage(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    signalId: string;
    body: SpaceMessageMutationBody;
  }
) {
  return client.requestJson({
    url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/messages/${encodeURIComponent(input.signalId)}`,
    operation: "space.message.change",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spaceMessageMutationBodySchema.parse(input.body)),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: spaceMessageMutationResponseSchema,
    invalidMessage: "Invalid message change response",
  });
}
