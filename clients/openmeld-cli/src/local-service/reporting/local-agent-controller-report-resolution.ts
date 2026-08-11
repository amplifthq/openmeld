import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import {
  collectLocalAgentControllerInventory,
  type LocalAgentControllerInventoryItem,
  resolveLocalAgentControllerReportDecision,
} from "../inventory/agent-controller-inventory";
import type { RuntimeAgentControllerReportInput } from "./runtime-agent-controller-reporting-submission";

export async function resolveLocalAgentControllerReportInput(input: {
  agentControllerRef: string;
  controllerInventory?: readonly LocalAgentControllerInventoryItem[];
  diagnosticProfileId?: string;
  requireEnabled: boolean;
}): Promise<RuntimeAgentControllerReportInput> {
  const parsedRef = parseAgentControllerRef(input.agentControllerRef);
  const agentControllerRef = parsedRef?.ref ?? input.agentControllerRef.trim();
  if (!parsedRef) {
    return buildReportInput({
      agentControllerRef,
      diagnosticProfileId: input.diagnosticProfileId,
      localParticipationState: "needs_agent_prepare",
      reasonCodes: ["runtime.reporting.agent_controller_ref_invalid"],
    });
  }

  if (parsedRef.kind !== "builtin") {
    return buildReportInput({
      agentControllerRef,
      diagnosticProfileId: input.diagnosticProfileId,
      localParticipationState: "ready",
      reasonCodes: [],
    });
  }

  const controllerInventory =
    input.controllerInventory ??
    (
      await collectLocalAgentControllerInventory({
        includeControllerInterface: true,
      })
    ).capabilities;
  const capability =
    controllerInventory.find(
      (currentCapability) =>
        currentCapability.agentControllerRef === agentControllerRef
    ) ?? null;
  if (!capability) {
    return buildReportInput({
      agentControllerRef,
      diagnosticProfileId: input.diagnosticProfileId,
      localParticipationState: "needs_agent_prepare",
      reasonCodes: ["local_agent_preparation.not_found"],
    });
  }

  const decision = resolveLocalAgentControllerReportDecision(capability, {
    requireEnabled: input.requireEnabled,
  });
  return buildReportInput({
    agentControllerInterface: capability.agentControllerInterface,
    agentControllerRef,
    diagnosticProfileId: input.diagnosticProfileId,
    localParticipationState: decision.localParticipationState,
    reasonCodes: decision.reasonCodes,
  });
}

function buildReportInput(
  input: RuntimeAgentControllerReportInput
): RuntimeAgentControllerReportInput {
  return {
    agentControllerRef: input.agentControllerRef,
    ...(input.agentControllerInterface
      ? { agentControllerInterface: input.agentControllerInterface }
      : {}),
    ...(input.diagnosticProfileId
      ? { diagnosticProfileId: input.diagnosticProfileId }
      : {}),
    localParticipationState: input.localParticipationState,
    reasonCodes: input.reasonCodes,
  };
}
