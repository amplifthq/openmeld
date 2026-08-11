import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  RUNTIME_TOKEN_CONTRACT_CHECKS,
  verifyRuntimeTokenContract,
} from "../verify-runtime-token-contract.mjs";

const EXECUTION_TOKEN_REQUIRED_RE = /execution_token_required/u;
const MISSING_MARKER_FAILURE_RE = /missing_marker: pattern not found/u;

test("passes against the repository runtime token contract", () => {
  const result = verifyRuntimeTokenContract();

  assert.equal(result.checked, RUNTIME_TOKEN_CONTRACT_CHECKS.length);
});

test("fails when a required runtime token contract marker is missing", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "openmeld-token-contract-")
  );
  try {
    await writeFile(
      path.join(tempDir, "contract.ts"),
      "export const noop = 1;\n"
    );

    assert.throws(
      () =>
        verifyRuntimeTokenContract({
          repoRoot: tempDir,
          checks: [
            {
              id: "missing_marker",
              file: "contract.ts",
              pattern: EXECUTION_TOKEN_REQUIRED_RE,
            },
          ],
        }),
      MISSING_MARKER_FAILURE_RE
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
