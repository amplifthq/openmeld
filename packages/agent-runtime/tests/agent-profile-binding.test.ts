import { describe, expect, it } from "vitest";
import {
  assertAgentProfileBindingTruthWriterAllowed,
  createAgentProfileBindingAgentControllerPermissionMode,
  createAgentProfileBindingDisplayProjection,
  createAgentProfileBindingExecutionTarget,
} from "../src";

describe("agent-runtime Agent Profile Binding pure model", () => {
  it("requires Binding to reference one OpenMeld Service Runtime and Agent Controller, not either side alone", () => {
    expect(
      createAgentProfileBindingExecutionTarget({
        openMeldServiceRuntimeId: " runtime-dev-1 ",
        agentControllerRef: "builtin:codex",
      })
    ).toEqual({
      openMeldServiceRuntimeId: "runtime-dev-1",
      agentControllerRef: "builtin:codex",
    });

    expect(() =>
      createAgentProfileBindingExecutionTarget({
        openMeldServiceRuntimeId: "runtime-dev-1",
      } as unknown as Parameters<
        typeof createAgentProfileBindingExecutionTarget
      >[0])
    ).toThrow("agent_profile_binding.agent_controller_report_invalid");

    expect(() =>
      createAgentProfileBindingExecutionTarget({
        agentControllerRef: "builtin:codex",
      } as unknown as Parameters<
        typeof createAgentProfileBindingExecutionTarget
      >[0])
    ).toThrow("agent_profile_binding.agent_controller_report_invalid");
  });

  it("projects an enabled primary Binding into display and dispatch-readable facts", () => {
    expect(
      createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        agentControllerPermissionMode: "codex:approveForMe",
        bindingId: "bind_11111111-1111-4111-8111-111111111111",
        bindingState: "enabled_primary",
        executionTarget: {
          openMeldServiceRuntimeId: "runtime-dev-1",
          agentControllerRef: "builtin:codex",
        },
      })
    ).toMatchObject({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      bindingState: "enabled_primary",
      resolutionSource: "binding_truth",
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      dispatchEligibility: {
        routable: true,
        status: "routable",
        reasonCodes: ["agent_profile_binding.enabled_primary"],
      },
      dispatchReadableFacts: {
        agentControllerPermissionMode: "codex:approveForMe",
        bindingId: "bind_11111111-1111-4111-8111-111111111111",
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        openMeldServiceRuntimeId: "runtime-dev-1",
        agentControllerRef: "builtin:codex",
        bindingState: "enabled_primary",
        routable: true,
      },
    });
  });

  it("fails closed to default Agent Controller Permission Mode for bound projections", () => {
    expect(
      createAgentProfileBindingAgentControllerPermissionMode(undefined)
    ).toBe("claude-code:default");
    expect(
      createAgentProfileBindingAgentControllerPermissionMode("unsupported")
    ).toBe("claude-code:default");

    expect(
      createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "bind_11111111-1111-4111-8111-111111111111",
        bindingState: "enabled_primary",
        executionTarget: {
          openMeldServiceRuntimeId: "runtime-dev-1",
          agentControllerRef: "builtin:codex",
        },
      })
    ).toMatchObject({
      agentControllerPermissionMode: "codex:askForApproval",
      dispatchReadableFacts: {
        agentControllerPermissionMode: "codex:askForApproval",
      },
    });
  });

  it("only projects an Agent Controller Collaboration Mode when Binding truth stores one", () => {
    const baseInput = {
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      bindingId: "bind_11111111-1111-4111-8111-111111111111",
      bindingState: "enabled_primary" as const,
      executionTarget: {
        openMeldServiceRuntimeId: "runtime-dev-1",
        agentControllerRef: "builtin:codex",
      },
    };

    const legacyProjection =
      createAgentProfileBindingDisplayProjection(baseInput);
    expect(legacyProjection).not.toHaveProperty(
      "agentControllerCollaborationMode"
    );
    expect(legacyProjection.dispatchReadableFacts).not.toHaveProperty(
      "agentControllerCollaborationMode"
    );

    expect(
      createAgentProfileBindingDisplayProjection({
        ...baseInput,
        agentControllerCollaborationMode: "codex:plan",
      })
    ).toMatchObject({
      agentControllerCollaborationMode: "codex:plan",
      dispatchReadableFacts: {
        agentControllerCollaborationMode: "codex:plan",
      },
    });
  });

  it("omits cross-provider and unsupported Agent Controller Permission Mode from bound projections", () => {
    const mismatchedProjection = createAgentProfileBindingDisplayProjection({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      bindingId: "bind_11111111-1111-4111-8111-111111111111",
      bindingState: "enabled_primary",
      agentControllerPermissionMode: "claude-code:default",
      executionTarget: {
        openMeldServiceRuntimeId: "runtime-dev-1",
        agentControllerRef: "builtin:codex",
      },
    });
    expect(mismatchedProjection).not.toHaveProperty(
      "agentControllerPermissionMode"
    );
    expect(mismatchedProjection.dispatchReadableFacts).not.toHaveProperty(
      "agentControllerPermissionMode"
    );

    const unsupportedProjection = createAgentProfileBindingDisplayProjection({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      bindingId: "bind_11111111-1111-4111-8111-111111111111",
      bindingState: "enabled_primary",
      agentControllerPermissionMode: "codex:askForApproval",
      executionTarget: {
        openMeldServiceRuntimeId: "runtime-dev-1",
        agentControllerRef: "builtin:openclaw",
      },
    });
    expect(unsupportedProjection).not.toHaveProperty(
      "agentControllerPermissionMode"
    );
    expect(unsupportedProjection.dispatchReadableFacts).not.toHaveProperty(
      "agentControllerPermissionMode"
    );
  });

  it("does not let diagnosticPointer override normalized projection truth fields", () => {
    const diagnosticPointerOverrideAttempt = {
      agentProfileId: "agt_wrong",
      bindingId: "bind_wrong",
      openMeldServiceRuntimeId: "runtime-wrong",
      agentControllerRef: "builtin:wrong",
      resolutionSource: "conflict_evidence",
      reasonCodes: ["agent_profile_binding.conflict"],
      correlationId: "corr_123",
      sourceSignalId: "sig_123",
      clientMessageId: "msg_123",
      dispatchId: "dispatch_123",
    } as unknown as NonNullable<
      Parameters<
        typeof createAgentProfileBindingDisplayProjection
      >[0]["diagnosticPointer"]
    >;

    const projection = createAgentProfileBindingDisplayProjection({
      agentProfileId: "agt_truth",
      bindingId: "bind_truth",
      bindingState: "enabled_primary",
      executionTarget: {
        openMeldServiceRuntimeId: " runtime-truth ",
        agentControllerRef: "builtin:codex",
      },
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      diagnosticPointer: diagnosticPointerOverrideAttempt,
    });

    expect(projection.diagnosticPointer).toEqual({
      agentProfileId: "agt_truth",
      bindingId: "bind_truth",
      openMeldServiceRuntimeId: "runtime-truth",
      agentControllerRef: "builtin:codex",
      resolutionSource: "binding_truth",
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      correlationId: "corr_123",
      sourceSignalId: "sig_123",
      clientMessageId: "msg_123",
      dispatchId: "dispatch_123",
    });
  });

  it("keeps missing Binding projections out of Dispatch routing", () => {
    expect(
      createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
        bindingState: "missing",
      })
    ).toMatchObject({
      bindingState: "missing",
      dispatchReadableFacts: null,
      dispatchEligibility: {
        routable: false,
        status: "not_routable",
      },
    });
  });

  it("keeps disabled historical Bindings visible but not routable", () => {
    expect(
      createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
        bindingId: "bind_33333333-3333-4333-8333-333333333333",
        bindingState: "disabled_historical",
        executionTarget: {
          openMeldServiceRuntimeId: "runtime-dev-1",
          agentControllerRef: "custom:custom-agent",
        },
      })
    ).toMatchObject({
      bindingState: "disabled_historical",
      dispatchEligibility: {
        routable: false,
        status: "not_routable",
        reasonCodes: ["agent_profile_binding.disabled_historical"],
      },
      dispatchReadableFacts: {
        bindingState: "disabled_historical",
        routable: false,
      },
    });
  });

  it("keeps owner mismatch blocked even when execution target facts exist", () => {
    expect(
      createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_66666666-6666-4666-8666-666666666666",
        bindingId: "bind_66666666-6666-4666-8666-666666666666",
        bindingState: "owner_mismatch",
        executionTarget: {
          openMeldServiceRuntimeId: "runtime-dev-1",
          agentControllerRef: "builtin:codex",
        },
        agentProfileOwner: {
          kind: "owner_account",
          id: "account-a",
        },
        runtimeOwner: {
          kind: "owner_account",
          id: "account-b",
        },
      })
    ).toMatchObject({
      bindingState: "owner_mismatch",
      authoritySource: "blocked",
      dispatchEligibility: {
        routable: false,
        status: "not_routable",
        reasonCodes: ["agent_profile_binding.owner_mismatch"],
      },
      dispatchReadableFacts: {
        bindingState: "owner_mismatch",
        routable: false,
      },
    });
  });

  it("keeps conflicts explicit instead of silently falling back to runtime facts", () => {
    expect(
      createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_44444444-4444-4444-8444-444444444444",
        bindingState: "conflict",
        reasonCodes: ["agent_profile_binding.conflict"],
      })
    ).toMatchObject({
      bindingState: "conflict",
      resolutionSource: "conflict_evidence",
      dispatchReadableFacts: null,
      dispatchEligibility: {
        routable: false,
        status: "not_routable",
      },
      reasonCodes: ["agent_profile_binding.conflict"],
    });
  });

  it("blocks direct Binding truth writes from Gateway, Web, CLI, Profile RPC, and Runtime Connector", () => {
    expect(() =>
      assertAgentProfileBindingTruthWriterAllowed({
        writer: "binding_command",
      })
    ).not.toThrow();

    for (const writer of [
      "profile_rpc",
      "gateway",
      "web",
      "cli",
      "runtime_connector",
    ] as const) {
      expect(() =>
        assertAgentProfileBindingTruthWriterAllowed({
          writer,
        })
      ).toThrow("agent_profile_binding.writer_forbidden");
    }
  });
});
