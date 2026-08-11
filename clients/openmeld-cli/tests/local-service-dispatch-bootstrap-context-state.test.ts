import {
  buildRuntimeWorkspaceFingerprint,
  createEmptyLedgerState,
  resolveConversationExecutionStateByLookupKey,
  upsertConversationExecutionState,
} from "@openmeld/local-execution";
import { resolveDispatchContinuityObservation } from "@openmeld/local-service";
import type {
  AgentControllerConversationRef,
  BootstrapTemplateFacts,
  ConversationExecutionState,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { buildDispatchBootstrapTemplateFacts } from "../src/local-service/carrier/service-runner";
import {
  resolveAgentControllerConversationResumePlan,
  resolveLocalRuntimeContextPlan,
  resolveProviderRuntimeDispatchContinuation,
} from "../src/local-service/continuation/provider-runtime-continuation";
import {
  markBootstrapInjectedContext,
  reconcileBootstrapInjectedContextAfterDispatch,
  resolveBootstrapPlan,
  resolveEffectiveAgentControllerConversationId,
  rollbackBootstrapExecutionStateAfterDispatchFailure,
} from "../src/local-service/dispatch/execute-dispatch-task";

const BOOTSTRAP_TEMPLATE_FACTS: BootstrapTemplateFacts = {
  templateVersion: "compact-dispatch-bootstrap-v1",
  contentFingerprint: "sha256:abc",
};

const AGENT_CONTROLLER_CONVERSATION: AgentControllerConversationRef = {
  agentControllerRef: "builtin:codex",
  agentControllerConversationKind: "thread",
  agentControllerConversationId: "ctx-1",
};

const OPENCLAW_SESSION_KEY: AgentControllerConversationRef = {
  agentControllerRef: "builtin:openclaw",
  agentControllerConversationKind: "session",
  agentControllerConversationId:
    "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345",
};

const OPENCLAW_PREPARATION_DETAILS = {
  bootstrap: {
    agentId: "openmeld-openclaw-phase-one",
    authStatus: "copied" as const,
    bootstrapVersion: 1,
    created: false,
    resolution: "reused" as const,
  },
  kind: "openclaw" as const,
  openClawGatewayVisibility: {
    agentId: "openmeld-openclaw-phase-one",
    gatewayRestartAttempted: false,
    gatewayVisibility: "visible" as const,
  },
};

const BASE_RUNTIME_CONTEXT = {
  providerRuntimeWorkingDirectory: "/tmp/repo-a",
} as const;

const buildExecutionState = (
  overrides?: Partial<ConversationExecutionState>
): ConversationExecutionState => ({
  agentContextLookupKey:
    "space-1|agent-1|builtin:codex|local-cli|sha256%3Aworkspace-a",
  activeContextId: "ctx-1",
  bootstrapLastAppliedAt: "2026-03-09T12:00:00.000Z",
  bootstrapLastActivatedAt: "2026-03-09T12:00:00.000Z",
  dispatchesSinceBootstrapApplied: 0,
  lastAppliedTemplateVersion: BOOTSTRAP_TEMPLATE_FACTS.templateVersion,
  lastAppliedContentFingerprint: BOOTSTRAP_TEMPLATE_FACTS.contentFingerprint,
  lastRuntimeWorkspacePath:
    BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory,
  runtimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
    BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory
  ),
  updatedAt: "2026-03-09T12:00:00.000Z",
  ...overrides,
});

