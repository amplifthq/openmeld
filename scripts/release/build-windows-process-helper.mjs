import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  importWindowsProcessArtifact,
  writeWindowsProcessArtifact,
} from "./windows-process-artifact.mjs";

// Build-time only: the published Native AOT executable requires neither dotnet
// nor a compiler on the user's computer. Keep compilation on native Windows.
if (process.platform !== "win32") {
  throw new Error("Build the native Windows process helper on Windows.");
}
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const buildRoot = path.join(root, "dev-tmp/windows-process-helper");
const output = path.join(root, "cli/dist");
mkdirSync(buildRoot, { recursive: true });
mkdirSync(output, { recursive: true });
const result = spawnSync(
  "dotnet",
  [
    "publish",
    path.join(
      root,
      "runtime/adapters/core/native/windows/OpenMeld.Windows.Process.csproj"
    ),
    "--configuration",
    "Release",
    "--runtime",
    "win-x64",
    "--output",
    output,
    `-p:BaseIntermediateOutputPath=${path.join(buildRoot, "obj")}${path.sep}`,
    `-p:BaseOutputPath=${path.join(buildRoot, "bin")}${path.sep}`,
  ],
  {
    cwd: path.join(root, "runtime/adapters/core/native/windows"),
    stdio: "inherit",
    timeout: 300_000,
  }
);
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(`Windows process helper build failed (${result.status}).`);
}
writeWindowsProcessArtifact(output, root);
importWindowsProcessArtifact(output, root);
