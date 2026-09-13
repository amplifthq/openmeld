import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { WindowsUserTaskRequest } from "@openmeld/schemas";
import { sleep } from "@openmeld/utils";
import type { DaemonServiceController } from "../../config/daemon-state";
import { daemonRuntimeRootPath } from "../../config/daemon-state";
import type { OpenMeldEnvironmentTarget } from "../../config/openmeld-environment-target";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
import {
  resolveOpenMeldEnvPreset,
  resolveOpenMeldRootDir,
} from "../../config/paths";
import { assertSafePublishedProductionServiceRegistrationMutation } from "../../config/published-production-safety";
import { resolveDaemonServiceIdentity } from "./daemon-service-identity";
import {
  readWindowsTaskAction,
  runWindowsUserTask,
  windowsPowerShellPath,
  windowsTaskActionArguments,
} from "./windows-user-task";

export type RunCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunCommandOptions = {
  args: string[];
  command: string;
  env?: NodeJS.ProcessEnv;
  throwOnError?: boolean;
};

export type DaemonServiceCommandSpec = {
  executable: string;
  args: string[];
  env: Record<string, string>;
  workingDirectory?: string;
};

export type DaemonServiceManagerRuntimeStatus = {
  installed: boolean;
  running: boolean;
  enabled: boolean;
  definitionPath?: string | null;
  commandSummary?: string | null;
  /** Native launch action when the supervisor does not use a definition file. */
  commandSpec?: DaemonServiceCommandSpec;
  /**
   * The OpenMeld backend target persisted in the OS service definition.
   * `undefined` is reserved for older/custom manager implementations that do
   * not expose this observation; `null` means the definition was readable but
   * did not contain one complete, valid target.
   */
  environmentTarget?: OpenMeldEnvironmentTarget | null;
};

export type DaemonServiceJobDiagnostics = {
  controller: DaemonServiceController;
  /** The service definition is loaded in the OS service manager domain. */
  loaded: boolean;
  /** How many times the OS service manager spawned the process since load. */
  runs: number | null;
  state: string | null;
  /** Raw last-exit text as reported, e.g. "(never exited)" or "78". */
  lastExitCodeText: string | null;
  /** Numeric last exit code when the raw text is a plain integer. */
  lastExitCode: number | null;
  /** launchd marker for deferred non-demand startup; not proof of permission denial. */
  pendedNondemandSpawn: string | null;
  /** Job is configured to auto-start and stay alive (keepalive + runatload). */
  keepaliveRunAtLoad: boolean;
};

export type DaemonServiceManager = {
  controller: DaemonServiceController;
  /**
   * Installs or refreshes the supervisor definition without starting another
   * process. When the definition was absent, success means a fresh status
   * probe confirmed that it is installed and enabled. A failed install or
   * verification removes that newly created definition before rejecting.
   */
  install: (spec: DaemonServiceCommandSpec) => Promise<void>;
  uninstall: () => Promise<void>;
  enableAutostart: () => Promise<void>;
  disableAutostart: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  deactivate: () => Promise<void>;
  status: () => Promise<DaemonServiceManagerRuntimeStatus>;
  waitUntilAbsent: () => Promise<void>;
  waitUntilStopped: () => Promise<void>;
  waitUntilRunning: () => Promise<void>;
  /**
   * Controller-reported job-state evidence for startup failure diagnosis
   * (for launchd: `launchctl print` runs/state/last exit code/pended spawn).
   * Diagnostic evidence only; it must never feed availability, readiness,
   * or lifecycle decisions. Resolves null when the controller offers no
   * job-state evidence or the probe fails.
   */
  readJobDiagnostics?: () => Promise<DaemonServiceJobDiagnostics | null>;
};

/**
 * Disables autostart only when the OS definition is already committed.
 * Setup can run a candidate Service from its stable carrier before that
 * definition exists; the process can still be stopped without toggling it.
 */
export async function disableDaemonServiceAutostartIfConfigured(input: {
  manager: DaemonServiceManager;
  status: DaemonServiceManagerRuntimeStatus | null;
}): Promise<boolean> {
  if (!(input.status?.installed === true && input.status.enabled === true)) {
    return false;
  }
  await input.manager.disableAutostart();
  return true;
}

const SHELL_QUOTING_PATTERN = /[\s"\\]/g;
const SHELL_BACKSLASH_PATTERN = /\\/g;
const SHELL_DOUBLE_QUOTE_PATTERN = /"/g;
const WINDOWS_QUOTE_PATTERN = /"/g;
const XML_AMPERSAND_PATTERN = /&/g;
const XML_LESS_THAN_PATTERN = /</g;
const XML_GREATER_THAN_PATTERN = />/g;
const XML_DOUBLE_QUOTE_ESCAPE_PATTERN = /"/g;
const XML_SINGLE_QUOTE_PATTERN = /'/g;
const LAUNCHD_ENABLED_PATTERN = /enabled\s*=\s*(true|false)/i;
const LAUNCHD_STATE_PATTERN = /state\s*=\s*running/i;
const LAUNCHD_DISABLED_SERVICES_ENTRY_PATTERN =
  /"([^"]+)"\s*=>\s*(enabled|disabled)/i;
const LAUNCHD_STRING_PATTERN = /<string>([^<]+)<\/string>/g;
const LAUNCHD_SERVICE_PROCESS_TYPE = "Interactive";
const LAUNCHD_PROCESS_TYPE_PATTERN =
  /<key>ProcessType<\/key>\s*<string>([^<]+)<\/string>/;
const LAUNCHD_ENVIRONMENT_BLOCK_PATTERN =
  /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/;
const WINDOWS_LINE_SEPARATOR_PATTERN = /\r?\n/;
const WINDOWS_ENVIRONMENT_ASSIGNMENT_PATTERN = /^set "([^=]+)=(.*)"$/i;
const SYSTEMD_ACTIVE_STATES = new Set([
  "active",
  "reloading",
  "inactive",
  "failed",
  "activating",
  "deactivating",
  "maintenance",
  "unknown",
]);
const SYSTEMD_ENABLED_STATES = new Set([
  "enabled",
  "enabled-runtime",
  "linked",
  "linked-runtime",
  "alias",
  "masked",
  "masked-runtime",
  "static",
  "indirect",
  "generated",
  "transient",
  "disabled",
  "bad",
  "not-found",
]);
const LAUNCHD_ALREADY_PATTERN = /already/i;
const WINDOWS_SCRIPT_LINE_SPLIT_PATTERN = /\r?\n/u;
const LAUNCHD_SERVICE_NOT_FOUND_PATTERNS = [
  /could not find service/i,
  /service could not be found/i,
  /could not find domain/i,
] as const;
const LAUNCHD_PRINT_RUNS_PATTERN = /^\s*runs\s*=\s*(\d+)\s*$/m;
const LAUNCHD_PRINT_STATE_PATTERN = /^\s*state\s*=\s*(.+?)\s*$/m;
const LAUNCHD_PRINT_LAST_EXIT_CODE_PATTERN =
  /^\s*last exit code\s*=\s*(.+?)\s*$/m;
