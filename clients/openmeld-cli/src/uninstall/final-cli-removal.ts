import { join } from "node:path";
import type { OpenMeldEnvPreset } from "../config/paths";
import { UNINSTALL_SELF_REMOVE_REASON } from "./copy";
import type { ManualCliRemoval, ProductionCliInstallSource } from "./types";

const CLI_PACKAGE_NAME = "openmeld";

export function inferProductionCliInstallSourceFromPaths(input: {
  cliScriptPath?: string;
  npmGlobalRootPath?: string;
}): ProductionCliInstallSource {
  const cliScriptPath = normalizePath(input.cliScriptPath);
  const npmGlobalRootPath = normalizePath(input.npmGlobalRootPath);
  if (!(cliScriptPath && npmGlobalRootPath)) {
    return "unknown";
  }

  const expectedCliPath = normalizePath(
    join(npmGlobalRootPath, CLI_PACKAGE_NAME, "dist", "openmeld.js")
  );
  return cliScriptPath === expectedCliPath ? "npm-global" : "unknown";
}

export function resolveFinalCliRemovalCommand(input: {
  currentLane: OpenMeldEnvPreset;
  productionInstallSource?: ProductionCliInstallSource;
}): ManualCliRemoval {
  if (input.currentLane === "dev-local") {
    return {
      kind: "command",
      command: "pnpm openmeld:dev:remove",
      reason: UNINSTALL_SELF_REMOVE_REASON,
    };
  }

  if (input.currentLane === "canary") {
    return {
      kind: "command",
      command: "pnpm openmeld:canary:remove",
      reason: UNINSTALL_SELF_REMOVE_REASON,
    };
  }

  if ((input.productionInstallSource ?? "unknown") === "npm-global") {
    return {
      kind: "command",
      command: "npm uninstall -g openmeld",
      reason: UNINSTALL_SELF_REMOVE_REASON,
    };
  }

  return {
    kind: "manual",
    message:
      "Remove the production OpenMeld CLI with the same tool you used to install it originally.",
    reason: UNINSTALL_SELF_REMOVE_REASON,
  };
}

function normalizePath(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .toLowerCase();
}
