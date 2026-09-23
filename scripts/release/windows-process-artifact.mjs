import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { windowsProcessArtifactSchema } from "../../packages/schemas/src/schemas/release/windows-process-artifact.ts";
import { WINDOWS_PROCESS_HELPER_FILENAME } from "../../packages/schemas/src/windows-artifact.ts";

export const WINDOWS_PROCESS_FILE = WINDOWS_PROCESS_HELPER_FILENAME;
export const WINDOWS_PROCESS_MANIFEST = "windows-process-artifact.json";
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const INPUTS = [
  "packages/schemas/src/schemas/release/windows-process-artifact.ts",
  "runtime/adapters/core/native/windows/OpenMeld.Windows.Process.csproj",
  "runtime/adapters/core/native/windows/ProcessJob.cs",
  "runtime/adapters/core/native/windows/Program.cs",
  "runtime/adapters/core/native/windows/global.json",
  "scripts/release/build-windows-process-helper.mjs",
  "scripts/release/windows-process-artifact.mjs",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const CRLF = /\r\n/gu;

export function windowsProcessSourceFingerprint(root = ROOT) {
  return sha256(
    INPUTS.map(
      // Git's Windows checkout may use CRLF. Native inputs are UTF-8 text;
      // fingerprint canonical source while preserving executable bytes exactly.
      (file) =>
        `${file}\0${sha256(readFileSync(path.join(root, file), "utf8").replace(CRLF, "\n"))}`
    ).join("\n")
  );
}

export function writeWindowsProcessArtifact(directory, root = ROOT) {
  const bytes = readFileSync(path.join(directory, WINDOWS_PROCESS_FILE));
  const manifest = windowsProcessArtifactSchema.parse({
    schemaVersion: 1,
    platform: "windows-x64",
    sourceSha256: windowsProcessSourceFingerprint(root),
    sha256: sha256(bytes),
    sizeBytes: bytes.length,
  });
  writeFileSync(
    path.join(directory, WINDOWS_PROCESS_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return manifest;
}

// This verifies local build inputs and bytes, not publisher trust. Production
// callers must acquire artifacts from their own trusted Windows build job.
export function verifyWindowsProcessArtifact(directory, root = ROOT) {
  const manifest = windowsProcessArtifactSchema.parse(
    JSON.parse(
      readFileSync(path.join(directory, WINDOWS_PROCESS_MANIFEST), "utf8")
    )
  );
  if (manifest.sourceSha256 !== windowsProcessSourceFingerprint(root)) {
    throw new Error(
      "The Windows process artifact does not match this checkout's native source."
    );
  }
  const bytes = readFileSync(path.join(directory, WINDOWS_PROCESS_FILE));
  if (
    manifest.sha256 !== sha256(bytes) ||
    manifest.sizeBytes !== bytes.length
  ) {
    throw new Error(
      "The Windows process artifact bytes do not match their build manifest."
    );
  }
  return manifest;
}

export function importWindowsProcessArtifact(directory, root = ROOT) {
  const manifest = verifyWindowsProcessArtifact(directory, root);
  const output = path.join(root, "cli/dist");
  const adapter = path.join(root, "runtime/adapters/core/dist/windows");
  for (const destination of [output, adapter]) {
    mkdirSync(destination, { recursive: true });
    for (const file of [WINDOWS_PROCESS_FILE, WINDOWS_PROCESS_MANIFEST]) {
      const source = path.resolve(directory, file);
      const target = path.join(destination, file);
      if (source !== target) {
        copyFileSync(source, target);
      }
    }
  }
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const directory = process.argv[2];
  if (!directory) {
    throw new Error(
      "Usage: node scripts/release/windows-process-artifact.mjs <downloaded-artifact-directory>"
    );
  }
  console.log(
    JSON.stringify(importWindowsProcessArtifact(path.resolve(directory)))
  );
}
