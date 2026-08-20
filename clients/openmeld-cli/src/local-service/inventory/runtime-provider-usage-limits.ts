import type {
  AgentControllerInterfaceAuthSnapshot,
  AgentControllerUsageLimits,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/schemas/types";
import {
  buildAgentControllerInterfaceKeeperKey,
  recordAgentControllerUsageLimitsObservation,
  resolveAgentControllerCommandFingerprint,
} from "./agent-controller-interface-keeper";

export async function recordRuntimeProviderUsageLimits(input: {
  agentId: string;
  authSnapshot: AgentControllerInterfaceAuthSnapshot;
  launchContract: RuntimeAgentControllerLaunchContract;
  usageLimits: AgentControllerUsageLimits;
}): Promise<boolean> {
  const commandPath = resolveLaunchContractCommandPath(input.launchContract);
  const commandFingerprint = await resolveAgentControllerCommandFingerprint({
    commandPath,
    launchContractKind: input.launchContract.kind,
  });
  if (!commandFingerprint) {
    return false;
  }
  return recordAgentControllerUsageLimitsObservation({
    authSnapshot: input.authSnapshot,
    commandFingerprint,
    keeperKey: buildAgentControllerInterfaceKeeperKey({
      agentId: input.agentId,
      commandPath,
    }),
    usageLimits: input.usageLimits,
  });
}

export function resolveLaunchContractCommandPath(
  launchContract: RuntimeAgentControllerLaunchContract
): string {
  return launchContract.kind === "executable"
    ? launchContract.commandPath
    : launchContract.scriptPath;
}
