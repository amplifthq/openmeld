import { buildAgentControllerConversationRef } from "@openmeld/schemas";
import type {
  ProviderRuntimeContinuationResult,
  ProviderSpecificRuntimeContinuationRequest,
} from "../../local-service/continuation/types";
import {
  classifyOpenClawAgentControllerConversation,
  type OpenClawAgentControllerConversationClassification,
} from "./agent-controller-conversation";
import { buildOpenClawSpaceSessionKey } from "./naming";

export function resolveOpenClawProviderRuntimeContinuation(
  input: ProviderSpecificRuntimeContinuationRequest
): ProviderRuntimeContinuationResult {
  const conversationClassification =
    classifyOpenClawAgentControllerConversation({
      agentControllerConversationId: input.agentControllerConversationId,
      openClawBootstrapAgentId: resolveOpenClawBootstrapAgentId(
        input.runtimePreparationDetails
      ),
      spaceId: input.spaceId,
    });

  return {
    localRuntimeContextPlan: input.standardLocalRuntimeContextPlan,
    taskResultProviderFacts: {
      openClawBinding: {
        classification: conversationClassification,
      },
    },
    agentControllerConversationResumePlan:
      input.standardAgentControllerConversationResumePlan,
    agentControllerConversationOverride:
      resolveOpenClawAgentControllerConversationOverride({
        conversationClassification,
        agentControllerConversationId: input.agentControllerConversationId,
        openClawBootstrapAgentId: resolveOpenClawBootstrapAgentId(
          input.runtimePreparationDetails
        ),
        spaceId: input.spaceId,
        spaceNameSnapshot: input.spaceNameSnapshot,
      }),
  };
}

function resolveOpenClawBootstrapAgentId(
  preparationDetails: ProviderSpecificRuntimeContinuationRequest["runtimePreparationDetails"]
): string | null {
  return preparationDetails.kind === "openclaw"
    ? preparationDetails.bootstrap.agentId
    : null;
}

function resolveOpenClawAgentControllerConversationOverride(input: {
  agentControllerConversationId: string | null;
  conversationClassification: OpenClawAgentControllerConversationClassification;
  openClawBootstrapAgentId: string | null;
  spaceId: string;
  spaceNameSnapshot: string | null;
}): ProviderRuntimeContinuationResult["agentControllerConversationOverride"] {
  if (
    input.conversationClassification === "canonical_owned" &&
    normalizeOptionalText(input.agentControllerConversationId)
  ) {
    return buildAgentControllerConversationRef({
      agentControllerRef: "builtin:openclaw",
      agentControllerConversationKind: "session",
      agentControllerConversationId: normalizeOptionalText(
        input.agentControllerConversationId
      ) as string,
    });
  }

  const openClawBootstrapAgentId = normalizeOptionalText(
    input.openClawBootstrapAgentId
  );
  if (!openClawBootstrapAgentId) {
    return null;
  }

  return buildAgentControllerConversationRef({
    agentControllerRef: "builtin:openclaw",
    agentControllerConversationKind: "session",
    agentControllerConversationId: buildOpenClawSpaceSessionKey({
      agentId: openClawBootstrapAgentId,
      spaceId: input.spaceId,
      spaceNameSnapshot: input.spaceNameSnapshot,
    }),
  });
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
