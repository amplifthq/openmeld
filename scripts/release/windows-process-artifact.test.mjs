import assert from "node:assert/strict";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  importWindowsProcessArtifact,
  WINDOWS_PROCESS_FILE,
  writeWindowsProcessArtifact,
} from "./windows-process-artifact.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const WRONG_BYTES = /bytes do not match/u;
const WRONG_SOURCE = /does not match this checkout/u;
const LINE_ENDING = /\r?\n/gu;

test("imports one source-matched helper and rejects tampered bytes or changed native inputs before copying", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld helper artifact "));
  try {
    const native = "runtime/adapters/core/native/windows";
    const schema =
      "packages/schemas/src/schemas/release/windows-process-artifact.ts";
    mkdirSync(path.dirname(path.join(root, schema)), { recursive: true });
    copyFileSync(path.join(ROOT, schema), path.join(root, schema));
    copyFileSync(
      path.join(ROOT, "packages/schemas/src/windows-artifact.ts"),
      path.join(root, "packages/schemas/src/windows-artifact.ts")
    );
    cpSync(path.join(ROOT, native), path.join(root, native), {
      recursive: true,
    });
    mkdirSync(path.join(root, "scripts/release"), { recursive: true });
    for (const file of [
      "build-windows-process-helper.mjs",
      "windows-process-artifact.mjs",
    ]) {
      copyFileSync(
        path.join(ROOT, "scripts/release", file),
        path.join(root, "scripts/release", file)
      );
    }
    const artifact = path.join(root, "download");
    mkdirSync(artifact);
    // This check is about artifact integrity; native execution has its own gate.
    writeFileSync(
      path.join(artifact, WINDOWS_PROCESS_FILE),
      "fixture executable bytes"
    );
    writeWindowsProcessArtifact(artifact, root);
    const sourcePath = path.join(root, native, "Program.cs");
    writeFileSync(
      sourcePath,
      readFileSync(sourcePath, "utf8").replace(LINE_ENDING, "\r\n")
    );
    importWindowsProcessArtifact(artifact, root);
    for (const directory of [
      "cli/dist",
      "runtime/adapters/core/dist/windows",
    ]) {
      assert.equal(
        readFileSync(path.join(root, directory, WINDOWS_PROCESS_FILE), "utf8"),
        "fixture executable bytes"
      );
    }
    writeFileSync(path.join(artifact, WINDOWS_PROCESS_FILE), "modified bytes");
    assert.throws(
      () => importWindowsProcessArtifact(artifact, root),
      WRONG_BYTES
    );
    assert.equal(
      readFileSync(path.join(root, "cli/dist", WINDOWS_PROCESS_FILE), "utf8"),
      "fixture executable bytes"
    );
    writeFileSync(
      path.join(artifact, WINDOWS_PROCESS_FILE),
      "fixture executable bytes"
    );
    writeFileSync(
      path.join(root, native, "global.json"),
      "changed SDK selection"
    );
    assert.throws(
      () => importWindowsProcessArtifact(artifact, root),
      WRONG_SOURCE
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
