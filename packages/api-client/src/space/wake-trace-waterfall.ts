import { getSpaceWakeTraceWaterfallResponseSchema } from "@openmeld/schemas";
import type { GetSpaceWakeTraceWaterfallResponse } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceWakeTraceWaterfallPath } from "./routes";
import type { SpaceRequestInput } from "./types";

export async function getSpaceWakeTraceWaterfall(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    clientMessageId?: string | null;
    sourceSignalId?: string | null;
    targetProfileId?: string;
  }
): Promise<GetSpaceWakeTraceWaterfallResponse> {
  const searchParams = new URLSearchParams();
  if (input.clientMessageId) {
    searchParams.set("clientMessageId", input.clientMessageId);
  }
  if (input.sourceSignalId) {
    searchParams.set("sourceSignalId", input.sourceSignalId);
  }
  if (input.targetProfileId) {
    searchParams.set("targetProfileId", input.targetProfileId);
  }

  const query = searchParams.toString();
  return await client.requestJson({
    url: `${buildSpaceWakeTraceWaterfallPath(input.spaceId)}?${query}`,
    operation: "space.wake_trace_waterfall",
    method: "GET",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: getSpaceWakeTraceWaterfallResponseSchema,
    invalidMessage: "invalid wake trace waterfall response",
  });
}
