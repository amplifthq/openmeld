import { execFileSync } from "node:child_process";
import { win32 } from "node:path";
import { normalizeCommandEnvironment } from "./process-environment.js";

export function resolveWindowsPowerShellPath(
  env: NodeJS.ProcessEnv = process.env
): string {
  const source = normalizeCommandEnvironment(env, "win32");
  const root = source.SystemRoot ?? source.WINDIR;
  if (!(root && win32.isAbsolute(root))) {
    throw new Error("Windows system directory is unavailable.");
  }
  return win32.join(
    root,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
}

export function powerShellEncodedArguments(script: string): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
}

const FILE_TIME_PATTERN = /^\d{10,20}$/u;
let currentProcessFileTime: string | undefined;

/** An opened process handle binds the observation to the actual instance, not a reused PID. */
export function readWindowsProcessStartFileTime(pid: number): string | null {
  if (!(Number.isSafeInteger(pid) && pid > 0)) {
    return null;
  }
  if (pid === process.pid && currentProcessFileTime) {
    return currentProcessFileTime;
  }
  const script = `$ErrorActionPreference='Stop'; $p=[Diagnostics.Process]::GetProcessById(${pid}); try { $null=$p.Handle; [Console]::Write($p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)) } finally { $p.Dispose() }`;
  try {
    const output = execFileSync(
      resolveWindowsPowerShellPath(),
      powerShellEncodedArguments(script),
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }
    ).trim();
    if (!FILE_TIME_PATTERN.test(output)) {
      return null;
    }
    if (pid === process.pid) {
      currentProcessFileTime = output;
    }
    return output;
  } catch {
    return null;
  }
}
