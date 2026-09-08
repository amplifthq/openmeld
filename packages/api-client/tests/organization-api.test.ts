import { describe, expect, it, vi } from "vitest";
import { createOpenMeldApiClient, createOrganizationApi } from "../src";

const REQUEST_CONTEXT = {
  actorContext: {
    requestId: "req-organization-api-123",
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    profileKind: "human" as const,
    profileName: "Mira",
  },
};

describe("api-client organization api", () => {
  it("uploads and removes the active Organization logo", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          logo: "https://gateway.openmeld.invalid/v1/organization-logos/org-1/22222222-2222-4222-8222-222222222222.webp",
          ok: true,
        })
      )
      .mockResolvedValueOnce(jsonResponse({ logo: null, ok: true }));
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    await expect(
      api.updateCurrentLogo({
        bytes,
        mimeType: "image/png",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toEqual({
      logo: "https://gateway.openmeld.invalid/v1/organization-logos/org-1/22222222-2222-4222-8222-222222222222.webp",
      ok: true,
    });
    await expect(
      api.removeCurrentLogo({ requestContext: REQUEST_CONTEXT })
    ).resolves.toEqual({ logo: null, ok: true });
    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        init: expect.objectContaining({
          body: expect.any(ArrayBuffer),
          headers: expect.objectContaining({ "content-type": "image/png" }),
          method: "PUT",
        }),
        operation: "organization.logo.update",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/logo",
      })
    );
    const uploadRequest = transport.mock.calls[0]?.[0];
    expect(new Uint8Array(uploadRequest?.init.body as ArrayBuffer)).toEqual(
      bytes
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        init: expect.objectContaining({ method: "DELETE" }),
        operation: "organization.logo.remove",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/logo",
      })
    );
  });

  it("reads the active Organization directory", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          generatedAt: "2026-07-04T00:00:00.000Z",
          members: [],
          agentProfiles: [],
        })
      )
    );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getCurrentDirectory({
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.organizationId).toBe("org-1");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "organization.directory.read",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/directory?agentProfileWorkRecoveryVersion=2",
      })
    );
  });

  it("requests Organization member activity only when the caller opts in", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          generatedAt: "2026-07-04T00:00:00.000Z",
          members: [],
          agentProfiles: [],
        })
      )
    );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.getCurrentDirectory({ includeMemberLastActiveAt: true });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/organizations/current/directory?agentProfileWorkRecoveryVersion=2&includeMemberLastActiveAt=true",
      })
    );
  });

  it("explicitly requests usage limits for Organization computers", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          computers: [],
          generatedAt: "2026-08-20T00:00:00.000Z",
          organizationId: "org-1",
        })
      )
    );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.getCurrentComputers({
      includeUsageLimits: "true",
      requestContext: REQUEST_CONTEXT,
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "organization.computers.read",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/computers?includeUsageLimits=true",
      })
    );
  });

  it("lists active Organization Spaces visible to the caller", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          generatedAt: "2026-07-04T00:00:00.000Z",
          spaces: [
            {
              spaceId: "space-1",
              name: "Launch Room",
              organizationId: "org-1",
              visibility: "public",
              joined: false,
              lastJoinedAt: null,
              spaceCreatedAt: "2026-07-04T00:00:00.000Z",
              spaceUpdatedAt: "2026-07-04T00:01:00.000Z",
              updatedAt: "2026-07-04T00:02:00.000Z",
            },
          ],
        })
      )
    );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.listCurrentSpaces({
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.spaces).toEqual([
      expect.objectContaining({
        organizationId: "org-1",
        spaceId: "space-1",
        visibility: "public",
      }),
    ]);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "organization.spaces.list",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/spaces",
      })
    );
  });

  it("lists the active Organization Message Channels", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          availableLarkPlatformProviders: ["lark"],
          connections: [
            {
              externalAccountId: "tenant_lark_1",
              externalAccountName: "Center Agent",
              grantedCapabilityGroups: ["messages"],
              id: "connection_lark_1",
              lastVerifiedAt: "2026-07-18T00:00:00.000Z",
              permissionBundleVersion: "lark-channel-v1",
              provider: "lark",
              reasonCode: null,
              status: "connected",
              transport: "webhook",
            },
          ],
          identityLinks: [],
          organizationId: "org-1",
        })
      )
    );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.listCurrentMessageChannels({ requestContext: REQUEST_CONTEXT })
    ).resolves.toMatchObject({
      availableLarkPlatformProviders: ["lark"],
      connections: [{ provider: "lark", status: "connected" }],
      identityLinks: [],
      organizationId: "org-1",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "organization.message_channels.list",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/message-channels",
      })
    );
  });

  it("disconnects a Message Channel account identity", async () => {
    const identityLinkId = `channel_identity_${"a".repeat(64)}`;
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          availableLarkPlatformProviders: ["lark"],
          connections: [],
          identityLinks: [],
          organizationId: "org-1",
        })
      )
    );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.disconnectMessageChannelIdentityLink({
        identityLinkId,
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({
      identityLinks: [],
      organizationId: "org-1",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "DELETE" }),
        operation: "organization.message_channel.identity_link.disconnect",
        url: `https://gateway.openmeld.invalid/v1/organizations/current/message-channels/identity-links/${identityLinkId}`,
      })
    );
  });

  it("requests Message Channel setup for the current Organization", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          provider: "slack",
          recipientCount: 2,
          requestId: "request-1",
          status: "created",
        })
      )
    );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.requestMessageChannelSetup({
        provider: "slack",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({
      organizationId: "org-1",
      provider: "slack",
      status: "created",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({ provider: "slack" }),
          method: "POST",
        }),
        operation: "organization.message_channel.setup.request",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/message-channels/setup-requests",
      })
    );
  });

  it("reads and saves Agent Profile creation defaults per Local Agent", async () => {
    const defaults = {
      agentControllerCollaborationMode: "codex:plan" as const,
      agentControllerPermissionMode: "codex:approveForMe" as const,
      agentControllerRef: "builtin:codex",
      defaultProjectId: "project-1",
      modelId: "gpt-5.4-mini",
      openCodePermission: null,
      organizationId: "org-1",
      reasoningLevel: "high",
      updatedAt: "2026-08-18T12:00:00.000Z",
      userId: "user-1",
    };
    const transport = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(defaults))
      .mockResolvedValueOnce(jsonResponse(defaults));
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.getAgentProfileCreationDefaults({
        agentControllerRef: "builtin:codex",
        organizationId: "org-1",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toEqual(defaults);
    await expect(
      api.setAgentProfileCreationDefaults({
        agentControllerCollaborationMode: "codex:plan",
        agentControllerPermissionMode: "codex:approveForMe",
        agentControllerRef: "builtin:codex",
        defaultProjectId: "project-1",
        modelId: "gpt-5.4-mini",
        openCodePermission: null,
        organizationId: "org-1",
        reasoningLevel: "high",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toEqual(defaults);

    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "agent_profile.creation_defaults.read",
        url: "https://gateway.openmeld.invalid/v1/organizations/org-1/agent-profile-creation-defaults/builtin%3Acodex",
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            agentControllerCollaborationMode: "codex:plan",
            agentControllerPermissionMode: "codex:approveForMe",
            defaultProjectId: "project-1",
            modelId: "gpt-5.4-mini",
            openCodePermission: null,
            reasoningLevel: "high",
          }),
          method: "PUT",
        }),
        operation: "agent_profile.creation_defaults.write",
        url: "https://gateway.openmeld.invalid/v1/organizations/org-1/agent-profile-creation-defaults/builtin%3Acodex",
      })
    );
  });

  it("lists active Lark-platform setup separately from connections", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          registrations: [
            {
              canResume: true,
              expiresAt: "2026-07-18T09:00:00.000Z",
              id: "attempt-1",
              nextPollAt: "2026-07-18T08:00:05.000Z",
              provider: "lark",
              reasonCode: null,
              status: "pending_registration",
            },
          ],
        })
      )
    );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.listCurrentLarkPlatformRegistrations({
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({
      registrations: [{ provider: "lark", status: "pending_registration" }],
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "organization.message_channel_registrations.list",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/message-channels/registrations",
      })
    );
  });

  it("starts, polls, and disconnects a Lark registration", async () => {
    const pending = larkRegistrationResponse("pending_registration");
    const connected = larkRegistrationResponse("connected");
    const transport = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(pending))
      .mockResolvedValueOnce(jsonResponse(pending))
      .mockResolvedValueOnce(jsonResponse(pending))
      .mockResolvedValueOnce(jsonResponse(connected))
      .mockResolvedValueOnce(
        jsonResponse({
          availableLarkPlatformProviders: ["lark"],
          connections: [],
          organizationId: "org-1",
        })
      );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.beginLarkPlatformRegistration({
        provider: "lark",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toEqual(pending);
    await expect(
      api.beginLarkPlatformRegistration({
        mode: "restart",
        provider: "lark",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toEqual(pending);
    await expect(
      api.beginLarkPlatformRegistration({
        mode: "repair",
        provider: "lark",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toEqual(pending);
    await expect(
      api.pollLarkPlatformRegistration({
        attemptId: "attempt/1",
        provider: "lark",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toEqual(connected);
    await expect(
      api.disconnectLarkPlatform({
        provider: "lark",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toEqual({
      availableLarkPlatformProviders: ["lark"],
      connections: [],
      identityLinks: [],
      organizationId: "org-1",
    });

    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        init: expect.objectContaining({ method: "POST" }),
        operation: "organization.message_channel.registration.begin",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/message-channels/lark/registration-attempts",
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        init: expect.objectContaining({ method: "POST" }),
        operation: "organization.message_channel.registration.begin",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/message-channels/lark/registration-attempts?mode=restart",
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        url: expect.stringContaining("?mode=repair"),
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        init: expect.objectContaining({ method: "POST" }),
        operation: "organization.message_channel.registration.poll",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/message-channels/lark/registration-attempts/attempt%2F1/poll",
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        init: expect.objectContaining({ method: "DELETE" }),
        operation: "organization.message_channel.disconnect",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/message-channels/lark",
      })
    );
  });

  it("lists Organization Spaces with member counts through the versioned route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          generatedAt: "2026-07-04T00:00:00.000Z",
          spaces: [
            {
              activeMemberCount: 12,
              spaceId: "space-1",
              name: "Launch Room",
              organizationId: "org-1",
              visibility: "public",
              joined: false,
              lastJoinedAt: null,
              spaceCreatedAt: "2026-07-04T00:00:00.000Z",
              spaceUpdatedAt: "2026-07-04T00:01:00.000Z",
              updatedAt: "2026-07-04T00:02:00.000Z",
            },
          ],
        })
      )
    );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.listCurrentSpacesWithMemberCounts({
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.spaces[0]?.activeMemberCount).toBe(12);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "organization.spaces_with_member_counts.list",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/spaces-with-member-counts",
      })
    );
  });

  it("reads, writes, and clears Organization information protection", async () => {
    const protectedInformation =
      "Customer contract pricing and unreleased Board forecasts.";
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          organizationId: "org-1",
          protectedInformation,
          updatedAt: "2026-07-21T00:00:00.000Z",
          updatedByUserId: "user-admin",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          organizationId: "org-1",
          protectedInformation,
          updatedAt: "2026-07-21T00:01:00.000Z",
          updatedByUserId: "user-admin",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          organizationId: "org-1",
          protectedInformation: null,
          updatedAt: "2026-07-21T00:02:00.000Z",
          updatedByUserId: "user-admin",
        })
      );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.readCurrentInformationProtection({
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({ protectedInformation });
    await expect(
      api.setCurrentInformationProtection({
        protectedInformation,
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({ protectedInformation });
    await expect(
      api.setCurrentInformationProtection({
        protectedInformation: null,
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({ protectedInformation: null });

    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "organization.information_protection.read",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/information-protection",
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({ protectedInformation }),
          method: "PUT",
        }),
        operation: "organization.information_protection.write",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/information-protection",
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({ protectedInformation: null }),
          method: "PUT",
        }),
      })
    );
  });

  it("creates and manages Agent Profile creation requests through one API", async () => {
    const request = {
      actorProfileId: "profile-actor",
      completedAt: null,
      configuration: {
        agentControllerPermissionMode: null,
        agentControllerRef: null,
        defaultProjectId: null,
        modelId: null,
        openCodePermission: null,
        reasoningLevel: null,
        targetComputerId: null,
      },
      createdAgentProfileId: null,
      createdAt: "2026-08-20T00:00:00.000Z",
      decidedAt: null,
      failureMessage: null,
      id: "creation-request-1",
      nativeSessionId: null,
      organizationId: "org-1",
      profileName: "Review Agent",
      requestedSpaceId: null,
      requesterUserId: "user-1",
      sessionStrategy: "new" as const,
      source: "web" as const,
      status: "pending" as const,
      statusReason: "approval_required" as const,
      targetOwnerUserId: "user-2",
      updatedAt: "2026-08-20T00:00:00.000Z",
    };
    const preference = {
      existingSessionPolicy: "ask_every_time" as const,
      newSessionPolicy: "automatically_allow" as const,
      organizationId: "org-1",
      updatedAt: "2026-08-20T00:00:00.000Z",
      userId: "user-1",
    };
    const transport = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ replayed: false, request }))
      .mockResolvedValueOnce(
        jsonResponse({ organizationId: "org-1", requests: [request] })
      )
      .mockResolvedValueOnce(jsonResponse({ request }))
      .mockResolvedValueOnce(jsonResponse(preference))
      .mockResolvedValueOnce(jsonResponse(preference));
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.createAgentProfileCreationRequest({
      idempotencyKey: "create-review-agent",
      organizationId: "org-1",
      profileName: "Review Agent",
      requestContext: REQUEST_CONTEXT,
      sessionStrategy: "new",
      source: "web",
      targetOwnerUserId: "user-2",
    });
    await api.listAgentProfileCreationRequests({
      organizationId: "org-1",
      requestContext: REQUEST_CONTEXT,
    });
    await api.decideAgentProfileCreationRequest({
      decision: "approve",
      organizationId: "org-1",
      requestContext: REQUEST_CONTEXT,
      requestId: "creation-request-1",
    });
    await api.getAgentProfileCreationApprovalPreference({
      organizationId: "org-1",
      requestContext: REQUEST_CONTEXT,
    });
    await api.setAgentProfileCreationApprovalPreference({
      existingSessionPolicy: "ask_every_time",
      newSessionPolicy: "automatically_allow",
      organizationId: "org-1",
      requestContext: REQUEST_CONTEXT,
    });

    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            idempotencyKey: "create-review-agent",
            profileName: "Review Agent",
            sessionStrategy: "new",
            source: "web",
            targetOwnerUserId: "user-2",
          }),
          method: "POST",
        }),
        operation: "agent_profile.creation_request.create",
        url: "https://gateway.openmeld.invalid/v1/organizations/org-1/agent-profile-creation-requests",
      })
    );
    expect(transport.mock.calls.map(([call]) => call.operation)).toEqual([
      "agent_profile.creation_request.create",
      "agent_profile.creation_request.list",
      "agent_profile.creation_request.decide",
      "agent_profile.creation_approval_preference.read",
      "agent_profile.creation_approval_preference.write",
    ]);
  });
});

function larkRegistrationResponse(
  status: "connected" | "pending_registration"
) {
  const connected = status === "connected";
  return {
    attempt: {
      expiresAt: "2026-07-18T01:00:00.000Z",
      id: "attempt/1",
      nextPollAt: "2026-07-18T00:00:05.000Z",
      provider: "lark",
      reasonCode: null,
      registrationUrl: connected
        ? null
        : "https://open.feishu.cn/page/launcher?user_code=redacted",
      status,
    },
    connection: connected
      ? {
          externalAccountId: "tenant_lark_1",
          externalAccountName: "OpenMeld Center Agent",
          grantedCapabilityGroups: ["conversation.text"],
          id: "connection_lark_1",
          lastVerifiedAt: "2026-07-18T00:00:00.000Z",
          permissionBundleVersion: "channel-only-2026-07-18",
          provider: "lark",
          reasonCode: null,
          status: "connected",
          transport: "webhook",
        }
      : null,
    organizationId: "org-1",
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
