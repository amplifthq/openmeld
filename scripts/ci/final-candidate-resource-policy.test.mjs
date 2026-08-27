import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
);
const OVERLAPPED_CHECK_AND_TEST_PATTERN =
  /turbo-affected\.mjs(?: --changed-only)? check test/u;
const SEPARATE_CHECK_AND_TEST_PHASES_PATTERN =
  /turbo-affected\.mjs(?: --changed-only)? check -- --concurrency=2 && node scripts\/dev\/turbo-affected\.mjs(?: --changed-only)? test -- --concurrency=2/u;
const SERIAL_INTEGRATION_PHASE_PATTERN =
  /turbo-affected\.mjs test:integration -- --concurrency=1/u;

test("runs memory-heavy affected task families in separate phases", () => {
  for (const scriptName of [
    "verify:pre-push:full",
    "verify:pr",
    "verify:pr:full",
  ]) {
    const command = packageJson.scripts[scriptName];
    assert.equal(typeof command, "string", `${scriptName} must exist`);
    assert.doesNotMatch(
      command,
      OVERLAPPED_CHECK_AND_TEST_PATTERN,
      `${scriptName} must not overlap check and test in one Turbo run`
    );
    assert.match(
      command,
      SEPARATE_CHECK_AND_TEST_PHASES_PATTERN,
      `${scriptName} must preserve package-level parallelism in two phases`
    );
  }
});

test("keeps full integration confidence bounded to one heavy task at a time", () => {
  assert.match(
    packageJson.scripts["verify:pr:full"],
    SERIAL_INTEGRATION_PHASE_PATTERN
  );
});
