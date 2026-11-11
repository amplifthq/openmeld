import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTlc } from "../formal-verification-tlc/run-tlc.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
execFileSync(
  "pnpm",
  [
    "--filter",
    "openmeld-web",
    "exec",
    "vitest",
    "run",
    "src/query/spaces/active-wake-progress.test.ts",
  ],
  { cwd: path.resolve(here, "../../.."), stdio: "inherit" }
);

await runTlc({ specDir: here, moduleName: "WakeProgress" });
console.log(
  "Wake progress: Web keeps matching progress hidden after observing a published outcome."
);
