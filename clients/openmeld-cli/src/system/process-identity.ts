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
