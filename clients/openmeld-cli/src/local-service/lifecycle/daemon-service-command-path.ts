import { basename } from "node:path";
import {
  daemonRuntimeBundlesPath,
  daemonServiceRecognizedExecutablePaths,
} from "../../config/daemon-state";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
import { isOpenMeldManagedBinaryPath } from "./daemon-managed-binary-path";

const COMMAND_TOKEN_PATTERN = /"([^"]*)"|'([^']*)'|(\S+)/g;
const COMMAND_ARGUMENT_BOUNDARY_PATTERN = /\s/u;

export type DaemonServiceProcessMode = "foreground" | "background" | null;

export type DaemonServiceProcessCommand = {
  action: "run" | "start";
  mode: DaemonServiceProcessMode;
};

export function tokenizeDaemonCommand(command: string): string[] {
  const tokens: string[] = [];
  for (const match of command.matchAll(COMMAND_TOKEN_PATTERN)) {
    const token = match[1] ?? match[2] ?? match[3];
    if (token) {
      tokens.push(token);
    }
  }
  return tokens;
}

export function normalizeDaemonCommandPath(path: string): string {
  return path.trim().replaceAll("\\", "/").toLowerCase();
}

export function daemonCommandContainsExactPath(
  command: string,
  path: string
): boolean {
  const normalizedCommand = normalizeDaemonCommandPath(command);
  const normalizedPath = normalizeDaemonCommandPath(path);
  let pathIndex = normalizedCommand.indexOf(normalizedPath);

  while (pathIndex >= 0) {
    const beforePath = normalizedCommand[pathIndex - 1];
    const afterPath = normalizedCommand[pathIndex + normalizedPath.length];
    if (
      isCommandArgumentBoundary(beforePath) &&
      isCommandArgumentBoundary(afterPath)
    ) {
      return true;
    }
    pathIndex = normalizedCommand.indexOf(
      normalizedPath,
      pathIndex + normalizedPath.length
    );
  }

  return false;
}

export function extractDaemonCommandEntryPath(
  command: string,
  pathInput: OpenMeldPathResolutionInput = {}
): string | null {
  const unquotedWrapperPath = extractUnquotedDaemonWrapperPath(
    command,
    pathInput
  );
  if (unquotedWrapperPath) {
    return unquotedWrapperPath;
  }

  const tokens = tokenizeDaemonCommand(command);
  if (tokens.length === 0) {
    return null;
  }
  const serviceRunIndex = findDaemonServiceCommandIndex(tokens);
  const candidateTokens =
    serviceRunIndex > 0 ? tokens.slice(0, serviceRunIndex) : tokens;

  for (let index = candidateTokens.length - 1; index >= 0; index -= 1) {
    const token = candidateTokens[index];
    if (!(token && looksLikeDaemonEntryPath(token, pathInput))) {
      continue;
    }
    return token;
  }

  return null;
}

export function isDaemonRuntimeProcessCommand(command: string): boolean {
  const serviceCommand = parseDaemonServiceProcessCommand(command);
  return (
    serviceCommand?.action === "run" ||
    (serviceCommand?.action === "start" && serviceCommand.mode === "foreground")
  );
}

export function parseDaemonServiceProcessCommand(
  command: string
): DaemonServiceProcessCommand | null {
  const tokens = tokenizeDaemonCommand(command).map((token) =>
    token.toLowerCase()
  );
  const serviceCommandIndex = findDaemonServiceCommandIndex(tokens);
  if (serviceCommandIndex < 0) {
    return null;
  }

  const action = tokens[serviceCommandIndex + 1];
  if (action !== "run" && action !== "start") {
    return null;
  }

  return {
    action,
    mode: resolveDaemonServiceProcessMode(
      tokens.slice(serviceCommandIndex + 2)
    ),
  };
}

export function resolveDaemonBundleIdFromEntryPath(
  entryPath: string,
  pathInput: OpenMeldPathResolutionInput = {}
): string | null {
  const normalizedEntryPath = normalizeDaemonCommandPath(entryPath);
  const normalizedBundleRoot = `${normalizeDaemonCommandPath(
    daemonRuntimeBundlesPath(pathInput)
  )}/`;
  if (!normalizedEntryPath.startsWith(normalizedBundleRoot)) {
    return null;
  }
  const relative = normalizedEntryPath.slice(normalizedBundleRoot.length);
  const bundleId = relative.split("/")[0];
  return bundleId && bundleId.length > 0 ? bundleId : null;
}

