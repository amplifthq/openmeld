import { spawn } from "node:child_process";
import { startWindowsIdleSleepBlocker } from "@openmeld/adapter-core/windows-system";

export function supportsIdleSleepPrevention() {
  return process.platform === "darwin" || process.platform === "win32";
}

export async function acquireIdleSleepPrevention(
  onLost: (message: string) => void
): Promise<() => Promise<void>> {
  if (!supportsIdleSleepPrevention()) {
    throw new Error(
      "Sleep prevention is not supported on this operating system."
    );
  }
  const child =
    process.platform === "darwin"
      ? spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], {
          stdio: ["pipe", "pipe", "pipe"],
        })
      : startWindowsIdleSleepBlocker();
  let releasing = false;
  const exited = new Promise<void>((resolve) =>
    child.once("close", () => {
      if (!releasing) {
        onLost(
          "Sleep prevention stopped unexpectedly. Turn the setting off and on to try again."
        );
      }
      resolve();
    })
  );
  child.on("error", () => undefined);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              "Sleep prevention did not start. Update or repair OpenMeld Service."
            )
          ),
        5000
      );
      const finish = (error?: Error) => {
        clearTimeout(timer);
        child.removeListener("error", fail);
        child.removeListener("exit", earlyExit);
        error ? reject(error) : resolve();
      };
      const fail = (error: Error) => finish(error);
      const earlyExit = () =>
        finish(
          new Error(
            "Sleep prevention could not start. Update or repair OpenMeld Service."
          )
        );
      child.once("error", fail);
      child.once("exit", earlyExit);
      if (process.platform === "darwin") {
        child.once("spawn", () => finish());
      } else {
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
          if (output.includes("openmeld-idle-sleep-held-v1")) {
            finish();
          }
        });
      }
    });
  } catch (error) {
    releasing = true;
    child.kill();
    await exited;
    throw error;
  }
  return async () => {
    releasing = true;
    child.stdin.end();
    if (process.platform === "darwin") {
      child.kill();
    }
    await exited;
  };
}
