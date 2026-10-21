import type {
  AgentControllerConversationRef,
  AgentControllerConversationResumePlan,
  ConversationExecutionState,
  ConversationPolicy,
  LocalRuntimeContextPlan,
  OpenMeldDaemonTaskResultPayload,
  ProviderDispatchRuntimeContext,
  RuntimeTransportMode,
} from "@openmeld/schemas/types";
import type { ProviderRuntimePreparationDetails } from "../../provider-hosts/prepare-provider-runtime";

export type DispatchContinuationTaskResultProviderFacts = {
  openClawBinding?: OpenMeldDaemonTaskResultPayload["openClawBinding"];
};

export type ProviderRuntimeContinuationResult = {
  localRuntimeContextPlan: LocalRuntimeContextPlan;
  taskResultProviderFacts: DispatchContinuationTaskResultProviderFacts;
  agentControllerConversationResumePlan: AgentControllerConversationResumePlan;
  agentControllerConversationOverride: AgentControllerConversationRef | null;
};

export type ProviderSpecificRuntimeContinuationRequest = {
  agentControllerConversationId: string | null;
  agentControllerRef: string;
  currentPolicy: ConversationPolicy;
  existingContextId: string | null;
  executionState: ConversationExecutionState | null;
  latestKnownRuntimeWorkspaceFingerprint?: string | null;
  runtimeContext: ProviderDispatchRuntimeContext;
  runtimePreparationDetails: ProviderRuntimePreparationDetails;
  /** A colleague's Wake: a conversation of its own (member-agent-program.md §4.3). */
  separateConversationScopeId?: string;
  spaceId: string;
  spaceNameSnapshot: string | null;
  standardLocalRuntimeContextPlan: LocalRuntimeContextPlan;
  standardAgentControllerConversationResumePlan: AgentControllerConversationResumePlan;
  transportMode: RuntimeTransportMode;
};

export type ProviderSpecificRuntimeContinuationPolicy = (
  input: ProviderSpecificRuntimeContinuationRequest
) => ProviderRuntimeContinuationResult;
