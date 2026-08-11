import {
  removeSpaceMembersBodySchema,
  removeSpaceMembersResponseSchema,
} from "@openmeld/schemas";
import type { RemoveSpaceMembersResponse } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceRemoveMembersPath } from "./routes";
import type { RemoveSpaceMembersInput } from "./types";

export async function removeSpaceMembers(
  client: OpenMeldApiClientFoundation,
  input: RemoveSpaceMembersInput
): Promise<RemoveSpaceMembersResponse> {
  const parsedBody = removeSpaceMembersBodySchema.safeParse({
    memberProfileIds: input.memberProfileIds,
  });

  if (!parsedBody.success) {
    throw new Error(
      parsedBody.error.issues[0]?.message ??
        "invalid remove space members request body"
    );
  }

  return await client.requestJson({
    url: buildSpaceRemoveMembersPath(input.spaceId),
    operation: "space.members.remove",
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
    schema: removeSpaceMembersResponseSchema,
    invalidMessage: "invalid remove space members response",
  });
}
