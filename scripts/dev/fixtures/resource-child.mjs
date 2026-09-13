import { spawn } from "node:child_process";
import { acquireLocalResources, RESOURCE_TOKEN } from "../local-resources.mjs";

const [mode, directory] = process.argv.slice(2);
if (mode === "leaf") {
  process.send({ type: "ready", pid: process.pid });
  setInterval(() => {
    /* Keep this intentionally uncooperative fixture alive. */
  }, 1000);
} else if (mode === "tree") {
  const leaf = spawn(process.execPath, [import.meta.filename, "leaf"], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  leaf.once("message", ({ pid }) =>
    process.send({ type: "ready", pid: process.pid, leafPid: pid })
  );
  // Deliberately leave the child behind; the owner must reclaim it.
  process.on("SIGTERM", () => process.exit(0));
} else {
  const controller = new AbortController();
  process.on("message", (message) => {
    if (message === "cancel") {
      controller.abort();
    }
  });
  try {
    process.send({ type: "attempting" });
    const reservation = await acquireLocalResources({
      kind: "heavy",
      gitCommonDir: directory,
      signal: controller.signal,
      // Arbitration tests use a controlled OS boundary; no real memory load.
      readMemory: () => ({
        totalBytes: 16 * 1024 ** 3,
        availableBytes: 12 * 1024 ** 3,
        pressure: "normal",
      }),
      onWait: () => process.send({ type: "waiting" }),
    });
    process.send({ type: "acquired" });
    process.on("message", async (message) => {
      if (message === "release") {
        await reservation.release();
        process.exit(0);
      }
      if (message === "nested") {
        const child = spawn(
          process.execPath,
          [import.meta.filename, "resource", directory],
          {
            env: { ...process.env, [RESOURCE_TOKEN]: reservation.token },
            stdio: ["ignore", "ignore", "inherit", "ipc"],
          }
        );
        child.on("message", (event) => {
          if (event.type === "acquired") {
            process.send({ type: "nested-acquired" });
            child.send("release");
          }
        });
      }
    });
  } catch (error) {
    if (!controller.signal.aborted) {
      throw error;
    }
    process.send({ type: "cancelled" });
    process.exitCode = 0;
    process.disconnect();
  }
}
