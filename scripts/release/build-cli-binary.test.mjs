import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildBunCompileArgs,
  collectCliBinaryMetadata,
  resolveCliBinaryArtifactName,
  resolveCliBinaryOutDir,
  resolveDefaultCliBinaryOutDir,
} from "./build-cli-binary.mjs";

test("minifies release code while keeping function and class names for diagnostics", () => {
  assert.deepEqual(
    buildBunCompileArgs({
      bunTarget: "bun-darwin-arm64",
      entry: "/repo/clients/openmeld-cli/src/openmeld.ts",
      outFile: "/tmp/openmeld",
      version: "0.3.122-staging.20260827160000.3053009",
    }),
    [
      "build",
      "/repo/clients/openmeld-cli/src/openmeld.ts",
      "--compile",
      "--target=bun-darwin-arm64",
      "--define",
      '__OPENMELD_DISTRIBUTION__="binary"',
      "--define",
      '__OPENMELD_VERSION__="0.3.122-staging.20260827160000.3053009"',
      "--minify",
      "--keep-names",
      "--outfile",
      "/tmp/openmeld",
    ]
  );
});

test("keeps CLI binary release artifacts outside the npm package dist", () => {
  assert.equal(
    resolveDefaultCliBinaryOutDir("/repo"),
    join("/repo", "cli", "dist")
  );
});

test("derives the CLI binary artifact name from platform and version", () => {
  assert.equal(
    resolveCliBinaryArtifactName({
      platform: "darwin-arm64",
      version: "0.2.10",
    }),
    "openmeld-cli-darwin-arm64-0.2.10"
  );
});

test("resolves custom binary output directories from the repository root", () => {
  assert.equal(
    resolveCliBinaryOutDir("dev-tmp/signing-smoke", "/repo"),
    join("/repo", "dev-tmp", "signing-smoke")
  );
  assert.equal(
    resolveCliBinaryOutDir("/tmp/signing-smoke", "/repo"),
    join("/tmp", "signing-smoke")
  );
});

test("collects sha256 and size from the final on-disk binary", () => {
  const directory = mkdtempSync(join(tmpdir(), "openmeld-cli-metadata-"));
  const outFile = join(directory, "openmeld");
  try {
    writeFileSync(outFile, "unsigned");
    writeFileSync(outFile, "signed-binary");

    assert.deepEqual(collectCliBinaryMetadata(outFile), {
      sha256: createHash("sha256").update("signed-binary").digest("hex"),
      sizeBytes: 13,
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
