import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  configureDaemonMaintenanceEnvironment,
  daemonServiceUpdateWorkerNpmEntryPath,
  hasIndependentMaintenanceRegistration,
  INDEPENDENT_MAINTENANCE_REGISTRATION,
  resolveDaemonServiceUpdateWorkerIdentity,
  resolveDaemonServiceUpdateWorkerLaunchdPlistPath,
  resolveDaemonServiceUpdateWorkerSystemdPathUnitPath,
  resolveDaemonServiceUpdateWorkerSystemdTimerUnitPath,
  resolveDaemonServiceUpdateWorkerSystemdUnitPath,
  resolveDaemonServiceUpdateWorkerWindowsScriptPath,
} from "../../config/daemon-service-update-worker-registration";
import {
  daemonRuntimeRootPath,
  daemonRuntimeStateRootPath,
} from "../../config/daemon-state";
import type { OpenMeldPathResolutionInput } from "../../config/paths";
import { assertSafePublishedProductionServiceRegistrationMutation } from "../../config/published-production-safety";
import { pruneManagedInstallVersions } from "../../local-components/managed-install";
import {
  clearDaemonServiceUpdateWorkerBinaryExecutable,
  daemonServiceUpdateWorkerBinaryPath,
  ensureDaemonServiceUpdateWorkerBinaryExecutable,
  readDaemonActiveBundleState,
  resolveDaemonBundleEntryPathFromState,
  runAuditedServiceManagerCarrierMutation,
  verifyDaemonActiveBundleIntegrity,
} from "./daemon-service-bundle";
import { buildDaemonSystemServiceCommandSpec } from "./daemon-service-command-spec";
import {
  resolveDaemonServiceManager,
  startLaunchdService,
  waitForLaunchdJobUnloaded,
} from "./daemon-service-manager";
import {
  type DaemonServiceUpdateJob,
  readPendingDaemonServiceUpdate,
} from "./daemon-service-update-state";
import {
  runWindowsUserTask,
  windowsPowerShellPath,
  windowsTaskActionArguments,
} from "./windows-user-task";

const UPDATE_WORKER_RESTART_BACKOFF_SECONDS = 30;
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

export async function ensureDaemonServiceMaintenanceInstalled(): Promise<void> {
  // The pending update owns its executor until verification and rollback finish.
  if (await readPendingDaemonServiceUpdate()) {
    return;
  }
  const preparedBundle = await readDaemonActiveBundleState();
  if (
    !(
      preparedBundle?.sourceDistFingerprint &&
      (preparedBundle.bundleFormat === "binary_v1" ||
        (await verifyDaemonActiveBundleIntegrity(preparedBundle)))
    )
  ) {
    throw new Error(
      "OpenMeld cannot install automatic maintenance without a verified Service program."
    );
  }
  // Binary preparation below verifies the maintenance executable against the
  // prepared source fingerprint. The main Service carrier may still be the
  // previous version until startup replaces it; it is not this worker's source.
  const spec = await buildDaemonServiceUpdateWorkerSpec({ preparedBundle });
  const identity = resolveDaemonServiceUpdateWorkerIdentity();
  let expectedDefinition: string;
  if (process.platform === "darwin") {
    expectedDefinition = buildLaunchdServiceUpdateWorkerPlist({
      label: identity.launchdLabel,
      logPath: resolveUpdateWorkerLogPath({}),
      spec,
    });
  } else if (process.platform === "linux") {
    expectedDefinition = buildSystemdServiceUpdateWorkerUnit({ spec });
  } else {
    expectedDefinition = windowsTaskActionArguments({
      ...spec,
      logPath: resolveUpdateWorkerLogPath({}),
    });
  }
  if (
    await hasIndependentMaintenanceRegistration(
      {},
      process.platform,
      expectedDefinition
    )
  ) {
    // A saved registration can outlive its executable (for example after a
    // local reinstall). Restore the verified carrier before trusting the job.
    await prepareDaemonServiceUpdateWorkerCarrier({ preparedBundle });
    if (process.platform === "darwin") {
      await startDaemonServiceUpdateWorker();
    }
    return;
  }
  await installDaemonServiceUpdateWorker({ preparedBundle });
}

