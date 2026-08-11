import type { AdapterTransportMode } from "@openmeld/adapter-core";
import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  parseAgentControllerRef,
} from "@openmeld/schemas";
import type {
  OpenMeldDaemonAgentContextLifecycleCounters,
  OpenMeldDaemonAgentContextRotationRecord,
  OpenMeldDaemonAgentContextState,
  OpenMeldDaemonLedgerStateV1,
} from "./ledger-store.js";

const AGENT_CONTEXT_LOOKUP_KEY_SEPARATOR = "|";
const LEDGER_AGENT_CONTEXT_SOURCE_FIELD = "openMeldDaemon.agent_context_ledger";

export type AgentContextLookupKeyInput = {
  spaceId: string;
  targetProfileId: string;
  agentControllerRef: string;
  transportMode: AdapterTransportMode;
  runtimeWorkspaceFingerprint: string;
};

export type AgentContextScopeInput = Omit<
  AgentContextLookupKeyInput,
  "runtimeWorkspaceFingerprint"
>;

export type AgentContextLifecycleReason =
  | "created_missing_context"
  | "recreated_incompatible_context"
  | "reused_existing_context"
  | "guard_reused_existing_context"
  | "profile_conversation_conflict"
  | "missing_context_unresolved";

export type AgentContextResolutionResult = {
  resolvedAgentControllerConversationId: string | null;
  agentContext?: OpenMeldDaemonAgentContextState;
  rotationRecord?: OpenMeldDaemonAgentContextRotationRecord;
  agentContextLookupKey: string;
  replacedAgentContextLookupKey?: string;
  sourceFieldOverride?: string;
  lifecycleReason: AgentContextLifecycleReason;
  counterDelta: Partial<OpenMeldDaemonAgentContextLifecycleCounters>;
};

const encodeLookupKeyPart = (value: string): string =>
  encodeURIComponent(value);

type AgentControllerRefInput = {
  agentControllerRef: string;
};

type LocalAgentControllerRef = {
  id: string;
  kind: "builtin" | "custom";
  ref: string;
};

const resolveCanonicalAgentControllerRef = (
  input: AgentControllerRefInput
): string => {
  const parsed = parseLocalAgentControllerRef(input);
  return parsed.ref;
};

const resolveAgentControllerRefKind = (
  input: AgentControllerRefInput
): "builtin" | "custom" => {
  return parseLocalAgentControllerRef(input).kind;
};

const parseLocalAgentControllerRef = (
  input: AgentControllerRefInput
): LocalAgentControllerRef => {
  const parsed = parseAgentControllerRef(input.agentControllerRef);
  if (!parsed) {
    throw new Error(
      `runtime.agent_context.invalid_agent_controller_ref: ${input.agentControllerRef}`
    );
  }
  const kind = parsed.kind;
  if (kind === HOSTED_CENTER_AGENT_CONTROLLER_REF) {
    throw new Error(
      "runtime.agent_context.hosted_agent_controller_ref_not_local"
    );
  }
  if (kind === "builtin" || kind === "custom") {
    return {
      id: parsed.id,
      kind,
      ref: parsed.ref,
    };
  }
  throw new Error(
    `runtime.agent_context.invalid_agent_controller_ref: ${input.agentControllerRef}`
  );
};

const areAgentControllerRefsEquivalent = (input: {
  leftAgentControllerRef: string;
  rightAgentControllerRef: string;
}): boolean =>
  resolveCanonicalAgentControllerRef({
    agentControllerRef: input.leftAgentControllerRef,
  }) ===
  resolveCanonicalAgentControllerRef({
    agentControllerRef: input.rightAgentControllerRef,
  });

const listCompatibleAgentControllerRefs = (
  input: AgentControllerRefInput
): string[] => [
  resolveCanonicalAgentControllerRef({
    agentControllerRef: input.agentControllerRef,
  }),
];

const buildLookupKey = (input: {
  agentControllerRef: string;
  targetProfileId: string;
  transportMode: AdapterTransportMode;
  runtimeWorkspaceFingerprint: string;
}): string =>
  [
    input.targetProfileId,
    input.agentControllerRef,
    input.transportMode,
    input.runtimeWorkspaceFingerprint,
  ]
    .map(encodeLookupKeyPart)
    .join(AGENT_CONTEXT_LOOKUP_KEY_SEPARATOR);

