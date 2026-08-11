import type {
  OpenMeldEnvPreset,
  OpenMeldPathResolutionInput,
} from "../config/paths";
import { resolveOpenMeldEnvPreset } from "../config/paths";
import type { UninstallScope, UninstallScopeInput } from "./types";

export const ALL_UNINSTALL_LANES = [
  "prod",
  "dev-local",
  "canary",
] as const satisfies readonly OpenMeldEnvPreset[];

export function resolveCurrentUninstallLane(
  input: OpenMeldPathResolutionInput = {}
): OpenMeldEnvPreset {
  return resolveOpenMeldEnvPreset(input);
}

export function resolveUninstallScope(
  input: UninstallScopeInput = {}
): UninstallScope {
  if (input.allLanes === true) {
    return {
      kind: "all-lanes",
      lanes: [...ALL_UNINSTALL_LANES],
    };
  }

  return {
    kind: "current-lane",
    lane: resolveCurrentUninstallLane(input),
  };
}

export function listScopeLanes(
  scope: UninstallScope
): readonly OpenMeldEnvPreset[] {
  return scope.kind === "all-lanes" ? scope.lanes : [scope.lane];
}

export function resolveLaneUserFacingCommand(lane: OpenMeldEnvPreset): string {
  switch (lane) {
    case "dev-local":
      return "openmeld-dev";
    case "canary":
      return "openmeld-canary";
    default:
      return "openmeld";
  }
}