export async function installDaemonServiceUpdateWorker(
  job: Pick<DaemonServiceUpdateJob, "preparedBundle">,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await prepareDaemonServiceUpdateWorkerCarrier(job, pathInput);
  await registerDaemonServiceUpdateWorker(job, pathInput);
  await startDaemonServiceUpdateWorker(undefined, pathInput);
}

export async function registerDaemonServiceUpdateWorker(
  job: Pick<DaemonServiceUpdateJob, "preparedBundle">,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  assertSafePublishedProductionServiceRegistrationMutation(
    "install the OpenMeld Service update worker for",
    pathInput
  );
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
    await waitForLaunchdJobUnloaded(serviceKey);
    // Stop/uninstall leaves a persistent disabled override. Clear it before
    // bootstrap, otherwise launchd rejects reinstall with an opaque EIO.
    await requireSuccessfulCommand({
      command: "launchctl",
      args: ["enable", serviceKey],
    });
    await requireSuccessfulCommand({
      command: "launchctl",
      args: ["bootstrap", guiDomain, plistPath],
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
      writeFile(
        resolveDaemonServiceUpdateWorkerSystemdTimerUnitPath(pathInput),
        buildSystemdServiceUpdateWorkerTimerUnit(identity.serviceName),
        { encoding: "utf8", mode: 0o600 }
      ),
    ]);
    await requireSuccessfulCommand({
      command: "systemctl",
      args: ["--user", "daemon-reload"],
    });
    await requireSuccessfulCommand({
      command: "systemctl",
      args: [
        "--user",
        "enable",
        "--now",
        `${identity.serviceName}.path`,
        `${identity.serviceName}.timer`,
      ],
    });
    return;
  }

  if (process.platform === "win32") {
    const scriptPath =
      resolveDaemonServiceUpdateWorkerWindowsScriptPath(pathInput);
    await mkdir(dirname(resolveUpdateWorkerLogPath(pathInput)), {
      recursive: true,
    });
    await runWindowsUserTask({
      name: identity.windowsServiceName,
      legacyScript: scriptPath,
      operation: "install",
      executable: windowsPowerShellPath(),
      arguments: windowsTaskActionArguments({
        ...spec,
        logPath: resolveUpdateWorkerLogPath(pathInput),
      }),
      workingDirectory: spec.workingDirectory,
      periodic: true,
    });
    await rm(scriptPath, { force: true });
    return;
  }

  throw new Error(
    `OpenMeld cannot install its background update worker on ${process.platform}.`
  );
}

