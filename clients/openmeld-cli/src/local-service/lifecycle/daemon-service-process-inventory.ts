import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import process from "node:process";
import { daemonRuntimeRootPath } from "../../config/daemon-state";
import {
  OPENMELD_HOME_ENV_KEY,
  type OpenMeldEnvPreset,
  type OpenMeldPathResolutionInput,
  resolveOpenMeldEnvPreset,
  resolveOpenMeldRootDir,
} from "../../config/paths";
import {
  containsOpenMeldManagedBinaryPath,
  resolveOpenMeldManagedVersionBinaryRootPath,
} from "./daemon-managed-binary-path";
import {
  daemonServiceLauncherPath,
  daemonServiceRecognizedExecutablePaths,
} from "./daemon-service-bundle";
import {
  type DaemonServiceProcessMode,
  daemonCommandContainsExactPath,
  extractDaemonCommandEntryPath,
  isDaemonRuntimeProcessCommand,
  parseDaemonServiceProcessCommand,
  tokenizeDaemonCommand,
} from "./daemon-service-command-path";
import { resolveDaemonServiceIdentity } from "./daemon-service-identity";

export type DaemonOwnedProcess = {
  pid: number;
  parentPid: number | null;
  command: string;
  mode: DaemonServiceProcessMode;
  ownership: "stable_launcher" | "legacy_detached" | "cli_direct" | "unknown";
};

type ListedProcess = {
  pid: number;
  parentPid: number | null;
  command: string;
};

const POSIX_PROCESS_LINE_PATTERN = /^(\d+)\s+(\d+)\s+(.+)$/;
const TRAILING_PATH_SEPARATOR_PATTERN = /\/+$/u;
const OPENMELD_PACKAGE_INSTALL_ENTRY_SEGMENT =
  "/node_modules/openmeld/dist/openmeld.js";
const OPENMELD_DEV_LOCAL_ENTRY_SEGMENT = "/openmeld-dev.js";
const ALL_OPENMELD_ENV_PRESETS = [
  "prod",
  "dev-local",
  "canary",
] as const satisfies readonly OpenMeldEnvPreset[];
const DAEMON_BIN_COMMAND_PATTERN_BY_PRESET = {
  prod: buildOpenMeldBinCommandPatternForPreset("prod"),
  "dev-local": buildOpenMeldBinCommandPatternForPreset("dev-local"),
  canary: buildOpenMeldBinCommandPatternForPreset("canary"),
} as const satisfies Record<OpenMeldEnvPreset, RegExp>;

export async function listDaemonOwnedProcesses(
  overrides: {
    listProcesses?: () => Promise<ListedProcess[]>;
    ignoreProcessIds?: Iterable<number>;
    pathInput?: OpenMeldPathResolutionInput;
  } = {}
): Promise<DaemonOwnedProcess[]> {
  const listProcesses =
    overrides.listProcesses ?? listProcessesForCurrentPlatform;
  const ignoredProcessIds = new Set(
    Array.from(overrides.ignoreProcessIds ?? []).filter(
      (pid): pid is number => Number.isInteger(pid) && pid > 0
    )
  );
  const processes = await listProcesses();
  const ownedProcesses = processes
    .map((processInfo) =>
      classifyDaemonOwnedProcess(
        processInfo,
        ignoredProcessIds,
        overrides.pathInput
      )
    )
    .filter(
      (processInfo): processInfo is DaemonOwnedProcess => processInfo !== null
    );
  return collapseLauncherWrapperProcesses(ownedProcesses);
}

