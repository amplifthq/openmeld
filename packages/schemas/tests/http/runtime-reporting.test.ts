import { describe, expect, it } from "vitest";
import {
  submitAgentControllerTaskLifecycleEventsBodySchema,
  submitAgentControllerTaskLifecycleEventsResponseSchema,
  submitRuntimeAgentControllerReportsBodySchema,
  submitRuntimeAgentControllerReportsResponseSchema,
  submitRuntimeProviderConversationProofsBodySchema,
  submitRuntimeProviderConversationProofsResponseSchema,
  submitRuntimeRegistrationBodySchema,
  submitRuntimeRegistrationResponseSchema,
} from "../../src/schemas";

describe("runtime reporting schemas", () => {
  const CODEX_AGENT_CONTROLLER_INTERFACE = {
    agentControllerRef: "builtin:codex",
    auth: { status: "authenticated", label: "Signed in" },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: false,
    },
    checkedAt: "2026-06-28T00:00:00.000Z",
    controllerId: "codex",
    displayName: "Codex",
    launch: {
      argsPrefix: [],
      commandPath: "/usr/local/bin/codex",
      installChoiceCount: 1,
      status: "ready",
    },
    message: null,
    models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
    nativeInterface: "codex-app-server",
    schemaVersion: 1,
    skills: [{ id: "review", displayName: "Review" }],
    status: "ready",
    version: "0.1.0",
  } as const;

  it("accepts runtime registration without caller-provided owner identity", () => {
    expect(
      submitRuntimeRegistrationBodySchema.parse({
        lane: "openmeld-dev",
      })
    ).toEqual({
      lane: "openmeld-dev",
    });

    expect(() =>
      submitRuntimeRegistrationBodySchema.parse({
        lane: "openmeld-dev",
        ownerAccountId: "owner-from-body",
      })
    ).toThrow();
  });

  it("accepts exact Agent Controller task lifecycle events", () => {
    expect(
      submitAgentControllerTaskLifecycleEventsBodySchema.parse({
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
          {
            agentControllerRef: "builtin:claude-code",
            attentionCode: "permission_prompt",
            eventId: "claude:session-1:permission-prompt:1001",
            eventType: "needs_attention",
            occurredAtMs: 1001,
            organizationId: "org-1",
            source: "claude_notification",
            taskId: "session-1",
          },
        ],
        lane: "openmeld-dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      }).events
    ).toHaveLength(2);
  });

  it("requires attention evidence only for needs_attention events", () => {
    for (const event of [
      {
        attentionCode: null,
        eventType: "needs_attention",
        source: "codex_permission_request",
      },
      {
        attentionCode: "permission_request",
        eventType: "completed",
        source: "codex_stop",
      },
    ]) {
      expect(
        submitAgentControllerTaskLifecycleEventsBodySchema.safeParse({
          events: [
            {
              agentControllerRef: "builtin:codex",
              eventId: "event-invalid-1",
              occurredAtMs: 1000,
              organizationId: "org-1",
              taskId: "turn-1",
              ...event,
            },
          ],
          lane: "openmeld-dev",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime_opaque_1",
          },
        }).success
      ).toBe(false);
    }
  });

  it("keeps accepted and rejected lifecycle event results unambiguous", () => {
    expect(
      submitAgentControllerTaskLifecycleEventsResponseSchema.parse({
        events: [
          {
            eventId: "event-accepted-1",
            outcome: "accepted",
            status: "accepted",
          },
          {
            eventId: "event-rejected-1",
            reason: "registered_task_missing",
            status: "permanently_rejected",
          },
        ],
        status: "partial",
      }).status
    ).toBe("partial");

    expect(
      submitAgentControllerTaskLifecycleEventsResponseSchema.safeParse({
        events: [
          {
            eventId: "event-ambiguous-1",
            outcome: "accepted",
            reason: "registered_task_missing",
            status: "accepted",
          },
        ],
        status: "accepted",
      }).success
    ).toBe(false);
  });

  it("accepts runtime agent controller report submission with authority openMeldServiceRuntimeId evidence", () => {
    expect(
      submitRuntimeAgentControllerReportsBodySchema.parse({
        lane: "openmeld-dev",
        reports: [
          {
            agentControllerRef: "builtin:codex",
            agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
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
      })
    ).toMatchObject({
      lane: "openmeld-dev",
      reports: [
        {
          agentControllerRef: "builtin:codex",
          agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
          status: "ready",
        },
      ],
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_opaque_1",
      },
    });
  });

  it("accepts explicit registration and report submission results", () => {
    expect(
      submitRuntimeRegistrationResponseSchema.parse({
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
        status: "created",
      })
    ).toMatchObject({
      status: "created",
    });

    expect(
      submitRuntimeAgentControllerReportsResponseSchema.parse({
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
    ).toMatchObject({
      reports: [
        {
          agentControllerRef: "builtin:codex",
          status: "accepted",
        },
      ],
      status: "accepted",
    });
  });

  it("rejects runtime agent controller reports with mismatched ACI refs", () => {
    expect(
      submitRuntimeAgentControllerReportsBodySchema.safeParse({
        lane: "openmeld-dev",
        reports: [
          {
            agentControllerRef: "builtin:claude-code",
            agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
            expiresAtMs: 2000,
            observedAtMs: 1000,
            status: "ready",
          },
        ],
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      }).success
    ).toBe(false);
  });

  it("accepts Runtime Provider Conversation Proof submissions", () => {
    expect(
      submitRuntimeProviderConversationProofsBodySchema.parse({
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
            method: "codex_app_server_thread_read",
            intrusive: false,
            observedAtMs: 1000,
            expiresAtMs: 2000,
            status: "passed",
          },
        ],
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_opaque_1",
        },
      })
    ).toMatchObject({
      proofs: [
        {
          agentControllerRef: "builtin:codex",
          method: "codex_app_server_thread_read",
          provider: "codex",
          status: "passed",
        },
      ],
    });
  });

  it("accepts explicit Runtime Provider Conversation Proof results", () => {
    expect(
      submitRuntimeProviderConversationProofsResponseSchema.parse({
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
      })
    ).toMatchObject({
      proofs: [
        {
          agentProfileId: "agt_1",
          bindingId: "binding_1",
          status: "accepted",
        },
      ],
      status: "accepted",
    });
  });

  it("does not require authority openMeldServiceRuntimeId evidence on fully rejected report submission results", () => {
    expect(
      submitRuntimeAgentControllerReportsResponseSchema.parse({
        reports: [
          {
            agentControllerRef: "builtin:codex",
            reason: "openmeld_service_runtime_id_invalid",
            status: "rejected",
          },
        ],
        status: "rejected",
      })
    ).toEqual({
      reports: [
        {
          agentControllerRef: "builtin:codex",
          reason: "openmeld_service_runtime_id_invalid",
          status: "rejected",
        },
      ],
      status: "rejected",
    });

    expect(() =>
      submitRuntimeAgentControllerReportsResponseSchema.parse({
        reports: [
          {
            agentControllerRef: "builtin:codex",
            outcome: "created",
            status: "accepted",
          },
        ],
        status: "accepted",
      })
    ).toThrow();
  });
});
