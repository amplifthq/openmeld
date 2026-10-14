import assert from "node:assert/strict";
import test from "node:test";

import { isFinalCandidateControlPath } from "./final-candidate-control-paths.mjs";

test("trusts production release checks and their orchestration from current main", () => {
  for (const name of [
    "hosted-production-preflight",
    "production-artifact-check",
    "production-release",
    "production-release-status",
    "production-release-status-regressions",
    "production-stage-admission",
    "production-train-artifact-admission",
    "production-web-health",
    "renderer-build",
  ]) {
    assert.equal(
      isFinalCandidateControlPath(`scripts/release/${name}.mjs`),
      true,
      name
    );
    assert.equal(
      isFinalCandidateControlPath(`scripts/release/${name}.test.mjs`),
      true,
      `${name} test`
    );
  }
});

test("does not broaden trusted control to arbitrary production release scripts", () => {
  assert.equal(
    isFinalCandidateControlPath("scripts/release/production-example.mjs"),
    false
  );
});

test("protects both candidate execution and result publication workflows", () => {
  for (const name of ["final-candidate", "final-candidate-result"]) {
    assert.equal(
      isFinalCandidateControlPath(`.github/workflows/${name}.yml`),
      true
    );
  }
});
