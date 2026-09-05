import { readFile } from "node:fs/promises";
import {
  type OpenMeldPathResolutionInput,
  resolveOpenMeldRootDir,
} from "../../config/paths";
import {
  type OpenMeldDistribution,
  resolveOpenMeldDistribution,
} from "../../runtime/distribution";
import { containsOpenMeldManagedBinaryPath } from "./daemon-managed-binary-path";
import {
  daemonServiceBinaryExecutablePath,
  daemonServiceExecutableWrapperPath,
  daemonServiceLauncherPath,
  daemonServiceLegacyWrapperPath,
} from "./daemon-service-bundle";
import {
  type DaemonServiceCommandSpec,
  type DaemonServiceManager,
  resolveDaemonServiceManager,
} from "./daemon-service-manager";

export async function assertDaemonMaintenanceInstallationOwnership(): Promise<void> {
  const manager = await resolveDaemonServiceManager();
  if (!manager) {
    throw new Error(
      "OpenMeld cannot verify the background service installation."
    );
  }
  const status = await manager.status();
  // A missing registration can be restored from this installation's saved job.
  if (!status.installed) {
    return;
  }
  if (
    !(await matchesExpectedDaemonServiceManagerDefinition({
      controller: manager.controller,
      definitionPath: status.definitionPath ?? null,
      commandSpec: status.commandSpec,
    }))
  ) {
    throw new Error(
      "OpenMeld background service belongs to a different installation. Automatic maintenance was stopped without changing it."
    );
  }
}

export function matchesExpectedDaemonServiceManagerCommand(input: {
  controller: DaemonServiceManager["controller"] | null;
  commandSummary: string;
  commandSpec?: DaemonServiceCommandSpec;
  definitionPath: string | null;
  distribution?: OpenMeldDistribution;
  includeLegacyExecutableWrappers?: boolean;
  pathInput?: OpenMeldPathResolutionInput;
}): boolean {
  if (input.controller === "windows-service") {
    if (input.commandSpec) {
      return matchesWindowsTaskInstallation(input.commandSpec, input.pathInput);
    }
    return (
      typeof input.definitionPath === "string" &&
      input.definitionPath.length > 0 &&
      input.commandSummary.includes(input.definitionPath)
    );
  }
  if ((input.distribution ?? resolveOpenMeldDistribution()) === "binary") {
    if (input.controller === "launchd") {
      const stableExecutablePath = daemonServiceBinaryExecutablePath(
        input.pathInput
      );
      return [
        `${stableExecutablePath} service run`,
        `"${stableExecutablePath}" service run`,
        `'${stableExecutablePath}' service run`,
      ].some((expectedPrefix) => input.commandSummary.includes(expectedPrefix));
    }
    return containsOpenMeldManagedBinaryPath(
      input.commandSummary,
      input.pathInput
    );
  }
  return resolveExpectedDaemonServiceManagerCommandPaths({
    controller: input.controller,
    includeLegacyExecutableWrappers:
      input.includeLegacyExecutableWrappers === true,
    pathInput: input.pathInput,
  }).some((path) => input.commandSummary.includes(path));
}

export async function matchesExpectedDaemonServiceManagerDefinition(input: {
  controller?: DaemonServiceManager["controller"] | null;
  definitionPath: string | null;
  commandSpec?: DaemonServiceCommandSpec;
  distribution?: OpenMeldDistribution;
  pathInput?: OpenMeldPathResolutionInput;
}): Promise<boolean> {
  if (input.controller === "windows-service" && input.commandSpec) {
    return matchesWindowsTaskInstallation(input.commandSpec, input.pathInput);
  }
  if (
    typeof input.definitionPath !== "string" ||
    input.definitionPath.trim().length === 0
  ) {
    return false;
  }

  const definition = await readFile(input.definitionPath, "utf8").catch(
    () => null
  );
  if (definition === null) {
    return false;
  }

  if ((input.distribution ?? resolveOpenMeldDistribution()) === "binary") {
    if (input.controller === "launchd") {
      const stableExecutablePath = daemonServiceBinaryExecutablePath(
        input.pathInput
      );
      return definition.includes(`<string>${stableExecutablePath}</string>`);
    }
    return containsOpenMeldManagedBinaryPath(definition, input.pathInput);
  }

  return resolveExpectedDaemonServiceManagerCommandPaths({
    controller: input.controller ?? null,
    pathInput: input.pathInput,
  }).some((path) => definition.includes(path));
}

function matchesWindowsTaskInstallation(
  spec: DaemonServiceCommandSpec,
  pathInput: OpenMeldPathResolutionInput = {}
): boolean {
  return (
    spec.args[0] === daemonServiceLauncherPath(pathInput) &&
    spec.args[1] === "service" &&
    spec.args[2] === "run" &&
    resolveOpenMeldRootDir({ env: spec.env }) ===
      resolveOpenMeldRootDir(pathInput)
  );
}

function resolveExpectedDaemonServiceManagerCommandPaths(input: {
  controller: DaemonServiceManager["controller"] | null;
  includeLegacyExecutableWrappers?: boolean;
  pathInput?: OpenMeldPathResolutionInput;
}): string[] {
  if (input.controller === "launchd") {
    return [
      daemonServiceExecutableWrapperPath(input.pathInput),
      ...(input.includeLegacyExecutableWrappers === true
        ? [daemonServiceLegacyWrapperPath(input.pathInput)]
        : []),
    ];
  }
  return [daemonServiceLauncherPath(input.pathInput)];
}
