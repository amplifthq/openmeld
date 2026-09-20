import {
  spaceFilePinMutationSchema,
  spaceFilePinsResponseSchema,
  spaceMessagePinMutationSchema,
  spaceMessagePinsResponseSchema,
} from "@openmeld/schemas";
import type {
  SpaceFilePinMutation,
  SpaceMessagePinMutation,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import type { SpaceRequestInput } from "./types";

export async function readOrUpdateSpaceFilePins(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { mutation?: SpaceFilePinMutation }
) {
  return await client.requestJson({
    url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/file-pins`,
    operation: "space.file-pins",
    method: input.mutation ? "PATCH" : "GET",
    ...(input.mutation
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            spaceFilePinMutationSchema.parse(input.mutation)
          ),
        }
      : {}),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    spacePassword: input.spacePassword,
    schema: spaceFilePinsResponseSchema,
    invalidMessage: "Invalid pinned files response.",
  });
}

export async function readOrUpdateSpaceMessagePins(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { mutation?: SpaceMessagePinMutation }
) {
  return await client.requestJson({
    url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/message-pins`,
    operation: "space.message-pins",
    method: input.mutation ? "PATCH" : "GET",
    ...(input.mutation
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            spaceMessagePinMutationSchema.parse(input.mutation)
          ),
        }
      : {}),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    spacePassword: input.spacePassword,
    schema: spaceMessagePinsResponseSchema,
    invalidMessage: "Invalid pinned messages response.",
  });
}
