import { execFile } from "node:child_process";
import type { CliCommandFailure, CliCommandResult } from "../../shared/types";
import type { CliProblem } from "../../shared/view-types";
import type { ExecFileError, ExecFileFn } from "./driver";
import {
  buildDesktopCommandEnv,
  canExecute,
  executableNamesForPlatform,
  resolveExecutableOnPath,
} from "./path-search";
import { resolveOpenMeldBin } from "./resolve-openmeld";

type InstallCliDeps = {
  openMeldBin?: string | null;
  env?: NodeJS.ProcessEnv;
  exec?: ExecFileFn;
  timeoutMs?: number;
};

const OPENMELD_CLI_PACKAGE = "openmeld";
const OPENMELD_CLI_PACKAGE_SPEC = `${OPENMELD_CLI_PACKAGE}@latest`;
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export function readOpenMeldCliSetupProblem(
  deps: InstallCliDeps = {}
): CliProblem | null {
  const env = buildDesktopCommandEnv(deps.env);
  if (!resolveNodeBin(env)) {
    return cliSetupProblem(
      "desktop.node_missing",
      "Node.js is required before OpenMeld Desktop can install OpenMeld CLI. Install the current Node.js LTS release, then try again."
    );
  }
  if (!resolveNpmBin(env)) {
    return cliSetupProblem(
      "desktop.npm_missing",
      "npm is required before OpenMeld Desktop can install OpenMeld CLI. Install the current Node.js LTS release, then try again."
    );
  }

  const openMeldBin = resolveOpenMeldBin({ env, override: deps.openMeldBin });
  if (openMeldBin !== "openmeld" && canExecute(openMeldBin)) {
    return null;
  }
  return cliSetupProblem(
    "desktop.openmeld_cli_missing",
    "OpenMeld Desktop could not find OpenMeld CLI on this Mac."
  );
}

export function installOpenMeldCli(
  deps: InstallCliDeps = {}
): Promise<CliCommandResult> {
  const env = buildDesktopCommandEnv(deps.env);
  const nodeBin = resolveNodeBin(env);
  if (!nodeBin) {
    return Promise.resolve(
      installFailure(
        "spawn_failed",
        "desktop.node_missing",
        "Node.js is required before OpenMeld Desktop can install OpenMeld CLI."
      )
    );
  }
  const npmBin = resolveNpmBin(env);
  if (!npmBin) {
    return Promise.resolve(
      installFailure(
        "spawn_failed",
        "desktop.npm_missing",
        "npm is required before OpenMeld Desktop can install OpenMeld CLI."
      )
    );
  }

  const exec = deps.exec ?? (execFile as unknown as ExecFileFn);
  return new Promise((resolve) => {
    exec(
      npmBin,
      ["install", "--global", OPENMELD_CLI_PACKAGE_SPEC],
      {
        timeout: deps.timeoutMs ?? INSTALL_TIMEOUT_MS,
        env,
        maxBuffer: MAX_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({
            ok: true,
            type: "desktop.openmeld_cli_install",
            data: {
              packageName: OPENMELD_CLI_PACKAGE,
              packageSpec: OPENMELD_CLI_PACKAGE_SPEC,
            },
            exitCode: 0,
          });
          return;
        }
        resolve(installFailureFromExec(error, stdout ?? "", stderr ?? ""));
      }
    );
  });
}

function resolveNodeBin(env: NodeJS.ProcessEnv): string | null {
  return resolveExecutableOnPath({
    env,
    names: executableNamesForPlatform("node", env),
  });
}

function resolveNpmBin(env: NodeJS.ProcessEnv): string | null {
  return resolveExecutableOnPath({
    env,
    names: executableNamesForPlatform("npm", env),
  });
}

function installFailureFromExec(
  error: ExecFileError,
  stdout: string,
  stderr: string
): CliCommandFailure {
  const exitCode = typeof error.code === "number" ? error.code : 1;
  if (error.killed === true || (error.signal != null && error.signal !== "")) {
    return {
      ok: false,
      kind: "timed_out",
      error: {
        code: "desktop.openmeld_cli_install_timed_out",
        message: "Installing OpenMeld CLI timed out.",
      },
      exitCode,
      rawStdout: stdout,
    };
  }
  if (typeof error.code !== "number") {
    const detail = stderr.trim() || error.message;
    return {
      ok: false,
      kind: "spawn_failed",
      error: {
        code: "desktop.npm_spawn_failed",
        message: `npm could not be launched: ${detail}`,
      },
      exitCode,
      rawStdout: stdout,
    };
  }
  return {
    ok: false,
    kind: "nonzero_exit",
    error: {
      code: "desktop.openmeld_cli_install_failed",
      message: stderr.trim() || error.message || "OpenMeld CLI install failed.",
    },
    exitCode,
    rawStdout: stdout,
  };
}

function installFailure(
  kind: CliCommandFailure["kind"],
  code: string,
  message: string
): CliCommandFailure {
  return {
    ok: false,
    kind,
    error: { code, message },
    exitCode: 1,
    rawStdout: "",
  };
}

function cliSetupProblem(code: string, message: string): CliProblem {
  return {
    kind: "spawn_failed",
    code,
    message,
    requestId: null,
  };
}
