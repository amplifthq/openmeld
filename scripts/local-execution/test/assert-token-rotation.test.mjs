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
  "assert-token-rotation.mjs"
);

const OUTPUT_PATTERNS = {
  staleToken: /token is older than allowed window/,
  success: /token rotation check passed/,
};

const runScriptWithTokenState = async (tokenState, args = []) => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "local-execution-token-")
  );
  const tokenPath = path.join(tempDir, "daemon-token.json");

  try {
    await writeFile(tokenPath, `${JSON.stringify(tokenState, null, 2)}\n`);
    return spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--token-file", tokenPath, ...args],
      {
        encoding: "utf8",
      }
    );
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
};

test("passes when token age is within the allowed window", async () => {
  const now = new Date().toISOString();
  const result = await runScriptWithTokenState({
    v: 1,
    schema: "openmeld-daemon-token-v1",
    token: "token-1234567890-abcdefgh",
    issuedAt: now,
    updatedAt: now,
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, OUTPUT_PATTERNS.success);
});

test("fails when token is older than max age", async () => {
  const stale = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
  const result = await runScriptWithTokenState(
    {
      v: 1,
      schema: "openmeld-daemon-token-v1",
      token: "token-1234567890-abcdefgh",
      issuedAt: stale,
      updatedAt: stale,
    },
    ["--max-age-hours", "24"]
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, OUTPUT_PATTERNS.staleToken);
});
