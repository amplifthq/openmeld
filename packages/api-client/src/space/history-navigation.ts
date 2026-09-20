import { spaceHistoryNavigationSchema } from "@openmeld/schemas";
import type { SpaceHistoryNavigationQuery } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import type { SpaceRequestInput } from "./types";

export function getSpaceHistoryNavigation(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & SpaceHistoryNavigationQuery
) {
  const query = new URLSearchParams();
  if (input.startSignalId) {
    query.set("startSignalId", input.startSignalId);
  }
  if (input.endSignalId) {
    query.set("endSignalId", input.endSignalId);
  }
  return client.requestJson({
    url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/history-navigation?${query}`,
    operation: "space.history_navigation.read",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: spaceHistoryNavigationSchema,
    invalidMessage: "Invalid history navigation response",
  });
}
