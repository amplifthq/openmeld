import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  verifyWindowsProcessArtifact,
  WINDOWS_PROCESS_FILE,
} from "../../../scripts/release/windows-process-artifact.mjs";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = WINDOWS_PROCESS_FILE;
const source = path.resolve(cli, "../../cli/dist", name);
if (existsSync(source)) {
  verifyWindowsProcessArtifact(
    path.dirname(source),
    path.resolve(cli, "../..")
  );
  const directory = path.join(cli, "dist/windows");
  mkdirSync(directory, { recursive: true });
  copyFileSync(source, path.join(directory, name));
} else if (process.platform === "win32") {
  throw new Error(
    "Build the Windows process helper before building the CLI: node scripts/release/build-windows-process-helper.mjs"
  );
}
