import {
  postNormalMessageBodySchema,
  postNormalMessageResponseSchema,
  toLegacySpaceAddressingWireValue,
} from "@openmeld/schemas";
import type {
  PostNormalMessageBody,
  PostNormalMessageResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import { buildSpaceSignalsPath } from "./routes";
import type { SpaceRequestInput } from "./types";

export async function postSpaceNormalMessage(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput & {
    text: PostNormalMessageBody["text"];
    attachments?: PostNormalMessageBody["attachments"];
    files?: PostNormalMessageBody["files"];
    messageEnvelope?: PostNormalMessageBody["messageEnvelope"];
    replyTo?: PostNormalMessageBody["replyTo"];
    meta?: PostNormalMessageBody["meta"];
  }
): Promise<PostNormalMessageResponse> {
  const body = buildPostNormalMessageBody(input);
  const parsedBody = postNormalMessageBodySchema.safeParse(body);

  if (!parsedBody.success) {
    const firstIssue = parsedBody.error.issues[0];
    throw new Error(
      firstIssue?.message ?? "invalid normal message request body"
    );
  }

  return await client.requestJson({
    url: buildSpaceSignalsPath(input.spaceId),
    operation: "space.send",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(toLegacySpaceAddressingWireValue(parsedBody.data)),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: postNormalMessageResponseSchema,
    invalidMessage: "invalid send response",
  });
}

function buildPostNormalMessageBody(input: {
  text: PostNormalMessageBody["text"];
  attachments?: PostNormalMessageBody["attachments"];
  files?: PostNormalMessageBody["files"];
  messageEnvelope?: PostNormalMessageBody["messageEnvelope"];
  replyTo?: PostNormalMessageBody["replyTo"];
  meta?: PostNormalMessageBody["meta"];
}): PostNormalMessageBody {
  return {
    text: input.text,
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(input.files ? { files: input.files } : {}),
    ...(input.messageEnvelope
      ? { messageEnvelope: input.messageEnvelope }
      : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.meta ? { meta: input.meta } : {}),
  };
}
