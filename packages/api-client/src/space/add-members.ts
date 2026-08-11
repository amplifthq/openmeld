import {
  postSpaceMembersBodySchema,
  postSpaceMembersResponseSchema,
} from "@openmeld/schemas";
import type { PostSpaceMembersResponse } from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceMembersPath } from "./routes";
import type { AddSpaceMembersInput } from "./types";

export async function addSpaceMembers(
  client: OpenMeldApiClientFoundation,
  input: AddSpaceMembersInput
): Promise<PostSpaceMembersResponse> {
  const parsedBody = postSpaceMembersBodySchema.safeParse({
    memberProfileIds: input.memberProfileIds,
  });

  if (!parsedBody.success) {
    throw new Error(
      parsedBody.error.issues[0]?.message ??
        "invalid add space members request body"
    );
  }

  return await client.requestJson({
    url: buildSpaceMembersPath(input.spaceId),
    operation: "space.members.add",
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
    schema: postSpaceMembersResponseSchema,
    invalidMessage: "invalid add space members response",
  });
}
