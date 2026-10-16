import { execFile, execFileSync, spawn } from "node:child_process";
import { win32 } from "node:path";
import { promisify } from "node:util";
import { windowsNativeProcessRequestSchema } from "@openmeld/schemas";
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

export async function activateWindowsManagedCommand(
  binDirectory: string
): Promise<"activated" | "already_active"> {
  const request = windowsNativeProcessRequestSchema.parse({
    operation: "activate-managed-command",
    binDirectory,
  });
  const { stdout } = await promisify(execFile)(
    resolveWindowsNativeProcessHelper(),
    [],
    {
      env: {
        ...process.env,
        [WINDOWS_NATIVE_PROCESS_REQUEST_ENV]: Buffer.from(
          JSON.stringify(request),
          "utf8"
        ).toString("base64"),
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 4096,
    }
  );
  const result = stdout.trim();
  if (result !== "activated" && result !== "already_active") {
    throw new Error("Windows returned an invalid command activation receipt.");
  }
  return result;
}

/** Kernel sharing rules keep a live CLI and its helper together during pruning. */
export async function pruneWindowsBinaryBundle(
  directory: string
): Promise<"removed" | "absent" | "in_use" | "unrecognized"> {
  const request = windowsNativeProcessRequestSchema.parse({
    operation: "prune-binary-bundle",
    directory,
  });
  const { stdout } = await promisify(execFile)(
    resolveWindowsNativeProcessHelper(),
    [],
    {
      env: {
        ...process.env,
        [WINDOWS_NATIVE_PROCESS_REQUEST_ENV]: Buffer.from(
          JSON.stringify(request),
          "utf8"
        ).toString("base64"),
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 4096,
    }
  );
  const result = stdout.trim();
  if (
    result !== "removed" &&
    result !== "absent" &&
    result !== "in_use" &&
    result !== "unrecognized"
  ) {
    throw new Error(
      "Windows returned an invalid managed-version cleanup receipt."
    );
  }
  return result;
}

/** An opened process handle binds the observation to the actual instance, not a reused PID. */
export function readWindowsProcessStartFileTime(pid: number): string | null {
  if (!(Number.isSafeInteger(pid) && pid > 0)) {
    return null;
  }
  if (pid === process.pid && currentProcessFileTime) {
    return currentProcessFileTime;
  }
  const request = windowsNativeProcessRequestSchema.parse({
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

export function startWindowsIdleSleepBlocker() {
  return spawn(resolveWindowsNativeProcessHelper(), [], {
    env: {
      ...process.env,
      [WINDOWS_NATIVE_PROCESS_REQUEST_ENV]: Buffer.from(
        JSON.stringify(
          windowsNativeProcessRequestSchema.parse({
            operation: "prevent-idle-sleep",
          })
        )
      ).toString("base64"),
    },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
