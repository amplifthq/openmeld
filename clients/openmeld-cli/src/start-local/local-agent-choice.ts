import type { OpenMeldDaemonSetLocalAgentEnabledPayload } from "@openmeld/schemas/types";
import { registerUnselectedBuiltinAgentsTurnedOff } from "../agents/registry";
import { requestLocalSetLocalAgentEnabled } from "../local-service/control-plane/client";

// The Local agents switch on this computer is the member's choice of which
// harnesses become Agents (design-plans/member-agent-program.md §4.1). Setup
// changes it through the running OpenMeld Service, which refreshes its
// catalog report before it answers, so Core sees the switch at once.

/**
 * Before setup starts the Service: turn every detected built-in agent the
 * member did not select off in the local registry (registering new ones as
 * off), so the Service never reports one as on. Returns the agents that were
 * on; turnOffUnselectedLocalAgentsForSetup reports them through the Service.
 */
export async function registerUnselectedLocalAgentsOffForSetup(input: {
  selectedLocalAgentIds: readonly string[];
}): Promise<string[]> {
  const { turnedOffExistingAgentIds } =
    await registerUnselectedBuiltinAgentsTurnedOff({
      selectedAgentIds: input.selectedLocalAgentIds,
      turnOffExisting: true,
    });
  return turnedOffExistingAgentIds;
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
  // Turned off before the Service started: switch them through the Service
  // too, so its report says so before any Agent is added.
  turnedOffBeforeServiceAgentIds?: readonly string[];
}): Promise<SetupLocalAgentChoiceResult> {
  const { registeredOffAgentIds, unselectedOnAgentIds } =
    await registerUnselectedBuiltinAgentsTurnedOff({
      selectedAgentIds: input.selectedLocalAgentIds,
    });
  const turnedOffAgentIds = [...registeredOffAgentIds];
  const failedAgentIds: string[] = [];
  const toSwitch = [
    ...new Set([
      ...unselectedOnAgentIds,
      ...(input.turnedOffBeforeServiceAgentIds ?? []),
    ]),
  ];
  for (const agentId of toSwitch) {
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
