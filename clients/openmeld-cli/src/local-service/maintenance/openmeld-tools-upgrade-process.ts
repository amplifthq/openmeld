import { spawn } from "node:child_process";
import { compareSemver } from "../../config/version-state";
import { readManagedCliInstallation } from "../../local-components/managed-install";
import { isBinaryDistribution } from "../../runtime/distribution";
import { OPENMELD_VERSION } from "../../runtime/version";
import {
  buildOpenMeldToolsUpdateContextEnv,
  type OpenMeldToolsUpdateContext,
} from "./openmeld-tools-update-context";
import {
  appendBoundedOpenMeldToolsUpdateProcessOutput,
  type OpenMeldToolsUpdateProcessFailure,
  parseOpenMeldToolsUpdateFailureFrame,
} from "./openmeld-tools-update-process-frame";

export type OpenMeldToolsUpgradeProcessResult = {
  exitCode: number;
  processFailure?: OpenMeldToolsUpdateProcessFailure;
};

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
    let stdout = "";
    const child = spawn(command, [...argsPrefix, "maintenance-upgrade"], {
      env: {
        ...process.env,
        ...buildOpenMeldToolsUpdateContextEnv(context),
        OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE: "1",
        OPENMELD_INTERNAL_MAINTENANCE_WORKER: "1",
      },
      // Tee output into the OS-owned worker log while retaining only a bounded
      // stdout tail so the typed terminal failure frame can reach the owner.
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout = appendBoundedOpenMeldToolsUpdateProcessOutput(stdout, text);
      process.stdout.write(text);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      const processFailure = parseOpenMeldToolsUpdateFailureFrame(stdout);
      resolve({
        exitCode: Number(code ?? 1),
        ...(processFailure ? { processFailure } : {}),
      });
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