const buildLegacySpaceScopedLookupKey = (input: {
  agentControllerRef: string;
  spaceId: string;
  targetProfileId: string;
  transportMode: AdapterTransportMode;
  runtimeWorkspaceFingerprint: string;
}): string =>
  [
    input.spaceId,
    input.targetProfileId,
    input.agentControllerRef,
    input.transportMode,
    input.runtimeWorkspaceFingerprint,
  ]
    .map(encodeLookupKeyPart)
    .join(AGENT_CONTEXT_LOOKUP_KEY_SEPARATOR);

export const listCompatibleAgentContextLookupKeys = (
  input: AgentContextLookupKeyInput
): string[] =>
  listCompatibleAgentControllerRefs(input)
    .flatMap((agentControllerRef) => [
      buildLookupKey({
        agentControllerRef,
        targetProfileId: input.targetProfileId,
        transportMode: input.transportMode,
        runtimeWorkspaceFingerprint: input.runtimeWorkspaceFingerprint,
      }),
      buildLegacySpaceScopedLookupKey({
        agentControllerRef,
        spaceId: input.spaceId,
        targetProfileId: input.targetProfileId,
        transportMode: input.transportMode,
        runtimeWorkspaceFingerprint: input.runtimeWorkspaceFingerprint,
      }),
    ])
    .filter((lookupKey, index, values) => values.indexOf(lookupKey) === index);

export const buildAgentContextLookupKey = (
  input: AgentContextLookupKeyInput
): string =>
  buildLookupKey({
    agentControllerRef: resolveCanonicalAgentControllerRef(input),
    targetProfileId: input.targetProfileId,
    transportMode: input.transportMode,
    runtimeWorkspaceFingerprint: input.runtimeWorkspaceFingerprint,
  });

const normalizeContextId = (
  value: string | null | undefined
): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

type IncompatibleAgentContextResolution = {
  previousAgentContext: OpenMeldDaemonAgentContextState;
  rotationReason: "controller_ref_changed" | "transport_mode_changed";
  rotationTriggerErrorCode:
    | "context.controller_ref_changed"
    | "context.transport_mode_changed";
};

export const isAgentContextCompatibleWithLookupKeyInput = (input: {
  agentContext: OpenMeldDaemonAgentContextState;
  key: AgentContextLookupKeyInput;
}): boolean =>
  isAgentContextCompatibleWithScopeInput({
    agentContext: input.agentContext,
    scope: input.key,
  }) &&
  input.agentContext.runtimeWorkspaceFingerprint ===
    input.key.runtimeWorkspaceFingerprint;

const isAgentContextStoredUnderCompatibleLookupKeyInput = (input: {
  agentContext: OpenMeldDaemonAgentContextState;
  key: AgentContextLookupKeyInput;
}): boolean =>
  listCompatibleAgentContextLookupKeys({
    ...input.key,
    spaceId: input.agentContext.spaceId,
  }).includes(input.agentContext.agentContextLookupKey);

export const isAgentContextCompatibleWithScopeInput = (input: {
  agentContext: OpenMeldDaemonAgentContextState;
  scope: AgentContextScopeInput;
}): boolean =>
  input.agentContext.targetProfileId === input.scope.targetProfileId &&
  input.agentContext.transportMode === input.scope.transportMode &&
  areAgentControllerRefsEquivalent({
    leftAgentControllerRef: input.agentContext.agentControllerRef,
    rightAgentControllerRef: input.scope.agentControllerRef,
  });

export const resolveAgentContextConversationProfileConflict = (input: {
  agentControllerConversationId: string | null | undefined;
  key: AgentContextLookupKeyInput;
  state: OpenMeldDaemonLedgerStateV1;
}): OpenMeldDaemonAgentContextState | null => {
  const agentControllerConversationId = normalizeContextId(
    input.agentControllerConversationId
  );
  if (!agentControllerConversationId) {
    return null;
  }

  const conflictingAgentContexts = Object.values(
    input.state.agentContextByLookupKey
  )
    .filter(
      (agentContext) =>
        agentContext.agentControllerConversationId ===
          agentControllerConversationId &&
        agentContext.targetProfileId !== input.key.targetProfileId &&
        agentContext.transportMode === input.key.transportMode &&
        areAgentControllerRefsEquivalent({
          leftAgentControllerRef: agentContext.agentControllerRef,
          rightAgentControllerRef: input.key.agentControllerRef,
        })
    )
    .sort((left, right) => {
      if (left.updatedAtMs !== right.updatedAtMs) {
        return right.updatedAtMs - left.updatedAtMs;
      }
      if (left.createdAtMs !== right.createdAtMs) {
        return right.createdAtMs - left.createdAtMs;
      }
      return right.agentContextLookupKey.localeCompare(
        left.agentContextLookupKey
      );
    });

  return conflictingAgentContexts[0] ?? null;
};