function looksLikeDaemonEntryPath(
  token: string,
  pathInput: OpenMeldPathResolutionInput
): boolean {
  return (
    token.includes("/bundles/") ||
    token.includes("openmeld/dist/openmeld.js") ||
    token.endsWith("/openmeld.js") ||
    token.endsWith("/openmeld-dev.js") ||
    token.endsWith("/daemon-service-launcher.mjs") ||
    isRecognizedDaemonServiceExecutableWrapperPath(token, pathInput) ||
    isOpenMeldManagedBinaryPath(token, pathInput)
  );
}

function findDaemonServiceCommandIndex(tokens: readonly string[]): number {
  return tokens.findIndex(
    (token, index) =>
      token === "service" &&
      (tokens[index + 1] === "run" || tokens[index + 1] === "start")
  );
}

function resolveDaemonServiceProcessMode(
  serviceArguments: readonly string[]
): DaemonServiceProcessMode {
  let mode: DaemonServiceProcessMode = null;
  for (let index = 0; index < serviceArguments.length; index += 1) {
    const argument = serviceArguments[index];
    let modeValue: string | undefined;
    if (argument === "--mode") {
      modeValue = serviceArguments[index + 1];
    } else if (argument?.startsWith("--mode=")) {
      modeValue = argument.slice("--mode=".length);
    }
    if (modeValue === "foreground" || modeValue === "background") {
      mode = modeValue;
    }
  }
  return mode;
}

function isRecognizedDaemonServiceExecutableWrapperPath(
  token: string,
  pathInput: OpenMeldPathResolutionInput
): boolean {
  const normalizedToken = normalizeDaemonCommandPath(token);
  return daemonServiceRecognizedExecutablePaths(pathInput).some(
    (wrapperPath) => {
      const normalizedWrapperPath = normalizeDaemonCommandPath(wrapperPath);
      return (
        normalizedToken === normalizedWrapperPath ||
        normalizedToken.endsWith(
          `/${normalizeDaemonCommandPath(basename(wrapperPath))}`
        )
      );
    }
  );
}

function extractUnquotedDaemonWrapperPath(
  command: string,
  pathInput: OpenMeldPathResolutionInput
): string | null {
  const normalizedCommand = normalizeDaemonCommandPath(command);
  const serviceRunIndex = normalizedCommand.indexOf(" service run");
  if (serviceRunIndex <= 0) {
    return null;
  }

  const commandPrefix = command.slice(0, serviceRunIndex);
  const normalizedPrefix = normalizedCommand.slice(0, serviceRunIndex);
  for (const wrapperPath of daemonServiceRecognizedExecutablePaths(pathInput)) {
    const normalizedWrapperPath = normalizeDaemonCommandPath(wrapperPath);
    const wrapperPathIndex = normalizedPrefix.lastIndexOf(
      normalizedWrapperPath
    );
    if (
      wrapperPathIndex >= 0 &&
      daemonCommandContainsExactPath(commandPrefix, wrapperPath)
    ) {
      return commandPrefix.slice(
        wrapperPathIndex,
        wrapperPathIndex + normalizedWrapperPath.length
      );
    }

    const wrapperName = basename(wrapperPath);
    if (!wrapperName.includes(" ")) {
      continue;
    }
    const normalizedSuffix = `/${normalizeDaemonCommandPath(wrapperName)}`;
    const wrapperNameIndex = normalizedPrefix.lastIndexOf(normalizedSuffix);
    if (
      wrapperNameIndex < 0 ||
      wrapperNameIndex + normalizedSuffix.length !== normalizedPrefix.length
    ) {
      continue;
    }
    return commandPrefix.slice(0, wrapperNameIndex + normalizedSuffix.length);
  }
  return null;
}

function isCommandArgumentBoundary(char: string | undefined): boolean {
  return (
    char === undefined ||
    char === "'" ||
    char === '"' ||
    COMMAND_ARGUMENT_BOUNDARY_PATTERN.test(char)
  );
}
