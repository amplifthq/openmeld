import { getSpaceEntryResolutionResponseSchema } from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceEntryResolutionPath } from "./routes";
import type { ResolveSpaceEntryInput } from "./types";

export async function resolveSpaceEntry(
  client: OpenMeldApiClientFoundation,
  input: ResolveSpaceEntryInput
) {
  return await client.requestJson({
    url: buildSpaceEntryResolutionPath(input),
    operation: "space.entry.resolve",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: getSpaceEntryResolutionResponseSchema,
    invalidMessage: "invalid Space entry resolution response",
  });
}