const LAUNCHD_PRINT_PENDED_NONDEMAND_SPAWN_PATTERN =
  /^\s*pended nondemand spawn\s*=\s*(.+?)\s*$/m;
const LAUNCHD_PRINT_PROPERTIES_PATTERN = /^\s*properties\s*=\s*(.+?)\s*$/m;
const LAUNCHD_PROPERTIES_KEEPALIVE_PATTERN = /\bkeepalive\b/i;
const LAUNCHD_PROPERTIES_RUNATLOAD_PATTERN = /\brunatload\b/i;
const INTEGER_TEXT_PATTERN = /^-?\d+$/;
const SYSTEM_SERVICE_WAIT_MS = 15_000;
const SYSTEM_SERVICE_POLL_MS = 200;

const QUOTED_XML_REPLACEMENT = "&quot;";
const APOSTROPHE_XML_REPLACEMENT = "&apos;";
const GREATER_XML_REPLACEMENT = "&gt;";
const LESS_XML_REPLACEMENT = "&lt;";
const AMPERSAND_XML_REPLACEMENT = "&amp;";

export function getDaemonSystemServiceLogPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    daemonRuntimeRootPath(pathInput),
    "logs",
    "daemon-system-service.log"
  );
}

export function getDaemonServiceLaunchdLabel(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return resolveDaemonServiceIdentity(pathInput).launchdLabel;
}

const SYSTEMD_CONTROLLER: DaemonServiceController = "systemd";
const LAUNCHD_CONTROLLER: DaemonServiceController = "launchd";
const WINDOWS_CONTROLLER: DaemonServiceController = "windows-service";
const DAEMON_SERVICE_RESTART_BACKOFF_SECONDS = 60;

export async function startLaunchdService(input: {
  serviceKey: string;
  guiDomain: string;
  plistPath: string;
  run?: (options: RunCommandOptions) => Promise<RunCommandResult>;
}): Promise<void> {
  const run = input.run ?? runCommand;
  const observed = await run({
    command: "launchctl",
    args: ["print", input.serviceKey],
    throwOnError: false,
  });
  if (observed.exitCode !== 0 && !isLaunchdServiceMissing(observed)) {
    throw buildServiceManagerProbeError("launchctl print", observed);
  }
  await run({
    command: "launchctl",
    args: ["enable", input.serviceKey],
    throwOnError: true,
  });
  // A loaded job must not be bootstrapped again: launchd can report EIO for
  // that case, which is not evidence that its registration needs replacing.
  if (observed.exitCode !== 0) {
    const bootstrap = await run({
      command: "launchctl",
      args: ["bootstrap", input.guiDomain, input.plistPath],
      throwOnError: false,
    });
    if (
      bootstrap.exitCode !== 0 &&
      !LAUNCHD_ALREADY_PATTERN.test(bootstrap.stderr)
    ) {
      throw new Error(
        `failed to start launchd service: ${bootstrap.stderr.trim() || bootstrap.stdout.trim()}`
      );
    }
  }
  // Registration/KeepAlive is not a demand start. Never use -k: an existing
  // healthy instance must survive repeated setup/start requests.
  await run({
    command: "launchctl",
    args: ["kickstart", input.serviceKey],
    throwOnError: true,
  });
}

async function runCommand(input: RunCommandOptions): Promise<RunCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: input.env ?? process.env,
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

    child.once("error", (error) => {
      if (input.throwOnError) {
        reject(error);
        return;
      }
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}${String(error)}`,
      });
    });

    child.once("close", (code) => {
      const exitCode = typeof code === "number" ? code : 1;
      if (input.throwOnError && exitCode !== 0) {
        reject(
          new Error(
            [
              `command failed: ${input.command} ${input.args.join(" ")}`,
              stdout.trim(),
              stderr.trim(),
            ]
              .filter(Boolean)
              .join(" | ")
          )
        );
        return;
      }
      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

// Thrown when a service-manager wait (running/stopped/absent) times out. On the
// launchd running path it carries the structured launchd job-state verdict so
// upstream lifecycle journaling can distinguish a never-spawned (Login Items
// blocked) job from a crash loop — matching the `openmeld service run` startup path.
// Diagnostic evidence only: jobDiagnostics must never gate lifecycle decisions.
export class DaemonServiceWaitTimeoutError extends Error {
  readonly jobDiagnostics: DaemonServiceJobDiagnostics | null;

  constructor(input: {
    message: string;
    jobDiagnostics?: DaemonServiceJobDiagnostics | null;
  }) {
    super(input.message);
    this.name = "DaemonServiceWaitTimeoutError";
    this.jobDiagnostics = input.jobDiagnostics ?? null;
  }
}

export function isDaemonServiceWaitTimeoutError(
  error: unknown
): error is DaemonServiceWaitTimeoutError {
  return error instanceof DaemonServiceWaitTimeoutError;
}

function buildSystemServiceWaitTimeoutError(input: {
  action: "absent" | "running" | "stopped";
  controller: DaemonServiceController;
  details?: string | null;
  jobDiagnostics?: DaemonServiceJobDiagnostics | null;
}): DaemonServiceWaitTimeoutError {
  const detailSuffix =
    input.details && input.details.trim().length > 0
      ? ` Last observed state: ${input.details.trim()}`
      : "";
  return new DaemonServiceWaitTimeoutError({
    message: `timed out waiting for ${input.controller} service to become ${input.action}.${detailSuffix}`,
    jobDiagnostics: input.jobDiagnostics ?? null,
  });
}

async function waitForCondition(input: {
  waitMs?: number;
  pollMs?: number;
  until: () => Promise<boolean>;
  onTimeout: () => Promise<Error> | Error;
}): Promise<void> {
  const deadline = Date.now() + (input.waitMs ?? SYSTEM_SERVICE_WAIT_MS);
  const pollMs = input.pollMs ?? SYSTEM_SERVICE_POLL_MS;
  while (Date.now() < deadline) {
    if (await input.until()) {
      return;
    }
    await sleep(pollMs);
  }
  throw await input.onTimeout();
}

function isLaunchdServiceMissing(result: RunCommandResult): boolean {
  if (result.exitCode === 0) {
    return false;
  }
  const output = `${result.stdout}\n${result.stderr}`;
  return LAUNCHD_SERVICE_NOT_FOUND_PATTERNS.some((pattern) =>
    pattern.test(output)
  );
}

export async function waitForLaunchdJobUnloaded(
  serviceKey: string
): Promise<void> {
  await waitForCondition({
    until: async () => {
      const result = await runCommand({
        command: "launchctl",
        args: ["print", serviceKey],
        throwOnError: false,
      });
      if (result.exitCode !== 0 && !isLaunchdServiceMissing(result)) {
        throw buildServiceManagerProbeError("launchctl print", result);
      }
      return isLaunchdServiceMissing(result);
    },
    onTimeout: () =>
      new Error(`Timed out waiting for launchd job ${serviceKey} to unload.`),
  });
}

function formatManagerStatusDetails(
  status: DaemonServiceManagerRuntimeStatus
): string {
  return `installed=${String(status.installed)} running=${String(status.running)} enabled=${String(status.enabled)}`;
}

function quoteShellValue(input: string): string {
  if (input === "") {
    return '""';
  }
  if (SHELL_QUOTING_PATTERN.test(input)) {
    return `"${input
      .replace(SHELL_BACKSLASH_PATTERN, "\\\\")
      .replace(SHELL_DOUBLE_QUOTE_PATTERN, '\\"')}"`;
  }
  return input;
}

