import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = "openmeld-windows-process.exe";
const source = path.resolve(cli, "../../cli/dist", name);
if (existsSync(source)) {
  const directory = path.join(cli, "dist/native");
  mkdirSync(directory, { recursive: true });
  copyFileSync(source, path.join(directory, name));
} else if (process.platform === "win32") {
  throw new Error(
    "Build the Windows process helper before building the CLI: node scripts/release/build-windows-process-helper.mjs"
  );
}
