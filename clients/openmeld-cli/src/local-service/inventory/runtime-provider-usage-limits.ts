import type {
  AgentControllerInterfaceAuthSnapshot,
  AgentControllerUsageAdmission,
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
  usageAccountKey?: string;
  usageAdmission?: AgentControllerUsageAdmission;
  usageLimits: AgentControllerUsageLimits;
}): Promise<boolean> {
  if (
    input.agentId === "codex" &&
    (!input.usageAccountKey ||
      input.usageAccountKey !== input.authSnapshot.accountKey)
  ) {
    return false;
  }
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
    usageAdmission: input.usageAdmission,
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
