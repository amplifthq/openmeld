import { rm } from "node:fs/promises";
import { runDaemonTeardownStrict } from "../commands/service";
import { runSkillsUninstall } from "../commands/skills";
import {
  clearAuthSession,
  getAuthSessionMetadata,
} from "../config/auth-session";
import type { OpenMeldEnvPreset } from "../config/paths";
import { resolveOpenMeldRootDir } from "../config/paths";
import { resolveLaneUserFacingCommand } from "./lane-scope";

type ScopedLaneInput = {
  lane: OpenMeldEnvPreset;
  openMeldHome?: string;
};

const SCOPED_ENV_KEYS = [
  "OPENMELD_ENV_PRESET",
  "OPENMELD_HOME",
  "OPENMELD_USER_FACING_CLI_COMMAND",
] as const;

export async function runLaneSkillsCleanup(input: {
  lane: OpenMeldEnvPreset;
  openMeldHome?: string;
  allowExternalTargets?: boolean;
}): Promise<void> {
  await withScopedLaneEnvironment(input, async () => {
    await runSkillsUninstall({
      all: true,
      allowExternalTargets: input.allowExternalTargets === true,
      view: "agent",
    });
  });
}

export async function clearLaneAuthSession(
  input: ScopedLaneInput
): Promise<void> {
  await withScopedLaneEnvironment(input, async () => {
    await clearAuthSession();
  });
}

export async function getLaneAuthSessionMetadata(
  input: ScopedLaneInput
): Promise<Awaited<ReturnType<typeof getAuthSessionMetadata>>> {
  return await withScopedLaneEnvironment(input, async () => {
    return await getAuthSessionMetadata();
  });
}

export async function runLaneDaemonTeardown(
  input: ScopedLaneInput
): Promise<Awaited<ReturnType<typeof runDaemonTeardownStrict>>> {
  return await withScopedLaneEnvironment(input, async () => {
    return await runDaemonTeardownStrict({
      reason: "service_uninstall",
    });
  });
}

export async function removeLaneOpenMeldHome(input: ScopedLaneInput): Promise<{
  removed: boolean;
  homePath: string;
}> {
  return await withScopedLaneEnvironment(input, async () => {
    const homePath =
      typeof input.openMeldHome === "string" &&
      input.openMeldHome.trim().length > 0
        ? input.openMeldHome.trim()
        : resolveOpenMeldRootDir({
            env: process.env,
            argv: buildLaneArgv(input.lane),
          });
    await rm(homePath, {
      recursive: true,
      force: true,
    });
    return {
      removed: true,
      homePath,
    };
  });
}

async function withScopedLaneEnvironment<T>(
  input: ScopedLaneInput,
  fn: () => Promise<T>
): Promise<T> {
  const previousEnv = Object.fromEntries(
    SCOPED_ENV_KEYS.map((key) => [key, process.env[key]])
  ) as Record<(typeof SCOPED_ENV_KEYS)[number], string | undefined>;

  process.env.OPENMELD_ENV_PRESET = input.lane;
  process.env.OPENMELD_USER_FACING_CLI_COMMAND = resolveLaneUserFacingCommand(
    input.lane
  );
  if (
    typeof input.openMeldHome === "string" &&
    input.openMeldHome.trim().length > 0
  ) {
    process.env.OPENMELD_HOME = input.openMeldHome.trim();
  } else {
    Reflect.deleteProperty(process.env, "OPENMELD_HOME");
  }

  try {
    return await fn();
  } finally {
    for (const key of SCOPED_ENV_KEYS) {
      const previousValue = previousEnv[key];
      if (previousValue === undefined) {
        Reflect.deleteProperty(process.env, key);
        continue;
      }
      process.env[key] = previousValue;
    }
  }
}

function buildLaneArgv(lane: OpenMeldEnvPreset): string[] {
  let command = "openmeld";
  if (lane === "dev-local") {
    command = "openmeld-dev";
  } else if (lane === "canary") {
    command = "openmeld-canary";
  }

  return [process.execPath, command];
}