function classifyDaemonOwnedProcess(
  processInfo: ListedProcess,
  ignoredProcessIds: ReadonlySet<number>,
  pathInput: OpenMeldPathResolutionInput = {}
): DaemonOwnedProcess | null {
  if (ignoredProcessIds.has(processInfo.pid)) {
    return null;
  }
  const normalizedCommand = normalizeProcessCommand(processInfo.command);
  const isRuntimeProcess = isDaemonRuntimeProcessCommand(normalizedCommand);
  const isLegacyDetachedProcess = normalizedCommand.includes("legacy-detached");
  if (!(isRuntimeProcess || isLegacyDetachedProcess)) {
    return null;
  }
  const launcherPath = normalizeProcessCommand(
    daemonServiceLauncherPath(pathInput)
  );
  const wrapperPaths = daemonServiceRecognizedExecutablePaths(pathInput).map(
    normalizeProcessCommand
  );
  if (
    wrapperPaths.some(
      (wrapperPath) =>
        normalizedCommand.includes(wrapperPath) &&
        !daemonCommandContainsExactPath(normalizedCommand, wrapperPath)
    )
  ) {
    return null;
  }
  if (
    !looksLikeCurrentLaneDaemonCandidate({
      launcherPath,
      normalizedCommand,
      wrapperPaths,
    })
  ) {
    return null;
  }
  if (
    resolveDaemonCommandLaneScope({
      launcherPath,
      normalizedCommand,
      pathInput,
    }) !== "current_lane"
  ) {
    return null;
  }
  const ownership = resolveDaemonProcessOwnership(
    normalizedCommand,
    launcherPath,
    wrapperPaths,
    pathInput
  );
  const mode =
    parseDaemonServiceProcessCommand(normalizedCommand)?.mode ?? null;
  return {
    pid: processInfo.pid,
    parentPid: processInfo.parentPid,
    command: processInfo.command,
    mode,
    ownership,
  };
}

async function listProcessesForCurrentPlatform(): Promise<ListedProcess[]> {
  if (process.platform === "win32") {
    return await listWindowsProcesses();
  }
  return await listPosixProcesses();
}

async function listPosixProcesses(): Promise<ListedProcess[]> {
  const output = await runCommand("ps", ["-axo", "pid=,ppid=,command="]);
  const processes: ListedProcess[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const match = trimmed.match(POSIX_PROCESS_LINE_PATTERN);
    if (!(match?.[1] && match[2] && match[3])) {
      continue;
    }
    processes.push({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      command: match[3],
    });
  }
  return processes;
}

function resolveDaemonProcessOwnership(
  normalizedCommand: string,
  launcherPath: string,
  wrapperPaths: readonly string[],
  pathInput: OpenMeldPathResolutionInput
): DaemonOwnedProcess["ownership"] {
  const isRuntimeProcess = isDaemonRuntimeProcessCommand(normalizedCommand);
  if (
    normalizedCommand.includes(launcherPath) ||
    wrapperPaths.some((wrapperPath) =>
      daemonCommandContainsExactPath(normalizedCommand, wrapperPath)
    ) ||
    (isRuntimeProcess &&
      containsOpenMeldManagedBinaryPath(normalizedCommand, pathInput))
  ) {
    return "stable_launcher";
  }
  if (normalizedCommand.includes("legacy-detached")) {
    return "legacy_detached";
  }
  if (isRuntimeProcess) {
    return "cli_direct";
  }
  return "unknown";
}

function looksLikeCurrentLaneDaemonCandidate(input: {
  normalizedCommand: string;
  launcherPath: string;
  wrapperPaths: readonly string[];
}): boolean {
  return (
    isDaemonRuntimeProcessCommand(input.normalizedCommand) ||
    input.normalizedCommand.includes(input.launcherPath) ||
    input.wrapperPaths.some((wrapperPath) =>
      daemonCommandContainsExactPath(input.normalizedCommand, wrapperPath)
    ) ||
    input.normalizedCommand.includes("legacy-detached")
  );
}

function resolveDaemonCommandLaneScope(input: {
  normalizedCommand: string;
  launcherPath: string;
  pathInput: OpenMeldPathResolutionInput;
}): "current_lane" | "other_lane" | "not_openmeld" {
  const managedVersionRoot = resolveDaemonCommandManagedVersionRoot(
    input.normalizedCommand
  );
  if (managedVersionRoot) {
    const currentRoot = normalizeRootPath(
      resolveOpenMeldRootDir(input.pathInput)
    );
    return managedVersionRoot === currentRoot ? "current_lane" : "other_lane";
  }

  const currentLane = resolveOpenMeldEnvPreset(input.pathInput);
  const managedLane = resolveManagedDaemonPathLane({
    normalizedCommand: input.normalizedCommand,
    pathInput: input.pathInput,
  });
  if (managedLane) {
    return managedLane === currentLane ? "current_lane" : "other_lane";
  }

  if (hasExplicitOpenMeldHome(input.pathInput)) {
    return "not_openmeld";
  }

  const detectedLane = resolveDaemonCliCommandLane(
    input.normalizedCommand,
    input.pathInput
  );
  if (!detectedLane) {
    return "not_openmeld";
  }
  return detectedLane === currentLane ? "current_lane" : "other_lane";
}

