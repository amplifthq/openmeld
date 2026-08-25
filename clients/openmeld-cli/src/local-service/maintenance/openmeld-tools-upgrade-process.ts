import { spawn } from "node:child_process";
import { isBinaryDistribution } from "../../runtime/distribution";
import {
  type DaemonActiveBundleState,
  readDaemonActiveBundleState,
} from "../lifecycle/daemon-service-bundle";
import {
  buildOpenMeldToolsUpdateContextEnv,
  type OpenMeldToolsUpdateContext,
} from "./openmeld-tools-update-context";

export type OpenMeldToolsUpgradeProcessResult = { exitCode: number };

export async function runOpenMeldToolsUpgradeProcess(
  context: OpenMeldToolsUpdateContext
): Promise<OpenMeldToolsUpgradeProcessResult> {
  const activeBundle = await readDaemonActiveBundleState().catch(() => null);
  const { command, argsPrefix } = resolveOpenMeldToolsUpgradeProgram({
    activeBundle,
    binaryDistribution: isBinaryDistribution(),
    processEntryScriptPath: process.argv[1],
    processExecutablePath: process.execPath,
  });
  return await new Promise((resolve, reject) => {
    const child = spawn(
      command,
      [...argsPrefix, "--view", "agent", "upgrade", "--yes"],
      {
        env: {
          ...process.env,
          ...buildOpenMeldToolsUpdateContextEnv(context),
          OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE: "1",
        },
        stdio: "ignore",
      }
    );
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ exitCode: Number(code ?? 1) });
    });
  });
}

export function resolveOpenMeldToolsUpgradeProgram(input: {
  activeBundle: Pick<
    DaemonActiveBundleState,
    "bundleFormat" | "sourceEntryScriptPath"
  > | null;
  binaryDistribution: boolean;
  processEntryScriptPath?: string;
  processExecutablePath: string;
}): { argsPrefix: string[]; command: string } {
  if (input.binaryDistribution) {
    return {
      argsPrefix: [],
      command:
        input.activeBundle?.bundleFormat === "binary_v1"
          ? input.activeBundle.sourceEntryScriptPath
          : input.processExecutablePath,
    };
  }
  const sourceEntryScriptPath =
    input.activeBundle?.sourceEntryScriptPath ?? input.processEntryScriptPath;
  if (!sourceEntryScriptPath) {
    throw new Error("OpenMeld could not find its update program.");
  }
  return {
    argsPrefix: [sourceEntryScriptPath],
    command: input.processExecutablePath,
  };
}
