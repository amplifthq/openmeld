import {
  respondToSpaceAgentInteractionBodySchema,
  respondToSpaceAgentInteractionResponseSchema,
} from "@openmeld/schemas";
import type {
  RespondToSpaceAgentInteractionBody,
  RespondToSpaceAgentInteractionResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceAgentInteractionResponsePath } from "./routes";
import type { SpaceRequestInput } from "./types";

export async function respondToSpaceAgentInteraction(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    body: RespondToSpaceAgentInteractionBody;
  }
): Promise<RespondToSpaceAgentInteractionResponse> {
  const parsedBody = respondToSpaceAgentInteractionBodySchema.safeParse(
    input.body
  );
  if (!parsedBody.success) {
    throw new Error(
      parsedBody.error.issues[0]?.message ??
        "invalid agent interaction response"
    );
  }

  return await client.requestJson({
    body: JSON.stringify(parsedBody.data),
    headers: {
      "content-type": "application/json",
    },
    invalidMessage: "invalid agent interaction result",
    method: "POST",
    operation: "space.agent_interaction.respond",
    requestContext: input.requestContext,
    schema: respondToSpaceAgentInteractionResponseSchema,
    signal: input.signal,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    timeoutMs: input.timeoutMs,
    url: buildSpaceAgentInteractionResponsePath(input.spaceId),
  });
}