const resolveExistingAgentContext = (input: {
  key: AgentContextLookupKeyInput;
  state: OpenMeldDaemonLedgerStateV1;
}): OpenMeldDaemonAgentContextState | null => {
  for (const lookupKey of listCompatibleAgentContextLookupKeys(input.key)) {
    const agentContext = input.state.agentContextByLookupKey[lookupKey];
    if (
      agentContext &&
      isAgentContextCompatibleWithLookupKeyInput({
        agentContext,
        key: input.key,
      })
    ) {
      return agentContext;
    }
  }
  const compatibleContexts = Object.values(input.state.agentContextByLookupKey)
    .filter(
      (agentContext) =>
        isAgentContextCompatibleWithLookupKeyInput({
          agentContext,
          key: input.key,
        }) &&
        isAgentContextStoredUnderCompatibleLookupKeyInput({
          agentContext,
          key: input.key,
        })
    )
    .sort((left, right) => {
      if (left.updatedAtMs !== right.updatedAtMs) {
        return right.updatedAtMs - left.updatedAtMs;
      }
      if (left.createdAtMs !== right.createdAtMs) {
        return right.createdAtMs - left.createdAtMs;
      }
      return right.agentContextLookupKey.localeCompare(
        left.agentContextLookupKey
      );
    });
  return compatibleContexts[0] ?? null;
};

const resolveNextAgentContextLookupKey = (input: {
  existing: OpenMeldDaemonAgentContextState;
  key: AgentContextLookupKeyInput;
}): string =>
  resolveAgentControllerRefKind({
    agentControllerRef: input.existing.agentControllerRef,
  }) === "builtin"
    ? buildAgentContextLookupKey(input.key)
    : input.existing.agentContextLookupKey;

const resolveIncompatibleAgentContext = (input: {
  key: AgentContextLookupKeyInput;
  state: OpenMeldDaemonLedgerStateV1;
}): IncompatibleAgentContextResolution | null => {
  const candidates = Object.values(input.state.agentContextByLookupKey).filter(
    (agentContext) =>
      agentContext.targetProfileId === input.key.targetProfileId &&
      agentContext.runtimeWorkspaceFingerprint ===
        input.key.runtimeWorkspaceFingerprint
  );
  candidates.sort((left, right) => {
    if (left.updatedAtMs !== right.updatedAtMs) {
      return right.updatedAtMs - left.updatedAtMs;
    }
    if (left.createdAtMs !== right.createdAtMs) {
      return right.createdAtMs - left.createdAtMs;
    }
    return right.agentContextLookupKey.localeCompare(
      left.agentContextLookupKey
    );
  });

  for (const agentContext of candidates) {
    if (
      !areAgentControllerRefsEquivalent({
        leftAgentControllerRef: agentContext.agentControllerRef,
        rightAgentControllerRef: input.key.agentControllerRef,
      })
    ) {
      return {
        previousAgentContext: agentContext,
        rotationReason: "controller_ref_changed",
        rotationTriggerErrorCode: "context.controller_ref_changed",
      };
    }
    if (agentContext.transportMode !== input.key.transportMode) {
      return {
        previousAgentContext: agentContext,
        rotationReason: "transport_mode_changed",
        rotationTriggerErrorCode: "context.transport_mode_changed",
      };
    }
  }

  return null;
};

const createAgentContextState = (input: {
  agentControllerConversationId: string;
  key: AgentContextLookupKeyInput;
  nowMs: number;
  agentContextLookupKey: string;
  taskId: string;
}): OpenMeldDaemonAgentContextState => ({
  agentControllerConversationId: input.agentControllerConversationId,
  agentControllerRef: resolveCanonicalAgentControllerRef(input.key),
  createdAtMs: input.nowMs,
  lastTaskId: input.taskId,
  agentContextLookupKey: input.agentContextLookupKey,
  spaceId: input.key.spaceId,
  targetProfileId: input.key.targetProfileId,
  transportMode: input.key.transportMode,
  runtimeWorkspaceFingerprint: input.key.runtimeWorkspaceFingerprint,
  updatedAtMs: input.nowMs,
});

