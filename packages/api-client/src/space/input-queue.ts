import {
  spaceInputQueueMutationSchema,
  spaceInputQueueResponseSchema,
} from "@openmeld/schemas";
import type {
  SpaceInputQueueMutation,
  SpaceInputQueueOptions,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import type { SpaceRequestInput } from "./types";

export async function readOrUpdateSpaceInputQueue(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput &
    SpaceInputQueueOptions & { mutation?: SpaceInputQueueMutation }
) {
  const params = new URLSearchParams();
  if (input.includeRecovery) {
    params.set("recovery", "1");
  }
  if (input.includeConversationContext) {
    params.set("conversation", "1");
  }
  const query = params.size ? `?${params}` : "";
  return await client.requestJson({
    url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/input-queue${query}`,
    operation: "space.input-queue",
    method: input.mutation ? "PATCH" : "GET",
    ...(input.mutation
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            spaceInputQueueMutationSchema.parse(input.mutation)
          ),
        }
      : {}),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    spacePassword: input.spacePassword,
    schema: spaceInputQueueResponseSchema,
    invalidMessage: "Invalid queued messages response.",
  });
}
