import { userInfo } from "node:os";
import process from "node:process";
import {
  DAEMON_SERVICE_RUNTIME_AUTO_START_ENV,
  DAEMON_SERVICE_RUNTIME_CONTROLLER_ENV,
  DAEMON_SERVICE_RUNTIME_DETACHED_ENV,
  DAEMON_SERVICE_RUNTIME_MODE_ENV,
  DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV,
  daemonRuntimeRootPath,
} from "../../config/daemon-state";
import {
  type OpenMeldEnvironmentTarget,
  resolveOpenMeldEnvironmentTargetFromEnv,
} from "../../config/openmeld-environment-target";
import {
  OPENMELD_HOME_ENV_KEY,
  openMeldManagedVersionBinaryPath,
} from "../../config/paths";
import { resolveCliSelfVersion } from "../../local-components/managed-install";
import {
  type OpenMeldDistribution,
  resolveOpenMeldDistribution,
} from "../../runtime/distribution";
import {
  daemonServiceBinaryExecutablePath,
  daemonServiceExecutableWrapperPath,
  daemonServiceLauncherPath,
  ensureDaemonServiceStableBinaryExecutable,
  readDaemonActiveBundleState,
  writeDaemonServiceExecutableWrapper,
  writeDaemonServiceLauncher,
} from "./daemon-service-bundle";
import type {
  DaemonServiceCommandSpec,
  DaemonServiceManager,
} from "./daemon-service-manager";

const DEFAULT_LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const MACOS_SYSTEM_SHELL = "/bin/sh";
const DAEMON_SERVICE_ENV_KEY_WHITELIST = new Set([
  "HOME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_COLLATE",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LC_MONETARY",
  "LC_NUMERIC",
  "LC_TIME",
  "USER",
  "LOGNAME",
  OPENMELD_HOME_ENV_KEY,
  "OPENMELD_DEV_MODE",
  "OPENMELD_ENV_PRESET",
  "OPENMELD_USER_FACING_CLI_COMMAND",
  "OPENMELD_CLI_BINARY_MANIFEST_URL",
]);

export function buildDaemonSystemServiceCommandSpec(input: {
  controller: DaemonServiceManager["controller"];
  binaryExecutablePath?: string;
  distribution?: OpenMeldDistribution;
  environmentTarget?: OpenMeldEnvironmentTarget;
}): DaemonServiceCommandSpec {
  const args: string[] = ["service", "run", "--mode", "foreground"];
  const environmentTarget =
    input.environmentTarget ?? resolveOpenMeldEnvironmentTargetFromEnv();
  const { executable, specArgs } = resolveDaemonServiceExecutable({
    args,
    binaryExecutablePath: input.binaryExecutablePath,
    controller: input.controller,
    distribution: input.distribution,
  });

  return {
    executable,
    args: specArgs,
    env: {
      ...buildSystemServiceEnvironment(),
      OPENMELD_ENV_PRESET: environmentTarget.preset,
      OPENMELD_GATEWAY_URL: environmentTarget.gatewayUrl,
      OPENMELD_AUTH_URL: environmentTarget.authBaseUrl,
      OPENMELD_USER_FACING_CLI_COMMAND: environmentTarget.userFacingCommand,
      [DAEMON_SERVICE_RUNTIME_MODE_ENV]: "foreground",
      [DAEMON_SERVICE_RUNTIME_DETACHED_ENV]: "1",
      [DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV]: "1",
      [DAEMON_SERVICE_RUNTIME_CONTROLLER_ENV]: input.controller,
      [DAEMON_SERVICE_RUNTIME_AUTO_START_ENV]: "1",
    },
    workingDirectory: daemonRuntimeRootPath(),
  };
}

function resolveDaemonServiceExecutable(input: {
  args: string[];
  binaryExecutablePath?: string;
  controller: DaemonServiceManager["controller"];
  distribution?: OpenMeldDistribution;
}): { executable: string; specArgs: string[] } {
  if ((input.distribution ?? resolveOpenMeldDistribution()) === "binary") {
    // macOS privacy grants identify a bare CLI by its executable path. Keep the
    // launchd carrier at one physical path across upgrades; the prepared,
    // signed version binary is copied there before registration. Other service
    // managers retain the existing versioned executable contract.
    return {
      executable:
        input.controller === "launchd"
          ? daemonServiceBinaryExecutablePath()
          : (input.binaryExecutablePath ??
            openMeldManagedVersionBinaryPath(resolveCliSelfVersion())),
      specArgs: input.args,
    };
  }
  const launcherPath = daemonServiceLauncherPath();
  if (input.controller === "launchd") {
    return {
      executable: MACOS_SYSTEM_SHELL,
      specArgs: [daemonServiceExecutableWrapperPath(), ...input.args],
    };
  }
  return {
    executable: process.execPath,
    specArgs: [launcherPath, ...input.args],
  };
}

export async function ensureDaemonSystemServiceCommandFiles(input: {
  controller: DaemonServiceManager["controller"];
  distribution?: OpenMeldDistribution;
}): Promise<void> {
  if ((input.distribution ?? resolveOpenMeldDistribution()) === "binary") {
    if (input.controller === "launchd") {
      await ensureDaemonServiceStableBinaryExecutable();
    }
    return;
  }
  const activeBundle = await readDaemonActiveBundleState();
  if (activeBundle?.bundleFormat === "binary_v1") {
    throw new Error(
      "Refusing to replace a binary-managed OpenMeld Service with the npm carrier. Run the managed OpenMeld binary for Service repair or update."
    );
  }
  await writeDaemonServiceLauncher();
  if (input.controller === "launchd") {
    await writeDaemonServiceExecutableWrapper();
  }
}

function buildSystemServiceEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  const runtimeUser = userInfo().username;
  for (const [key, value] of Object.entries(process.env)) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      !isDaemonServiceEnvironmentKey(key)
    ) {
      continue;
    }
    env[key] = sanitizeDaemonServiceEnvironmentValue(value);
  }
  if (process.platform === "darwin") {
    env.PATH ??= DEFAULT_LAUNCHD_PATH;
  }
  env.HOME ??= userInfo().homedir;
  env.USER ??= env.LOGNAME ?? runtimeUser;
  env.LOGNAME ??= env.USER;
  return env;
}

function isDaemonServiceEnvironmentKey(key: string): boolean {
  return DAEMON_SERVICE_ENV_KEY_WHITELIST.has(key);
}

function sanitizeDaemonServiceEnvironmentValue(value: string): string {
  let sanitized = "";
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined) {
      continue;
    }
    if ((code >= 0x00 && code <= 0x1f) || code === 0x7f) {
      continue;
    }
    sanitized += char;
  }
  return sanitized;
}
