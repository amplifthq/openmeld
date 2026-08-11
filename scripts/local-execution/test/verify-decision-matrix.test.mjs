import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "verify-decision-matrix.mjs"
);

const REQUIRE_ALL_FLAGS = [
  "--require-owner",
  "--require-scope",
  "--require-evidence",
];

const OUTPUT_PATTERNS = {
  duplicateId: /duplicate id "D-001"/,
  emptyArray: /decision-matrix block cannot be empty/,
  invalidPhase: /invalid phase "unknown-phase"/,
  invalidJson: /invalid JSON in decision-matrix block/,
  missingPhase: /field "phase" must be a non-empty string/,
  missingBlock: /missing ```json decision-matrix``` block/,
  nonStringId: /field "id" must be a non-empty string/,
  success: /decision matrix verified: 1 rows/,
};

const VALID_ROW = {
  id: "D-001",
  decision: "Decision",
  task: "Task",
  owner: "runtime",
  scope: "runtime/local-execution",
  phase: "control-plane",
  evidence: "test evidence",
  checkCommand: "pnpm turbo run test --filter=@openmeld/local-execution",
};

const createMatrixMarkdown = (rows) =>
  `# Matrix\n\n\`\`\`json decision-matrix\n${JSON.stringify(rows, null, 2)}\n\`\`\`\n`;

const runCliWithMarkdown = async (markdown, args = []) => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "local-execution-matrix-")
  );
  const matrixPath = path.join(tempDir, "matrix.md");

  try {
    await writeFile(matrixPath, markdown, "utf8");
    return spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--matrix", matrixPath, ...args],
      {
        encoding: "utf8",
      }
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
};

test("passes for a valid matrix", async () => {
  const result = await runCliWithMarkdown(
    createMatrixMarkdown([VALID_ROW]),
    REQUIRE_ALL_FLAGS
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, OUTPUT_PATTERNS.success);
});

test("fails when decision-matrix block is missing", async () => {
  const result = await runCliWithMarkdown("# no block\n", REQUIRE_ALL_FLAGS);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, OUTPUT_PATTERNS.missingBlock);
});

test("fails when decision-matrix JSON is invalid", async () => {
  const result = await runCliWithMarkdown(
    "# Matrix\n\n```json decision-matrix\n{invalid json}\n```\n",
    REQUIRE_ALL_FLAGS
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, OUTPUT_PATTERNS.invalidJson);
});

test("fails when decision-matrix array is empty", async () => {
  const result = await runCliWithMarkdown(
    createMatrixMarkdown([]),
    REQUIRE_ALL_FLAGS
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, OUTPUT_PATTERNS.emptyArray);
});

test("fails for duplicate id", async () => {
  const rows = [{ ...VALID_ROW }, { ...VALID_ROW }];
  const result = await runCliWithMarkdown(
    createMatrixMarkdown(rows),
    REQUIRE_ALL_FLAGS
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, OUTPUT_PATTERNS.duplicateId);
});

test("fails for invalid phase", async () => {
  const rows = [{ ...VALID_ROW, phase: "unknown-phase" }];
  const result = await runCliWithMarkdown(
    createMatrixMarkdown(rows),
    REQUIRE_ALL_FLAGS
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, OUTPUT_PATTERNS.invalidPhase);
});

test("fails when phase is missing", async () => {
  const row = { ...VALID_ROW };
  // biome-ignore lint/performance/noDelete: test fixture mutation is intentional
  delete row.phase;
  const result = await runCliWithMarkdown(
    createMatrixMarkdown([row]),
    REQUIRE_ALL_FLAGS
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, OUTPUT_PATTERNS.missingPhase);
});

test("fails for non-string field values", async () => {
  const rows = [{ ...VALID_ROW, id: { raw: "D-001" } }];
  const result = await runCliWithMarkdown(
    createMatrixMarkdown(rows),
    REQUIRE_ALL_FLAGS
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, OUTPUT_PATTERNS.nonStringId);
});
