import {
  deleteConversationForMeResponseSchema,
  deleteSpaceResponseSchema,
} from "@openmeld/schemas";
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

export async function deleteConversationForMe(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput
) {
  return await client.requestJson({
    url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/personal-history`,
    operation: "conversation.delete_for_me",
    method: "DELETE",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    schema: deleteConversationForMeResponseSchema,
    invalidMessage: "invalid personal conversation deletion response",
  });
}
