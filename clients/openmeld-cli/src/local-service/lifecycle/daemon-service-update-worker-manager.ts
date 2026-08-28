import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import {
  resolveDaemonServiceUpdateWorkerIdentity,
  resolveDaemonServiceUpdateWorkerLaunchdPlistPath,
  resolveDaemonServiceUpdateWorkerSystemdPathUnitPath,
  resolveDaemonServiceUpdateWorkerSystemdUnitPath,
  resolveDaemonServiceUpdateWorkerWindowsScriptPath,
} from "../../config/daemon-service-update-worker-registration";
import {
  daemonRuntimeRootPath,
  daemonRuntimeStateRootPath,
} from "../../config/daemon-state";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
import { assertSafePublishedProductionServiceRegistrationMutation } from "../../config/published-production-safety";
import { pruneManagedVersions } from "../../local-components/managed-version-pruning";
import {
  clearDaemonServiceUpdateWorkerBinaryExecutable,
  daemonServiceUpdateWorkerBinaryPath,
  ensureDaemonServiceUpdateWorkerBinaryExecutable,
  readDaemonActiveBundleState,
  resolveDaemonBundleEntryPathFromState,
} from "./daemon-service-bundle";
import { buildDaemonSystemServiceCommandSpec } from "./daemon-service-command-spec";
import { resolveDaemonServiceManager } from "./daemon-service-manager";
import type { DaemonServiceUpdateJob } from "./daemon-service-update-state";

