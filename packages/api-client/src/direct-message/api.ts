import {
  agentDirectMessageSessionSelectorSchema,
  convertDirectMessageToSpaceBodySchema,
  convertDirectMessageToSpaceResponseSchema,
  deleteAgentDirectMessageSessionResponseSchema,
  listAgentDirectMessageSessionsQuerySchema,
  listAgentDirectMessageSessionsResponseSchema,
  openDirectMessageSpaceBodySchema,
  openDirectMessageSpaceResponseSchema,
  openMeldRequestContextSchema,
  updateAgentDirectMessageSessionBodySchema,
  updateAgentDirectMessageSessionResponseSchema,
} from "@openmeld/schemas";
import {
  buildDirectMessageConversionPath,
  buildDirectMessageSessionPath,
  buildDirectMessageSessionsPath,
  buildDirectMessageSpacePath,
} from "./routes";
import type {
  ConvertDirectMessageToSpaceInput,
  CreateDirectMessageApi,
  DirectMessageRequestInput,
  OpenDirectMessageSpaceInput,
} from "./types";

export const createDirectMessageApi: CreateDirectMessageApi = (client) => ({
  listSessions: async (input) => {
    const parsed = listAgentDirectMessageSessionsQuerySchema.safeParse({
      agentProfileId: input.agentProfileId,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.archived === undefined ? {} : { archived: input.archived }),
    });
    if (!parsed.success) {
      throw new Error("Provide a valid Agent, chat-list cursor and limit.");
    }
    const query = new URLSearchParams({
      agentProfileId: parsed.data.agentProfileId,
      limit: String(parsed.data.limit),
      archived: String(parsed.data.archived),
    });
    if (parsed.data.cursor !== undefined) {
      query.set("cursor", parsed.data.cursor);
    }
    return await client.requestJson({
      url: `${buildDirectMessageSessionsPath()}?${query.toString()}`,
      operation: "direct_message.session.list",
      method: "GET",
      requestContext: validateRequestInput(input).requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: listAgentDirectMessageSessionsResponseSchema,
      invalidMessage: "Invalid chat list.",
    });
  },
  updateSession: async (input) => {
    const selector = requireSessionSelector(input.spaceId);
    const body = updateAgentDirectMessageSessionBodySchema.safeParse(
      input.update
    );
    if (!body.success) {
      throw new Error(
        body.error.issues[0]?.message ?? "Provide a valid chat update."
      );
    }
    return await client.requestJson({
      url: buildDirectMessageSessionPath(selector),
      operation: `direct_message.session.${body.data.operation}`,
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body.data),
      requestContext: validateRequestInput(input).requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: updateAgentDirectMessageSessionResponseSchema,
      invalidMessage: "Invalid chat update response.",
    });
  },
  deleteSession: async (input) =>
    await client.requestJson({
      url: buildDirectMessageSessionPath(requireSessionSelector(input.spaceId)),
      operation: "direct_message.session.delete",
      method: "DELETE",
      requestContext: validateRequestInput(input).requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: deleteAgentDirectMessageSessionResponseSchema,
      invalidMessage: "Invalid chat deletion response.",
    }),
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

function requireSessionSelector(spaceId: string): string {
  const selector = agentDirectMessageSessionSelectorSchema.safeParse({
    spaceId,
  });
  if (!selector.success) {
    throw new Error("Provide a valid session ID.");
  }
  return selector.data.spaceId;
}

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
