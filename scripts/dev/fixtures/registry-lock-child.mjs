import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { withRegistryLock } from "../dev-isolated-lane.mjs";

const [mode, lockPath] = process.argv.slice(2);
if (mode === "recovery") {
  // Hold the OS recovery lock at the crash boundary, without application cleanup.
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));
  const database = new DatabaseSync(`${lockPath}.reclaim`, { timeout: 0 });
  database.exec("BEGIN EXCLUSIVE");
  process.send("recovering");
  process.on("message", (message) => {
    // Retain the connection until the parent interrupts this process.
    if (message === "release") {
      database.close();
    }
  });
} else {
  process.send("attempting");
  await withRegistryLock(
    {
      lockPath,
      lockPid: process.pid,
      timeoutMs: 5000,
      isPidAlive: (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          if (error.code === "ESRCH") {
            return false;
          }
          throw error;
        }
      },
    },
    () =>
      new Promise((resolve) => {
        process.send("acquired");
        process.once("message", resolve);
      })
  );
  process.disconnect();
}