const UPDATE_WORKER_RESTART_BACKOFF_SECONDS = 30;
const WINDOWS_SERVICE_ALREADY_RUNNING_PATTERN = /already running|1056/i;
const SYSTEMD_QUOTING_PATTERN = /[\s"\\]/u;

export type DaemonServiceUpdateWorkerSpec = {
  args: string[];
  env: Record<string, string>;
  executable: string;
  pendingJobPath: string;
  workingDirectory: string;
};

type RunCommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export async function installDaemonServiceUpdateWorker(
  job: DaemonServiceUpdateJob,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  assertSafePublishedProductionServiceRegistrationMutation(
    "install the OpenMeld Service update worker for",
    pathInput
  );
  const previousActiveBundle =
    job.preparedBundle.bundleFormat === "binary_v1"
      ? await readDaemonActiveBundleState().catch(() => null)
      : null;
  if (job.preparedBundle.bundleFormat === "binary_v1") {
    await ensureDaemonServiceUpdateWorkerBinaryExecutable(
      job.preparedBundle,
      pathInput
    );
  }
  const spec = await buildDaemonServiceUpdateWorkerSpec(job, pathInput);
  const identity = resolveDaemonServiceUpdateWorkerIdentity(pathInput);
  if (process.platform === "darwin") {
    const guiDomain =
      process.getuid === undefined ? "gui/501" : `gui/${process.getuid()}`;
    const serviceKey = `${guiDomain}/${identity.launchdLabel}`;
    const plistPath =
      resolveDaemonServiceUpdateWorkerLaunchdPlistPath(pathInput);
    await Promise.all([
      mkdir(dirname(plistPath), { recursive: true }),
      mkdir(dirname(resolveUpdateWorkerLogPath(pathInput)), {
        recursive: true,
      }),
    ]);
    await writeFile(
      plistPath,
      buildLaunchdServiceUpdateWorkerPlist({
        label: identity.launchdLabel,
        logPath: resolveUpdateWorkerLogPath(pathInput),
        spec,
      }),
      { encoding: "utf8", mode: 0o644 }
    );
    await chmod(plistPath, 0o644);
    await runCommand({
      command: "launchctl",
      args: ["bootout", serviceKey],
    });
    await requireSuccessfulCommand({
      command: "launchctl",
      args: ["bootstrap", guiDomain, plistPath],
    });
    await requireSuccessfulCommand({
      command: "launchctl",
      args: ["enable", serviceKey],
    });
    await pruneVersionsAfterStableWorkerRegistration({
      job,
      pathInput,
      previousActiveVersion: previousActiveBundle?.daemonVersion ?? null,
    });
    return;
  }

  if (process.platform === "linux") {
    const unitPath = resolveDaemonServiceUpdateWorkerSystemdUnitPath(pathInput);
    const pathUnitPath =
      resolveDaemonServiceUpdateWorkerSystemdPathUnitPath(pathInput);
    await mkdir(dirname(unitPath), { recursive: true });
    await Promise.all([
      writeFile(unitPath, buildSystemdServiceUpdateWorkerUnit({ spec }), {
        encoding: "utf8",
        mode: 0o600,
      }),
      writeFile(
        pathUnitPath,
        buildSystemdServiceUpdateWorkerPathUnit({
          serviceName: identity.serviceName,
          pendingJobPath: spec.pendingJobPath,
        }),
        { encoding: "utf8", mode: 0o600 }
      ),
    ]);
    await requireSuccessfulCommand({
      command: "systemctl",
      args: ["--user", "daemon-reload"],
    });
    await requireSuccessfulCommand({
      command: "systemctl",
      args: ["--user", "enable", "--now", `${identity.serviceName}.path`],
    });
    await pruneVersionsAfterStableWorkerRegistration({
      job,
      pathInput,
      previousActiveVersion: previousActiveBundle?.daemonVersion ?? null,
    });
    return;
  }

  if (process.platform === "win32") {
    const scriptPath =
      resolveDaemonServiceUpdateWorkerWindowsScriptPath(pathInput);
    await mkdir(dirname(scriptPath), { recursive: true });
    await writeFile(scriptPath, buildWindowsUpdateWorkerScript(spec), {
      encoding: "utf8",
      mode: 0o600,
    });
    const query = await runCommand({
      command: "sc",
      args: ["query", identity.windowsServiceName],
    });
    const operation = query.exitCode === 0 ? "config" : "create";
    await requireSuccessfulCommand({
      command: "sc",
      args: [
        operation,
        identity.windowsServiceName,
        "binPath=",
        quoteWindowsArg(scriptPath),
        "start=",
        "auto",
        ...(operation === "create"
          ? ["DisplayName=", quoteWindowsArg(identity.windowsDisplayName)]
          : []),
      ],
    });
    await requireSuccessfulCommand({
      command: "sc",
      args: [
        "failure",
        identity.windowsServiceName,
        "reset=",
        "86400",
        "actions=",
        "restart/30000/restart/30000/restart/30000",
      ],
    });
    await pruneVersionsAfterStableWorkerRegistration({
      job,
      pathInput,
      previousActiveVersion: previousActiveBundle?.daemonVersion ?? null,
    });
    return;
  }

  throw new Error(
    `OpenMeld cannot install its background update worker on ${process.platform}.`
  );
}

export async function startDaemonServiceUpdateWorker(
  _job: DaemonServiceUpdateJob,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  assertSafePublishedProductionServiceRegistrationMutation(
    "start the OpenMeld Service update worker for",
    pathInput
  );
  const identity = resolveDaemonServiceUpdateWorkerIdentity(pathInput);
  if (process.platform === "darwin") {
    const guiDomain =
      process.getuid === undefined ? "gui/501" : `gui/${process.getuid()}`;
    const serviceKey = `${guiDomain}/${identity.launchdLabel}`;
    await requireSuccessfulCommand({
      command: "launchctl",
      args: ["kickstart", serviceKey],
    });
    return;
  }
  if (process.platform === "linux") {
    await requireSuccessfulCommand({
      command: "systemctl",
      args: ["--user", "start", `${identity.serviceName}.service`],
    });
    return;
  }
  if (process.platform === "win32") {
    const start = await runCommand({
      command: "sc",
      args: ["start", identity.windowsServiceName],
    });
    if (
      start.exitCode !== 0 &&
      !WINDOWS_SERVICE_ALREADY_RUNNING_PATTERN.test(
        `${start.stdout}\n${start.stderr}`
      )
    ) {
      throw commandFailure("sc start", start);
    }
    return;
  }
  throw new Error(
    `OpenMeld cannot start its background update worker on ${process.platform}.`
  );
}

export async function uninstallDaemonServiceUpdateWorker(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  assertSafePublishedProductionServiceRegistrationMutation(
    "uninstall the OpenMeld Service update worker for",
    pathInput
  );
  const identity = resolveDaemonServiceUpdateWorkerIdentity(pathInput);
  if (process.platform === "darwin") {
    const guiDomain =
      process.getuid === undefined ? "gui/501" : `gui/${process.getuid()}`;
    await runCommand({
      command: "launchctl",
      args: ["bootout", `${guiDomain}/${identity.launchdLabel}`],
    });
    await rm(resolveDaemonServiceUpdateWorkerLaunchdPlistPath(pathInput), {
      force: true,
    });
    await clearDaemonServiceUpdateWorkerBinaryExecutable(pathInput);
    return;
  }
  if (process.platform === "linux") {
    await runCommand({
      command: "systemctl",
      args: ["--user", "disable", "--now", `${identity.serviceName}.path`],
    });
    await runCommand({
      command: "systemctl",
      args: ["--user", "stop", `${identity.serviceName}.service`],
    });
    await Promise.all([
      rm(resolveDaemonServiceUpdateWorkerSystemdUnitPath(pathInput), {
        force: true,
      }),
      rm(resolveDaemonServiceUpdateWorkerSystemdPathUnitPath(pathInput), {
        force: true,
      }),
    ]);
    await runCommand({
      command: "systemctl",
      args: ["--user", "daemon-reload"],
    });
    await clearDaemonServiceUpdateWorkerBinaryExecutable(pathInput);
    return;
  }
  if (process.platform === "win32") {
    await runCommand({
      command: "sc",
      args: ["stop", identity.windowsServiceName],
    });
    await runCommand({
      command: "sc",
      args: ["delete", identity.windowsServiceName],
    });
    await clearDaemonServiceUpdateWorkerBinaryExecutable(pathInput);
  }
}

export async function buildDaemonServiceUpdateWorkerSpec(
  job: DaemonServiceUpdateJob,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonServiceUpdateWorkerSpec> {
  const mainManager = await resolveDaemonServiceManager(undefined, pathInput);
  if (!mainManager) {
    throw new Error(
      "OpenMeld could not find this computer's background service manager."
    );
  }
  const baseSpec = buildDaemonSystemServiceCommandSpec({
    controller: mainManager.controller,
    ...(job.preparedBundle.bundleFormat === "binary_v1"
      ? { binaryExecutablePath: job.preparedBundle.sourceEntryScriptPath }
      : {}),
    distribution:
      job.preparedBundle.bundleFormat === "binary_v1" ? "binary" : "npm",
  });
  const binaryDistribution = job.preparedBundle.bundleFormat === "binary_v1";
  const targetEntryPath = binaryDistribution
    ? daemonServiceUpdateWorkerBinaryPath(pathInput)
    : await resolveDaemonBundleEntryPathFromState(job.preparedBundle);
  if (!targetEntryPath) {
    throw new Error(
      "OpenMeld could not resolve the prepared Service update executable."
    );
  }
  return {
    args: binaryDistribution
      ? ["service", "update-worker"]
      : [targetEntryPath, "service", "update-worker"],
    env: baseSpec.env,
    executable: binaryDistribution ? targetEntryPath : process.execPath,
    pendingJobPath: join(
      daemonRuntimeStateRootPath(pathInput),
      "service-update.json"
    ),
    workingDirectory: daemonRuntimeRootPath(pathInput),
  };
}

export function buildLaunchdServiceUpdateWorkerPlist(input: {
  label: string;
  logPath: string;
  spec: DaemonServiceUpdateWorkerSpec;
}): string {
  const args = [input.spec.executable, ...input.spec.args]
    .map((value) => `    <string>${escapeXml(value)}</string>`)
    .join("\n");
  const env = Object.entries(input.spec.env)
    .map(
      ([key, value]) =>
        `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(input.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(input.spec.workingDirectory)}</string>
  <key>KeepAlive</key>
  <dict>
    <key>PathState</key>
    <dict>
      <key>${escapeXml(input.spec.pendingJobPath)}</key>
      <true/>
    </dict>
  </dict>
  <key>ThrottleInterval</key>
  <integer>${String(UPDATE_WORKER_RESTART_BACKOFF_SECONDS)}</integer>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(input.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(input.logPath)}</string>
</dict>
</plist>
`;
}

export function buildSystemdServiceUpdateWorkerUnit(input: {
  spec: DaemonServiceUpdateWorkerSpec;
}): string {
  const command = [input.spec.executable, ...input.spec.args]
    .map(quoteSystemdArg)
    .join(" ");
  const environment = Object.entries(input.spec.env)
    .map(
      ([key, value]) =>
        `Environment=${key}=${quoteSystemdEnvironmentValue(value)}`
    )
    .join("\n");
  return `[Unit]
Description=OpenMeld Service Update Worker
After=default.target

[Service]
Type=simple
ExecStart=${command}
WorkingDirectory=${quoteSystemdArg(input.spec.workingDirectory)}
${environment}
Restart=on-failure
RestartSec=${String(UPDATE_WORKER_RESTART_BACKOFF_SECONDS)}

[Install]
WantedBy=default.target
`;
}

export function buildSystemdServiceUpdateWorkerPathUnit(input: {
  pendingJobPath: string;
  serviceName: string;
}): string {
  return `[Unit]
Description=Watch for a pending OpenMeld Service update

[Path]
PathExists=${input.pendingJobPath}
Unit=${input.serviceName}.service

[Install]
WantedBy=default.target
`;
}

function resolveUpdateWorkerLogPath(
  pathInput: OpenMeldPathResolutionInput
): string {
  return join(
    daemonRuntimeRootPath(pathInput),
    "logs",
    "service-update-worker.log"
  );
}

async function pruneVersionsAfterStableWorkerRegistration(input: {
  job: DaemonServiceUpdateJob;
  pathInput: OpenMeldPathResolutionInput;
  previousActiveVersion: string | null;
}): Promise<void> {
  if (input.job.preparedBundle.bundleFormat !== "binary_v1") {
    return;
  }
  await pruneManagedVersions({
    currentVersion: input.job.targetVersion,
    pathInput: input.pathInput,
    preferredRollbackVersion: input.previousActiveVersion,
  });
}

function buildWindowsUpdateWorkerScript(
  spec: DaemonServiceUpdateWorkerSpec
): string {
  const env = Object.entries(spec.env).map(
    ([key, value]) => `set "${key}=${value.replaceAll('"', '\\"')}"`
  );
  const command = [spec.executable, ...spec.args]
    .map(quoteWindowsArg)
    .join(" ");
  return ["@echo off", "setlocal", ...env, command, ""].join("\r\n");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function quoteSystemdArg(value: string): string {
  if (!SYSTEMD_QUOTING_PATTERN.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function quoteSystemdEnvironmentValue(value: string): string {
  return quoteSystemdArg(value);
}

function quoteWindowsArg(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

async function requireSuccessfulCommand(input: {
  args: string[];
  command: string;
}): Promise<void> {
  const result = await runCommand(input);
  if (result.exitCode !== 0) {
    throw commandFailure(`${input.command} ${input.args.join(" ")}`, result);
  }
}

function commandFailure(operation: string, result: RunCommandResult): Error {
  const detail = result.stderr.trim() || result.stdout.trim();
  return new Error(
    `${operation} failed with exit ${String(result.exitCode)}${
      detail ? `: ${detail}` : ""
    }`
  );
}

async function runCommand(input: {
  args: string[];
  command: string;
}): Promise<RunCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
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
      resolve({ exitCode: Number(code ?? 1), stderr, stdout });
    });
  });
}

export async function readInstalledUpdateWorkerDefinition(
  path: string
): Promise<string | null> {
  return await readFile(path, "utf8").catch(() => null);
}
