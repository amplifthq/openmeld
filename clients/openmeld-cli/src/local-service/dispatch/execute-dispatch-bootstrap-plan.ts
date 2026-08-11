import {
  buildRuntimeWorkspaceFingerprint,
  removeConversationExecutionState,
  upsertConversationExecutionState,
} from "@openmeld/local-execution";
import type { DispatchContinuityObservation } from "@openmeld/local-service";
import type {
  AgentControllerConversationRef,
  BootstrapTemplateFacts,
  ConversationExecutionState,
  LocalRuntimeContextPlan,
} from "@openmeld/schemas/types";
import { normalizeOptionalContextId } from "./execute-dispatch-conversation";
import type { BootstrapPlan } from "./execute-dispatch-types";

const BOOTSTRAP_IDLE_STALE_MS = 24 * 60 * 60 * 1000;
const BOOTSTRAP_DISPATCH_STALE_THRESHOLD = 8;

const isBootstrapExecutionStateMissing = (
  executionState: ConversationExecutionState
): boolean =>
  !(
    executionState.bootstrapLastAppliedAt &&
    executionState.lastAppliedTemplateVersion &&
    executionState.lastAppliedContentFingerprint
  );

const isBootstrapIdleStale = (
  lastActivatedAt: string | undefined,
  nowMs: number
): boolean => {
  if (!lastActivatedAt) {
    return false;
  }
  const lastActivatedMs = Date.parse(lastActivatedAt);
  if (!Number.isFinite(lastActivatedMs)) {
    return false;
  }
  return nowMs - lastActivatedMs >= BOOTSTRAP_IDLE_STALE_MS;
};

export function resolveBootstrapPlan(input: {
  bootstrapTemplateFacts: BootstrapTemplateFacts;
  executionState: ConversationExecutionState | null;
  localRuntimeContextPlan: LocalRuntimeContextPlan;
  nowMs: number;
}): BootstrapPlan {
  if (input.localRuntimeContextPlan.status === "recreate") {
    return {
      reason: "compatibility_recreate",
      shouldInject: true,
    };
  }
  if (!input.executionState) {
    return {
      reason: "missing_bootstrap_state",
      shouldInject: true,
    };
  }
  if (input.executionState.pendingBootstrapReason === "context_healed") {
    return {
      reason: "context_healed",
      shouldInject: true,
    };
  }
  if (isBootstrapExecutionStateMissing(input.executionState)) {
    return {
      reason: "missing_bootstrap_state",
      shouldInject: true,
    };
  }
  if (
    input.executionState.lastAppliedTemplateVersion !==
      input.bootstrapTemplateFacts.templateVersion ||
    input.executionState.lastAppliedContentFingerprint !==
      input.bootstrapTemplateFacts.contentFingerprint
  ) {
    return {
      reason: "template_changed",
      shouldInject: true,
    };
  }
  if (
    isBootstrapIdleStale(
      input.executionState.bootstrapLastActivatedAt,
      input.nowMs
    )
  ) {
    return {
      reason: "idle_stale",
      shouldInject: true,
    };
  }
  if (
    input.executionState.dispatchesSinceBootstrapApplied >=
    BOOTSTRAP_DISPATCH_STALE_THRESHOLD
  ) {
    return {
      reason: "dispatch_count_stale",
      shouldInject: true,
    };
  }
  return {
    reason: null,
    shouldInject: false,
  };
}

export function markBootstrapInjectedContext(input: {
  executionState: ConversationExecutionState | null;
  agentContextLookupKey: string;
  bootstrapTemplateFacts: BootstrapTemplateFacts;
  existingContextId: string | null;
  effectiveRuntimeWorkingDirectory: string;
  nowIso: string;
}): ConversationExecutionState {
  const runtimeWorkspaceFingerprint = buildRuntimeWorkspaceFingerprint(
    input.effectiveRuntimeWorkingDirectory
  );
  return {
    agentContextLookupKey: input.agentContextLookupKey,
    activeContextId: normalizeOptionalContextId(input.existingContextId),
    dispatchesSinceBootstrapApplied: 0,
    bootstrapLastAppliedAt: input.nowIso,
    bootstrapLastActivatedAt: input.nowIso,
    lastAppliedTemplateVersion: input.bootstrapTemplateFacts.templateVersion,
    lastAppliedContentFingerprint:
      input.bootstrapTemplateFacts.contentFingerprint,
    lastRuntimeWorkspacePath: input.effectiveRuntimeWorkingDirectory,
    runtimeWorkspaceFingerprint,
    pendingBootstrapReason: undefined,
    updatedAt: input.nowIso,
    ...(input.executionState?.lastResolvedAgentControllerConversation
      ? {
          lastResolvedAgentControllerConversation: {
            ...input.executionState.lastResolvedAgentControllerConversation,
          },
        }
      : {}),
  };
}

