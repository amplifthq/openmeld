import { execFileSync } from "node:child_process";
import { win32 } from "node:path";
import { windowsProcessJobRequestSchema } from "@openmeld/schemas";
import { normalizeCommandEnvironment } from "./process-environment.js";
import {
  resolveWindowsNativeProcessHelper,
  WINDOWS_NATIVE_PROCESS_REQUEST_ENV,
} from "./windows-native-process.js";

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
// Keep native identity reads bounded; an unavailable identity fails admission.
const PROCESS_IDENTITY_TIMEOUT_MS = 15_000;
let currentProcessFileTime: string | undefined;

/** An opened process handle binds the observation to the actual instance, not a reused PID. */
export function readWindowsProcessStartFileTime(pid: number): string | null {
  if (!(Number.isSafeInteger(pid) && pid > 0)) {
    return null;
  }
  if (pid === process.pid && currentProcessFileTime) {
    return currentProcessFileTime;
  }
  const request = windowsProcessJobRequestSchema.parse({
    operation: "identity",
    pid,
  });
  try {
    const output = execFileSync(resolveWindowsNativeProcessHelper(), [], {
      env: {
        ...process.env,
        [WINDOWS_NATIVE_PROCESS_REQUEST_ENV]: Buffer.from(
          JSON.stringify(request),
          "utf8"
        ).toString("base64"),
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: PROCESS_IDENTITY_TIMEOUT_MS,
      maxBuffer: 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
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