function quoteWindowsArg(input: string): string {
  return `"${input.replace(WINDOWS_QUOTE_PATTERN, '\\"')}"`;
}

function escapeXmlText(input: string): string {
  return input
    .replace(XML_AMPERSAND_PATTERN, AMPERSAND_XML_REPLACEMENT)
    .replace(XML_LESS_THAN_PATTERN, LESS_XML_REPLACEMENT)
    .replace(XML_GREATER_THAN_PATTERN, GREATER_XML_REPLACEMENT)
    .replace(XML_DOUBLE_QUOTE_ESCAPE_PATTERN, QUOTED_XML_REPLACEMENT)
    .replace(XML_SINGLE_QUOTE_PATTERN, APOSTROPHE_XML_REPLACEMENT);
}

export function buildSystemdUnitFile(
  spec: DaemonServiceCommandSpec,
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  const serviceLogPath = getDaemonSystemServiceLogPath(pathInput);
  const command = [
    quoteShellValue(spec.executable),
    ...spec.args.map(quoteShellValue),
  ].join(" ");
  const workingDirectory = quoteShellValue(
    spec.workingDirectory ?? daemonRuntimeRootPath(pathInput)
  );
  const envRows = Object.entries(spec.env).map(
    ([key, value]) =>
      `Environment=${key}=${quoteSystemdEnvironmentValue(value)}`
  );
  return `# Managed by OpenMeld CLI
[Unit]
Description=OpenMeld Daemon Service
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${workingDirectory}
ExecStart=${command}
Restart=always
RestartSec=${DAEMON_SERVICE_RESTART_BACKOFF_SECONDS}
${envRows.join("\n")}
StandardOutput=append:${serviceLogPath}
StandardError=append:${serviceLogPath}

[Install]
WantedBy=default.target
`;
}

function quoteSystemdEnvironmentValue(value: string): string {
  return `"${value
    .replace(SHELL_BACKSLASH_PATTERN, "\\\\")
    .replace(SHELL_DOUBLE_QUOTE_PATTERN, '\\"')}"`;
}

function sanitizeLaunchdEnvironmentValue(value: string): string {
  return sanitizeControlCharacters(value);
}

function sanitizeControlCharacters(value: string): string {
  let sanitized = "";
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined) {
      continue;
    }
    if (code >= 0x00 && code <= 0x1f) {
      continue;
    }
    if (code === 0x7f) {
      continue;
    }
    sanitized += char;
  }
  return sanitized;
}

export function matchesLaunchdServiceStartupPolicy(
  definition: string
): boolean {
  return (
    LAUNCHD_PROCESS_TYPE_PATTERN.exec(definition)?.[1] ===
    LAUNCHD_SERVICE_PROCESS_TYPE
  );
}

/** Reads only the owned definition; callers report drift through existing diagnostics. */
export async function readDaemonServiceStartupPolicyCurrent(input: {
  controller: DaemonServiceController | null;
  status: DaemonServiceManagerRuntimeStatus | null;
}): Promise<boolean | null> {
  if (
    input.controller !== "launchd" ||
    !input.status?.installed ||
    !input.status.definitionPath
  ) {
    return null;
  }
  const definition = await readFile(input.status.definitionPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      // An uninstalled definition is not evidence of a scheduling-policy mismatch.
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  );
  return definition === null
    ? null
    : matchesLaunchdServiceStartupPolicy(definition);
}

export function buildLaunchdPlist(
  spec: DaemonServiceCommandSpec,
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  const serviceIdentity = resolveDaemonServiceIdentity(pathInput);
  const serviceLogPath = getDaemonSystemServiceLogPath(pathInput);
  const args = [spec.executable, ...spec.args]
    .map((value) => `    <string>${escapeXmlText(value)}</string>`)
    .join("\n");
  const workingDirectory = escapeXmlText(
    sanitizeLaunchdEnvironmentValue(
      spec.workingDirectory ?? daemonRuntimeRootPath(pathInput)
    )
  );
  const envRows = Object.entries(spec.env)
    .filter(([key, value]) => key.trim() !== "" && value !== "")
    .map(
      ([key, value]) =>
        `  <key>${escapeXmlText(key)}</key>\n  <string>${escapeXmlText(
          sanitizeLaunchdEnvironmentValue(value)
        )}</string>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${serviceIdentity.launchdLabel}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${workingDirectory}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>${LAUNCHD_SERVICE_PROCESS_TYPE}</string>
  <key>ThrottleInterval</key>
  <integer>${DAEMON_SERVICE_RESTART_BACKOFF_SECONDS}</integer>
  <key>EnvironmentVariables</key>
  <dict>
${envRows}
  </dict>
  <key>StandardOutPath</key>
  <string>${serviceLogPath}</string>
  <key>StandardErrorPath</key>
  <string>${serviceLogPath}</string>
</dict>
</plist>
`;
}

function resolveSystemdUnitPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  const serviceIdentity = resolveDaemonServiceIdentity(pathInput);
  return join(
    userInfo().homedir,
    ".config",
    "systemd",
    "user",
    `${serviceIdentity.serviceName}.service`
  );
}

function resolveLaunchdPlistPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  const serviceIdentity = resolveDaemonServiceIdentity(pathInput);
  return join(
    userInfo().homedir,
    "Library",
    "LaunchAgents",
    `${serviceIdentity.launchdLabel}.plist`
  );
}

function resolveWindowsServiceScriptPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  const serviceIdentity = resolveDaemonServiceIdentity(pathInput);
  return join(
    daemonRuntimeRootPath(pathInput),
    `${serviceIdentity.serviceName}-runner.bat`
  );
}

function parseRegexGroup(input: string, pattern: RegExp): string | null {
  const match = input.match(pattern);
  return match?.[1] ?? null;
}

function parseLaunchdEnabled(output: string): boolean {
  const value = parseRegexGroup(output, LAUNCHD_ENABLED_PATTERN);
  return value !== null && value.toLowerCase() === "true";
}

export function parseLaunchdServiceJobDiagnostics(
  printOutput: string
): DaemonServiceJobDiagnostics {
  const runsText = parseRegexGroup(printOutput, LAUNCHD_PRINT_RUNS_PATTERN);
  const lastExitCodeText = parseRegexGroup(
    printOutput,
    LAUNCHD_PRINT_LAST_EXIT_CODE_PATTERN
  );
  const propertiesText = parseRegexGroup(
    printOutput,
    LAUNCHD_PRINT_PROPERTIES_PATTERN
  );
  return {
    controller: LAUNCHD_CONTROLLER,
    loaded: true,
    runs: runsText === null ? null : Number.parseInt(runsText, 10),
    state: parseRegexGroup(printOutput, LAUNCHD_PRINT_STATE_PATTERN),
    lastExitCodeText,
    lastExitCode:
      lastExitCodeText !== null && INTEGER_TEXT_PATTERN.test(lastExitCodeText)
        ? Number.parseInt(lastExitCodeText, 10)
        : null,
    pendedNondemandSpawn: parseRegexGroup(
      printOutput,
      LAUNCHD_PRINT_PENDED_NONDEMAND_SPAWN_PATTERN
    ),
    keepaliveRunAtLoad:
      propertiesText !== null &&
      LAUNCHD_PROPERTIES_KEEPALIVE_PATTERN.test(propertiesText) &&
      LAUNCHD_PROPERTIES_RUNATLOAD_PATTERN.test(propertiesText),
  };
}

export function isDaemonServiceJobNeverSpawned(
  diagnostics: DaemonServiceJobDiagnostics
): boolean {
  return (
    diagnostics.loaded &&
    diagnostics.runs === 0 &&
    diagnostics.keepaliveRunAtLoad
  );
}

// A pending spawn is evidence of deferred startup, not of a denied permission.
// launchd also reports it when the GUI domain is in on-demand-only mode.
export function isDaemonServiceJobSpawnPending(
  diagnostics: DaemonServiceJobDiagnostics
): boolean {
  return (
    diagnostics.controller === LAUNCHD_CONTROLLER &&
    isDaemonServiceJobNeverSpawned(diagnostics) &&
    diagnostics.pendedNondemandSpawn !== null
  );
}

export function readDaemonServiceJobCrashExitCode(
  diagnostics: DaemonServiceJobDiagnostics
): number | null {
  if (!diagnostics.loaded) {
    return null;
  }
  if (diagnostics.runs === null || diagnostics.runs <= 0) {
    return null;
  }
  if (diagnostics.lastExitCode === null || diagnostics.lastExitCode === 0) {
    return null;
  }
  return diagnostics.lastExitCode;
}

export function formatDaemonServiceJobDiagnosticsEvidence(
  diagnostics: DaemonServiceJobDiagnostics
): string {
  if (!diagnostics.loaded) {
    return `${diagnostics.controller} job: not loaded`;
  }
  const parts = [
    `state=${diagnostics.state ?? "unknown"}`,
    `runs=${diagnostics.runs ?? "unknown"}`,
    `last exit code=${diagnostics.lastExitCodeText ?? "unknown"}`,
    ...(diagnostics.pendedNondemandSpawn
      ? [`pended nondemand spawn=${diagnostics.pendedNondemandSpawn}`]
      : []),
    ...(diagnostics.keepaliveRunAtLoad
      ? ["properties=keepalive|runatload"]
      : []),
  ];
  return `${diagnostics.controller} job: ${parts.join(", ")}`;
}

function parseLaunchdEnabledFromDisabledServices(
  output: string,
  label: string
): boolean | null {
  const lines = output.split("\n");
  for (const line of lines) {
    const match = line.match(LAUNCHD_DISABLED_SERVICES_ENTRY_PATTERN);
    if (!match) {
      continue;
    }
    const serviceLabel = match[1];
    const state = match[2];
    if (!(serviceLabel && state) || serviceLabel !== label) {
      continue;
    }
    return state.toLowerCase() === "enabled";
  }
  return null;
}

export async function installMissingServiceDefinitionFailAtomically(input: {
  definitionWasPresent: boolean;
  install: () => Promise<void>;
  rollbackNewDefinition: () => Promise<void>;
  verifyNewDefinition: () => Promise<void>;
}): Promise<void> {
  try {
    await input.install();
    await input.verifyNewDefinition();
  } catch (installError) {
    if (input.definitionWasPresent) {
      throw installError;
    }
    try {
      await input.rollbackNewDefinition();
    } catch (rollbackError) {
      throw new AggregateError(
        [installError, rollbackError],
        "service registration install failed and its new definition could not be rolled back"
      );
    }
    throw installError;
  }
}

export function readSystemdServiceActiveProbe(
  result: RunCommandResult
): boolean {
  const state = result.stdout.trim().toLowerCase();
  if (!SYSTEMD_ACTIVE_STATES.has(state)) {
    throw buildServiceManagerProbeError("systemctl is-active", result);
  }
  return state === "active" || state === "reloading";
}

export function readSystemdServiceEnabledProbe(
  result: RunCommandResult
): boolean {
  const state = result.stdout.trim().toLowerCase();
  if (!SYSTEMD_ENABLED_STATES.has(state)) {
    throw buildServiceManagerProbeError("systemctl is-enabled", result);
  }
  return state === "enabled" || state === "enabled-runtime";
}

export function assertServiceManagerProbeSucceeded(
  probe: string,
  result: RunCommandResult
): void {
  if (result.exitCode !== 0) {
    throw buildServiceManagerProbeError(probe, result);
  }
}

