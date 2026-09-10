import { getSpaceMessageReactionsResponseSchema } from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import type { SpaceRequestInput } from "./types";
export type ReadMessageReactionsInput = SpaceRequestInput & {
  signalId: string;
  emoji?: string;
  afterProfileId?: string;
};
export type SetMessageReactionInput = SpaceRequestInput & {
  signalId: string;
  emoji: string;
  active: boolean;
};
export function getSpaceMessageReactions(
  client: OpenMeldApiClientFoundation,
  input: ReadMessageReactionsInput
) {
  const query = new URLSearchParams({ signalId: input.signalId });
  if (input.emoji) {
    query.set("emoji", input.emoji);
  }
  if (input.afterProfileId) {
    query.set("afterProfileId", input.afterProfileId);
  }
  return client.requestJson({
    ...requestFields(input),
    url: `${path(input.spaceId)}?${query}`,
    method: "GET",
    operation: "space.reactions.read",
  });
}
export function setSpaceMessageReaction(
  client: OpenMeldApiClientFoundation,
  input: SetMessageReactionInput
) {
  return client.requestJson({
    ...requestFields(input),
    url: path(input.spaceId),
    method: "PUT",
    operation: "space.reactions.set",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      signalId: input.signalId,
      emoji: input.emoji,
      active: input.active,
    }),
  });
}
function path(spaceId: string) {
  return `/v1/spaces/${encodeURIComponent(spaceId)}/message-reactions`;
}
function requestFields(input: SpaceRequestInput) {
  return {
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: getSpaceMessageReactionsResponseSchema,
    invalidMessage: "Invalid message reactions response",
  };
}
