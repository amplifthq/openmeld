import { buildRuntimeWorkspaceFingerprint } from "@openmeld/local-execution";
import type {
  AgentControllerConversationResumePlan,
  ConversationExecutionState,
  ConversationPolicy,
  LocalRuntimeContextPlan,
  ProviderDispatchRuntimeContext,
  RuntimeTransportMode,
} from "@openmeld/schemas/types";
import {
  listBuiltinAgentsRegistryEntries,
  resolveRegistryRuntimeAdapterContractByAgentControllerRef,
} from "../../agents/registry-source";
import { resolveOpenClawProviderRuntimeContinuation } from "../../provider-hosts/openclaw/continuation";
import type { ProviderRuntimePreparationDetails } from "../../provider-hosts/prepare-provider-runtime";
import type {
  ProviderRuntimeContinuationResult,
  ProviderSpecificRuntimeContinuationPolicy,
} from "./types";

type ConversationCompatibilityRequest = {
  agentControllerConversationId: string | null;
  agentControllerRef: string;
  currentPolicy: ConversationPolicy;
  existingContextId: string | null;
  executionState: ConversationExecutionState | null;
  latestKnownRuntimeWorkspaceFingerprint?: string | null;
  runtimeContext: ProviderDispatchRuntimeContext;
  transportMode: RuntimeTransportMode;
};

type ProviderRuntimeContinuationRequest = ConversationCompatibilityRequest & {
  runtimePreparationDetails: ProviderRuntimePreparationDetails;
  separateConversationScopeId?: string;
  spaceId: string;
  spaceNameSnapshot: string | null;
};

type ProviderSpecificRuntimeContinuationRegistry = Record<
  string,
  ProviderSpecificRuntimeContinuationPolicy
>;

const DEFAULT_PROVIDER_SPECIFIC_CONTINUATION_POLICIES: ProviderSpecificRuntimeContinuationRegistry =
  {
    openclaw: resolveOpenClawProviderRuntimeContinuation,
  };

export function listRegisteredProviderSpecificContinuationAdapterIds(): string[] {
  return Object.keys(DEFAULT_PROVIDER_SPECIFIC_CONTINUATION_POLICIES).sort();
}

export function resolveProviderRuntimeDispatchContinuation(
  input: ProviderRuntimeContinuationRequest,
  options: {
    policies?: ProviderSpecificRuntimeContinuationRegistry;
    resolveAdapterContract?: typeof resolveRegistryRuntimeAdapterContractByAgentControllerRef;
  } = {}
): ProviderRuntimeContinuationResult {
  const standardAgentControllerConversationResumePlan =
    resolveAgentControllerConversationResumePlan(input);
  const standardLocalRuntimeContextPlan = resolveLocalRuntimeContextPlan(input);
  const runtimeAdapterContract = (
    options.resolveAdapterContract ??
    resolveRegistryRuntimeAdapterContractByAgentControllerRef
  )(input.agentControllerRef);

  if (
    !runtimeAdapterContract ||
    runtimeAdapterContract.capabilityDeclaration.continuationCapability ===
      "standard"
  ) {
    return {
      localRuntimeContextPlan: standardLocalRuntimeContextPlan,
      taskResultProviderFacts: {},
      agentControllerConversationResumePlan:
        standardAgentControllerConversationResumePlan,
      agentControllerConversationOverride: null,
    };
  }

  const policies: ProviderSpecificRuntimeContinuationRegistry =
    options.policies ?? DEFAULT_PROVIDER_SPECIFIC_CONTINUATION_POLICIES;
  const policy = policies[runtimeAdapterContract.adapterId];
  if (!policy) {
    throw new Error(
      `No runtime continuation implementation is registered for adapter '${runtimeAdapterContract.adapterId}'`
    );
  }

  return policy({
    ...input,
    standardLocalRuntimeContextPlan,
    standardAgentControllerConversationResumePlan,
  });
}

export function resolveAgentControllerConversationResumePlan(
  input: Pick<
    ConversationCompatibilityRequest,
    "agentControllerConversationId" | "existingContextId"
  >
): AgentControllerConversationResumePlan {
  const agentControllerConversationId =
    normalizeOptionalText(input.agentControllerConversationId) ??
    normalizeOptionalText(input.existingContextId);
  if (!agentControllerConversationId) {
    return {
      status: "not_bound",
    };
  }

  return {
    status: "continue_existing",
  };
}

export function resolveLocalRuntimeContextPlan(
  input: ConversationCompatibilityRequest
): LocalRuntimeContextPlan {
  if (input.executionState) {
    return {
      reason: null,
      status: "reuse",
    };
  }

  if (normalizeOptionalText(input.existingContextId)) {
    return {
      reason: "execution_state_missing",
      status: "recreate",
    };
  }

  if (hasWorkspaceChangedSinceLatestKnownRuntime(input)) {
    return {
      reason: "workspace_changed",
      status: "recreate",
    };
  }

  return {
    reason: "first_local_runtime_context",
    status: "recreate",
  };
}

function hasWorkspaceChangedSinceLatestKnownRuntime(
  input: ConversationCompatibilityRequest
): boolean {
  const currentRuntimeWorkingDirectory = normalizeOptionalText(
    input.runtimeContext.providerRuntimeWorkingDirectory
  );
  if (!currentRuntimeWorkingDirectory) {
    return false;
  }

  const currentRuntimeWorkspaceFingerprint = buildRuntimeWorkspaceFingerprint(
    currentRuntimeWorkingDirectory
  );
  const latestKnownRuntimeWorkspaceFingerprint = normalizeOptionalText(
    input.latestKnownRuntimeWorkspaceFingerprint
  );
  if (!latestKnownRuntimeWorkspaceFingerprint) {
    return false;
  }
  return (
    currentRuntimeWorkspaceFingerprint !==
    latestKnownRuntimeWorkspaceFingerprint
  );
}

export function listRegistryProviderSpecificContinuationAdapterIds(): string[] {
  return listBuiltinAgentsRegistryEntries()
    .filter((agent) => agent.runtime.supported)
    .flatMap((agent) =>
      agent.runtime.adapters
        .filter(
          (adapter) =>
            adapter.capabilityDeclaration.continuationCapability ===
            "provider_specific"
        )
        .map((adapter) => adapter.adapterId)
    )
    .sort();
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
