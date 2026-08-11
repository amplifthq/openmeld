import {
  postSpaceWakeStopBodySchema,
  postSpaceWakeStopResponseSchema,
} from "@openmeld/schemas";
import type {
  PostSpaceWakeStopBody,
  PostSpaceWakeStopResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceWakeStopPath } from "./routes";
import type { SpaceRequestInput } from "./types";

export async function postSpaceWakeStop(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    body: PostSpaceWakeStopBody;
  }
): Promise<PostSpaceWakeStopResponse> {
  const parsedBody = postSpaceWakeStopBodySchema.safeParse(input.body);
  if (!parsedBody.success) {
    const firstIssue = parsedBody.error.issues[0];
    throw new Error(firstIssue?.message ?? "invalid Wake Stop request body");
  }

  return await client.requestJson({
    url: buildSpaceWakeStopPath(input.spaceId),
    operation: "space.wake_stop",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(parsedBody.data),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: postSpaceWakeStopResponseSchema,
    invalidMessage: "invalid Wake Stop response",
  });
}
