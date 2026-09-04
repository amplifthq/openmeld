import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildFinalCandidatePublisherBundle } from "./final-candidate-publisher-build.mjs";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const CHECKED_IN_BUNDLE = path.join(
  SCRIPT_DIRECTORY,
  "final-candidate-publisher.bundle.mjs"
);
const PACKAGE_IMPORT_PATTERN = /from\s*["'](?:zod|@openmeld|\.\.\/)/u;

test("the checked-in publisher is the exact zero-dependency trusted build", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "openmeld-fc-publisher-")
  );
  try {
    const generatedPath = path.join(temporaryDirectory, "publisher.mjs");
    await buildFinalCandidatePublisherBundle({ outputPath: generatedPath });
    const generated = readFileSync(generatedPath, "utf8");
    const checkedIn = readFileSync(CHECKED_IN_BUNDLE, "utf8");

    if (checkedIn !== generated) {
      throw new Error(
        "The trusted publisher bundle is stale. Run node scripts/ci/final-candidate-publisher-build.mjs."
      );
    }
    assert.doesNotMatch(checkedIn, PACKAGE_IMPORT_PATTERN);
    const publisher = await import(pathToFileURL(CHECKED_IN_BUNDLE).href);
    assert.equal(typeof publisher.assertEvidenceMatchesExecution, "function");
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});
