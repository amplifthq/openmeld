import {
  AGENT_ACTIVITY_EVENT_BATCH_MAX_BYTES,
  AGENT_CONTROLLER_TASK_LIFECYCLE_EVENT_BATCH_MAX_BYTES,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

type CoreRpcMock = {
  submitAgentActivityEvents: ReturnType<typeof vi.fn>;
  submitAgentControllerTaskLifecycleEvents: ReturnType<typeof vi.fn>;
  submitRuntimeAgentControllerReports: ReturnType<typeof vi.fn>;
  submitRuntimeProviderConversationProofs: ReturnType<typeof vi.fn>;
  submitRuntimeRegistration: ReturnType<typeof vi.fn>;
};

type AuthRpcMock = {
  resolveProfile: ReturnType<typeof vi.fn>;
  resolveRequestAuth: ReturnType<typeof vi.fn>;
};

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

const WORKER_ROUTE_TEST_TIMEOUT_MS = 30_000;

function makeEnv(input?: {
  authOverrides?: Partial<AuthRpcMock>;
  coreOverrides?: Partial<CoreRpcMock>;
}) {
  const coreRpc: CoreRpcMock = {
    submitAgentActivityEvents: vi.fn(async () => ({
      events: [{ eventId: "event-1", index: 0, outcome: "accepted" }],
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
      status: "accepted",
    })),
    submitAgentControllerTaskLifecycleEvents: vi.fn(async () => ({
      events: [
        {
          eventId: "controller-event-1",
          outcome: "accepted",
          status: "accepted",
        },
      ],
      status: "accepted",
    })),
    submitRuntimeRegistration: vi.fn(async () => ({
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
      status: "created",
    })),
    submitRuntimeAgentControllerReports: vi.fn(async () => ({
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
    })),
    submitRuntimeProviderConversationProofs: vi.fn(async () => ({
      proofs: [
        {
          agentProfileId: "agt_1",
          bindingId: "binding_1",
          outcome: "created",
          status: "accepted",
        },
      ],
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
      status: "accepted",
    })),
    ...(input?.coreOverrides ?? {}),
  };

  const authRpc: AuthRpcMock = {
    resolveRequestAuth: vi.fn(async () => ({
      ok: true,
      claims: {
        authMethod: "session",
        authenticated: true,
        ownerIds: ["owner-1"],
        requestId: "req-runtime-reporting-route",
      },
    })),
    resolveProfile: vi.fn(async () => ({
      ok: true,
      resolvedProfile: {
        openMeldProfileId: "11111111-1111-4111-8111-111111111111",
        ownerUserId: "owner-1",
        profileKind: "human",
        profileName: "Mira",
      },
    })),
    ...(input?.authOverrides ?? {}),
  };

  return {
    coreRpc,
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
    } as unknown as CloudflareBindings,
  };
}

describe("runtime reporting routes", () => {
  it(
    "forwards opaque Agent Activity candidates for per-event Core validation",
    async () => {
      const { coreRpc, env } = makeEnv();
      const events = [
        {
          eventId: "event-1",
          prompt:
            "Core must permanently reject this candidate without persistence",
        },
      ];
      const response = await app.fetch(
        new Request("http://local/v1/devices/device-1/agent-activity-events", {
          body: JSON.stringify({
            events,
            lane: "openmeld-dev",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_1",
            },
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }),
        env,
        TEST_EXECUTION_CONTEXT
      );

      expect(response.status).toBe(200);
      expect(coreRpc.submitAgentActivityEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: "device-1",
          events,
          lane: "openmeld-dev",
        })
      );
    },
    WORKER_ROUTE_TEST_TIMEOUT_MS
  );

  it("rejects oversized Agent Activity batches before calling Core", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request("http://local/v1/devices/device-1/agent-activity-events", {
        body: JSON.stringify({
          events: [
            {
              eventId: "event-large",
              prompt: "x".repeat(AGENT_ACTIVITY_EVENT_BATCH_MAX_BYTES),
            },
          ],
          lane: "openmeld-dev",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime_opaque_1",
          },
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(413);
    expect(coreRpc.submitAgentActivityEvents).not.toHaveBeenCalled();
  });

  it("rejects oversized controller task lifecycle batches before calling Core", async () => {
    const { coreRpc, env } = makeEnv();
    const response = await app.fetch(
      new Request(
        "http://local/v1/devices/device-1/agent-controller-task-lifecycle-events",
        {
          body: JSON.stringify({
            events: [
              {
                eventId: "controller-event-large",
                padding: "x".repeat(
                  AGENT_CONTROLLER_TASK_LIFECYCLE_EVENT_BATCH_MAX_BYTES
                ),
              },
            ],
            lane: "openmeld-dev",
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_1",
            },
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(413);
    expect(
      coreRpc.submitAgentControllerTaskLifecycleEvents
    ).not.toHaveBeenCalled();
  });

  it("rejects Runtime registration payloads with caller-provided owner identity", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request("http://local/v1/devices/device-1/runtime-registration", {
        body: JSON.stringify({
          lane: "openmeld-dev",
          ownerAccountId: "body-owner",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(coreRpc.submitRuntimeRegistration).not.toHaveBeenCalled();
  });

  it("forwards Runtime Agent Controller Report submission to Core", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/devices/device-1/runtime-agent-controller-reports/current",
        {
          body: JSON.stringify({
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
              value: "runtime_opaque_1",
            },
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "accepted",
    });
    expect(coreRpc.submitRuntimeAgentControllerReports).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [
          expect.objectContaining({
            agentControllerRef: "builtin:codex",
          }),
        ],
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      })
    );
  });

  it("passes through rejected Runtime Agent Controller Report responses without authority openMeldServiceRuntimeId evidence", async () => {
    const { env } = makeEnv({
      coreOverrides: {
        submitRuntimeAgentControllerReports: vi.fn(async () => ({
          reports: [
            {
              agentControllerRef: "builtin:codex",
              reason: "openmeld_service_runtime_id_invalid",
              status: "rejected",
            },
          ],
          status: "rejected",
        })),
      },
    });

    const response = await app.fetch(
      new Request(
        "http://local/v1/devices/device-1/runtime-agent-controller-reports/current",
        {
          body: JSON.stringify({
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
              value: "owner_account:owner-1:device-1:openmeld-dev",
            },
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
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

  it("forwards Runtime Provider Conversation Proof submission to Core", async () => {
    const { coreRpc, env } = makeEnv();

    const response = await app.fetch(
      new Request(
        "http://local/v1/devices/device-1/runtime-provider-conversation-proofs/current",
        {
          body: JSON.stringify({
            lane: "openmeld-dev",
            proofs: [
              {
                agentProfileId: "agt_1",
                bindingId: "binding_1",
                agentControllerRef: "builtin:codex",
                agentControllerConversationId:
                  "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
                transportMode: "codex-app-server",
                provider: "codex",
                method: "codex_app_server_thread_resume",
                intrusive: false,
                expiresAtMs: 2000,
                observedAtMs: 1000,
                status: "passed",
              },
            ],
            openMeldServiceRuntimeId: {
              source: "runtime_registry_authority",
              value: "runtime_opaque_1",
            },
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "accepted",
    });
    expect(
      coreRpc.submitRuntimeProviderConversationProofs
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "device-1",
        lane: "openmeld-dev",
        proofs: [
          expect.objectContaining({
            agentControllerConversationId:
              "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
            method: "codex_app_server_thread_resume",
            provider: "codex",
          }),
        ],
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      })
    );
  });
});
