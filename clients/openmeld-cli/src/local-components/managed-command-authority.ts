import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  OPENMELD_HOME_ENV_KEY,
  openMeldManagedBinaryPath,
  openMeldManagedVersionBinaryPath,
  resolveOpenMeldEnvPreset,
} from "../config/paths";
import { compareSemver } from "../config/version-state";
import type { OpenMeldDistribution } from "../runtime/distribution";
import { parseLeadingCommandTokensFromArgv } from "../runtime/view-argv";

const MANAGED_CLI_DELEGATION_ENV = "OPENMELD_INTERNAL_MANAGED_CLI_DELEGATION";
const UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG = "--internal-align-service";

export type ManagedCliDelegation =
  | { status: "stay" }
  | {
      status: "delegate";
      command: string;
      args: string[];
      reason: "managed_cli_is_current" | "managed_cli_upgrade_owns_channel";
    };

export async function resolveManagedCliDelegation(input: {
  argv: string[];
  currentVersion: string;
  distribution: OpenMeldDistribution;
  env?: NodeJS.ProcessEnv;
}): Promise<ManagedCliDelegation> {
  const env = input.env ?? process.env;
  const args = input.argv.slice(2);
  const [firstCommand, secondCommand] = parseLeadingCommandTokensFromArgv(
    input.argv,
    2
  );
  if (
    input.distribution !== "npm" ||
    resolveOpenMeldEnvPreset({ env, argv: input.argv }) !== "prod" ||
    normalizeOptionalText(env[OPENMELD_HOME_ENV_KEY]) ||
    env[MANAGED_CLI_DELEGATION_ENV] === "1" ||
    isServiceCarrierCommand(firstCommand, secondCommand) ||
    args.includes(UPGRADE_INTERNAL_ALIGN_SERVICE_FLAG)
  ) {
    return { status: "stay" };
  }

  const managed = await resolveUsableManagedCli({ env, argv: input.argv });
  if (!managed) {
    return { status: "stay" };
  }

  let versionComparison: number;
  try {
    versionComparison = compareSemver(managed.version, input.currentVersion);
  } catch {
    return { status: "stay" };
  }
  if (versionComparison >= 0) {
    return {
      args,
      command: managed.path,
      reason: "managed_cli_is_current",
      status: "delegate",
    };
  }
  if (firstCommand === "upgrade") {
    return {
      args,
      command: managed.path,
      reason: "managed_cli_upgrade_owns_channel",
      status: "delegate",
    };
  }
  return { status: "stay" };
}

export async function runManagedCliDelegation(
  delegation: Extract<ManagedCliDelegation, { status: "delegate" }>,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  return await new Promise((resolve, reject) => {
    const child = spawn(delegation.command, delegation.args, {
      env: {
        ...env,
        [MANAGED_CLI_DELEGATION_ENV]: "1",
      },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (typeof code === "number") {
        resolve(code);
        return;
      }
      reject(
        new Error(
          `managed OpenMeld CLI exited without a status${
            signal ? ` after signal ${signal}` : ""
          }`
        )
      );
    });
  });
}

async function resolveUsableManagedCli(input: {
  env: NodeJS.ProcessEnv;
  argv: string[];
}): Promise<{ path: string; version: string } | null> {
  const pointerPath = openMeldManagedBinaryPath(input);
  const resolvedPath = await realpath(pointerPath).catch(() => null);
  if (!resolvedPath) {
    return null;
  }
  const resolvedStat = await stat(resolvedPath).catch(() => null);
  if (!resolvedStat?.isFile()) {
    return null;
  }
  const executable = await access(resolvedPath, fsConstants.X_OK).then(
    () => true,
    () => false
  );
  if (!executable) {
    return null;
  }
  const version = basename(dirname(resolvedPath));
  if (!version) {
    return null;
  }
  const expectedVersionPath = await realpath(
    openMeldManagedVersionBinaryPath(version, input)
  ).catch(() => null);
  return expectedVersionPath === resolvedPath
    ? { path: resolvedPath, version }
    : null;
}

function isServiceCarrierCommand(
  firstCommand: string | undefined,
  secondCommand: string | undefined
): boolean {
  return (
    (firstCommand === "service" || firstCommand === "daemon") &&
    secondCommand === "run"
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
