import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { dirname } from "node:path";
import { initializeWindowsTaskEntry } from "../../src/local-service/lifecycle/windows-task-entry";

initializeWindowsTaskEntry();
const args = process.argv.slice(2);
if (args[0] === "child") {
  console.log("inherited child stdout 中文");
  console.error("inherited child stderr");
} else {
  console.log(
    JSON.stringify({
      stage: "direct_task",
      pid: process.pid,
      executable: process.execPath,
      args,
      value: process.env.OPENMELD_TASK_FIXTURE,
    })
  );
  console.error("direct task stderr");
  process.stdout.write("direct stream stdout\n");
  process.stderr.write("direct stream stderr\n");
  const child = spawn(process.execPath, ["child"], {
    stdio: ["ignore", process.stdout.fd, process.stderr.fd],
    windowsHide: true,
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) {
    throw new Error(`Fixture child exited with ${code}.`);
  }
  const release = process.env.OPENMELD_TASK_FIXTURE_RELEASE;
  if (release) {
    console.log("direct task waiting for release");
    await new Promise<void>((resolve, reject) => {
      const watcher = watch(dirname(release));
      const deadline = setTimeout(
        () => finish(new Error("Direct task fixture release timed out.")),
        30_000
      );
      const finish = (error?: Error) => {
        clearTimeout(deadline);
        watcher.close();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      watcher.on("error", (error) => finish(error));
      watcher.on("change", () => {
        if (existsSync(release)) {
          finish();
        }
      });
      if (existsSync(release)) {
        finish();
      }
    });
  }
  // Immediate exit also has to retain all log writes; no async copy must keep
  // the supervised process alive after its actual work has finished.
  process.exit(Number(args[0]) || 0);
}
