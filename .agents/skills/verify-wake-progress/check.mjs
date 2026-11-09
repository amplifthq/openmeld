import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTlc } from "../formal-verification-tlc/run-tlc.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const run = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repo, stdio: "inherit" });
    child.on("error", (error) => {
      console.error(error.message);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });

const vitest = await run("pnpm", [
  "--filter",
  "@openmeld/space",
  "exec",
  "vitest",
  "run",
  "--config",
  path.join(here, "vitest.config.ts"),
]);
if (vitest !== 0) {
  process.exit(vitest);
}

const holds = await runTlc({
  specDir: here,
  moduleName: "WakeProgress",
  invariants: ["TypeOK", "ClosedRowStaysClosed"],
});
if (!holds.passed) {
  fail(holds.output.slice(-2000));
}

for (const name of ["StopIsNotShownAsFailure", "StopIsNotClearedByAReply"]) {
  const broken = await runTlc({
    specDir: here,
    moduleName: "WakeProgress",
    invariants: [name],
  });
  if (!broken.violated.includes(name)) {
    fail(
      `${name} no longer fails. If the banner now keeps a stop, update WakeProgress.tla and this check. Otherwise the model no longer matches applyWakeProgressSignals.\n${broken.output.slice(-1500)}`
    );
  }
}

console.log(
  "Wake progress: a closed banner stays closed. A later failure notice or final reply still replaces a stop; those two findings are unchanged."
);
