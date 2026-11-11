import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTlc } from "../formal-verification-tlc/run-tlc.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

const code = await new Promise((resolve) => {
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@openmeld/core",
      "exec",
      "vitest",
      "run",
      "--config",
      path.join(here, "vitest.config.ts"),
    ],
    { cwd: repo, stdio: "inherit" }
  );
  child.on("error", (error) => {
    console.error(error.message);
    resolve(1);
  });
  child.on("close", (status) => resolve(status ?? 1));
});
if (code !== 0) {
  process.exit(code);
}

await runTlc({ specDir: here, moduleName: "RuntimeCoordinatorLiveness" });

console.log(
  "RuntimeCoordinator liveness: fresh progress is not a failure, and the first terminal outcome sticks."
);
