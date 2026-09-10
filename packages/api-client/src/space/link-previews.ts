import { getSpaceLinkPreviewsResponseSchema } from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import type { SpaceRequestInput } from "./types";

export function getSpaceLinkPreviews(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & { signalId: string }
) {
  const query = new URLSearchParams({ signalId: input.signalId });
  return client.requestJson({
    url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/link-previews?${query}`,
    operation: "space.link_previews",
    method: "GET",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs ?? 30_000,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: getSpaceLinkPreviewsResponseSchema,
    invalidMessage: "Invalid link preview response.",
  });
}