export function reconcileBootstrapInjectedContextAfterDispatch(input: {
  executionState: ConversationExecutionState | null;
  shouldInjectBootstrap: boolean;
  bootstrapTemplateFacts: BootstrapTemplateFacts;
  continuityObservation: DispatchContinuityObservation | null;
  contextHealed: boolean;
  dispatchedContextId: string | null;
  effectiveRuntimeWorkingDirectory: string;
  nowIso: string;
  resolvedAgentControllerConversation: AgentControllerConversationRef | null;
}): ConversationExecutionState | null {
  if (!input.executionState) {
    return null;
  }

  const runtimeWorkspaceFingerprint = buildRuntimeWorkspaceFingerprint(
    input.effectiveRuntimeWorkingDirectory
  );
  const nextExecutionState: ConversationExecutionState = {
    ...input.executionState,
    bootstrapLastActivatedAt: input.nowIso,
    lastRuntimeWorkspacePath: input.effectiveRuntimeWorkingDirectory,
    runtimeWorkspaceFingerprint,
    updatedAt: input.nowIso,
    ...(input.resolvedAgentControllerConversation
      ? {
          lastResolvedAgentControllerConversation: {
            ...input.resolvedAgentControllerConversation,
          },
        }
      : {}),
  };

  if (input.shouldInjectBootstrap) {
    const dispatchedContextId = normalizeOptionalContextId(
      input.dispatchedContextId
    );
    return {
      ...nextExecutionState,
      activeContextId:
        dispatchedContextId ?? nextExecutionState.activeContextId,
      dispatchesSinceBootstrapApplied: 0,
      bootstrapLastAppliedAt:
        nextExecutionState.bootstrapLastAppliedAt ?? input.nowIso,
      bootstrapLastActivatedAt: input.nowIso,
      lastAppliedTemplateVersion: input.bootstrapTemplateFacts.templateVersion,
      lastAppliedContentFingerprint:
        input.bootstrapTemplateFacts.contentFingerprint,
      pendingBootstrapReason: undefined,
    };
  }

  if (input.contextHealed) {
    return {
      ...nextExecutionState,
      activeContextId:
        normalizeOptionalContextId(input.dispatchedContextId) ??
        nextExecutionState.activeContextId,
      dispatchesSinceBootstrapApplied: 0,
      bootstrapLastAppliedAt: undefined,
      lastAppliedTemplateVersion: undefined,
      lastAppliedContentFingerprint: undefined,
      pendingBootstrapReason: "context_healed",
    };
  }

  if (input.continuityObservation?.status === "implicit_rotation") {
    return {
      ...nextExecutionState,
      activeContextId:
        normalizeOptionalContextId(input.dispatchedContextId) ??
        nextExecutionState.activeContextId,
      dispatchesSinceBootstrapApplied:
        nextExecutionState.dispatchesSinceBootstrapApplied + 1,
      pendingBootstrapReason: undefined,
    };
  }

  return {
    ...nextExecutionState,
    dispatchesSinceBootstrapApplied:
      nextExecutionState.dispatchesSinceBootstrapApplied + 1,
    pendingBootstrapReason: undefined,
  };
}

export function rollbackBootstrapExecutionStateAfterDispatchFailure(input: {
  agentContextLookupKey: string;
  executionStateBeforeDispatch: ConversationExecutionState | null;
  state: Parameters<typeof upsertConversationExecutionState>[0]["state"];
}) {
  const stateWithoutCurrentLookupKey = removeConversationExecutionState({
    agentContextLookupKey: input.agentContextLookupKey,
    state: input.state,
  });
  if (input.executionStateBeforeDispatch) {
    return upsertConversationExecutionState({
      state: stateWithoutCurrentLookupKey,
      executionState: input.executionStateBeforeDispatch,
    });
  }
  return stateWithoutCurrentLookupKey;
}
