import { describe, expect, it, vi } from "vitest";
import {
  createCenterAgentApi,
  createDirectMessageApi,
  createOpenMeldApiClient,
} from "../src";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_CONTEXT = {
  activeOrganizationId: "org-1",
  actorContext: {
    requestId: "req-center-agent-api-123",
    callerPrincipalId: "user-1",
    openMeldProfileId: AGENT_PROFILE_ID,
    profileKind: "agent" as const,
    profileName: "Center Agent",
    ownerUserId: "user-1",
  },
};

describe("api-client Center Agent api", () => {
  it("reads and updates the Organization model through the canonical route", async () => {
    const modelConfiguration = {
      canManage: true,
      choices: [
        {
          displayName: "OpenMeld default",
          effectiveModelDisplayName: "Grok 4.5",
          preference: { kind: "system_default" },
          supportsImageInput: true,
        },
        {
          displayName: "DeepSeek V4 Flash",
          effectiveModelDisplayName: "DeepSeek V4 Flash",
          preference: {
            kind: "selected_model",
            modelId: "deepseek/deepseek-v4-flash",
          },
          supportsImageInput: false,
        },
      ],
      configurationRevision: 3,
      effectiveModel: {
        availability: "available",
        displayName: "Grok 4.5",
        modelId: "x-ai/grok-4.5",
        supportsImageInput: true,
      },
      organizationId: "org-1",
      preference: { kind: "system_default" },
    } as const;
    const transport = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(modelConfiguration))
      .mockResolvedValueOnce(
        jsonResponse({
          ...modelConfiguration,
          changed: true,
          configurationRevision: 4,
          effectiveModel: {
            availability: "available",
            displayName: "DeepSeek V4 Flash",
            modelId: "deepseek/deepseek-v4-flash",
            supportsImageInput: false,
          },
          preference: {
            kind: "selected_model",
            modelId: "deepseek/deepseek-v4-flash",
          },
        })
      );
    const api = createCenterAgentApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.getModel({ requestContext: REQUEST_CONTEXT })
    ).resolves.toMatchObject({
      effectiveModel: { displayName: "Grok 4.5" },
    });
    await expect(
      api.updateModel({
        expectedConfigurationRevision: 3,
        preference: {
          kind: "selected_model",
          modelId: "deepseek/deepseek-v4-flash",
        },
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({
      changed: true,
      effectiveModel: { displayName: "DeepSeek V4 Flash" },
    });

    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "center_agent.model.read",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/center-agent/model",
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            expectedConfigurationRevision: 3,
            preference: {
              kind: "selected_model",
              modelId: "deepseek/deepseek-v4-flash",
            },
          }),
          method: "PUT",
        }),
        operation: "center_agent.model.update",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/center-agent/model",
      })
    );
  });

  it("reads Remote Agent runtime availability from Center Agent designation responses", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          designation: null,
          remoteRuntimeAvailability: {
            selectable: false,
            reasonCode: "remote_runtime_disabled",
          },
        })
      )
    );
    const api = createCenterAgentApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getDesignation({
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.remoteRuntimeAvailability).toEqual({
      selectable: false,
      reasonCode: "remote_runtime_disabled",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "center_agent.designation.read",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/center-agent/designation",
      })
    );
  });

  it("writes the current Center Agent designation through the canonical route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          designation: designationResponse(),
          status: "designated",
        })
      )
    );
    const api = createCenterAgentApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.designate({
      agentProfileId: AGENT_PROFILE_ID,
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.status).toBe("designated");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({ agentProfileId: AGENT_PROFILE_ID }),
          method: "PUT",
        }),
        operation: "center_agent.designation.write",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/center-agent/designation",
      })
    );
  });

  it("sends the requested Center Agent runtime in designation writes", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          designation: designationResponse(),
          status: "designated",
        })
      )
    );
    const api = createCenterAgentApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.designate({
      agentProfileId: AGENT_PROFILE_ID,
      requestContext: REQUEST_CONTEXT,
      runtime: "remote_agent",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            agentProfileId: AGENT_PROFILE_ID,
            runtime: "remote_agent",
          }),
          method: "PUT",
        }),
        operation: "center_agent.designation.write",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/center-agent/designation",
      })
    );
  });

  it("can designate the managed Center Agent runtime without an explicit profile id", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          designation: designationResponse(),
          status: "designated",
        })
      )
    );
    const api = createCenterAgentApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.designate({
      requestContext: REQUEST_CONTEXT,
      runtime: "remote_agent",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            runtime: "remote_agent",
          }),
          method: "PUT",
        }),
        operation: "center_agent.designation.write",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/center-agent/designation",
      })
    );
  });

  it("reads and updates the Center Agent operating state through its dedicated route", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          canChangeOperatingState: true,
          operatingState: "active",
          organizationId: "org-1",
          pausedAt: null,
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          affectedTaskCount: 3,
          canChangeOperatingState: true,
          changed: true,
          operatingState: "paused",
          organizationId: "org-1",
          pausedAt: "2026-07-29T00:00:00.000Z",
        })
      );
    const api = createCenterAgentApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.getOperatingState({ requestContext: REQUEST_CONTEXT })
    ).resolves.toMatchObject({
      canChangeOperatingState: true,
      operatingState: "active",
    });
    await expect(
      api.updateOperatingState({
        operatingState: "paused",
        requestContext: REQUEST_CONTEXT,
      })
    ).resolves.toMatchObject({
      affectedTaskCount: 3,
      changed: true,
      operatingState: "paused",
    });

    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "center_agent.operating_state.read",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/center-agent/operating-state",
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({ operatingState: "paused" }),
          method: "PUT",
        }),
        operation: "center_agent.operating_state.update",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/center-agent/operating-state",
      })
    );
  });

  it("opts audit readers into an explicit action set without changing the legacy default", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          entries: [
            {
              id: "audit-1",
              organizationId: "org-1",
              actorProfileId: AGENT_PROFILE_ID,
              action: "create_space",
              onBehalfOf: {
                profileId: HUMAN_PROFILE_ID,
                userId: "user-1",
                displayName: "Mira",
              },
              resource: { type: "space", id: "space-1" },
              createdAt: "2026-07-04T00:00:00.000Z",
            },
          ],
        })
      )
    );
    const api = createCenterAgentApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.listAuditJournal({
      actionSet: "v18",
      limit: 25,
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.entries[0]?.onBehalfOf?.profileId).toBe(HUMAN_PROFILE_ID);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "GET" }),
        operation: "center_agent.audit_journal.list",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/center-agent/audit-journal?limit=25&actionSet=v18",
      })
    );

    await api.listAuditJournal({
      limit: 5,
      requestContext: REQUEST_CONTEXT,
    });

    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        operation: "center_agent.audit_journal.list",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/center-agent/audit-journal?limit=5&actionSet=v16",
      })
    );
  });

  it("records an exact Context Load Receipt through its manifest-scoped route", async () => {
    const manifestId =
      "center_agent_context_manifest_11111111-1111-4111-8111-111111111111";
    const hash = `sha256:${"a".repeat(64)}`;
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          authorization: {
            principal: "authenticated_member",
            scope: "requester_private",
          },
          provenance: { auditEntryId: "audit-load-1" },
          receipt: {
            client: "codex",
            estimatedTokens: 50,
            id: "center_agent_context_load_receipt_11111111-1111-4111-8111-111111111111",
            includedMessages: 1,
            manifestId,
            selectedEntries: [
              { materializedContentHash: hash, sourceRefId: "signal-1" },
            ],
            status: "loaded",
          },
          recordedAt: "2026-08-10T00:00:01.000Z",
          schemaVersion: "center_agent_context_load_receipt.v1",
        })
      )
    );
    const api = createCenterAgentApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.createContextLoadReceipt({
        manifestId,
        requestContext: REQUEST_CONTEXT,
        selection: {
          entries: [{ materializedContentHash: hash, sourceRefId: "signal-1" }],
          kind: "selected_entries",
        },
        source: { client: "codex", kind: "local_agent" },
      })
    ).resolves.toMatchObject({ receipt: { manifestId, status: "loaded" } });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            selection: {
              entries: [
                { materializedContentHash: hash, sourceRefId: "signal-1" },
              ],
              kind: "selected_entries",
            },
            source: { client: "codex", kind: "local_agent" },
          }),
          method: "POST",
        }),
        operation: "center_agent.context_load_receipt.create",
        url: `https://gateway.openmeld.invalid/v1/organizations/current/center-agent/context-manifests/${manifestId}/load-receipt`,
      })
    );
  });

  it("opens the lazy Center Agent DM Space through the canonical route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          centerAgentProfileId: AGENT_PROFILE_ID,
          memberProfileId: HUMAN_PROFILE_ID,
          spaceId: "space-dm-1",
          created: false,
        })
      )
    );
    const api = createCenterAgentApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.openDirectMessageSpace({
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.spaceId).toBe("space-dm-1");
    expect(result.created).toBe(false);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "POST" }),
        operation: "center_agent.dm_space.open",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/center-agent/dm-space",
      })
    );
  });
});

describe("api-client Direct Message api", () => {
  it("opens a Direct Message Space through the org-scoped route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          organizationId: "org-1",
          memberProfileId: HUMAN_PROFILE_ID,
          targetProfileId: AGENT_PROFILE_ID,
          spaceId: "space-dm-2",
          created: true,
        })
      )
    );
    const api = createDirectMessageApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.openSpace({
      targetProfileId: AGENT_PROFILE_ID,
      requestContext: REQUEST_CONTEXT,
    });

    expect(result.spaceId).toBe("space-dm-2");
    expect(result.created).toBe(true);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({ targetProfileId: AGENT_PROFILE_ID }),
          method: "POST",
        }),
        operation: "direct_message.space.open",
        url: "https://gateway.openmeld.invalid/v1/organizations/current/dm-space",
      })
    );
  });
});

function designationResponse() {
  return {
    organizationId: "org-1",
    agentProfileId: AGENT_PROFILE_ID,
    duty: null,
    designatedBy: "user-1",
    createdAt: "2026-07-04T00:00:00.000Z",
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
