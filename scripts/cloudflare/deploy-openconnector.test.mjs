import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const entrypoint = new URL("./deploy-openconnector.mjs", import.meta.url);
const sourceArguments = [
  "--source",
  "/does-not-exist",
  "--source-sha",
  "a".repeat(40),
];

for (const environmentArguments of [
  [],
  ["--environment", "prd"],
  ["--environment", "staging", "--", "--environment", "production"],
]) {
  test(`rejects an ambiguous deployment target before inspecting or modifying resources: ${environmentArguments.join(" ") || "missing"}`, () => {
    const result = spawnSync(
      process.execPath,
      [entrypoint.pathname, ...environmentArguments, ...sourceArguments],
      { encoding: "utf8" }
    );
    assert.notEqual(result.status, 0);
    assert.ok(
      result.stderr.includes("explicit production or staging environment") ||
        result.stderr.includes("Duplicate option: --environment")
    );
    assert.equal(result.stderr.includes("package.json was not found"), false);
    assert.equal(result.stdout.includes("Deploying OpenConnector"), false);
  });
}
