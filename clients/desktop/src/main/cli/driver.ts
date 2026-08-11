import { execFile } from "node:child_process";
import type { CliCommandResult } from "../../shared/types";
import { parseCliJsonResult } from "./envelope";

/** The error shape node's execFile passes on failure (the bits we discriminate on). */
export type ExecFileError = Error & {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals | string | null;
};

/** Minimal injectable shape of node's `execFile` (so the driver is testable). */
export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { timeout?: number; env?: NodeJS.ProcessEnv; maxBuffer?: number },
  callback: (
    error: ExecFileError | null,
    stdout: string,
    stderr: string
  ) => void
) => unknown;

export type RunCliJsonInput = {
  openMeldBin: string;
  args: readonly string[];
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Injectable for tests; defaults to node's execFile. */
  exec?: ExecFileFn;
};

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/**
 * Runs `openmeld <args> --json` and parses the single-line envelope into a typed
 * result. Never rejects — spawn/parse/exit failures come back as a typed
 * `{ ok: false }` result.
 */
export function runCliJson(input: RunCliJsonInput): Promise<CliCommandResult> {
  const exec = input.exec ?? (execFile as unknown as ExecFileFn);
  const args = [...input.args, "--json"];
  return new Promise((resolve) => {
    exec(
      input.openMeldBin,
      args,
      {
        timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        env: input.env,
        maxBuffer: MAX_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        resolve(
          parseCliJsonResult({
            stdout: stdout ?? "",
            exitCode: resolveExitCode(error),
            spawnError: resolveSpawnError(error, stderr ?? ""),
            terminated: isTerminated(error),
          })
        );
      }
    );
  });
}

/** True when the process launched but was killed (timeout / maxBuffer exceeded). */
function isTerminated(error: ExecFileError | null): boolean {
  if (!error) {
    return false;
  }
  return error.killed === true || (error.signal != null && error.signal !== "");
}

function resolveExitCode(error: ExecFileError | null): number {
  if (!error) {
    return 0;
  }
  return typeof error.code === "number" ? error.code : 1;
}

function resolveSpawnError(
  error: ExecFileError | null,
  stderr: string
): string | null {
  if (!error) {
    return null;
  }
  // Killed (timeout / maxBuffer) — the process DID launch; handled as timed_out.
  if (isTerminated(error)) {
    return null;
  }
  // A non-numeric code (e.g. "ENOENT") means the process never launched.
  if (typeof error.code !== "number") {
    const detail = stderr.trim() || error.message;
    return `failed to launch openmeld: ${detail}`;
  }
  // A numeric code means it ran and exited non-zero — not a spawn failure; let
  // the envelope parser interpret stdout (it may carry an error envelope).
  return null;
}
