import { readFile } from "node:fs/promises";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
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
import type { DaemonServiceManager } from "./daemon-service-manager";

export function matchesExpectedDaemonServiceManagerCommand(input: {
  controller: DaemonServiceManager["controller"] | null;
  commandSummary: string;
  definitionPath: string | null;
  distribution?: OpenMeldDistribution;
  includeLegacyExecutableWrappers?: boolean;
  pathInput?: OpenMeldPathResolutionInput;
}): boolean {
  if (input.controller === "windows-service") {
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
  distribution?: OpenMeldDistribution;
  pathInput?: OpenMeldPathResolutionInput;
}): Promise<boolean> {
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