function hasExplicitOpenMeldHome(
  pathInput: OpenMeldPathResolutionInput
): boolean {
  const value = (pathInput.env ?? process.env)[OPENMELD_HOME_ENV_KEY];
  return typeof value === "string" && value.trim().length > 0;
}

function resolveDaemonCommandManagedVersionRoot(
  normalizedCommand: string
): string | null {
  for (const token of tokenizeDaemonCommand(normalizedCommand)) {
    const rootPath = resolveOpenMeldManagedVersionBinaryRootPath(token);
    if (rootPath) {
      return normalizeRootPath(rootPath);
    }
  }
  return null;
}

function resolveManagedDaemonPathLane(input: {
  normalizedCommand: string;
  pathInput: OpenMeldPathResolutionInput;
}): OpenMeldEnvPreset | null {
  const currentPreset = resolveOpenMeldEnvPreset(input.pathInput);
  for (const preset of ALL_OPENMELD_ENV_PRESETS) {
    const lanePathInput = resolveLanePathInput(input.pathInput, preset);
    const laneLauncherPath = normalizeProcessCommand(
      daemonServiceLauncherPath(lanePathInput)
    );
    const laneWrapperPaths = daemonServiceRecognizedExecutablePaths(
      lanePathInput
    ).map(normalizeProcessCommand);
    const laneRuntimeRoot = normalizeProcessCommand(
      daemonRuntimeRootPath(lanePathInput)
    );
    const laneEntryPath = extractDaemonCommandEntryPath(
      input.normalizedCommand,
      lanePathInput
    );
    const laneExecutableNames = laneWrapperPaths.map((candidatePath) =>
      basename(candidatePath)
    );
    if (
      input.normalizedCommand.includes(laneLauncherPath) ||
      laneWrapperPaths.some((wrapperPath) =>
        daemonCommandContainsExactPath(input.normalizedCommand, wrapperPath)
      ) ||
      (preset !== currentPreset &&
        laneEntryPath !== null &&
        laneExecutableNames.includes(
          normalizeProcessCommand(basename(laneEntryPath))
        )) ||
      input.normalizedCommand.includes(laneRuntimeRoot) ||
      containsOpenMeldManagedBinaryPath(input.normalizedCommand, lanePathInput)
    ) {
      return preset;
    }
  }
  return null;
}

function resolveDaemonCliCommandLane(
  normalizedCommand: string,
  pathInput: OpenMeldPathResolutionInput
): OpenMeldEnvPreset | null {
  if (!isDaemonRuntimeProcessCommand(normalizedCommand)) {
    return null;
  }
  if (matchesDaemonCliLane(normalizedCommand, "dev-local", pathInput)) {
    return "dev-local";
  }
  if (matchesDaemonCliLane(normalizedCommand, "canary", pathInput)) {
    return "canary";
  }
  if (matchesDaemonCliLane(normalizedCommand, "prod", pathInput)) {
    return "prod";
  }
  return null;
}

function matchesDaemonCliLane(
  normalizedCommand: string,
  preset: OpenMeldEnvPreset,
  pathInput: OpenMeldPathResolutionInput
): boolean {
  if (DAEMON_BIN_COMMAND_PATTERN_BY_PRESET[preset].test(normalizedCommand)) {
    return true;
  }

  if (preset === "dev-local") {
    return normalizedCommand.includes(OPENMELD_DEV_LOCAL_ENTRY_SEGMENT);
  }

  const canaryPackageInstallRoot = resolveCanaryPackageInstallRoot(pathInput);
  if (preset === "canary") {
    return (
      normalizedCommand.includes(canaryPackageInstallRoot) ||
      normalizedCommand.includes(
        "/.local/share/openmeld-canary/package-install/"
      )
    );
  }

  return (
    normalizedCommand.includes(OPENMELD_PACKAGE_INSTALL_ENTRY_SEGMENT) &&
    !normalizedCommand.includes(canaryPackageInstallRoot) &&
    !normalizedCommand.includes(
      "/.local/share/openmeld-canary/package-install/"
    ) &&
    !normalizedCommand.includes(OPENMELD_DEV_LOCAL_ENTRY_SEGMENT)
  );
}

