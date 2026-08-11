import assert from "node:assert/strict";
import test from "node:test";

import { findActiveDevLockHolder } from "./dev-lock.mjs";
import { buildProcessMatcherContext } from "./process-matchers.mjs";

test("accepts a live lock only when the pid still belongs to this repo dev guard", () => {
  const repoRoot = "C:\\repo";
  const matcherContext = buildProcessMatcherContext(repoRoot);
  const rows = [
    { pid: 123, command: "node C:\\repo\\scripts\\dev\\dev-guard.mjs" },
  ];

  const activeHolder = findActiveDevLockHolder({ pid: 123, repoRoot }, rows, {
    repoRoot,
    matcherContext,
    isPidAlive: () => true,
  });

  assert.deepEqual(activeHolder, rows[0]);
});

test("ignores stale lock pids that were reused by unrelated processes", () => {
  const repoRoot = "C:\\repo";
  const matcherContext = buildProcessMatcherContext(repoRoot);
  const rows = [
    {
      pid: 123,
      command: "node C:\\other\\node_modules\\tsx\\dist\\cli.mjs app.js",
    },
  ];

  const activeHolder = findActiveDevLockHolder({ pid: 123, repoRoot }, rows, {
    repoRoot,
    matcherContext,
    isPidAlive: () => true,
  });

  assert.equal(activeHolder, null);
});