describe("dispatch bootstrap execution state", () => {
  it("marks an unbound dispatch as not bound and prepares a first local runtime context", () => {
    const input = {
      agentControllerConversationId: null,
      agentControllerRef: "builtin:codex",
      currentPolicy: {},
      existingContextId: null,
      executionState: null,
      latestKnownRuntimeWorkspaceFingerprint: null,
      runtimeContext: BASE_RUNTIME_CONTEXT,
      transportMode: "local-cli" as const,
    };

    expect(resolveAgentControllerConversationResumePlan(input)).toEqual({
      status: "not_bound",
    });
    expect(resolveLocalRuntimeContextPlan(input)).toEqual({
      reason: "first_local_runtime_context",
      status: "recreate",
    });
  });

  it("continues the agent controller conversation when the profile has a conversation id", () => {
    const input = {
      agentControllerConversationId: "ctx-1",
      agentControllerRef: "builtin:codex",
      currentPolicy: {},
      existingContextId: "ctx-1",
      executionState: buildExecutionState(),
      latestKnownRuntimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
        BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory
      ),
      runtimeContext: BASE_RUNTIME_CONTEXT,
      transportMode: "local-cli" as const,
    };

    expect(resolveAgentControllerConversationResumePlan(input)).toEqual({
      status: "continue_existing",
    });
    expect(resolveLocalRuntimeContextPlan(input)).toEqual({
      reason: null,
      status: "reuse",
    });
  });

  it("continues the agent controller conversation from the local ledger before the binding catches up", () => {
    const input = {
      agentControllerConversationId: null,
      agentControllerRef: "builtin:codex",
      currentPolicy: {},
      existingContextId: "ctx-local-ledger-1",
      executionState: buildExecutionState({
        activeContextId: "ctx-local-ledger-1",
      }),
      latestKnownRuntimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
        BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory
      ),
      runtimeContext: BASE_RUNTIME_CONTEXT,
      transportMode: "local-cli" as const,
    };

    expect(resolveAgentControllerConversationResumePlan(input)).toEqual({
      status: "continue_existing",
    });
    expect(resolveLocalRuntimeContextPlan(input)).toEqual({
      reason: null,
      status: "reuse",
    });
  });

  it("uses the binding conversation before falling back to the local ledger context", () => {
    expect(
      resolveEffectiveAgentControllerConversationId({
        agentControllerConversationId: "ctx-binding-1",
        existingContextId: "ctx-local-ledger-1",
      })
    ).toBe("ctx-binding-1");
    expect(
      resolveEffectiveAgentControllerConversationId({
        agentControllerConversationId: null,
        existingContextId: "ctx-local-ledger-1",
      })
    ).toBe("ctx-local-ledger-1");
    expect(
      resolveEffectiveAgentControllerConversationId({
        agentControllerConversationId: null,
        existingContextId: null,
      })
    ).toBeNull();
  });

  it("recreates the local runtime context when a same-workspace agent context exists without execution state", () => {
    expect(
      resolveLocalRuntimeContextPlan({
        agentControllerConversationId: "ctx-1",
        agentControllerRef: "builtin:codex",
        currentPolicy: {},
        existingContextId: "ctx-1",
        executionState: null,
        latestKnownRuntimeWorkspaceFingerprint:
          buildRuntimeWorkspaceFingerprint(
            BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory
          ),
        runtimeContext: BASE_RUNTIME_CONTEXT,
        transportMode: "local-cli",
      })
    ).toEqual({
      reason: "execution_state_missing",
      status: "recreate",
    });
  });

  it("continues the agent controller conversation while recreating the local runtime context in a new workspace", () => {
    const input = {
      agentControllerConversationId: "ctx-1",
      agentControllerRef: "builtin:codex",
      currentPolicy: {},
      existingContextId: null,
      executionState: null,
      latestKnownRuntimeWorkspaceFingerprint:
        buildRuntimeWorkspaceFingerprint("/tmp/repo-a"),
      runtimeContext: {
        providerRuntimeWorkingDirectory: "/tmp/repo-b",
      },
      transportMode: "local-cli" as const,
    };

    expect(resolveAgentControllerConversationResumePlan(input)).toEqual({
      status: "continue_existing",
    });
    expect(resolveLocalRuntimeContextPlan(input)).toEqual({
      reason: "workspace_changed",
      status: "recreate",
    });
  });

  it("keeps canonical OpenClaw bindings on the same Agent Controller conversation even when the local runtime context must be recreated", () => {
    const result = resolveProviderRuntimeDispatchContinuation({
      agentControllerConversationId:
        OPENCLAW_SESSION_KEY.agentControllerConversationId,
      agentControllerRef: "builtin:openclaw",
      currentPolicy: {},
      existingContextId: null,
      executionState: null,
      latestKnownRuntimeWorkspaceFingerprint: null,
      runtimeContext: BASE_RUNTIME_CONTEXT,
      runtimePreparationDetails: OPENCLAW_PREPARATION_DETAILS,
      spaceId: "abc12345deadbeef",
      spaceNameSnapshot: "Ops Room",
      transportMode: "local-cli",
    });

    expect(result.agentControllerConversationResumePlan).toEqual({
      status: "continue_existing",
    });
    expect(result.localRuntimeContextPlan).toEqual({
      reason: "first_local_runtime_context",
      status: "recreate",
    });
    expect(result.agentControllerConversationOverride).toEqual(
      OPENCLAW_SESSION_KEY
    );
  });

  it("rotates legacy OpenClaw session-id bindings into a fresh canonical session key", () => {
    const result = resolveProviderRuntimeDispatchContinuation({
      agentControllerConversationId: "session-legacy-openclaw-1",
      agentControllerRef: "builtin:openclaw",
      currentPolicy: {},
      existingContextId: "session-legacy-openclaw-1",
      executionState: buildExecutionState({
        activeContextId: "session-legacy-openclaw-1",
      }),
      latestKnownRuntimeWorkspaceFingerprint: buildRuntimeWorkspaceFingerprint(
        BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory
      ),
      runtimeContext: BASE_RUNTIME_CONTEXT,
      runtimePreparationDetails: OPENCLAW_PREPARATION_DETAILS,
      spaceId: "abc12345deadbeef",
      spaceNameSnapshot: "Ops Room",
      transportMode: "local-cli",
    });

    expect(result.agentControllerConversationResumePlan).toEqual({
      status: "continue_existing",
    });
    expect(result.localRuntimeContextPlan).toEqual({
      reason: null,
      status: "reuse",
    });
    expect(result.agentControllerConversationOverride).toEqual({
      agentControllerRef: "builtin:openclaw",
      agentControllerConversationKind: "session",
      agentControllerConversationId:
        "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345",
    });
  });

  it("injects when no execution state exists yet", () => {
    expect(
      resolveBootstrapPlan({
        bootstrapTemplateFacts: BOOTSTRAP_TEMPLATE_FACTS,
        localRuntimeContextPlan: {
          reason: null,
          status: "reuse",
        },
        executionState: null,
        nowMs: Date.parse("2026-03-09T12:00:00.000Z"),
      })
    ).toEqual({
      reason: "missing_bootstrap_state",
      shouldInject: true,
    });
  });

  it("does not trust canonical-looking OpenClaw bindings owned by another agent", () => {
    const result = resolveProviderRuntimeDispatchContinuation({
      agentControllerConversationId:
        "agent:openmeld-other-agent:openmeld-space:ops-room--abc12345",
      agentControllerRef: "builtin:openclaw",
      currentPolicy: {},
      existingContextId: null,
      executionState: null,
      latestKnownRuntimeWorkspaceFingerprint: null,
      runtimeContext: BASE_RUNTIME_CONTEXT,
      runtimePreparationDetails: OPENCLAW_PREPARATION_DETAILS,
      spaceId: "abc12345deadbeef",
      spaceNameSnapshot: "Ops Room",
      transportMode: "local-cli",
    });

    expect(result.agentControllerConversationResumePlan).toEqual({
      status: "continue_existing",
    });
    expect(result.localRuntimeContextPlan).toEqual({
      reason: "first_local_runtime_context",
      status: "recreate",
    });
    expect(result.agentControllerConversationOverride).toEqual({
      agentControllerRef: "builtin:openclaw",
      agentControllerConversationKind: "session",
      agentControllerConversationId:
        "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345",
    });
  });

  it("reuses only canonical-owned OpenClaw bindings when deriving the Agent Controller conversation override", () => {
    expect(
      resolveProviderRuntimeDispatchContinuation({
        agentControllerConversationId:
          OPENCLAW_SESSION_KEY.agentControllerConversationId,
        agentControllerRef: "builtin:openclaw",
        currentPolicy: {},
        existingContextId: "ctx-openclaw",
        executionState: buildExecutionState({
          activeContextId: "ctx-openclaw",
        }),
        latestKnownRuntimeWorkspaceFingerprint:
          buildRuntimeWorkspaceFingerprint(
            BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory
          ),
        runtimeContext: BASE_RUNTIME_CONTEXT,
        runtimePreparationDetails: OPENCLAW_PREPARATION_DETAILS,
        spaceId: "abc12345deadbeef",
        spaceNameSnapshot: "Ops Room",
        transportMode: "local-cli",
      }).agentControllerConversationOverride
    ).toEqual(OPENCLAW_SESSION_KEY);

    expect(
      resolveProviderRuntimeDispatchContinuation({
        agentControllerConversationId:
          "agent:openmeld-other-agent:openmeld-space:ops-room--abc12345",
        agentControllerRef: "builtin:openclaw",
        currentPolicy: {},
        existingContextId: "ctx-openclaw",
        executionState: buildExecutionState({
          activeContextId: "ctx-openclaw",
        }),
        latestKnownRuntimeWorkspaceFingerprint:
          buildRuntimeWorkspaceFingerprint(
            BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory
          ),
        runtimeContext: BASE_RUNTIME_CONTEXT,
        runtimePreparationDetails: OPENCLAW_PREPARATION_DETAILS,
        spaceId: "abc12345deadbeef",
        spaceNameSnapshot: "Ops Room",
        transportMode: "local-cli",
      }).agentControllerConversationOverride
    ).toEqual({
      agentControllerRef: "builtin:openclaw",
      agentControllerConversationKind: "session",
      agentControllerConversationId:
        "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345",
    });
  });

  it("does not re-inject when the dispatch stays on the same active context", () => {
    expect(
      resolveBootstrapPlan({
        bootstrapTemplateFacts: BOOTSTRAP_TEMPLATE_FACTS,
        localRuntimeContextPlan: {
          reason: null,
          status: "reuse",
        },
        executionState: buildExecutionState(),
        nowMs: Date.parse("2026-03-09T12:10:00.000Z"),
      })
    ).toEqual({
      reason: null,
      shouldInject: false,
    });
  });

  it("does not re-inject solely because the active context changed", () => {
    expect(
      resolveBootstrapPlan({
        bootstrapTemplateFacts: BOOTSTRAP_TEMPLATE_FACTS,
        localRuntimeContextPlan: {
          reason: null,
          status: "reuse",
        },
        executionState: buildExecutionState(),
        nowMs: Date.parse("2026-03-09T12:10:00.000Z"),
      })
    ).toEqual({
      reason: null,
      shouldInject: false,
    });
  });

  it("re-injects when the bootstrap template fingerprint changes", () => {
    expect(
      resolveBootstrapPlan({
        bootstrapTemplateFacts: {
          ...BOOTSTRAP_TEMPLATE_FACTS,
          contentFingerprint: "sha256:def",
        },
        localRuntimeContextPlan: {
          reason: null,
          status: "reuse",
        },
        executionState: buildExecutionState(),
        nowMs: Date.parse("2026-03-09T12:10:00.000Z"),
      })
    ).toEqual({
      reason: "template_changed",
      shouldInject: true,
    });
  });

  it("re-injects the entry brief when the Space guide changes", () => {
    const originalTemplateFacts = buildDispatchBootstrapTemplateFacts({
      dispatchTriggerSource: "activation_targets",
      spaceGuide: "Prefer reversible decisions.",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });
    const updatedTemplateFacts = buildDispatchBootstrapTemplateFacts({
      dispatchTriggerSource: "activation_targets",
      spaceGuide: "Escalate security blockers immediately.",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });

    expect(
      resolveBootstrapPlan({
        bootstrapTemplateFacts: updatedTemplateFacts,
        localRuntimeContextPlan: {
          reason: null,
          status: "reuse",
        },
        executionState: buildExecutionState({
          lastAppliedTemplateVersion: originalTemplateFacts.templateVersion,
          lastAppliedContentFingerprint:
            originalTemplateFacts.contentFingerprint,
        }),
        nowMs: Date.parse("2026-03-09T12:10:00.000Z"),
      })
    ).toEqual({
      reason: "template_changed",
      shouldInject: true,
    });
  });

  it("re-injects after the bootstrap goes idle for 24 hours", () => {
    expect(
      resolveBootstrapPlan({
        bootstrapTemplateFacts: BOOTSTRAP_TEMPLATE_FACTS,
        localRuntimeContextPlan: {
          reason: null,
          status: "reuse",
        },
        executionState: buildExecutionState({
          bootstrapLastActivatedAt: "2026-03-08T11:59:59.000Z",
        }),
        nowMs: Date.parse("2026-03-09T12:00:00.000Z"),
      })
    ).toEqual({
      reason: "idle_stale",
      shouldInject: true,
    });
  });

  it("re-injects after 8 dispatches since the last bootstrap", () => {
    expect(
      resolveBootstrapPlan({
        bootstrapTemplateFacts: BOOTSTRAP_TEMPLATE_FACTS,
        localRuntimeContextPlan: {
          reason: null,
          status: "reuse",
        },
        executionState: buildExecutionState({
          dispatchesSinceBootstrapApplied: 8,
        }),
        nowMs: Date.parse("2026-03-09T12:10:00.000Z"),
      })
    ).toEqual({
      reason: "dispatch_count_stale",
      shouldInject: true,
    });
  });

  it("marks bootstrap against the current context before dispatch and reconciles to the created context after dispatch", () => {
    const markedState = markBootstrapInjectedContext({
      executionState: null,
      agentContextLookupKey: "space-1|agent-1|builtin:codex|local-cli",
      bootstrapTemplateFacts: BOOTSTRAP_TEMPLATE_FACTS,
      existingContextId: null,
      effectiveRuntimeWorkingDirectory:
        BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory,
      nowIso: "2026-03-09T12:00:00.000Z",
    });

    expect(markedState).toMatchObject({
      activeContextId: null,
      dispatchesSinceBootstrapApplied: 0,
      lastAppliedTemplateVersion: "compact-dispatch-bootstrap-v1",
    });

    const reconciledState = reconcileBootstrapInjectedContextAfterDispatch({
      executionState: markedState,
      shouldInjectBootstrap: true,
      bootstrapTemplateFacts: BOOTSTRAP_TEMPLATE_FACTS,
      continuityObservation: null,
      contextHealed: false,
      dispatchedContextId: "ctx-1",
      effectiveRuntimeWorkingDirectory:
        BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory,
      nowIso: "2026-03-09T12:01:00.000Z",
      resolvedAgentControllerConversation: AGENT_CONTROLLER_CONVERSATION,
    });

    expect(reconciledState).toMatchObject({
      activeContextId: "ctx-1",
      dispatchesSinceBootstrapApplied: 0,
      lastResolvedAgentControllerConversation: AGENT_CONTROLLER_CONVERSATION,
    });
  });

  it("rolls back a prewritten bootstrap state after runtime failure so the next retry reinjects", () => {
    const agentContextLookupKey = "space-1|agent-1|builtin:codex|local-cli";
    const markedState = markBootstrapInjectedContext({
      executionState: null,
      agentContextLookupKey,
      bootstrapTemplateFacts: BOOTSTRAP_TEMPLATE_FACTS,
      existingContextId: null,
      effectiveRuntimeWorkingDirectory:
        BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory,
      nowIso: "2026-03-09T12:00:00.000Z",
    });
    const prewrittenLedgerState = upsertConversationExecutionState({
      state: createEmptyLedgerState(),
      executionState: markedState,
    });

    const rolledBackLedgerState =
      rollbackBootstrapExecutionStateAfterDispatchFailure({
        agentContextLookupKey,
        executionStateBeforeDispatch: null,
        state: prewrittenLedgerState,
      });

    expect(
      resolveConversationExecutionStateByLookupKey({
        agentContextLookupKey,
        state: rolledBackLedgerState,
      })
    ).toBeUndefined();
    expect(
      resolveBootstrapPlan({
        bootstrapTemplateFacts: BOOTSTRAP_TEMPLATE_FACTS,
        localRuntimeContextPlan: {
          reason: null,
          status: "reuse",
        },
        executionState: null,
        nowMs: Date.parse("2026-03-09T12:05:00.000Z"),
      })
    ).toEqual({
      reason: "missing_bootstrap_state",
      shouldInject: true,
    });
  });

  it("restores a legacy execution state and removes the canonical prewrite after runtime failure", () => {
    const legacyExecutionState = buildExecutionState({
      agentContextLookupKey: "space-1|agent-1|codex|local-cli",
    });
    const prewrittenLedgerState = upsertConversationExecutionState({
      state: createEmptyLedgerState(),
      executionState: markBootstrapInjectedContext({
        executionState: legacyExecutionState,
        agentContextLookupKey: "space-1|agent-1|builtin:codex|local-cli",
        bootstrapTemplateFacts: BOOTSTRAP_TEMPLATE_FACTS,
        existingContextId: "ctx-1",
        effectiveRuntimeWorkingDirectory:
          BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory,
        nowIso: "2026-03-09T12:00:00.000Z",
      }),
    });

    const rolledBackLedgerState =
      rollbackBootstrapExecutionStateAfterDispatchFailure({
        agentContextLookupKey: "space-1|agent-1|builtin:codex|local-cli",
        executionStateBeforeDispatch: legacyExecutionState,
        state: prewrittenLedgerState,
      });

    expect(
      resolveConversationExecutionStateByLookupKey({
        agentContextLookupKey: "space-1|agent-1|builtin:codex|local-cli",
        state: rolledBackLedgerState,
      })
    ).toBeUndefined();
    expect(
      resolveConversationExecutionStateByLookupKey({
        agentContextLookupKey: "space-1|agent-1|codex|local-cli",
        state: rolledBackLedgerState,
      })
    ).toEqual(legacyExecutionState);
  });

  it("keeps bootstrap state when a non-bootstrapped dispatch rotates unexpectedly", () => {
    const reconciledState = reconcileBootstrapInjectedContextAfterDispatch({
      executionState: buildExecutionState(),
      shouldInjectBootstrap: false,
      bootstrapTemplateFacts: BOOTSTRAP_TEMPLATE_FACTS,
      continuityObservation: resolveDispatchContinuityObservation({
        contextHealed: false,
        existingContextId: "ctx-1",
        resolvedContextId: "ctx-2",
      }),
      contextHealed: false,
      dispatchedContextId: "ctx-2",
      effectiveRuntimeWorkingDirectory:
        BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory,
      nowIso: "2026-03-09T12:01:00.000Z",
      resolvedAgentControllerConversation: {
        ...AGENT_CONTROLLER_CONVERSATION,
        agentControllerConversationId: "ctx-2",
      },
    });

    expect(reconciledState).toMatchObject({
      activeContextId: "ctx-2",
      dispatchesSinceBootstrapApplied: 1,
      pendingBootstrapReason: undefined,
      bootstrapLastAppliedAt: "2026-03-09T12:00:00.000Z",
      lastAppliedTemplateVersion: BOOTSTRAP_TEMPLATE_FACTS.templateVersion,
      lastAppliedContentFingerprint:
        BOOTSTRAP_TEMPLATE_FACTS.contentFingerprint,
      lastResolvedAgentControllerConversation: {
        agentControllerRef: "builtin:codex",
        agentControllerConversationKind: "thread",
        agentControllerConversationId: "ctx-2",
      },
    });
  });

  it("refreshes lastActivatedAt on a stable dispatch so active conversations do not look idle", () => {
    const reconciledState = reconcileBootstrapInjectedContextAfterDispatch({
      executionState: buildExecutionState({
        bootstrapLastActivatedAt: "2026-03-09T12:00:00.000Z",
      }),
      shouldInjectBootstrap: false,
      bootstrapTemplateFacts: BOOTSTRAP_TEMPLATE_FACTS,
      continuityObservation: resolveDispatchContinuityObservation({
        contextHealed: false,
        existingContextId: "ctx-1",
        resolvedContextId: "ctx-1",
      }),
      contextHealed: false,
      dispatchedContextId: "ctx-1",
      effectiveRuntimeWorkingDirectory:
        BASE_RUNTIME_CONTEXT.providerRuntimeWorkingDirectory,
      nowIso: "2026-03-10T11:59:59.000Z",
      resolvedAgentControllerConversation: AGENT_CONTROLLER_CONVERSATION,
    });

    expect(reconciledState?.bootstrapLastActivatedAt).toBe(
      "2026-03-10T11:59:59.000Z"
    );
    expect(
      resolveBootstrapPlan({
        bootstrapTemplateFacts: BOOTSTRAP_TEMPLATE_FACTS,
        localRuntimeContextPlan: {
          reason: null,
          status: "reuse",
        },
        executionState: reconciledState,
        nowMs: Date.parse("2026-03-10T12:00:00.000Z"),
      })
    ).toEqual({
      reason: null,
      shouldInject: false,
    });
  });

  it("classifies a new context with no previous context as fresh", () => {
    expect(
      resolveDispatchContinuityObservation({
        contextHealed: false,
        existingContextId: null,
        resolvedContextId: "ctx-1",
      })
    ).toEqual({
      existingContextId: null,
      resolvedContextId: "ctx-1",
      shouldWarn: false,
      status: "fresh_context",
    });
  });

  it("classifies the same context id as a stable resume", () => {
    expect(
      resolveDispatchContinuityObservation({
        contextHealed: false,
        existingContextId: "ctx-1",
        resolvedContextId: "ctx-1",
      })
    ).toEqual({
      existingContextId: "ctx-1",
      resolvedContextId: "ctx-1",
      shouldWarn: false,
      status: "stable_resume",
    });
  });

  it("classifies a healed context rotation as explicit heal", () => {
    expect(
      resolveDispatchContinuityObservation({
        contextHealed: true,
        existingContextId: "ctx-1",
        resolvedContextId: "ctx-2",
      })
    ).toEqual({
      existingContextId: "ctx-1",
      resolvedContextId: "ctx-2",
      shouldWarn: false,
      status: "explicit_heal",
    });
  });

  it("classifies an unexpected context rotation as implicit rotation and requests a warning", () => {
    expect(
      resolveDispatchContinuityObservation({
        contextHealed: false,
        existingContextId: "ctx-1",
        resolvedContextId: "ctx-2",
      })
    ).toEqual({
      existingContextId: "ctx-1",
      resolvedContextId: "ctx-2",
      shouldWarn: true,
      status: "implicit_rotation",
    });
  });
});
