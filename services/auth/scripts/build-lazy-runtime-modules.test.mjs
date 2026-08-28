import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildLazyRuntimeModules } from "./build-lazy-runtime-modules.mjs";

const CREATE_AUTH_EXPORT_PATTERN = /createAuth/u;
const REQUEST_STATE_EXPORT_PATTERN = /runWithAuthRequestState/u;

test("builds a reusable request-only Better Auth module", async () => {
  const outputDirectory = mkdtempSync(
    path.join(tmpdir(), "openmeld-auth-runtime-")
  );
  try {
    const first = await buildLazyRuntimeModules(outputDirectory);
    const second = await buildLazyRuntimeModules(outputDirectory);
    const output = readFileSync(first.outputPath, "utf8");

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.match(output, CREATE_AUTH_EXPORT_PATTERN);
    assert.match(output, REQUEST_STATE_EXPORT_PATTERN);
  } finally {
    rmSync(outputDirectory, { force: true, recursive: true });
  }
});
