import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CUTOVER_UNAVAILABLE_PATTERN =
  /PostgreSQL product cutover is unavailable/u;
const MISSING_COMMAND_PATTERN = /ENOENT|not found/u;

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
test("the PostgreSQL candidate blocks product deployment and D1 writes before external commands", () => {
  for (const args of [
    ["scripts/release/production-release.mjs", "deploy", "--scope", "core"],
    ["scripts/release/production-db.mjs"],
    ["scripts/release/staging-release.mjs", "deploy"],
  ]) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: { ...process.env, PATH: "" },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, CUTOVER_UNAVAILABLE_PATTERN);
    assert.doesNotMatch(result.stderr, MISSING_COMMAND_PATTERN);
  }
});
