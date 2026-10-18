import { execFileSync } from "node:child_process";
import { readWindowsProcessStartFileTime } from "@openmeld/adapter-core/windows-system";

const WINDOWS_PROCESS_IDENTITY_PATTERN = /^win32:\d{10,20}$/u;

export function isPreciseProcessStartIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ((value.startsWith("ps:") && value.length > 3) ||
      WINDOWS_PROCESS_IDENTITY_PATTERN.test(value))
  );
}

export const CURRENT_PROCESS_START_IDENTITY =
  readProcessStartIdentity(process.pid) ??
  `fallback:${process.pid}:${Math.floor(Date.now() - process.uptime() * 1000)}`;

export function isProcessIdentityAlive(
  input: { ownerPid: number; ownerProcessStartedAt: string },
  platform: NodeJS.Platform = process.platform
): boolean {
  if (!isProcessAlive(input.ownerPid)) {
    return false;
  }
  const observedIdentity = readProcessStartIdentity(input.ownerPid, platform);
  if (
    isPreciseProcessStartIdentity(observedIdentity) &&
    isPreciseProcessStartIdentity(input.ownerProcessStartedAt) &&
    observedIdentity.split(":", 1)[0] ===
      input.ownerProcessStartedAt.split(":", 1)[0]
  ) {
    return observedIdentity === input.ownerProcessStartedAt;
  }
  // Fail closed when a live process cannot be identified precisely. A caller
  // may recover only after it can prove that the transition owner has exited.
  return true;
}

export function readProcessStartIdentity(
  pid: number,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (!(Number.isSafeInteger(pid) && pid > 0)) {
    return null;
  }
  if (platform === "win32") {
    const created = readWindowsProcessStartFileTime(pid);
    return created === null ? null : `win32:${created}`;
  }
  try {
    const output = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
      windowsHide: true,
    }).trim();
    return output.length > 0 ? `ps:${output}` : null;
  } catch {
    return null;
  }
}

// Windows FILETIME counts 100 ns intervals since 1601-01-01 UTC.
const WINDOWS_FILETIME_UNIX_EPOCH_MS = 11_644_473_600_000;

/**
 * Wall-clock start of a live process in epoch milliseconds, or null when it
 * cannot be read. POSIX `lstart` has one-second resolution and is read in the
 * C locale so the timestamp parses regardless of the user's language.
 */
export function readProcessStartedAtMs(
  pid: number,
  platform: NodeJS.Platform = process.platform
): number | null {
  if (!(Number.isSafeInteger(pid) && pid > 0)) {
    return null;
  }
  if (platform === "win32") {
    const created = readWindowsProcessStartFileTime(pid);
    if (created === null) {
      return null;
    }
    const startedAtMs =
      Number(created) / 10_000 - WINDOWS_FILETIME_UNIX_EPOCH_MS;
    return Number.isFinite(startedAtMs) ? startedAtMs : null;
  }
  try {
    const output = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
      windowsHide: true,
    }).trim();
    const startedAtMs = Date.parse(output);
    return Number.isFinite(startedAtMs) ? startedAtMs : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeError(error, "ESRCH");
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error && "code" in error && String(error.code) === code
  );
}
