import { spawn } from "node:child_process";
import { currentDaemonServiceLifecycleLock } from "../../config/daemon-state";
import {
  attachLockProcess,
  type OpenMeldLock,
  releaseLock,
} from "../../config/lock";

// The shell waits without spawning another process. exec preserves its PID
// and start identity. EOF before a grant prevents the platform command.
const EXEC_HANDSHAKE =
  'IFS= read -r grant && [ "$grant" = "execute" ] || exit 125; exec "$@"';

export async function runNativeServiceCommand(input: {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  throwOnError?: boolean;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const lock = currentDaemonServiceLifecycleLock();
  const attached = lock !== null && process.platform !== "win32";
  const child = spawn(
    attached ? "/bin/sh" : input.command,
    attached
      ? [
          "-c",
          EXEC_HANDSHAKE,
          "openmeld-native-command",
          input.command,
          ...input.args,
        ]
      : input.args,
    {
      stdio: [attached ? "pipe" : "ignore", "pipe", "pipe"],
      env: input.env ?? process.env,
      windowsHide: true,
    }
  );
  let stdout = "";
  let stderr = "";
  let spawnError: Error | undefined;
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("error", (error) => {
    spawnError = error;
  });
  // EPIPE is expected when a waiting participant exits before the grant.
  child.stdin?.on("error", () => undefined);
  const completion = new Promise<number>((resolve) => {
    child.once("close", (code) => resolve(code ?? 1));
  });
  let participant: OpenMeldLock | undefined;
  try {
    if (attached) {
      if (!child.pid) {
        throw new Error("Native command did not establish a process.");
      }
      participant = await attachLockProcess(lock, child.pid);
      child.stdin?.end("execute\n");
    }
    const exitCode = await completion;
    if (input.throwOnError && (spawnError || exitCode !== 0)) {
      throw (
        spawnError ??
        new Error(
          [
            `command failed: ${input.command} ${input.args.join(" ")}`,
            stdout.trim(),
            stderr.trim(),
          ]
            .filter(Boolean)
            .join(" | ")
        )
      );
    }
    return {
      exitCode,
      stdout,
      stderr: `${stderr}${spawnError ? String(spawnError) : ""}`,
    };
  } finally {
    child.stdin?.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    await completion;
    if (participant) {
      await releaseLock(participant);
    }
  }
}
