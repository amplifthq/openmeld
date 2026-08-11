import {
  type LocalControllerInstallRepairResult,
  type LocalControllerInstallResolution,
  type LocalControllerInstallStatus,
  repairBuiltinControllerInstall,
  resolveBuiltinControllerInstallResolution,
} from "./local-controller-install";

export type BuiltinAgentLaunchStatus = LocalControllerInstallStatus;
export type BuiltinAgentLaunchResolution = LocalControllerInstallResolution;
export type BuiltinAgentLaunchRepairResult = LocalControllerInstallRepairResult;

export function resolveBuiltinAgentLaunchResolution(
  input: Parameters<typeof resolveBuiltinControllerInstallResolution>[0]
): ReturnType<typeof resolveBuiltinControllerInstallResolution> {
  return resolveBuiltinControllerInstallResolution(input);
}

export function repairBuiltinAgentLaunchContract(
  input: Parameters<typeof repairBuiltinControllerInstall>[0]
): ReturnType<typeof repairBuiltinControllerInstall> {
  return repairBuiltinControllerInstall(input);
}
