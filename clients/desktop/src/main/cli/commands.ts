import { execFile } from "node:child_process";
import type { CliCommandFailure, CliCommandResult } from "../../shared/types";
import type { CliVersionView } from "../../shared/view-types";
import { type ExecFileError, type ExecFileFn, runCliJson } from "./driver";
import { installOpenMeldCli } from "./install-cli";
import { buildDesktopCommandEnv } from "./path-search";
import { resolveOpenMeldBin } from "./resolve-openmeld";

export type CommandDeps = {
  /** Override the resolved `openmeld` entry (else `OPENMELD_BIN`, PATH, or active bundle). */
  openMeldBin?: string | null;
  env?: NodeJS.ProcessEnv;
  /** Injectable execFile for tests. */
  exec?: ExecFileFn;
  timeoutMs?: number;
};

type AgentSelection = {
  all?: boolean;
  agentIds?: readonly string[];
};

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const LINE_BREAK_RE = /\r?\n/;

function run(
  args: readonly string[],
  deps?: CommandDeps
): Promise<CliCommandResult> {
  const env = buildDesktopCommandEnv(deps?.env);
  return runCliJson({
    openMeldBin: resolveOpenMeldBin({ env, override: deps?.openMeldBin }),
    args,
    env,
    exec: deps?.exec,
    timeoutMs: deps?.timeoutMs,
  });
}

export const serviceStatus = (deps?: CommandDeps): Promise<CliCommandResult> =>
  run(["service", "status"], deps);

export const installService = (deps?: CommandDeps): Promise<CliCommandResult> =>
  run(["service", "install"], deps);

export const startService = (deps?: CommandDeps): Promise<CliCommandResult> =>
  run(["service", "start"], deps);

export const stopService = (deps?: CommandDeps): Promise<CliCommandResult> =>
  run(["service", "stop"], deps);

export const enableServiceAutoStart = (
  deps?: CommandDeps
): Promise<CliCommandResult> => run(["service", "autostart", "enable"], deps);

export const disableServiceAutoStart = (
  deps?: CommandDeps
): Promise<CliCommandResult> => run(["service", "autostart", "disable"], deps);

export const detectAgents = (deps?: CommandDeps): Promise<CliCommandResult> =>
  run(["agents", "detect"], deps);

export const listAgents = (deps?: CommandDeps): Promise<CliCommandResult> =>
  run(["agents", "list"], deps);

export const showAgent = (
  agentId: string,
  deps?: CommandDeps
): Promise<CliCommandResult> => run(["agents", "show", agentId], deps);

export async function cliVersionStatus(
  deps?: CommandDeps
): Promise<CliVersionView> {
  const [versionResult, upgradeResult] = await Promise.all([
    runRaw(["--version"], deps),
    runRaw(["upgrade", "--check", "--view", "agent"], deps),
  ]);
  const currentVersion = readFirstLine(versionResult.stdout);
  const upgrade = readUpgradeCheckResult(upgradeResult.stdout);
  return {
    currentVersion: upgrade.currentVersion ?? currentVersion,
    latestVersion: upgrade.latestVersion,
    requiredVersion: upgrade.requiredVersion,
    updateAvailable: upgrade.updateAvailable,
    checked: upgrade.checked,
  };
}

export const upgradeCli = (deps?: CommandDeps): Promise<CliCommandResult> =>
  runAgentView(
    ["upgrade", "--yes", "--view", "agent"],
    "upgrade.completed",
    deps
  );

export const installCli = (deps?: CommandDeps): Promise<CliCommandResult> =>
  installOpenMeldCli(deps);

export function enableAgents(
  input: AgentSelection,
  deps?: CommandDeps
): Promise<CliCommandResult> {
  return run(["agents", "enable", ...selectionArgs(input)], deps);
}

export function disableAgents(
  input: AgentSelection,
  deps?: CommandDeps
): Promise<CliCommandResult> {
  return run(["agents", "disable", ...selectionArgs(input)], deps);
}

function selectionArgs(input: AgentSelection): string[] {
  if (input.all) {
    return ["--all"];
  }
  return (input.agentIds ?? []).flatMap((id) => ["--agent", id]);
}

