import type { OpenMeldDaemonSetLocalAgentEnabledPayload } from "@openmeld/schemas/types";
import { registerUnselectedBuiltinAgentsTurnedOff } from "../agents/registry";
import { requestLocalSetLocalAgentEnabled } from "../local-service/control-plane/client";

// The Local agents switch on this computer is the member's choice of which
// harnesses become Agents (design-plans/member-agent-program.md §4.1). Setup
// changes it through the running OpenMeld Service, which refreshes its
// catalog report before it answers, so Core sees the switch at once.

/**
 * Before setup starts the Service: register each detected built-in agent the
 * member did not select as off, so the Service's discovery never turns it on
 * and reports it in the meantime. Agents already registered keep their switch
 * until turnOffUnselectedLocalAgentsForSetup runs.
 */
export async function registerUnselectedLocalAgentsOffForSetup(input: {
  selectedLocalAgentIds: readonly string[];
}): Promise<void> {
  await registerUnselectedBuiltinAgentsTurnedOff({
    selectedAgentIds: input.selectedLocalAgentIds,
  });
}

export type SetupLocalAgentChoiceResult = {
  // Unselected agents now off: newly registered off, or turned off.
  turnedOffAgentIds: string[];
  // Unselected agents the Service could not turn off, or turned off without
  // reporting it to OpenMeld.
  failedAgentIds: string[];
};

/**
 * After setup applied the member's selection, turn every detected built-in
 * agent they did not select off on this computer. Setup or the Service may
 * have turned new agents on automatically before the member chose; without
 * this, each would become an Agent on the next sync. Setup never fails here.
 */
export async function turnOffUnselectedLocalAgentsForSetup(input: {
  selectedLocalAgentIds: readonly string[];
}): Promise<SetupLocalAgentChoiceResult> {
  const { registeredOffAgentIds, unselectedOnAgentIds } =
    await registerUnselectedBuiltinAgentsTurnedOff({
      selectedAgentIds: input.selectedLocalAgentIds,
    });
  const turnedOffAgentIds = [...registeredOffAgentIds];
  const failedAgentIds: string[] = [];
  for (const agentId of unselectedOnAgentIds) {
    const switched = await setLocalAgentEnabledThroughService({
      agentId,
      enabled: false,
    });
    if (switched.accepted && switched.reportSyncStatus !== "failed") {
      turnedOffAgentIds.push(agentId);
    } else {
      failedAgentIds.push(agentId);
      console.warn("[openmeld.setup.local_agent_turn_off_failed]", {
        agentId,
        event: "cli.setup.local_agent_turn_off_failed",
        reasonCode: switched.reasonCode ?? null,
      });
    }
  }
  return { failedAgentIds, turnedOffAgentIds };
}

/**
 * Turn one local agent on or off through the running OpenMeld Service. A
 * Service that is not running answers as a rejected switch.
 */
async function setLocalAgentEnabledThroughService(input: {
  agentId: string;
  enabled: boolean;
}): Promise<OpenMeldDaemonSetLocalAgentEnabledPayload> {
  try {
    return await requestLocalSetLocalAgentEnabled({ payload: input });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "service.not_running";
    return {
      accepted: false,
      agentId: input.agentId,
      changed: false,
      enabled: !input.enabled,
      message:
        (error instanceof Error ? error.message : String(error)) ||
        "OpenMeld Service is unavailable.",
      reasonCode: code,
      reportSyncStatus: "failed",
      status: "rejected",
    };
  }
}