export async function prepareDaemonServiceUpdateWorkerCarrier(
  job: Pick<DaemonServiceUpdateJob, "preparedBundle">,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  if (job.preparedBundle.bundleFormat === "binary_v1") {
    await ensureDaemonServiceUpdateWorkerBinaryExecutable(
      job.preparedBundle,
      pathInput
    );
    return;
  }
  const entry = await resolveDaemonBundleEntryPathFromState(
    job.preparedBundle,
    pathInput
  );
  if (!entry) {
    throw new Error(
      "OpenMeld could not resolve the verified maintenance bundle."
    );
  }
  const target = daemonServiceUpdateWorkerNpmEntryPath(pathInput);
  await runAuditedServiceManagerCarrierMutation({
    distribution: "npm",
    operation: "refresh_update_worker_launcher",
    pathInput,
    targetPath: target,
    run: async () => {
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.tmp`;
      try {
        await writeFile(
          temporary,
          `process.env.OPENMELD_INTERNAL_NPM_INSTALL_ENTRY = ${JSON.stringify(job.preparedBundle.sourceEntryScriptPath)};\nawait import(${JSON.stringify(pathToFileURL(entry).href)});\n`,
          { mode: 0o600 }
        );
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    },
  });
}

export async function pruneDaemonServiceUpdateWorkerManagedVersions(
  job: DaemonServiceUpdateJob,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  if (job.preparedBundle.bundleFormat !== "binary_v1") {
    return;
  }
  const previousActiveBundle = await readDaemonActiveBundleState(pathInput);
  await pruneManagedInstallVersions({
    pathInput,
    preferredRollbackVersion: previousActiveBundle?.daemonVersion ?? null,
  });
}

export async function startDaemonServiceUpdateWorker(
  _job?: DaemonServiceUpdateJob,
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
    await startLaunchdService({
      guiDomain,
      serviceKey,
      plistPath: resolveDaemonServiceUpdateWorkerLaunchdPlistPath(pathInput),
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
    await runWindowsUserTask({
      name: identity.windowsServiceName,
      legacyScript:
        resolveDaemonServiceUpdateWorkerWindowsScriptPath(pathInput),
      operation: "start",
    });
    return;
  }
  throw new Error(
    `OpenMeld cannot start its background update worker on ${process.platform}.`
  );
}

async function clearDaemonServiceUpdateWorkerNpmEntry(
  pathInput: OpenMeldPathResolutionInput
): Promise<void> {
  const targetPath = daemonServiceUpdateWorkerNpmEntryPath(pathInput);
  await runAuditedServiceManagerCarrierMutation({
    distribution: "npm",
    operation: "remove_update_worker_launcher",
    pathInput,
    targetPath,
    run: () => rm(targetPath, { force: true }),
  });
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
      args: ["disable", `${guiDomain}/${identity.launchdLabel}`],
    });
    await runCommand({
      command: "launchctl",
      args: ["bootout", `${guiDomain}/${identity.launchdLabel}`],
    });
    await waitForLaunchdJobUnloaded(`${guiDomain}/${identity.launchdLabel}`);
    await rm(resolveDaemonServiceUpdateWorkerLaunchdPlistPath(pathInput), {
      force: true,
    });
    await clearDaemonServiceUpdateWorkerBinaryExecutable(pathInput);
    await clearDaemonServiceUpdateWorkerNpmEntry(pathInput);
    return;
  }
  if (process.platform === "linux") {
    await runCommand({
      command: "systemctl",
      args: [
        "--user",
        "disable",
        "--now",
        `${identity.serviceName}.path`,
        `${identity.serviceName}.timer`,
      ],
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
      rm(resolveDaemonServiceUpdateWorkerSystemdTimerUnitPath(pathInput), {
        force: true,
      }),
    ]);
    await runCommand({
      command: "systemctl",
      args: ["--user", "daemon-reload"],
    });
    await clearDaemonServiceUpdateWorkerBinaryExecutable(pathInput);
    await clearDaemonServiceUpdateWorkerNpmEntry(pathInput);
    return;
  }
  if (process.platform === "win32") {
    const legacyScript =
      resolveDaemonServiceUpdateWorkerWindowsScriptPath(pathInput);
    await runWindowsUserTask({
      name: identity.windowsServiceName,
      legacyScript,
      operation: "stop",
    });
    await runWindowsUserTask({
      name: identity.windowsServiceName,
      legacyScript,
      operation: "uninstall",
    });
    await rm(legacyScript, { force: true });
    await clearDaemonServiceUpdateWorkerNpmEntry(pathInput);
  }
}

export async function buildDaemonServiceUpdateWorkerSpec(
  job: Pick<DaemonServiceUpdateJob, "preparedBundle">,
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
    : daemonServiceUpdateWorkerNpmEntryPath(pathInput);
  if (!targetEntryPath) {
    throw new Error(
      "OpenMeld could not resolve the prepared Service update executable."
    );
  }
  const env = { ...baseSpec.env };
  configureDaemonMaintenanceEnvironment(env);
  return {
    args: binaryDistribution
      ? ["service", "update-worker"]
      : [targetEntryPath, "service", "update-worker"],
    env,
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
<!-- ${INDEPENDENT_MAINTENANCE_REGISTRATION} -->
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
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>3600</integer>
  <key>KeepAlive</key>
  <dict>
    <key>PathState</key>
    <dict>
      <key>${escapeXml(input.spec.pendingJobPath)}</key>
      <true/>
      <key>${escapeXml(join(dirname(input.spec.pendingJobPath), "tools-update.json"))}</key>
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
  return `# ${INDEPENDENT_MAINTENANCE_REGISTRATION}
[Unit]
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
PathExists=${join(dirname(input.pendingJobPath), "tools-update.json")}
Unit=${input.serviceName}.service

[Install]
WantedBy=default.target
`;
}

export function buildSystemdServiceUpdateWorkerTimerUnit(
  serviceName: string
): string {
  return `[Unit]
Description=Check for OpenMeld updates

[Timer]
OnStartupSec=2min
OnUnitInactiveSec=1h
Unit=${serviceName}.service

[Install]
WantedBy=timers.target
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
