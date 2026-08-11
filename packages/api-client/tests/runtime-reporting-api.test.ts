import { describe, expect, it, vi } from "vitest";
import {
  createOpenMeldApiClient,
  createRuntimeReportingApi,
  type OpenMeldApiClientTransport,
} from "../src";

describe("api-client runtime reporting api", () => {
  it("submits exact Agent Controller task lifecycle events", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(
        jsonResponse({
          events: [
            {
              eventId: "codex:turn-1:stop",
              outcome: "accepted",
              status: "accepted",
            },
          ],
          status: "accepted",
        })
      )
    );
    const api = createRuntimeReportingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.submitAgentControllerTaskLifecycleEvents({
      deviceId: "device-macbook-pro",
      events: [
        {
          agentControllerRef: "builtin:codex",
          attentionCode: null,
          eventId: "codex:turn-1:stop",
          eventType: "completed",
          occurredAtMs: 1000,
          organizationId: "org-1",
          source: "codex_stop",
          taskId: "turn-1",
        },
      ],
      lane: "openmeld-dev",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({ method: "PUT" }),
        operation: "agent_controller_task.lifecycle_events.submit",
        url: "https://gateway.openmeld.invalid/v1/devices/device-macbook-pro/agent-controller-task-lifecycle-events",
      })
    );
  });

  it("submits only strict Agent Activity events through the device authority route", async () => {
    const transport = vi.fn<OpenMeldApiClientTransport>(() =>
      Promise.resolve(
        jsonResponse({
          events: [{ eventId: "event-1", index: 0, outcome: "accepted" }],
          status: "accepted",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime_opaque_1",
          },
        })
      )
    );
    const api = createRuntimeReportingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );
    const event = {
      clientKind: "codex-app" as const,
      eventId: "event-1",
      eventType: "session_active" as const,
      expiresAtMs: 61_000,
      gitBranch: "main",
      gitCommit: null,
      model: "gpt-5.6-sol",
      observedAtMs: 1000,
      organizationId: "org-1",
      projectId: "project-1",
      provider: "codex" as const,
      providerMetadata: {
        originator: "desktop" as const,
        source: "rollout" as const,
      },
      providerSessionId: "session-1",
      repositoryFingerprint: null,
      source: "observed" as const,
      startedAtMs: 900,
      status: "active" as const,
      title: "Agent Activity",
    };

    await api.submitAgentActivityEvents({
      deviceId: "device-macbook-pro",
      events: [event],
      lane: "openmeld-dev",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          method: "PUT",
        }),
        operation: "agent_activity.events.submit",
        url: "https://gateway.openmeld.invalid/v1/devices/device-macbook-pro/agent-activity-events",
      })
    );
    const request = transport.mock.calls[0]?.[0];
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      events: [event],
      lane: "openmeld-dev",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
    });
  });

  it("submits Runtime registration through the canonical device route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime_opaque_1",
          },
          status: "created",
        })
      )
    );
    const api = createRuntimeReportingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.submitRegistration({
      deviceId: "device-macbook-pro",
      lane: "openmeld-dev",
    });

    expect(result.status).toBe("created");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({ lane: "openmeld-dev" }),
          method: "PUT",
        }),
        operation: "runtime.registration.submit",
        url: "https://gateway.openmeld.invalid/v1/devices/device-macbook-pro/runtime-registration",
      })
    );
  });

  it("submits Runtime Agent Controller Reports through the canonical device route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          reports: [
            {
              agentControllerRef: "builtin:codex",
              outcome: "created",
              status: "accepted",
            },
          ],
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime_opaque_1",
          },
          status: "accepted",
        })
      )
    );
    const api = createRuntimeReportingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.submitAgentControllerReports({
      deviceId: "device-macbook-pro",
      lane: "openmeld-dev",
      reports: [
        {
          agentControllerRef: "builtin:codex",
          expiresAtMs: 2000,
          observedAtMs: 1000,
          reasonCodes: ["runtime.agent_controller_report.ready"],
          status: "ready",
        },
      ],
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
    });

    expect(result.status).toBe("accepted");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            lane: "openmeld-dev",
            reports: [
              {
                agentControllerRef: "builtin:codex",
                expiresAtMs: 2000,
                observedAtMs: 1000,
                reasonCodes: ["runtime.agent_controller_report.ready"],
                status: "ready",
              },
            ],
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_1",
            },
          }),
          method: "PUT",
        }),
        operation: "runtime.agent_controller_reports.submit",
        url: "https://gateway.openmeld.invalid/v1/devices/device-macbook-pro/runtime-agent-controller-reports/current",
      })
    );
  });

  it("accepts rejected Runtime Agent Controller Report responses without authority openMeldServiceRuntimeId evidence", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          reports: [
            {
              agentControllerRef: "builtin:codex",
              reason: "openmeld_service_runtime_id_invalid",
              status: "rejected",
            },
          ],
          status: "rejected",
        })
      )
    );
    const api = createRuntimeReportingApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.submitAgentControllerReports({
      deviceId: "device-macbook-pro",
      lane: "openmeld-dev",
      reports: [
        {
          agentControllerRef: "builtin:codex",
          expiresAtMs: 2000,
          observedAtMs: 1000,
          status: "ready",
        },
      ],
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "owner_account:owner-1:device-macbook-pro:openmeld-dev",
      },
    });

    expect(result).toEqual({
      reports: [
        {
          agentControllerRef: "builtin:codex",
          reason: "openmeld_service_runtime_id_invalid",
          status: "rejected",
        },
      ],
      status: "rejected",
    });
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