function collapseLauncherWrapperProcesses(
  processes: DaemonOwnedProcess[]
): DaemonOwnedProcess[] {
  const launcherPidSet = new Set<number>();

  for (const processInfo of processes) {
    if (processInfo.ownership === "stable_launcher") {
      launcherPidSet.add(processInfo.pid);
    }
  }
  if (launcherPidSet.size === 0) {
    return processes;
  }

  const collapsedProcesses: DaemonOwnedProcess[] = [];
  for (const processInfo of processes) {
    if (processInfo.ownership === "stable_launcher") {
      const hasManagedChild = processes.some(
        (candidate) =>
          candidate.pid !== processInfo.pid &&
          candidate.parentPid === processInfo.pid &&
          candidate.ownership !== "stable_launcher"
      );
      if (hasManagedChild) {
        continue;
      }
      collapsedProcesses.push(processInfo);
      continue;
    }

    if (
      processInfo.parentPid !== null &&
      launcherPidSet.has(processInfo.parentPid)
    ) {
      collapsedProcesses.push({
        ...processInfo,
        ownership:
          processInfo.ownership === "unknown"
            ? processInfo.ownership
            : "stable_launcher",
      });
      continue;
    }

    collapsedProcesses.push(processInfo);
  }

  return collapsedProcesses;
}

async function listWindowsProcesses(): Promise<ListedProcess[]> {
  const script =
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress";
  const output = await runCommand("powershell", [
    "-NoProfile",
    "-Command",
    script,
  ]);
  const parsed = JSON.parse(output) as
    | Array<{
        ProcessId?: number;
        ParentProcessId?: number;
        CommandLine?: string | null;
      }>
    | {
        ProcessId?: number;
        ParentProcessId?: number;
        CommandLine?: string | null;
      };
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const processes: ListedProcess[] = [];
  for (const row of rows) {
    if (
      typeof row.ProcessId !== "number" ||
      typeof row.ParentProcessId !== "number" ||
      typeof row.CommandLine !== "string" ||
      row.CommandLine.trim().length === 0
    ) {
      continue;
    }
    processes.push({
      pid: row.ProcessId,
      parentPid: row.ParentProcessId,
      command: row.CommandLine,
    });
  }
  return processes;
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `process inventory command failed: ${command} ${args.join(" ")} ${stderr.trim()}`
          )
        );
        return;
      }
      resolve(stdout);
    });
  });
}

function buildOpenMeldBinCommandPatternForPreset(
  preset: OpenMeldEnvPreset
): RegExp {
  const aliases = resolveDaemonServiceIdentity({
    env: {
      OPENMELD_ENV_PRESET: preset,
    },
  }).cliEntryAliases.map(escapeRegex);
  return new RegExp(
    `(^|[\\s\\/])(${aliases.join("|")})(?:\\.cmd|\\.exe|\\.js)?(?=\\s|$)`,
    "u"
  );
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveCanaryPackageInstallRoot(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return normalizeProcessCommand(
    join(
      pathInput.homeDir ?? homedir(),
      ".local",
      "share",
      "openmeld-canary",
      "package-install"
    )
  );
}

function resolveLanePathInput(
  pathInput: OpenMeldPathResolutionInput,
  preset: OpenMeldEnvPreset
): OpenMeldPathResolutionInput {
  const currentPreset = resolveOpenMeldEnvPreset(pathInput);
  const env: NodeJS.ProcessEnv = {
    ...(pathInput.env ?? process.env),
    OPENMELD_ENV_PRESET: preset,
  };
  if (preset !== currentPreset && env[OPENMELD_HOME_ENV_KEY]) {
    delete env[OPENMELD_HOME_ENV_KEY];
  }
  return {
    ...pathInput,
    env,
  };
}

function normalizeProcessCommand(command: string): string {
  return command.trim().toLowerCase().replaceAll("\\", "/");
}

function normalizeRootPath(path: string): string {
  const normalized = normalizeProcessCommand(path);
  return normalized === "/"
    ? normalized
    : normalized.replace(TRAILING_PATH_SEPARATOR_PATTERN, "");
}