export const resolveAgentContextForDispatch = (input: {
  key: AgentContextLookupKeyInput;
  providerContextId: string | null | undefined;
  state: OpenMeldDaemonLedgerStateV1;
  taskId: string;
  nowMs: number;
}): AgentContextResolutionResult => {
  const agentContextLookupKey = buildAgentContextLookupKey(input.key);
  const existing = resolveExistingAgentContext({
    key: input.key,
    state: input.state,
  });
  const providerContextId = normalizeContextId(input.providerContextId);

  if (existing) {
    const nextAgentContext: OpenMeldDaemonAgentContextState = {
      ...existing,
      agentContextLookupKey: resolveNextAgentContextLookupKey({
        existing,
        key: input.key,
      }),
      agentControllerRef: resolveCanonicalAgentControllerRef({
        agentControllerRef: existing.agentControllerRef,
      }),
      lastTaskId: input.taskId,
      runtimeWorkspaceFingerprint: input.key.runtimeWorkspaceFingerprint,
      spaceId: input.key.spaceId,
      updatedAtMs: input.nowMs,
    };
    const replacedAgentContextLookupKey =
      existing.agentContextLookupKey === nextAgentContext.agentContextLookupKey
        ? null
        : existing.agentContextLookupKey;
    if (
      providerContextId &&
      providerContextId !== existing.agentControllerConversationId
    ) {
      return {
        counterDelta: {
          guardBlocked: 1,
          reused: 1,
        },
        lifecycleReason: "guard_reused_existing_context",
        resolvedAgentControllerConversationId:
          existing.agentControllerConversationId,
        agentContext: nextAgentContext,
        agentContextLookupKey: nextAgentContext.agentContextLookupKey,
        ...(replacedAgentContextLookupKey
          ? {
              replacedAgentContextLookupKey,
            }
          : {}),
        sourceFieldOverride: LEDGER_AGENT_CONTEXT_SOURCE_FIELD,
      };
    }

    return {
      counterDelta: {
        reused: 1,
      },
      lifecycleReason: "reused_existing_context",
      resolvedAgentControllerConversationId:
        existing.agentControllerConversationId,
      agentContext: nextAgentContext,
      agentContextLookupKey: nextAgentContext.agentContextLookupKey,
      ...(replacedAgentContextLookupKey
        ? {
            replacedAgentContextLookupKey,
          }
        : {}),
      ...(providerContextId
        ? {}
        : { sourceFieldOverride: LEDGER_AGENT_CONTEXT_SOURCE_FIELD }),
    };
  }

  if (!providerContextId) {
    return {
      counterDelta: {},
      lifecycleReason: "missing_context_unresolved",
      resolvedAgentControllerConversationId: null,
      agentContextLookupKey,
    };
  }

  if (
    resolveAgentContextConversationProfileConflict({
      agentControllerConversationId: providerContextId,
      key: input.key,
      state: input.state,
    })
  ) {
    return {
      counterDelta: {
        guardBlocked: 1,
      },
      lifecycleReason: "profile_conversation_conflict",
      resolvedAgentControllerConversationId: null,
      agentContextLookupKey,
      sourceFieldOverride: LEDGER_AGENT_CONTEXT_SOURCE_FIELD,
    };
  }

  const incompatibleContextResolution = resolveIncompatibleAgentContext({
    key: input.key,
    state: input.state,
  });
  const recreatedIncompatible = incompatibleContextResolution !== null;
  const nextAgentContext = createAgentContextState({
    agentControllerConversationId: providerContextId,
    key: input.key,
    nowMs: input.nowMs,
    agentContextLookupKey,
    taskId: input.taskId,
  });

  return {
    counterDelta: recreatedIncompatible
      ? {
          created: 1,
          recreated: 1,
        }
      : {
          created: 1,
        },
    lifecycleReason: recreatedIncompatible
      ? "recreated_incompatible_context"
      : "created_missing_context",
    resolvedAgentControllerConversationId: providerContextId,
    agentContext: nextAgentContext,
    agentContextLookupKey,
    ...(incompatibleContextResolution
      ? {
          rotationRecord: {
            previousAgentControllerConversationId:
              incompatibleContextResolution.previousAgentContext
                .agentControllerConversationId,
            nextAgentControllerConversationId: providerContextId,
            rotationTriggerErrorCode:
              incompatibleContextResolution.rotationTriggerErrorCode,
            rotationReason: incompatibleContextResolution.rotationReason,
            rotationAt: input.nowMs,
            rotationTaskId: input.taskId,
          },
        }
      : {}),
  };
};