function buildServiceManagerProbeError(
  probe: string,
  result: RunCommandResult
): Error {
  return new Error(
    [
      `${probe} probe failed`,
      `exitCode=${result.exitCode}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ]
      .filter(Boolean)
      .join(" | ")
  );
}

export async function runServiceDefinitionRollbackSteps(
  steps: ReadonlyArray<() => Promise<unknown>>
): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "one or more service registration rollback steps failed"
    );
  }
}

function assertServiceRegistrationInstalledAndEnabled(
  controller: DaemonServiceController,
  status: DaemonServiceManagerRuntimeStatus
): void {
  if (status.installed && status.enabled) {
    return;
  }
  throw new Error(
    `${controller} service registration install did not restore an installed, enabled registration`
  );
}

function buildSystemdManager(
  pathInput: OpenMeldPathResolutionInput = {}
): DaemonServiceManager {
  const serviceIdentity = resolveDaemonServiceIdentity(pathInput);
  const unitPath = resolveSystemdUnitPath(pathInput);
  const unitName = `${serviceIdentity.serviceName}.service`;

  return {
    controller: SYSTEMD_CONTROLLER,
    install: async (spec) => {
      const definitionWasPresent = await pathExists(unitPath);
      await installMissingServiceDefinitionFailAtomically({
        definitionWasPresent,
        install: async () => {
          await ensureServiceLogDirectory(pathInput);
          await mkdir(dirname(unitPath), { recursive: true });
          await writeFile(unitPath, buildSystemdUnitFile(spec, pathInput), {
            encoding: "utf8",
            mode: 0o600,
          });
          await runCommand({
            command: "systemctl",
            args: ["--user", "daemon-reload"],
            throwOnError: true,
          });
          await runCommand({
            command: "systemctl",
            args: ["--user", "enable", unitName],
            throwOnError: true,
          });
          const user = process.env.USER || userInfo().username;
          await runCommand({
            command: "loginctl",
            args: ["enable-linger", user],
            throwOnError: false,
          });
        },
        rollbackNewDefinition: async () => {
          await runServiceDefinitionRollbackSteps([
            async () =>
              await runCommand({
                command: "systemctl",
                args: ["--user", "disable", unitName],
                throwOnError: true,
              }),
            async () => await rm(unitPath, { force: true }),
            async () =>
              await runCommand({
                command: "systemctl",
                args: ["--user", "daemon-reload"],
                throwOnError: true,
              }),
          ]);
        },
        verifyNewDefinition: async () => {
          const status = await buildSystemdManager(pathInput).status();
          assertServiceRegistrationInstalledAndEnabled(
            SYSTEMD_CONTROLLER,
            status
          );
        },
      });
    },
    uninstall: async () => {
      await runCommand({
        command: "systemctl",
        args: ["--user", "disable", "--now", unitName],
        throwOnError: false,
      });
      await rm(unitPath, { force: true });
      await runCommand({
        command: "systemctl",
        args: ["--user", "daemon-reload"],
        throwOnError: false,
      });
    },
    enableAutostart: async () => {
      if (!(await pathExists(unitPath))) {
        throw new Error("OpenMeld Service is not installed for systemd.");
      }
      await runCommand({
        command: "systemctl",
        args: ["--user", "enable", unitName],
        throwOnError: true,
      });
    },
    disableAutostart: async () => {
      if (!(await pathExists(unitPath))) {
        throw new Error("OpenMeld Service is not installed for systemd.");
      }
      await runCommand({
        command: "systemctl",
        args: ["--user", "disable", unitName],
        throwOnError: true,
      });
    },
    start: async () => {
      await runCommand({
        command: "systemctl",
        args: ["--user", "enable", "--now", unitName],
        throwOnError: true,
      });
    },
    stop: async () => {
      await runCommand({
        command: "systemctl",
        args: ["--user", "disable", "--now", unitName],
        throwOnError: true,
      });
    },
    deactivate: async () => {
      await runCommand({
        command: "systemctl",
        args: ["--user", "stop", unitName],
        throwOnError: false,
      });
    },
    status: async () => {
      const installed = await pathExists(unitPath);
      const activeResult = await runCommand({
        command: "systemctl",
        args: ["--user", "is-active", unitName],
        throwOnError: false,
      });
      const enabledResult = await runCommand({
        command: "systemctl",
        args: ["--user", "is-enabled", unitName],
        throwOnError: false,
      });
      return {
        installed,
        running: readSystemdServiceActiveProbe(activeResult),
        enabled: readSystemdServiceEnabledProbe(enabledResult),
        definitionPath: installed ? unitPath : null,
        commandSummary: installed
          ? await readSystemServiceCommandSummary(unitPath, "ExecStart=")
          : null,
        environmentTarget: installed
          ? await readDaemonServiceEnvironmentTargetFromDefinition({
              controller: SYSTEMD_CONTROLLER,
              path: unitPath,
            })
          : null,
      };
    },
    // systemd does not expose the launchd-style job spawn evidence yet.
    readJobDiagnostics: async () => null,
    waitUntilAbsent: async () => {
      await waitForCondition({
        until: async () => {
          const status = await buildSystemdManager(pathInput).status();
          return !(status.installed || status.running || status.enabled);
        },
        onTimeout: async () => {
          const status = await buildSystemdManager(pathInput).status();
          return buildSystemServiceWaitTimeoutError({
            action: "absent",
            controller: SYSTEMD_CONTROLLER,
            details: formatManagerStatusDetails(status),
          });
        },
      });
    },
    waitUntilStopped: async () => {
      await waitForCondition({
        until: async () =>
          !(await buildSystemdManager(pathInput).status()).running,
        onTimeout: async () => {
          const status = await buildSystemdManager(pathInput).status();
          return buildSystemServiceWaitTimeoutError({
            action: "stopped",
            controller: SYSTEMD_CONTROLLER,
            details: formatManagerStatusDetails(status),
          });
        },
      });
    },
    waitUntilRunning: async () => {
      await waitForCondition({
        until: async () =>
          (await buildSystemdManager(pathInput).status()).running,
        onTimeout: async () => {
          const status = await buildSystemdManager(pathInput).status();
          return buildSystemServiceWaitTimeoutError({
            action: "running",
            controller: SYSTEMD_CONTROLLER,
            details: formatManagerStatusDetails(status),
          });
        },
      });
    },
  };
}

function buildLaunchdManager(
  pathInput: OpenMeldPathResolutionInput = {}
): DaemonServiceManager {
  const serviceIdentity = resolveDaemonServiceIdentity(pathInput);
  const plistPath = resolveLaunchdPlistPath(pathInput);
  const guiDomain =
    process.getuid === undefined ? "gui/501" : `gui/${process.getuid()}`;
  const launchdServiceKey = `${guiDomain}/${serviceIdentity.launchdLabel}`;

  return {
    controller: LAUNCHD_CONTROLLER,
    install: async (spec) => {
      const definitionWasPresent = await pathExists(plistPath);
      await installMissingServiceDefinitionFailAtomically({
        definitionWasPresent,
        install: async () => {
          await ensureServiceLogDirectory(pathInput);
          await mkdir(dirname(plistPath), { recursive: true });
          await writeFile(plistPath, buildLaunchdPlist(spec, pathInput), {
            encoding: "utf8",
            mode: 0o644,
          });
          await chmod(plistPath, 0o644);
          await runCommand({
            command: "launchctl",
            args: ["enable", launchdServiceKey],
            throwOnError: true,
          });
        },
        rollbackNewDefinition: async () => {
          await runServiceDefinitionRollbackSteps([
            async () =>
              await runCommand({
                command: "launchctl",
                args: ["disable", launchdServiceKey],
                throwOnError: true,
              }),
            async () => await rm(plistPath, { force: true }),
          ]);
        },
        verifyNewDefinition: async () => {
          const status = await buildLaunchdManager(pathInput).status();
          assertServiceRegistrationInstalledAndEnabled(
            LAUNCHD_CONTROLLER,
            status
          );
        },
      });
    },
    uninstall: async () => {
      await runCommand({
        command: "launchctl",
        args: ["disable", launchdServiceKey],
        throwOnError: false,
      });
      await runCommand({
        command: "launchctl",
        args: ["bootout", launchdServiceKey],
        throwOnError: false,
      });
      await runCommand({
        command: "launchctl",
        args: ["remove", serviceIdentity.launchdLabel],
        throwOnError: false,
      });
      await rm(plistPath, { force: true });
    },
    enableAutostart: async () => {
      if (!(await pathExists(plistPath))) {
        throw new Error("OpenMeld Service is not installed for launchd.");
      }
      await runCommand({
        command: "launchctl",
        args: ["enable", launchdServiceKey],
        throwOnError: true,
      });
    },
    disableAutostart: async () => {
      if (!(await pathExists(plistPath))) {
        throw new Error("OpenMeld Service is not installed for launchd.");
      }
      await runCommand({
        command: "launchctl",
        args: ["disable", launchdServiceKey],
        throwOnError: true,
      });
    },
    start: async () => {
      await startLaunchdService({
        serviceKey: launchdServiceKey,
        guiDomain,
        plistPath,
      });
    },
    stop: async () => {
      await runCommand({
        command: "launchctl",
        args: ["disable", launchdServiceKey],
        throwOnError: false,
      });
      await runCommand({
        command: "launchctl",
        args: ["bootout", launchdServiceKey],
        throwOnError: false,
      });
    },
    deactivate: async () => {
      await runCommand({
        command: "launchctl",
        args: ["bootout", launchdServiceKey],
        throwOnError: false,
      });
    },
    status: async () => {
      const installed = await pathExists(plistPath);
      const printResult = await runCommand({
        command: "launchctl",
        args: ["print", launchdServiceKey],
        throwOnError: false,
      });
      const disabledResult = await runCommand({
        command: "launchctl",
        args: ["print-disabled", guiDomain],
        throwOnError: false,
      });
      if (printResult.exitCode !== 0 && !isLaunchdServiceMissing(printResult)) {
        throw buildServiceManagerProbeError("launchctl print", printResult);
      }
      assertServiceManagerProbeSucceeded(
        "launchctl print-disabled",
        disabledResult
      );
      const output = `${printResult.stdout}\n${printResult.stderr}`;
      const disabledOutput = `${disabledResult.stdout}\n${disabledResult.stderr}`;
      const enabledFromDisabledServices =
        parseLaunchdEnabledFromDisabledServices(
          disabledOutput,
          serviceIdentity.launchdLabel
        );
      return {
        installed,
        running: LAUNCHD_STATE_PATTERN.test(output),
        enabled: enabledFromDisabledServices ?? parseLaunchdEnabled(output),
        definitionPath: installed ? plistPath : null,
        commandSummary: installed
          ? await readLaunchdProgramArguments(plistPath)
          : null,
        environmentTarget: installed
          ? await readDaemonServiceEnvironmentTargetFromDefinition({
              controller: LAUNCHD_CONTROLLER,
              path: plistPath,
            })
          : null,
      };
    },
    readJobDiagnostics: async () => {
      const printResult = await runCommand({
        command: "launchctl",
        args: ["print", launchdServiceKey],
        throwOnError: false,
      });
      if (printResult.exitCode === 0) {
        return parseLaunchdServiceJobDiagnostics(
          `${printResult.stdout}\n${printResult.stderr}`
        );
      }
      if (isLaunchdServiceMissing(printResult)) {
        return {
          controller: LAUNCHD_CONTROLLER,
          loaded: false,
          runs: null,
          state: null,
          lastExitCodeText: null,
          lastExitCode: null,
          pendedNondemandSpawn: null,
          keepaliveRunAtLoad: false,
        };
      }
      return null;
    },
    waitUntilAbsent: async () => {
      await waitForCondition({
        until: async () => {
          const [installed, printResult] = await Promise.all([
            pathExists(plistPath),
            runCommand({
              command: "launchctl",
              args: ["print", launchdServiceKey],
              throwOnError: false,
            }),
          ]);
          return !installed && isLaunchdServiceMissing(printResult);
        },
        onTimeout: async () => {
          const status = await buildLaunchdManager(pathInput).status();
          return buildSystemServiceWaitTimeoutError({
            action: "absent",
            controller: LAUNCHD_CONTROLLER,
            details: formatManagerStatusDetails(status),
          });
        },
      });
    },
    waitUntilStopped: async () => {
      await waitForCondition({
        until: async () => {
          const result = await runCommand({
            command: "launchctl",
            args: ["print", launchdServiceKey],
            throwOnError: false,
          });
          if (result.exitCode !== 0 && !isLaunchdServiceMissing(result)) {
            throw buildServiceManagerProbeError("launchctl print", result);
          }
          return isLaunchdServiceMissing(result);
        },
        onTimeout: async () => {
          const status = await buildLaunchdManager(pathInput).status();
          return buildSystemServiceWaitTimeoutError({
            action: "stopped",
            controller: LAUNCHD_CONTROLLER,
            details: formatManagerStatusDetails(status),
          });
        },
      });
    },
    waitUntilRunning: async () => {
      await waitForCondition({
        until: async () =>
          (await buildLaunchdManager(pathInput).status()).running,
        onTimeout: async () => {
          const manager = buildLaunchdManager(pathInput);
          const status = await manager.status();
          // Diagnostic-only launchd job-state probe on timeout, mirroring the
          // `openmeld service run` startup path so the lifecycle journal can record a
          // never-spawned vs crash-loop verdict. Best-effort; never gates state.
          const jobDiagnostics = manager.readJobDiagnostics
            ? await manager.readJobDiagnostics().catch(() => null)
            : null;
          return buildSystemServiceWaitTimeoutError({
            action: "running",
            controller: LAUNCHD_CONTROLLER,
            details: formatManagerStatusDetails(status),
            jobDiagnostics,
          });
        },
      });
    },
  };
}

function buildWindowsManager(
  pathInput: OpenMeldPathResolutionInput = {}
): DaemonServiceManager {
  const identity = resolveDaemonServiceIdentity(pathInput);
  const scriptPath = resolveWindowsServiceScriptPath(pathInput);
  const task = (operation: WindowsUserTaskRequest["operation"]) =>
    runWindowsUserTask({
      name: identity.windowsServiceName,
      legacyScript: scriptPath,
      operation,
    });
  const status = async (): Promise<DaemonServiceManagerRuntimeStatus> => {
    const observed = await task("status");
    if (observed.actionArguments !== null) {
      const action = readWindowsTaskAction(observed.actionArguments);
      return {
        installed: observed.installed,
        running: observed.running,
        enabled: observed.enabled,
        definitionPath: `Task Scheduler: ${identity.windowsServiceName} (current user)`,
        commandSummary: [
          quoteWindowsArg(action.executable),
          ...action.args.map(quoteWindowsArg),
        ].join(" "),
        commandSpec: action,
        environmentTarget: serviceEnvironmentTarget(action.env),
      };
    }
    return {
      installed: observed.installed,
      running: observed.running,
      enabled: observed.enabled,
      definitionPath: observed.installed ? scriptPath : null,
      commandSummary: observed.installed
        ? await readWindowsRunnerCommandSummary(scriptPath)
        : null,
      environmentTarget: observed.installed
        ? await readDaemonServiceEnvironmentTargetFromDefinition({
            controller: WINDOWS_CONTROLLER,
            path: scriptPath,
          })
        : null,
    };
  };
  const wait = async (action: "absent" | "stopped" | "running") => {
    await waitForCondition({
      until: async () => {
        const current = await status();
        if (action === "running") {
          return current.running;
        }
        return action === "stopped" ? !current.running : !current.installed;
      },
      onTimeout: async () =>
        buildSystemServiceWaitTimeoutError({
          action,
          controller: WINDOWS_CONTROLLER,
          details: formatManagerStatusDetails(await status()),
        }),
    });
  };
  return {
    controller: WINDOWS_CONTROLLER,
    install: async (spec) => {
      await ensureServiceLogDirectory(pathInput);
      await runWindowsUserTask({
        name: identity.windowsServiceName,
        legacyScript: scriptPath,
        operation: "install",
        executable: windowsPowerShellPath(),
        arguments: windowsTaskActionArguments({
          ...spec,
          logPath: getDaemonSystemServiceLogPath(pathInput),
        }),
        workingDirectory:
          spec.workingDirectory ?? daemonRuntimeRootPath(pathInput),
      });
      assertServiceRegistrationInstalledAndEnabled(
        WINDOWS_CONTROLLER,
        await status()
      );
      await rm(scriptPath, { force: true });
    },
    uninstall: async () => {
      await task("uninstall");
      await rm(scriptPath, { force: true });
    },
    enableAutostart: async () => {
      await task("enable");
    },
    disableAutostart: async () => {
      await task("disable");
    },
    start: async () => {
      await task("enable");
      await task("start");
    },
    stop: async () => {
      await task("disable");
      await task("stop");
    },
    deactivate: async () => {
      await task("stop");
    },
    status,
    readJobDiagnostics: async () => null,
    waitUntilAbsent: () => wait("absent"),
    waitUntilStopped: () => wait("stopped"),
    waitUntilRunning: () => wait("running"),
  };
}

export async function readWindowsRunnerCommandSummary(
  path: string
): Promise<string | null> {
  const file = await readFile(path, "utf8").catch(() => null);
  if (!file) {
    return null;
  }
  const lines = file
    .split(WINDOWS_SCRIPT_LINE_SPLIT_PATTERN)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    const normalizedLine = line.toLowerCase();
    if (
      !(
        normalizedLine === "@echo off" ||
        normalizedLine === "setlocal" ||
        normalizedLine.startsWith("set ")
      )
    ) {
      return line;
    }
  }
  return null;
}

async function readSystemServiceCommandSummary(
  path: string,
  prefix: string
): Promise<string | null> {
  const file = await readFile(path, "utf8").catch(() => null);
  if (!file) {
    return null;
  }
  const line = file
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  if (!line) {
    return null;
  }
  return line.slice(prefix.length).trim() || null;
}

async function readLaunchdProgramArguments(
  path: string
): Promise<string | null> {
  const file = await readFile(path, "utf8").catch(() => null);
  if (!file) {
    return null;
  }
  const matches = [...file.matchAll(LAUNCHD_STRING_PATTERN)].map(
    (match) => match[1]
  );
  if (matches.length === 0) {
    return null;
  }
  return matches.join(" ");
}

const SERVICE_ENVIRONMENT_TARGET_KEYS = {
  preset: "OPENMELD_ENV_PRESET",
  gatewayUrl: "OPENMELD_GATEWAY_URL",
  authBaseUrl: "OPENMELD_AUTH_URL",
  userFacingCommand: "OPENMELD_USER_FACING_CLI_COMMAND",
} as const;

export function parseDaemonServiceEnvironmentTargetFromDefinition(input: {
  controller: DaemonServiceController;
  definition: string;
}): OpenMeldEnvironmentTarget | null {
  return serviceEnvironmentTarget(
    parseDaemonServiceEnvironmentFromDefinition(input)
  );
}

export function parseDaemonServiceEnvironmentFromDefinition(input: {
  controller: DaemonServiceController;
  definition: string;
}): Record<string, string> {
  if (input.controller === SYSTEMD_CONTROLLER) {
    return parseSystemdEnvironment(input.definition);
  }
  if (input.controller === LAUNCHD_CONTROLLER) {
    return parseLaunchdEnvironment(input.definition);
  }
  return parseWindowsEnvironment(input.definition);
}

function serviceEnvironmentTarget(
  environment: Record<string, string>
): OpenMeldEnvironmentTarget | null {
  const preset = environment[SERVICE_ENVIRONMENT_TARGET_KEYS.preset];
  const gatewayUrl = environment[SERVICE_ENVIRONMENT_TARGET_KEYS.gatewayUrl];
  const authBaseUrl = environment[SERVICE_ENVIRONMENT_TARGET_KEYS.authBaseUrl];
  const userFacingCommand =
    environment[SERVICE_ENVIRONMENT_TARGET_KEYS.userFacingCommand];
  if (
    !(
      (preset === "prod" || preset === "canary" || preset === "dev-local") &&
      gatewayUrl &&
      authBaseUrl &&
      userFacingCommand
    )
  ) {
    return null;
  }
  return {
    preset,
    gatewayUrl,
    authBaseUrl,
    userFacingCommand,
  };
}

async function readDaemonServiceEnvironmentTargetFromDefinition(input: {
  controller: DaemonServiceController;
  path: string;
}): Promise<OpenMeldEnvironmentTarget | null> {
  const definition = await readFile(input.path, "utf8").catch(() => null);
  if (!definition) {
    return null;
  }
  return parseDaemonServiceEnvironmentTargetFromDefinition({
    controller: input.controller,
    definition,
  });
}

function parseSystemdEnvironment(definition: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const rawLine of definition.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("Environment=")) {
      continue;
    }
    const assignment = line.slice("Environment=".length);
    const separatorIndex = assignment.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = assignment.slice(0, separatorIndex);
    let value = assignment.slice(separatorIndex + 1);
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    environment[key] = value;
  }
  return environment;
}

function parseLaunchdEnvironment(definition: string): Record<string, string> {
  const environmentBlock = definition.match(
    LAUNCHD_ENVIRONMENT_BLOCK_PATTERN
  )?.[1];
  if (!environmentBlock) {
    return {};
  }
  const environment: Record<string, string> = {};
  for (const match of environmentBlock.matchAll(
    /<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g
  )) {
    const key = decodeXmlText(match[1] ?? "");
    if (!key) {
      continue;
    }
    environment[key] = decodeXmlText(match[2] ?? "");
  }
  return environment;
}

function parseWindowsEnvironment(definition: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const rawLine of definition.split(WINDOWS_LINE_SEPARATOR_PATTERN)) {
    const match = rawLine.trim().match(WINDOWS_ENVIRONMENT_ASSIGNMENT_PATTERN);
    if (!(match?.[1] && match[2] !== undefined)) {
      continue;
    }
    environment[match[1]] = match[2].replace(/\\"/g, '"');
  }
  return environment;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function isSystemdAvailable(): Promise<boolean> {
  return runCommand({
    command: "systemctl",
    args: ["--user", "--version"],
    throwOnError: false,
  }).then((result) => result.exitCode === 0);
}

function isLaunchdAvailable(): Promise<boolean> {
  return runCommand({
    command: "launchctl",
    args: ["version"],
    throwOnError: false,
  }).then((result) => result.exitCode === 0);
}

function isWindowsTaskSchedulerAvailable(): Promise<boolean> {
  return runCommand({
    command: windowsPowerShellPath(),
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop'; $s=New-Object -ComObject Schedule.Service; $s.Connect()",
    ],
    throwOnError: false,
  }).then((result) => result.exitCode === 0);
}

async function ensureServiceLogDirectory(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await mkdir(dirname(getDaemonSystemServiceLogPath(pathInput)), {
    recursive: true,
  });
}

export function guardDaemonServiceManagerMutations(
  manager: DaemonServiceManager,
  pathInput: OpenMeldPathResolutionInput = {}
): DaemonServiceManager {
  const assertMutationAllowed = async (operation: string): Promise<void> => {
    assertSafePublishedProductionServiceRegistrationMutation(
      operation,
      pathInput
    );
    if (resolveOpenMeldEnvPreset(pathInput) !== "dev-local") {
      return;
    }
    const status = await manager.status();
    if (!status.installed) {
      return;
    }
    const env =
      status.commandSpec?.env ??
      (status.definitionPath
        ? parseDaemonServiceEnvironmentFromDefinition({
            controller: manager.controller,
            definition: await readFile(status.definitionPath, "utf8"),
          })
        : {});
    if (
      env.OPENMELD_ENV_PRESET !== "dev-local" ||
      !env.OPENMELD_HOME ||
      resolve(env.OPENMELD_HOME) !== resolve(resolveOpenMeldRootDir(pathInput))
    ) {
      throw new Error(
        `Cannot ${operation} OpenMeld Service: its registered development home does not match this environment.`
      );
    }
  };
  return {
    ...manager,
    install: async (spec) => {
      await assertMutationAllowed("install");
      await manager.install(spec);
    },
    uninstall: async () => {
      await assertMutationAllowed("uninstall");
      await manager.uninstall();
    },
    enableAutostart: async () => {
      await assertMutationAllowed("enable autostart for");
      await manager.enableAutostart();
    },
    disableAutostart: async () => {
      await assertMutationAllowed("disable autostart for");
      await manager.disableAutostart();
    },
    start: async () => {
      await assertMutationAllowed("start");
      await manager.start();
    },
    stop: async () => {
      await assertMutationAllowed("stop");
      await manager.stop();
    },
    deactivate: async () => {
      await assertMutationAllowed("deactivate");
      await manager.deactivate();
    },
  };
}

export async function resolveDaemonServiceManager(
  controller?: DaemonServiceController,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonServiceManager | null> {
  const manager = await resolveUnguardedDaemonServiceManager(
    controller,
    pathInput
  );
  return manager
    ? guardDaemonServiceManagerMutations(manager, pathInput)
    : null;
}

async function resolveUnguardedDaemonServiceManager(
  controller?: DaemonServiceController,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonServiceManager | null> {
  if (controller === SYSTEMD_CONTROLLER) {
    if (!(await isSystemdAvailable())) {
      return null;
    }
    return buildSystemdManager(pathInput);
  }
  if (controller === LAUNCHD_CONTROLLER) {
    if (!(await isLaunchdAvailable())) {
      return null;
    }
    return buildLaunchdManager(pathInput);
  }
  if (controller === WINDOWS_CONTROLLER) {
    if (!(await isWindowsTaskSchedulerAvailable())) {
      return null;
    }
    return buildWindowsManager(pathInput);
  }

  if (process.platform === "darwin") {
    if (!(await isLaunchdAvailable())) {
      return null;
    }
    return buildLaunchdManager(pathInput);
  }
  if (process.platform === "linux") {
    if (!(await isSystemdAvailable())) {
      return null;
    }
    return buildSystemdManager(pathInput);
  }
  if (process.platform === "win32") {
    if (!(await isWindowsTaskSchedulerAvailable())) {
      return null;
    }
    return buildWindowsManager(pathInput);
  }

  return null;
}
