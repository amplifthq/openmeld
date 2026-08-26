import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyTrustedCandidateEntrypoints } from "./verify-trusted-candidate-entrypoints.mjs";

test("rejects a candidate that rewrites the package script used to validate itself", () => {
  const fixture = createFixture();
  try {
    writeManifest(fixture.candidateRoot, {
      candidate: "node scripts/ci/forged-runner.mjs",
      "verify:pr": "true",
    });

    assert.throws(
      () =>
        verifyTrustedCandidateEntrypoints({
          candidateRoot: fixture.candidateRoot,
          paths: ["package.json"],
          trustedRoot: fixture.trustedRoot,
        }),
      /cannot let the candidate rewrite its own test-control entrypoints/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("accepts product source changes when validation entrypoints are unchanged", () => {
  const fixture = createFixture();
  try {
    const result = verifyTrustedCandidateEntrypoints({
      candidateRoot: fixture.candidateRoot,
      paths: ["package.json", "turbo.json", "pnpm-workspace.yaml"],
      trustedRoot: fixture.trustedRoot,
    });

    assert.deepEqual(result.checkedPaths, [
      "package.json",
      "turbo.json",
      "pnpm-workspace.yaml",
    ]);
  } finally {
    fixture.cleanup();
  }
});

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-trusted-candidate-"));
  const trustedRoot = path.join(root, "trusted");
  const candidateRoot = path.join(root, "candidate");
  mkdirSync(trustedRoot);
  mkdirSync(candidateRoot);
  for (const repoRoot of [trustedRoot, candidateRoot]) {
    writeManifest(repoRoot, {
      candidate: "node scripts/ci/final-candidate.mjs",
      "verify:pr": "node scripts/dev/turbo-affected.mjs check test",
    });
    writeFileSync(path.join(repoRoot, "turbo.json"), '{"tasks":{}}\n');
    writeFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "packages: []\n");
  }
  return {
    candidateRoot,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    trustedRoot,
  };
}

function writeManifest(root, scripts) {
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ packageManager: "pnpm@10.30.0", scripts })}\n`
  );
}
