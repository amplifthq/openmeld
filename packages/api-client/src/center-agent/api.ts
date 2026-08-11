import {
  centerAgentModelConfigurationResponseSchema,
  centerAgentSlackWorkspaceConnectBodySchema,
  centerAgentSlackWorkspaceConnectionResponseSchema,
  centerAgentSlackWorkspaceDisconnectResponseSchema,
  centerAgentUpdateProfileBodySchema,
  centerAgentUpdateProfileResponseSchema,
  createCenterAgentContextLoadReceiptBodySchema,
  createCenterAgentContextLoadReceiptResponseSchema,
  createCenterAgentContextManifestBodySchema,
  createCenterAgentContextManifestResponseSchema,
  designateCenterAgentBodySchema,
  designateCenterAgentResponseSchema,
  getCenterAgentDesignationResponseSchema,
  getCenterAgentDirectMessageSpaceProjectionResponseSchema,
  getCenterAgentOperatingStateResponseSchema,
  listCenterAgentAuditJournalQuerySchema,
  listCenterAgentAuditJournalResponseSchema,
  openCenterAgentDirectMessageSpaceResponseSchema,
  openMeldRequestContextSchema,
  slackIdentityLinkConsumeBodySchema,
  slackIdentityLinkConsumeResponseSchema,
  slackIdentityLinkPreviewBodySchema,
  slackIdentityLinkPreviewResponseSchema,
  updateCenterAgentModelBodySchema,
  updateCenterAgentModelResponseSchema,
  updateCenterAgentOperatingStateBodySchema,
  updateCenterAgentOperatingStateResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildCenterAgentAuditJournalPath,
  buildCenterAgentContextLoadReceiptPath,
  buildCenterAgentContextManifestPath,
  buildCenterAgentDesignationPath,
  buildCenterAgentDirectMessageSpacePath,
  buildCenterAgentModelPath,
  buildCenterAgentOperatingStatePath,
  buildCenterAgentProfilePath,
  buildCenterAgentSlackWorkspaceConnectionPath,
  buildSlackIdentityLinkConsumePath,
  buildSlackIdentityLinkPreviewPath,
} from "./routes";
import type {
  CenterAgentDesignateInput,
  CenterAgentRequestInput,
  CenterAgentSlackWorkspaceConnectInput,
  CenterAgentUpdateModelInput,
  CenterAgentUpdateOperatingStateInput,
  CenterAgentUpdateProfileInput,
  CreateCenterAgentApi,
  CreateCenterAgentContextLoadReceiptInput,
  CreateCenterAgentContextManifestInput,
  ListCenterAgentAuditJournalInput,
  SlackIdentityLinkConsumeInput,
  SlackIdentityLinkPreviewInput,
} from "./types";

