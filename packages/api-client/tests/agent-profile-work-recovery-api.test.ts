import { describe, expect, it, vi } from "vitest";
import {
  createAgentProfileWorkRecoveryApi,
  createOpenMeldApiClient,
} from "../src";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

describe("api-client Agent Profile work recovery API", () => {
  it("posts only the recovery action to the canonical Agent Profile route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          action: "continue_interrupted_work",
          status: "accepted",
        })
      )
    );
    const api = createAgentProfileWorkRecoveryApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        getRequestContextHeaders: async ({ requestContext }) => ({
          "x-openmeld-requested-organization-id":
            requestContext.activeOrganizationId ?? "",
        }),
        transport,
      })
    );

    await expect(
      api.execute({
        action: "continue_interrupted_work",
        agentProfileId: AGENT_PROFILE_ID,
        requestContext: {
          activeOrganizationId: "org-1",
          actorContext: {
            openMeldProfileId: "11111111-1111-4111-8111-111111111111",
            ownerUserId: "owner-1",
            profileKind: "human",
            profileName: "Mira",
            requestId: "req-agent-profile-work-recovery",
          },
        },
      })
    ).resolves.toEqual({
      action: "continue_interrupted_work",
      status: "accepted",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({ action: "continue_interrupted_work" }),
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-openmeld-requested-organization-id": "org-1",
          }),
          method: "POST",
        }),
        operation: "agent_profile_work_recovery.execute",
        url: `https://gateway.openmeld.invalid/v1/agent-profiles/${encodeURIComponent(AGENT_PROFILE_ID)}/work-recovery`,
      })
    );
  });

  it("posts the exact interrupted Wake identity with Skip", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          action: "skip_interrupted_work",
          status: "accepted",
        })
      )
    );
    const api = createAgentProfileWorkRecoveryApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.execute({
        action: "skip_interrupted_work",
        agentProfileId: AGENT_PROFILE_ID,
        expectedInterruptedTargetWakeLifecycleId: "twl_interrupted",
      })
    ).resolves.toEqual({
      action: "skip_interrupted_work",
      status: "accepted",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            action: "skip_interrupted_work",
            expectedInterruptedTargetWakeLifecycleId: "twl_interrupted",
          }),
        }),
      })
    );
  });

  it("posts queued-work approval through the composed strict input contract", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          action: "approve_queued_work",
          status: "accepted",
        })
      )
    );
    const api = createAgentProfileWorkRecoveryApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.execute({
        action: "approve_queued_work",
        agentProfileId: AGENT_PROFILE_ID,
      })
    ).resolves.toEqual({
      action: "approve_queued_work",
      status: "accepted",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({ action: "approve_queued_work" }),
        }),
      })
    );
  });

  it("rejects Skip without the interrupted Wake identity before making a request", async () => {
    const transport = vi.fn();
    const api = createAgentProfileWorkRecoveryApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.execute({
        action: "skip_interrupted_work",
        agentProfileId: AGENT_PROFILE_ID,
      } as never)
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects an invalid action before making a request", async () => {
    const transport = vi.fn();
    const api = createAgentProfileWorkRecoveryApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.execute({
        action: "retry_everything" as never,
        agentProfileId: AGENT_PROFILE_ID,
      })
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects a response that does not match the recovery contract", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          action: "continue_interrupted_work",
          status: "accepted",
          unexpected: true,
        })
      )
    );
    const api = createAgentProfileWorkRecoveryApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.execute({
        action: "continue_interrupted_work",
        agentProfileId: AGENT_PROFILE_ID,
      })
    ).rejects.toThrow("Invalid Agent Profile work recovery response.");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
