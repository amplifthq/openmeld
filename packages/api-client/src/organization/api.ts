import {
  agentProfileCreationIntentSchema,
  agentProfileCreationRequestMutationResponseSchema,
  centerAgentOrganizationMemoryPolicyResponseSchema,
  centerAgentWipeMemberMemoryResponseSchema,
  createAgentProfileCreationRequestBodySchema,
  createAgentProfileCreationRequestResponseSchema,
  decideAgentProfileCreationRequestBodySchema,
  getAgentProfileCreationApprovalPreferenceResponseSchema,
  getAgentProfileCreationDefaultsResponseSchema,
  larkPlatformActiveRegistrationListResponseSchema,
  larkPlatformProviderSchema,
  larkPlatformRegistrationAttemptIdSchema,
  larkPlatformRegistrationBeginModeSchema,
  larkPlatformRegistrationResponseSchema,
  listAgentProfileCreationRequestsResponseSchema,
  messageChannelConnectionListResponseSchema,
  messageChannelIdentityLinkConsumeBodySchema,
  messageChannelIdentityLinkConsumeResponseSchema,
  messageChannelIdentityLinkPreviewBodySchema,
  messageChannelIdentityLinkPreviewResponseSchema,
  messageChannelSetupRequestBodySchema,
  messageChannelSetupRequestResponseSchema,
  ORGANIZATION_LOGO_MAX_SIZE_BYTES,
  organizationComputersResponseSchema,
  organizationDirectoryResponseSchema,
  organizationInformationProtectionPolicyResponseSchema,
  organizationLogoMimeTypeSchema,
  organizationLogoResponseSchema,
  organizationMemberOpenMeldServiceStatusesResponseSchema,
  organizationSpaceDirectoryResponseSchema,
  organizationSpaceDirectoryWithMemberCountsResponseSchema,
  setAgentProfileCreationApprovalPreferenceBodySchema,
  setAgentProfileCreationApprovalPreferenceResponseSchema,
  setAgentProfileCreationDefaultsBodySchema,
  setAgentProfileCreationDefaultsResponseSchema,
  updateCenterAgentOrganizationMemoryPolicyBodySchema,
  updateOrganizationInformationProtectionPolicyBodySchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import { toStructuredApiClientFailure } from "../errors";
import {
  buildAgentProfileCreationApprovalPreferencePath,
  buildAgentProfileCreationDefaultsPath,
  buildAgentProfileCreationRequestCancelPath,
  buildAgentProfileCreationRequestDecisionPath,
  buildAgentProfileCreationRequestRetryPath,
  buildAgentProfileCreationRequestsPath,
  buildCurrentOrganizationCenterAgentMemoryPolicyPath,
  buildCurrentOrganizationCenterAgentMemoryWipeSelfPath,
  buildCurrentOrganizationComputersPath,
  buildCurrentOrganizationDirectoryPath,
  buildCurrentOrganizationInformationProtectionPath,
  buildCurrentOrganizationLogoPath,
  buildCurrentOrganizationMemberOpenMeldServiceStatusesPath,
  buildCurrentOrganizationMessageChannelIdentityLinkPath,
  buildCurrentOrganizationMessageChannelPath,
  buildCurrentOrganizationMessageChannelRegistrationPath,
  buildCurrentOrganizationMessageChannelRegistrationPollPath,
  buildCurrentOrganizationMessageChannelRegistrationsPath,
  buildCurrentOrganizationMessageChannelSetupRequestsPath,
  buildCurrentOrganizationMessageChannelsPath,
  buildCurrentOrganizationSpacesPath,
  buildCurrentOrganizationSpacesWithMemberCountsPath,
  buildMessageChannelIdentityLinkConsumePath,
  buildMessageChannelIdentityLinkPreviewPath,
} from "./routes";
import type { CreateOrganizationApi } from "./types";

export const createOrganizationApi: CreateOrganizationApi = (
  client: OpenMeldApiClientFoundation
) => ({
  createAgentProfileCreationRequest: async (input) => {
    const body = createAgentProfileCreationRequestBodySchema.parse({
      configuration: input.configuration,
      idempotencyKey: input.idempotencyKey,
      nativeSessionId: input.nativeSessionId,
      profileName: input.profileName,
      requestedSpaceId: input.requestedSpaceId,
      sessionStrategy: input.sessionStrategy,
      source: input.source,
      targetOwnerUserId: input.targetOwnerUserId,
    });
    try {
      return await client.requestJson({
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        invalidMessage: "invalid Agent Profile creation request response",
        method: "POST",
        operation: "agent_profile.creation_request.create",
        requestContext: input.requestContext,
        schema: createAgentProfileCreationRequestResponseSchema,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
        url: buildAgentProfileCreationRequestsPath(input.organizationId),
      });
    } catch (error) {
      const failure = toStructuredApiClientFailure(error);
      if (
        input.signal?.aborted ||
        (failure.status !== null &&
          failure.status >= 400 &&
          failure.status < 500 &&
          failure.status !== 408)
      ) {
        throw error;
      }
      // A lost response does not undo an accepted command. Read that exact
      // intent once; never resubmit or infer success from a similarly named Agent.
      const recovered = await client
        .requestJson({
          method: "GET",
          operation: "agent_profile.creation_request.recover",
          requestContext: input.requestContext,
          schema: listAgentProfileCreationRequestsResponseSchema,
          signal: input.signal,
          timeoutMs: input.timeoutMs,
          invalidMessage:
            "invalid Agent Profile creation request recovery response",
          url: buildAgentProfileCreationRequestsPath(input.organizationId, {
            idempotencyKey: body.idempotencyKey,
          }),
        })
        .catch(() => null);
      const request =
        recovered?.matchedIdempotencyKey === body.idempotencyKey &&
        recovered.requests.length === 1
          ? recovered.requests[0]
          : undefined;
      if (
        request &&
        request.organizationId === input.organizationId &&
        JSON.stringify(
          agentProfileCreationIntentSchema.parse({
            ...request,
            idempotencyKey: body.idempotencyKey,
          })
        ) === JSON.stringify(agentProfileCreationIntentSchema.parse(body))
      ) {
        return { replayed: true, request };
      }
      throw Object.assign(
        new Error(
          "The request may still be creating the Agent. Try again to check the same request.",
          { cause: error }
        ),
        {
          code: "agent_profile.creation_request.outcome_unknown",
          requestId: failure.requestId,
          idempotencyKey: body.idempotencyKey,
        }
      );
    }
  },
  listAgentProfileCreationRequests: async (input) =>
    await client.requestJson({
      invalidMessage: "invalid Agent Profile creation request list response",
      method: "GET",
      operation: "agent_profile.creation_request.list",
      requestContext: input.requestContext,
      schema: listAgentProfileCreationRequestsResponseSchema,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      url: buildAgentProfileCreationRequestsPath(input.organizationId, input),
    }),
  decideAgentProfileCreationRequest: async (input) => {
    const body = decideAgentProfileCreationRequestBodySchema.parse({
      decision: input.decision,
    });
    return await client.requestJson({
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage:
        "invalid Agent Profile creation request decision response",
      method: "POST",
      operation: "agent_profile.creation_request.decide",
      requestContext: input.requestContext,
      schema: agentProfileCreationRequestMutationResponseSchema,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      url: buildAgentProfileCreationRequestDecisionPath(
        input.organizationId,
        input.requestId
      ),
    });
  },
  cancelAgentProfileCreationRequest: async (input) =>
    await client.requestJson({
      invalidMessage: "invalid Agent Profile creation request cancel response",
      method: "POST",
      operation: "agent_profile.creation_request.cancel",
      requestContext: input.requestContext,
      schema: agentProfileCreationRequestMutationResponseSchema,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      url: buildAgentProfileCreationRequestCancelPath(
        input.organizationId,
        input.requestId
      ),
    }),
  retryAgentProfileCreationRequest: async (input) =>
    await client.requestJson({
      invalidMessage: "invalid Agent Profile creation request retry response",
      method: "POST",
      operation: "agent_profile.creation_request.retry",
      requestContext: input.requestContext,
      schema: agentProfileCreationRequestMutationResponseSchema,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      url: buildAgentProfileCreationRequestRetryPath(
        input.organizationId,
        input.requestId
      ),
    }),
  getAgentProfileCreationApprovalPreference: async (input) =>
    await client.requestJson({
      invalidMessage:
        "invalid Agent Profile creation approval preference response",
      method: "GET",
      operation: "agent_profile.creation_approval_preference.read",
      requestContext: input.requestContext,
      schema: getAgentProfileCreationApprovalPreferenceResponseSchema,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      url: buildAgentProfileCreationApprovalPreferencePath(
        input.organizationId
      ),
    }),
  setAgentProfileCreationApprovalPreference: async (input) => {
    const body = setAgentProfileCreationApprovalPreferenceBodySchema.parse({
      existingSessionPolicy: input.existingSessionPolicy,
      newSessionPolicy: input.newSessionPolicy,
    });
    return await client.requestJson({
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage:
        "invalid Agent Profile creation approval preference response",
      method: "PUT",
      operation: "agent_profile.creation_approval_preference.write",
      requestContext: input.requestContext,
      schema: setAgentProfileCreationApprovalPreferenceResponseSchema,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      url: buildAgentProfileCreationApprovalPreferencePath(
        input.organizationId
      ),
    });
  },
  getAgentProfileCreationDefaults: async (input) =>
    await client.requestJson({
      url: buildAgentProfileCreationDefaultsPath(
        input.organizationId,
        input.agentControllerRef
      ),
      operation: "agent_profile.creation_defaults.read",
      method: "GET",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: getAgentProfileCreationDefaultsResponseSchema,
      invalidMessage: "invalid Agent Profile creation defaults response",
    }),
  updateCurrentLogo: async (input) => {
    const mimeType = organizationLogoMimeTypeSchema.parse(input.mimeType);
    const body = toOrganizationLogoBody(input.bytes);
    const sizeBytes = body instanceof Blob ? body.size : body.byteLength;
    if (sizeBytes < 1 || sizeBytes > ORGANIZATION_LOGO_MAX_SIZE_BYTES) {
      throw new Error("invalid Organization logo size");
    }
    return await client.requestJson({
      url: buildCurrentOrganizationLogoPath(),
      operation: "organization.logo.update",
      method: "PUT",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      headers: { "content-type": mimeType },
      body,
      schema: organizationLogoResponseSchema,
      invalidMessage: "invalid Organization logo update response",
    });
  },
  removeCurrentLogo: async (input = {}) =>
    await client.requestJson({
      url: buildCurrentOrganizationLogoPath(),
      operation: "organization.logo.remove",
      method: "DELETE",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: organizationLogoResponseSchema,
      invalidMessage: "invalid Organization logo removal response",
    }),
  getCurrentDirectory: async (input = {}) =>
    await client.requestJson({
      url: buildCurrentOrganizationDirectoryPath({
        agentProfileWorkRecoveryVersion:
          input.agentProfileWorkRecoveryVersion ?? 2,
        includeMemberLastActiveAt: input.includeMemberLastActiveAt,
      }),
      operation: "organization.directory.read",
      method: "GET",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: organizationDirectoryResponseSchema,
      invalidMessage: "invalid Organization directory response",
    }),
  getCurrentComputers: async (input = {}) =>
    await client.requestJson({
      url: buildCurrentOrganizationComputersPath({
        includeUsageLimits: input.includeUsageLimits,
      }),
      operation: "organization.computers.read",
      method: "GET",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: organizationComputersResponseSchema,
      invalidMessage: "invalid Organization computers response",
    }),
  getCurrentMemberOpenMeldServiceStatuses: async (input = {}) =>
    await client.requestJson({
      url: buildCurrentOrganizationMemberOpenMeldServiceStatusesPath(),
      operation: "organization.member_service_statuses.read",
      method: "GET",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: organizationMemberOpenMeldServiceStatusesResponseSchema,
      invalidMessage:
        "invalid Organization member OpenMeld Service statuses response",
    }),
  listCurrentSpaces: async (input = {}) =>
    await client.requestJson({
      url: buildCurrentOrganizationSpacesPath(),
      operation: "organization.spaces.list",
      method: "GET",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: organizationSpaceDirectoryResponseSchema,
      invalidMessage: "invalid Organization Space directory response",
    }),
  listCurrentSpacesWithMemberCounts: async (input = {}) =>
    await client.requestJson({
      url: buildCurrentOrganizationSpacesWithMemberCountsPath(),
      operation: "organization.spaces_with_member_counts.list",
      method: "GET",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: organizationSpaceDirectoryWithMemberCountsResponseSchema,
      invalidMessage:
        "invalid Organization Space directory with member counts response",
    }),
  listCurrentMessageChannels: async (input = {}) =>
    await client.requestJson({
      url: buildCurrentOrganizationMessageChannelsPath(),
      operation: "organization.message_channels.list",
      method: "GET",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: messageChannelConnectionListResponseSchema,
      invalidMessage: "invalid Organization Message Channels response",
    }),
  requestMessageChannelSetup: async (input) => {
    const body = messageChannelSetupRequestBodySchema.parse({
      provider: input.provider,
    });
    return await client.requestJson({
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Message Channel setup request response",
      method: "POST",
      operation: "organization.message_channel.setup.request",
      requestContext: input.requestContext,
      schema: messageChannelSetupRequestResponseSchema,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      url: buildCurrentOrganizationMessageChannelSetupRequestsPath(),
    });
  },
  disconnectMessageChannelIdentityLink: async (input) =>
    await client.requestJson({
      url: buildCurrentOrganizationMessageChannelIdentityLinkPath(
        input.identityLinkId
      ),
      operation: "organization.message_channel.identity_link.disconnect",
      method: "DELETE",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: messageChannelConnectionListResponseSchema,
      invalidMessage:
        "invalid Message Channel identity link disconnect response",
    }),
  listCurrentLarkPlatformRegistrations: async (input = {}) =>
    await client.requestJson({
      url: buildCurrentOrganizationMessageChannelRegistrationsPath(),
      operation: "organization.message_channel_registrations.list",
      method: "GET",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: larkPlatformActiveRegistrationListResponseSchema,
      invalidMessage:
        "invalid Organization Message Channel registrations response",
    }),
  previewMessageChannelIdentityLink: async (input) => {
    const body = messageChannelIdentityLinkPreviewBodySchema.parse({
      token: input.token,
    });
    return await client.requestJson({
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Message Channel identity link preview response",
      method: "POST",
      operation: "organization.message_channel.identity_link.preview",
      requestContext: input.requestContext,
      schema: messageChannelIdentityLinkPreviewResponseSchema,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      url: buildMessageChannelIdentityLinkPreviewPath(),
    });
  },
  consumeMessageChannelIdentityLink: async (input) => {
    const body = messageChannelIdentityLinkConsumeBodySchema.parse({
      token: input.token,
    });
    return await client.requestJson({
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Message Channel identity link consume response",
      method: "POST",
      operation: "organization.message_channel.identity_link.consume",
      requestContext: input.requestContext,
      schema: messageChannelIdentityLinkConsumeResponseSchema,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      url: buildMessageChannelIdentityLinkConsumePath(),
    });
  },
  beginLarkPlatformRegistration: async (input) => {
    const provider = larkPlatformProviderSchema.parse(input.provider);
    const mode = larkPlatformRegistrationBeginModeSchema.parse(
      input.mode ?? "resume"
    );
    const path =
      buildCurrentOrganizationMessageChannelRegistrationPath(provider);
    return await client.requestJson({
      url: mode === "resume" ? path : `${path}?mode=${mode}`,
      operation: "organization.message_channel.registration.begin",
      method: "POST",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: larkPlatformRegistrationResponseSchema,
      invalidMessage: "invalid Message Channel registration response",
    });
  },
  pollLarkPlatformRegistration: async (input) => {
    const provider = larkPlatformProviderSchema.parse(input.provider);
    const attemptId = larkPlatformRegistrationAttemptIdSchema.parse(
      input.attemptId
    );
    return await client.requestJson({
      url: buildCurrentOrganizationMessageChannelRegistrationPollPath(
        provider,
        attemptId
      ),
      operation: "organization.message_channel.registration.poll",
      method: "POST",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: larkPlatformRegistrationResponseSchema,
      invalidMessage: "invalid Message Channel registration poll response",
    });
  },
  disconnectLarkPlatform: async (input) => {
    const provider = larkPlatformProviderSchema.parse(input.provider);
    return await client.requestJson({
      url: buildCurrentOrganizationMessageChannelPath(provider),
      operation: "organization.message_channel.disconnect",
      method: "DELETE",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: messageChannelConnectionListResponseSchema,
      invalidMessage: "invalid Message Channel disconnect response",
    });
  },
  wipeCurrentMemberCenterAgentMemory: async (input = {}) =>
    await client.requestJson({
      url: buildCurrentOrganizationCenterAgentMemoryWipeSelfPath(),
      operation: "organization.center_agent_memory.wipe_self",
      method: "POST",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: centerAgentWipeMemberMemoryResponseSchema,
      invalidMessage: "invalid Center Agent memory wipe response",
    }),
  readCurrentOrganizationCenterAgentMemoryPolicy: async (input = {}) =>
    await client.requestJson({
      url: buildCurrentOrganizationCenterAgentMemoryPolicyPath(),
      operation: "organization.center_agent_memory.organization_policy.read",
      method: "GET",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: centerAgentOrganizationMemoryPolicyResponseSchema,
      invalidMessage:
        "invalid Center Agent organization memory policy response",
    }),
  setCurrentOrganizationCenterAgentMemoryPolicy: async (input) => {
    const body = updateCenterAgentOrganizationMemoryPolicyBodySchema.parse({
      organizationMemoryOptIn: input.organizationMemoryOptIn,
    });
    return await client.requestJson({
      url: buildCurrentOrganizationCenterAgentMemoryPolicyPath(),
      operation: "organization.center_agent_memory.organization_policy.write",
      method: "PUT",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      schema: centerAgentOrganizationMemoryPolicyResponseSchema,
      invalidMessage:
        "invalid Center Agent organization memory policy response",
    });
  },
  readCurrentInformationProtection: async (input = {}) =>
    await client.requestJson({
      url: buildCurrentOrganizationInformationProtectionPath(),
      operation: "organization.information_protection.read",
      method: "GET",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      schema: organizationInformationProtectionPolicyResponseSchema,
      invalidMessage:
        "invalid Organization information protection policy response",
    }),
  setCurrentInformationProtection: async (input) => {
    const body = updateOrganizationInformationProtectionPolicyBodySchema.parse({
      protectedInformation: input.protectedInformation,
    });
    return await client.requestJson({
      url: buildCurrentOrganizationInformationProtectionPath(),
      operation: "organization.information_protection.write",
      method: "PUT",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      schema: organizationInformationProtectionPolicyResponseSchema,
      invalidMessage:
        "invalid Organization information protection policy response",
    });
  },
  setAgentProfileCreationDefaults: async (input) => {
    const body = setAgentProfileCreationDefaultsBodySchema.parse({
      agentControllerCollaborationMode: input.agentControllerCollaborationMode,
      agentControllerPermissionMode: input.agentControllerPermissionMode,
      defaultProjectId: input.defaultProjectId,
      modelId: input.modelId,
      openCodePermission: input.openCodePermission,
      reasoningLevel: input.reasoningLevel,
    });
    return await client.requestJson({
      url: buildAgentProfileCreationDefaultsPath(
        input.organizationId,
        input.agentControllerRef
      ),
      operation: "agent_profile.creation_defaults.write",
      method: "PUT",
      requestContext: input.requestContext,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      schema: setAgentProfileCreationDefaultsResponseSchema,
      invalidMessage: "invalid Agent Profile creation defaults response",
    });
  },
});

function toOrganizationLogoBody(
  bytes: ArrayBuffer | Blob | Uint8Array
): ArrayBuffer | Blob {
  if (bytes instanceof Blob || bytes instanceof ArrayBuffer) {
    return bytes;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
