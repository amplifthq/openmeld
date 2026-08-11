import {
  type OpenMeldEnvPreset,
  resolveOpenMeldEnvPreset,
  resolveOpenMeldRootDir,
} from "./paths";

export type OpenMeldLaneDescriptor = {
  command: "openmeld" | "openmeld-dev" | "openmeld-canary";
  preset: OpenMeldEnvPreset;
  openMeldHome: string;
  destructiveResetAllowed: boolean;
  repairCommand: string;
  removeCommand: string | null;
  resetCommand: string;
};

export function resolveOpenMeldLaneDescriptor(input?: {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  homeDir?: string;
}): OpenMeldLaneDescriptor {
  const env = input?.env ?? process.env;
  const preset = resolveOpenMeldEnvPreset({
    argv: input?.argv,
    env,
    homeDir: input?.homeDir,
  });
  const command = resolveLaneCommand(preset);
  return {
    command,
    preset,
    openMeldHome: resolveOpenMeldRootDir({
      argv: input?.argv,
      env,
      homeDir: input?.homeDir,
    }),
    destructiveResetAllowed: true,
    repairCommand: `${command} repair local-state`,
    removeCommand: preset === "canary" ? "pnpm openmeld:canary:remove" : null,
    resetCommand: `${command} reset --yes`,
  };
}

export function formatLaneScopeSentence(
  lane: Pick<OpenMeldLaneDescriptor, "openMeldHome" | "command">
): string {
  return `This only affects the ${lane.command} lane at ${lane.openMeldHome}.`;
}

export function buildLaneScopedCleanupGuidance(
  lane: Pick<
    OpenMeldLaneDescriptor,
    "command" | "repairCommand" | "removeCommand"
  >
): string {
  const commands = [`\`${lane.repairCommand}\``];
  if (lane.removeCommand) {
    commands.unshift(`\`${lane.removeCommand}\``);
  }
  return `Optional cleanup for this lane: run ${commands.join(" or ")}.`;
}

function resolveLaneCommand(
  preset: OpenMeldEnvPreset
): OpenMeldLaneDescriptor["command"] {
  if (preset === "dev-local") {
    return "openmeld-dev";
  }
  if (preset === "canary") {
    return "openmeld-canary";
  }
  return "openmeld";
}