function runRaw(
  args: readonly string[],
  deps?: CommandDeps
): Promise<{ stdout: string }> {
  const exec = deps?.exec ?? (execFile as unknown as ExecFileFn);
  const env = buildDesktopCommandEnv(deps?.env);
  return new Promise((resolve) => {
    exec(
      resolveOpenMeldBin({ env, override: deps?.openMeldBin }),
      args,
      {
        timeout: deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        env,
        maxBuffer: MAX_BUFFER_BYTES,
      },
      (_error, stdout) => {
        resolve({ stdout: stdout ?? "" });
      }
    );
  });
}

function runAgentView(
  args: readonly string[],
  successType: string,
  deps?: CommandDeps
): Promise<CliCommandResult> {
  const exec = deps?.exec ?? (execFile as unknown as ExecFileFn);
  const env = buildDesktopCommandEnv(deps?.env);
  return new Promise((resolve) => {
    exec(
      resolveOpenMeldBin({ env, override: deps?.openMeldBin }),
      args,
      {
        timeout: deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        env,
        maxBuffer: MAX_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({
            ok: true,
            type: successType,
            data: {},
            exitCode: 0,
          });
          return;
        }
        resolve(agentViewFailure(error, stdout ?? "", stderr ?? ""));
      }
    );
  });
}

function agentViewFailure(
  error: ExecFileError,
  stdout: string,
  stderr: string
): CliCommandFailure {
  const exitCode = resolveExitCode(error);
  if (isTerminated(error)) {
    return {
      ok: false,
      kind: "timed_out",
      error: {
        code: "desktop.command_timed_out",
        message: "OpenMeld command timed out.",
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
        code: "desktop.spawn_failed",
        message: `failed to launch openmeld: ${detail}`,
      },
      exitCode,
      rawStdout: stdout,
    };
  }
  const agentError = readLastAgentError(stdout);
  if (agentError) {
    return {
      ok: false,
      kind: "cli_error",
      error: agentError,
      exitCode,
      rawStdout: stdout,
    };
  }
  return {
    ok: false,
    kind: "nonzero_exit",
    error: {
      code: "desktop.command_failed",
      message: stderr.trim() || error.message || "OpenMeld command failed.",
    },
    exitCode,
    rawStdout: stdout,
  };
}

function readLastAgentError(stdout: string): CliCommandFailure["error"] | null {
  const lines = stdout
    .split(LINE_BREAK_RE)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  for (const line of lines.toReversed()) {
    const parsed = safeParseRecord(line);
    if (parsed?.type === "error" && isRecord(parsed.error)) {
      const code = readString(parsed.error.code);
      const message = readString(parsed.error.message);
      if (code && message) {
        return {
          code,
          message,
          requestId: readString(parsed.error.requestId) ?? undefined,
        };
      }
    }
  }
  return null;
}

function isTerminated(error: ExecFileError): boolean {
  return error.killed === true || (error.signal != null && error.signal !== "");
}

function resolveExitCode(error: ExecFileError): number {
  return typeof error.code === "number" ? error.code : 1;
}

function readFirstLine(stdout: string): string | null {
  return (
    stdout
      .split(LINE_BREAK_RE)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  );
}

function readUpgradeCheckResult(stdout: string): CliVersionView {
  const payload = readLastUpgradeCheckPayload(stdout);
  const currentVersion = readString(payload?.currentVersion);
  const latestVersion = readString(payload?.latestVersion);
  const requiredVersion = readString(payload?.requiredFloor);
  const status = readString(payload?.status);
  let updateAvailable: boolean | null = null;
  if (status === "outdated") {
    updateAvailable = true;
  } else if (status === "up_to_date" || status === "downgrade_blocked") {
    updateAvailable = false;
  }
  return {
    currentVersion,
    latestVersion,
    requiredVersion,
    updateAvailable,
    checked: payload !== null,
  };
}

function readLastUpgradeCheckPayload(
  stdout: string
): Record<string, unknown> | null {
  const lines = stdout
    .split(LINE_BREAK_RE)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  for (const line of lines.toReversed()) {
    const parsed = safeParseRecord(line);
    if (
      parsed?.type === "result" &&
      parsed.code === "upgrade.check" &&
      isRecord(parsed.payload)
    ) {
      return parsed.payload;
    }
  }
  return null;
}

function safeParseRecord(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
