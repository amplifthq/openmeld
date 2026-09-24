import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";

const args = process.argv.slice(2);
const gate = args.shift();
process.stdout.write(
  `${JSON.stringify({
    stage: "launcher_child",
    version: basename(dirname(process.execPath)),
    args,
    cwd: process.cwd(),
  })}\n`
);
process.stderr.write("launcher child stderr\n");
if (gate !== "immediate") {
  while (!existsSync(gate ?? "")) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
process.exitCode = 7;