export const createCenterAgentApi: CreateCenterAgentApi = (
  client: OpenMeldApiClientFoundation
) => ({
  getDesignation: async (input = {}) =>
    await client.requestJson({
      url: buildCenterAgentDesignationPath(),
      operation: "center_agent.designation.read",
      method: "GET",
      requestContext: validateRequestInput(input).requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: getCenterAgentDesignationResponseSchema,
      invalidMessage: "Invalid Center Agent designation response.",
    }),
  designate: async (input) => {
    const request = validateDesignationInput(input);
    return await client.requestJson({
      url: buildCenterAgentDesignationPath(),
      operation: "center_agent.designation.write",
      method: "PUT",
      requestContext: request.requestContext,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(request.agentProfileId === undefined
          ? {}
          : { agentProfileId: request.agentProfileId }),
        ...(request.runtime === undefined ? {} : { runtime: request.runtime }),
      }),
      schema: designateCenterAgentResponseSchema,
      invalidMessage: "Invalid Center Agent designation write response.",
    });
  },
  getModel: async (input = {}) =>
    await client.requestJson({
      url: buildCenterAgentModelPath(),
      operation: "center_agent.model.read",
      method: "GET",
      requestContext: validateRequestInput(input).requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: centerAgentModelConfigurationResponseSchema,
      invalidMessage: "Invalid Center Agent model response.",
    }),
  updateModel: async (input) => {
    const request = validateModelInput(input);
    return await client.requestJson({
      url: buildCenterAgentModelPath(),
      operation: "center_agent.model.update",
      method: "PUT",
      requestContext: request.requestContext,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedConfigurationRevision: request.expectedConfigurationRevision,
        preference: request.preference,
      }),
      schema: updateCenterAgentModelResponseSchema,
      invalidMessage: "Invalid Center Agent model update response.",
    });
  },
  getOperatingState: async (input = {}) =>
    await client.requestJson({
      url: buildCenterAgentOperatingStatePath(),
      operation: "center_agent.operating_state.read",
      method: "GET",
      requestContext: validateRequestInput(input).requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: getCenterAgentOperatingStateResponseSchema,
      invalidMessage: "Invalid Center Agent operating state response.",
    }),
  updateOperatingState: async (input) => {
    const request = validateOperatingStateInput(input);
    return await client.requestJson({
      url: buildCenterAgentOperatingStatePath(),
      operation: "center_agent.operating_state.update",
      method: "PUT",
      requestContext: request.requestContext,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operatingState: request.operatingState }),
      schema: updateCenterAgentOperatingStateResponseSchema,
      invalidMessage: "Invalid Center Agent operating state update response.",
    });
  },
  connectSlackWorkspace: async (input) => {
    const request = validateSlackWorkspaceConnectInput(input);
    return await client.requestJson({
      url: buildCenterAgentSlackWorkspaceConnectionPath(),
      operation: "center_agent.slack_workspace.connect",
      method: "POST",
      requestContext: request.requestContext,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slackTeamId: request.slackTeamId }),
      schema: centerAgentSlackWorkspaceConnectionResponseSchema,
      invalidMessage: "Invalid Center Agent Slack connection response.",
    });
  },
  disconnectSlackWorkspace: async (input = {}) =>
    await client.requestJson({
      url: buildCenterAgentSlackWorkspaceConnectionPath(),
      operation: "center_agent.slack_workspace.disconnect",
      method: "DELETE",
      requestContext: validateRequestInput(input).requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: centerAgentSlackWorkspaceDisconnectResponseSchema,
      invalidMessage: "Invalid Center Agent Slack disconnect response.",
    }),
  previewSlackIdentityLink: async (input) => {
    const request = validateSlackIdentityLinkPreviewInput(input);
    return await client.requestJson({
      url: buildSlackIdentityLinkPreviewPath(),
      operation: "center_agent.slack_identity_link.preview",
      method: "POST",
      requestContext: request.requestContext,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: request.token }),
      schema: slackIdentityLinkPreviewResponseSchema,
      invalidMessage: "Invalid Slack identity link preview response.",
    });
  },
  consumeSlackIdentityLink: async (input) => {
    const request = validateSlackIdentityLinkConsumeInput(input);
    return await client.requestJson({
      url: buildSlackIdentityLinkConsumePath(),
      operation: "center_agent.slack_identity_link.consume",
      method: "POST",
      requestContext: request.requestContext,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: request.token }),
      schema: slackIdentityLinkConsumeResponseSchema,
      invalidMessage: "Invalid Slack identity link consume response.",
    });
  },
  updateProfile: async (input) => {
    const request = validateUpdateProfileInput(input);
    return await client.requestJson({
      url: buildCenterAgentProfilePath(),
      operation: "center_agent.profile.update",
      method: "PATCH",
      requestContext: request.requestContext,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileName: request.profileName }),
      schema: centerAgentUpdateProfileResponseSchema,
      invalidMessage: "Invalid Center Agent profile update response.",
    });
  },
  listAuditJournal: async (input = {}) => {
    const request = validateAuditJournalInput(input);
    return await client.requestJson({
      url: buildAuditJournalUrl(request),
      operation: "center_agent.audit_journal.list",
      method: "GET",
      requestContext: request.requestContext,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      schema: listCenterAgentAuditJournalResponseSchema,
      invalidMessage: "Invalid Center Agent audit journal response.",
    });
  },
  createContextManifest: async (input) => {
    const request = validateContextManifestInput(input);
    return await client.requestJson({
      body: JSON.stringify({
        ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        limit: request.limit,
        maxContextTokens: request.maxContextTokens,
        source: request.source,
        view: request.view,
      }),
      headers: { "content-type": "application/json" },
      invalidMessage: "Invalid Center Agent context manifest response.",
      method: "POST",
      operation: "center_agent.context_manifest.create",
      requestContext: request.requestContext,
      schema: createCenterAgentContextManifestResponseSchema,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      url: buildCenterAgentContextManifestPath(),
    });
  },
  createContextLoadReceipt: async (input) => {
    const request = validateContextLoadReceiptInput(input);
    return await client.requestJson({
      body: JSON.stringify({
        selection: request.selection,
        source: request.source,
      }),
      headers: { "content-type": "application/json" },
      invalidMessage: "Invalid Center Agent Context Load Receipt response.",
      method: "POST",
      operation: "center_agent.context_load_receipt.create",
      requestContext: request.requestContext,
      schema: createCenterAgentContextLoadReceiptResponseSchema,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      url: buildCenterAgentContextLoadReceiptPath(request.manifestId),
    });
  },
  openDirectMessageSpace: async (input = {}) =>
    await client.requestJson({
      url: buildCenterAgentDirectMessageSpacePath(),
      operation: "center_agent.dm_space.open",
      method: "POST",
      requestContext: validateRequestInput(input).requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: openCenterAgentDirectMessageSpaceResponseSchema,
      invalidMessage: "Invalid Center Agent DM Space response.",
    }),
  getDirectMessageSpaceProjection: async (input = {}) =>
    await client.requestJson({
      url: buildCenterAgentDirectMessageSpacePath(),
      operation: "center_agent.dm_space.projection.read",
      method: "GET",
      requestContext: validateRequestInput(input).requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: getCenterAgentDirectMessageSpaceProjectionResponseSchema,
      invalidMessage: "Invalid Center Agent DM Space projection response.",
    }),
});

