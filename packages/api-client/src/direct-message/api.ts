import {
  convertDirectMessageToSpaceBodySchema,
  convertDirectMessageToSpaceResponseSchema,
  openDirectMessageSpaceBodySchema,
  openDirectMessageSpaceResponseSchema,
  openMeldRequestContextSchema,
} from "@openmeld/schemas";
import {
  buildDirectMessageConversionPath,
  buildDirectMessageSpacePath,
} from "./routes";
import type {
  ConvertDirectMessageToSpaceInput,
  CreateDirectMessageApi,
  DirectMessageRequestInput,
  OpenDirectMessageSpaceInput,
} from "./types";

export const createDirectMessageApi: CreateDirectMessageApi = (client) => ({
  convertToSpace: async (input) => {
    const request = validateConvertDirectMessageToSpaceInput(input);
    return await client.requestJson({
      body: JSON.stringify({
        includeMemberSnapshots: request.includeMemberSnapshots,
        name: request.name,
        profileIds: request.profileIds,
      }),
      headers: { "content-type": "application/json" },
      invalidMessage: "Invalid Direct Message conversion response.",
      method: "POST",
      operation: "direct_message.space.convert",
      requestContext: request.requestContext,
      schema: convertDirectMessageToSpaceResponseSchema,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      url: buildDirectMessageConversionPath(request.spaceId),
    });
  },
  openSpace: async (input) => {
    const request = validateOpenDirectMessageSpaceInput(input);
    const response = await client.requestJson({
      url: buildDirectMessageSpacePath(),
      operation: "direct_message.space.open",
      method: "POST",
      requestContext: request.requestContext,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetProfileId: request.targetProfileId,
        spaceId: request.spaceId,
        creationId: request.creationId,
        message: request.message,
      }),
      schema: openDirectMessageSpaceResponseSchema,
      invalidMessage: "Invalid Direct Message Space response.",
    });
    // Older Core receivers can ignore new RPC arguments during cloud rollout.
    // Require evidence for each requested effect before reporting success.
    if (request.spaceId && response.spaceId !== request.spaceId) {
      throw new Error(
        "The server did not confirm the selected Direct Message."
      );
    }
    if (request.creationId && response.creationId !== request.creationId) {
      throw new Error(
        "The server did not confirm the new chat. Update OpenMeld and retry with the same creation ID."
      );
    }
    if (
      request.message &&
      response.signal?.data.meta?.clientMessageId !==
        request.message.clientMessageId
    ) {
      throw new Error(
        "The server did not confirm the Direct Message. Update OpenMeld and retry with the same message ID."
      );
    }
    return response;
  },
});

function validateConvertDirectMessageToSpaceInput(
  input: ConvertDirectMessageToSpaceInput
): ConvertDirectMessageToSpaceInput {
  const parsed = convertDirectMessageToSpaceBodySchema.safeParse({
    includeMemberSnapshots: input.includeMemberSnapshots,
    name: input.name,
    profileIds: input.profileIds,
  });
  if (!parsed.success || input.spaceId.trim().length === 0) {
    throw new Error(
      parsed.error?.issues[0]?.message ??
        "Invalid Direct Message conversion request."
    );
  }
  validateRequestInput(input);
  return input;
}

function validateRequestInput<T extends DirectMessageRequestInput>(
  input: T
): T {
  const parsed = openMeldRequestContextSchema
    .optional()
    .safeParse(input.requestContext);
  if (!parsed.success) {
    throw new Error("Invalid Direct Message request context.");
  }
  return input;
}

function validateOpenDirectMessageSpaceInput(
  input: OpenDirectMessageSpaceInput
): OpenDirectMessageSpaceInput {
  const parsed = openDirectMessageSpaceBodySchema.safeParse({
    targetProfileId: input.targetProfileId,
    spaceId: input.spaceId,
    creationId: input.creationId,
    message: input.message,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid Direct Message target."
    );
  }
  validateRequestInput(input);
  return input;
}
