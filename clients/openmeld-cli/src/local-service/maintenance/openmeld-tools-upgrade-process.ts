import { spawn } from "node:child_process";
import { compareSemver } from "../../config/version-state";
import { readManagedCliInstallation } from "../../local-components/managed-install";
import { isBinaryDistribution } from "../../runtime/distribution";
import { OPENMELD_VERSION } from "../../runtime/version";
import {
  buildOpenMeldToolsUpdateContextEnv,
  type OpenMeldToolsUpdateContext,
} from "./openmeld-tools-update-context";

export type OpenMeldToolsUpgradeProcessResult = { exitCode: number };

export async function resolveMaintenanceCliInstallation(): Promise<{
  version: string;
  binaryPath: string;
}> {
  const installed = isBinaryDistribution()
    ? await readManagedCliInstallation()
    : null;
  return installed && compareSemver(installed.version, OPENMELD_VERSION) >= 0
    ? installed
    : { version: OPENMELD_VERSION, binaryPath: process.execPath };
}

export async function runOpenMeldToolsUpgradeProcess(
  context: OpenMeldToolsUpdateContext
): Promise<OpenMeldToolsUpgradeProcessResult> {
  const binaryDistribution = isBinaryDistribution();
  const cli = await resolveMaintenanceCliInstallation();
  // A retained Service/maintenance carrier may be older than the installed CLI.
  // Run the installed CLI for updates; the protected carrier can still repair a
  // missing managed install. npm retains its original installation recipe.
  const { command, argsPrefix } = resolveOpenMeldToolsUpgradeProgram({
    binaryDistribution,
    processEntryScriptPath: process.argv[1],
    processExecutablePath: binaryDistribution
      ? cli.binaryPath
      : process.execPath,
  });
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...argsPrefix, "maintenance-upgrade"], {
      env: {
        ...process.env,
        ...buildOpenMeldToolsUpdateContextEnv(context),
        OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE: "1",
        OPENMELD_INTERNAL_MAINTENANCE_WORKER: "1",
      },
      // The OS-owned worker log retains the installer's actual failure reason.
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ exitCode: Number(code ?? 1) });
    });
  });
}

export function resolveOpenMeldToolsUpgradeProgram(input: {
  binaryDistribution: boolean;
  processEntryScriptPath?: string;
  processExecutablePath: string;
}): { argsPrefix: string[]; command: string } {
  if (input.binaryDistribution) {
    return {
      argsPrefix: [],
      command: input.processExecutablePath,
    };
  }
  const sourceEntryScriptPath = input.processEntryScriptPath;
  if (!sourceEntryScriptPath) {
    throw new Error("OpenMeld could not find its update program.");
  }
  return {
    argsPrefix: [sourceEntryScriptPath],
    command: input.processExecutablePath,
  };
}