function validateRequestInput<T extends CenterAgentRequestInput>(input: T): T {
  const parsed = openMeldRequestContextSchema
    .optional()
    .safeParse(input.requestContext);
  if (!parsed.success) {
    throw new Error("Invalid Center Agent request context.");
  }
  return input;
}

function validateContextManifestInput(
  input: CreateCenterAgentContextManifestInput
): CreateCenterAgentContextManifestInput & {
  limit: number;
  maxContextTokens: number;
  view: "messages";
} {
  const parsed = createCenterAgentContextManifestBodySchema.safeParse({
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.maxContextTokens === undefined
      ? {}
      : { maxContextTokens: input.maxContextTokens }),
    source: input.source,
    ...(input.view === undefined ? {} : { view: input.view }),
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Center Agent context manifest request."
    );
  }
  validateRequestInput(input);
  return { ...input, ...parsed.data };
}

function validateContextLoadReceiptInput(
  input: CreateCenterAgentContextLoadReceiptInput
): CreateCenterAgentContextLoadReceiptInput {
  const parsed = createCenterAgentContextLoadReceiptBodySchema.safeParse({
    selection: input.selection,
    source: input.source,
  });
  const manifestId = input.manifestId.trim();
  if (!(parsed.success && manifestId)) {
    throw new Error("Invalid Center Agent Context Load Receipt request.");
  }
  validateRequestInput(input);
  return { ...input, ...parsed.data, manifestId };
}

function validateDesignationInput(
  input: CenterAgentDesignateInput
): CenterAgentDesignateInput {
  const parsed = designateCenterAgentBodySchema.safeParse({
    agentProfileId: input.agentProfileId,
    ...(input.runtime === undefined ? {} : { runtime: input.runtime }),
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid Center Agent designation."
    );
  }
  validateRequestInput(input);
  return input;
}

function validateOperatingStateInput(
  input: CenterAgentUpdateOperatingStateInput
): CenterAgentUpdateOperatingStateInput {
  const parsed = updateCenterAgentOperatingStateBodySchema.safeParse({
    operatingState: input.operatingState,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid Center Agent operating state."
    );
  }
  validateRequestInput(input);
  return input;
}

function validateModelInput(
  input: CenterAgentUpdateModelInput
): CenterAgentUpdateModelInput {
  const parsed = updateCenterAgentModelBodySchema.safeParse({
    expectedConfigurationRevision: input.expectedConfigurationRevision,
    preference: input.preference,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid Center Agent model."
    );
  }
  validateRequestInput(input);
  return input;
}

function validateAuditJournalInput(
  input: ListCenterAgentAuditJournalInput
): ListCenterAgentAuditJournalInput {
  const parsed = listCenterAgentAuditJournalQuerySchema.safeParse({
    actionSet: input.actionSet ?? "v16",
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Center Agent audit journal query."
    );
  }
  validateRequestInput(input);
  return { ...input, actionSet: parsed.data.actionSet };
}

function validateUpdateProfileInput(
  input: CenterAgentUpdateProfileInput
): CenterAgentUpdateProfileInput {
  const parsed = centerAgentUpdateProfileBodySchema.safeParse({
    profileName: input.profileName,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid Center Agent profile update."
    );
  }
  validateRequestInput(input);
  return input;
}

function validateSlackWorkspaceConnectInput(
  input: CenterAgentSlackWorkspaceConnectInput
): CenterAgentSlackWorkspaceConnectInput {
  const parsed = centerAgentSlackWorkspaceConnectBodySchema.safeParse({
    slackTeamId: input.slackTeamId,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid Center Agent Slack workspace payload."
    );
  }
  validateRequestInput(input);
  return input;
}

function validateSlackIdentityLinkPreviewInput(
  input: SlackIdentityLinkPreviewInput
): SlackIdentityLinkPreviewInput {
  const parsed = slackIdentityLinkPreviewBodySchema.safeParse({
    token: input.token,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid Slack identity link token."
    );
  }
  validateRequestInput(input);
  return input;
}

function validateSlackIdentityLinkConsumeInput(
  input: SlackIdentityLinkConsumeInput
): SlackIdentityLinkConsumeInput {
  const parsed = slackIdentityLinkConsumeBodySchema.safeParse({
    token: input.token,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "Invalid Slack identity link token."
    );
  }
  validateRequestInput(input);
  return input;
}

function buildAuditJournalUrl(input: ListCenterAgentAuditJournalInput): string {
  const url = new URL(
    buildCenterAgentAuditJournalPath(),
    "https://openmeld.local"
  );
  if (input.limit !== undefined) {
    url.searchParams.set("limit", String(input.limit));
  }
  if (input.actionSet !== undefined) {
    url.searchParams.set("actionSet", input.actionSet);
  }
  return `${url.pathname}${url.search}`;
}
