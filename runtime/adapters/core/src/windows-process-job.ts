import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { win32 } from "node:path";
import { promisify } from "node:util";
import { windowsProcessJobRequestSchema } from "@openmeld/schemas";
import type { AgentControllerProcessCleanupResult } from "./agent-controller-process.js";
import { normalizeCommandEnvironment } from "./process-environment.js";
import {
  type NativeCommandInvocation,
  quoteWindowsProcessArgument,
  resolveWindowsCommandPath,
} from "./process-launch.js";
import {
  WINDOWS_NATIVE_PROCESS_REQUEST_ENV as REQUEST_ENV,
  resolveWindowsNativeProcessHelper,
} from "./windows-native-process.js";
import { readWindowsProcessStartFileTime } from "./windows-system.js";

const DRAIN_RECEIPT = "openmeld-windows-job-drained-v1";
const CLEANUP_TIMEOUT_MS = 15_000;

export function spawnWindowsJobProcess(input: {
  invocation: NativeCommandInvocation;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): {
  child: ChildProcessWithoutNullStreams;
  terminate(signal: NodeJS.Signals): boolean;
  cleanup(): Promise<AgentControllerProcessCleanupResult>;
} {
  const env = normalizeCommandEnvironment(input.env, "win32");
  const executable = resolveWindowsCommandPath(input.invocation.bin, env);
  if (!(win32.isAbsolute(executable) && win32.isAbsolute(input.cwd))) {
    throw Object.assign(
      new Error(
        "The selected Windows controller needs an absolute executable and working directory."
      ),
      { code: "ENOENT" }
    );
  }
  const ownerStartedAt = readWindowsProcessStartFileTime(process.pid);
  if (!ownerStartedAt) {
    throw new Error(
      "Windows could not verify the process that owns this invocation."
    );
  }
  const jobName = `Local\\OpenMeld-Process-${randomUUID()}`;
  const commandLine = [
    quoteWindowsProcessArgument(executable),
    ...input.invocation.args.map((arg) =>
      input.invocation.windowsVerbatimArguments
        ? arg
        : quoteWindowsProcessArgument(arg)
    ),
  ].join(" ");
  const request = windowsProcessJobRequestSchema.parse({
    operation: "launch",
    jobName,
    executable,
    commandLine,
    workingDirectory: input.cwd,
    ownerPid: process.pid,
    ownerStartedAt,
  });
  const payload = Buffer.from(JSON.stringify(request), "utf8").toString(
    "base64"
  );
  if (payload.length > 32_000) {
    throw new Error(
      "The Windows controller arguments exceed the native launch envelope. Send large input through stdin instead."
    );
  }
  const helper = resolveWindowsNativeProcessHelper();
  const child = spawn(helper, [], {
    cwd: input.cwd,
    env: { ...env, [REQUEST_ENV]: payload },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve())
  );
  const terminate = (signal: NodeJS.Signals): boolean => {
    // Node retains the native process handle. Never signal a potentially reused
    // PID after exit; closing the supervisor's only Job handle kills descendants.
    if (
      child.exitCode !== null ||
      child.signalCode !== null ||
      child.pid === undefined
    ) {
      return false;
    }
    return child.kill(signal);
  };
  return {
    child,
    terminate,
    async cleanup() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let signalSent = false;
      try {
        signalSent = terminate("SIGKILL");
        await Promise.race([
          closed,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error("Windows supervisor exit could not be confirmed.")
                ),
              CLEANUP_TIMEOUT_MS
            );
          }),
        ]);
        // Query only AFTER the supervisor exits, so an absent Job cannot race a
        // delayed creation. A cleanup timeout/error is not a successful stop.
        const drain = windowsProcessJobRequestSchema.parse({
          operation: "drain",
          jobName,
        });
        const { stdout } = await promisify(execFile)(helper, [], {
          env: {
            ...env,
            [REQUEST_ENV]: Buffer.from(JSON.stringify(drain), "utf8").toString(
              "base64"
            ),
          },
          encoding: "utf8",
          windowsHide: true,
          timeout: CLEANUP_TIMEOUT_MS,
          maxBuffer: 4096,
        });
        if (stdout !== DRAIN_RECEIPT) {
          throw new Error(
            "Windows returned an invalid process cleanup receipt."
          );
        }
        return { ok: true, signalSent };
      } catch (error) {
        return { ok: false, signalSent, error };
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    },
  };
}
