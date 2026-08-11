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
        url: "https://gateway.openmeld.invalid/v1/organizations/current/directory",
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

  it("bulk-authorizes Agent Profile Bindings for an Organization", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          alreadyAuthorizedCount: 0,
          authorizedCount: 1,
          authorizations: [
            {
              agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
              authorizedBy: "user-1",
              bindingId: "binding-1",
              createdAt: "2026-07-04T00:00:00.000Z",
              organizationId: "org-1",
              status: "authorized",
            },
          ],
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
      api.bulkAuthorizeAgentProfileBindings({
        agentProfileIds: ["agt_11111111-1111-4111-8111-111111111111"],
        organizationId: "org-1",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({
      authorizedCount: 1,
      organizationId: "org-1",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            agentProfileIds: ["agt_11111111-1111-4111-8111-111111111111"],
          }),
          method: "POST",
        }),
        operation: "organization.binding_authorization.bulk_authorize",
        url: "https://gateway.openmeld.invalid/v1/organizations/org-1/binding-authorizations/bulk",
      })
    );
  });

  it("lists Organization Wake Access profiles for an Organization", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          profiles: [
            {
              agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
              authorized: false,
              authorizedAt: null,
              authorizedBy: null,
              bindingId: null,
              ownerUserId: "user-1",
              profileHandle: "codex",
              profileName: "Codex",
              profileOrganizationId: "org-1",
              status: "binding_required",
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
      api.listBindingAuthorizationProfiles({
        organizationId: "org-1",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({
      organizationId: "org-1",
      profiles: [expect.objectContaining({ status: "binding_required" })],
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "organization.binding_authorization.profiles.list",
        url: "https://gateway.openmeld.invalid/v1/organizations/org-1/binding-authorizations/profiles",
      })
    );
  });

  it("reads and writes the Organization Binding authorization preference", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          autoAuthorizeAgentProfileBindings: false,
          organizationId: "org-1",
          updatedAt: null,
          userId: "user-1",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          autoAuthorizeAgentProfileBindings: true,
          organizationId: "org-1",
          updatedAt: "2026-07-04T00:00:00.000Z",
          userId: "user-1",
        })
      );
    const api = createOrganizationApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.getBindingAuthorizationPreference({
        organizationId: "org-1",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({
      autoAuthorizeAgentProfileBindings: false,
    });
    await expect(
      api.setBindingAuthorizationPreference({
        autoAuthorizeAgentProfileBindings: true,
        organizationId: "org-1",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({
      autoAuthorizeAgentProfileBindings: true,
    });

    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "organization.binding_authorization.preference.read",
        url: "https://gateway.openmeld.invalid/v1/organizations/org-1/binding-authorization-preference",
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            autoAuthorizeAgentProfileBindings: true,
          }),
          method: "PUT",
        }),
        operation: "organization.binding_authorization.preference.write",
        url: "https://gateway.openmeld.invalid/v1/organizations/org-1/binding-authorization-preference",
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

  it("saves the Organization Wake access choice in one request", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          alreadyAuthorizedCount: 0,
          authorizedCount: 2,
          organizationId: "org-1",
          preference: {
            autoAuthorizeAgentProfileBindings: true,
            organizationId: "org-1",
            updatedAt: "2026-07-16T00:00:00.000Z",
            userId: "user-1",
          },
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
      api.saveWakeAccessChoice({
        enableWakeAccess: true,
        organizationId: "org-1",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({
      authorizedCount: 2,
      preference: { autoAuthorizeAgentProfileBindings: true },
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({ enableWakeAccess: true }),
          method: "PUT",
        }),
        operation: "organization.wake_access_choice.write",
        url: "https://gateway.openmeld.invalid/v1/organizations/org-1/wake-access-choice",
      })
    );
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
        : "https://open.feishu.cn/page/launcher?device_code=redacted",
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
