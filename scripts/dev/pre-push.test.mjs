import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runFocusedPrePush } from "./pre-push.mjs";

const MALFORMED = /malformed/u;
const DIRTY_TREE = /clean worktree/u;
const SHA = "1".repeat(40);
const REMOTE_SHA = "2".repeat(40);
const update = `refs/heads/feature ${SHA} refs/heads/feature ${REMOTE_SHA}`;

test("a failed focused check blocks push; successful checks recheck the exact tree", () => {
  for (const status of [0, 7]) {
    let headChecks = 0;
    let treeChecks = 0;
    const result = runFocusedPrePush(update, {
      assertHead: () => {
        headChecks += 1;
      },
      assertClean: () => {
        treeChecks += 1;
      },
      resolveBase: () => REMOTE_SHA,
      verify: (options) => {
        assert.deepEqual(options, {
          base: REMOTE_SHA,
          feedback: true,
          committed: true,
        });
        return status;
      },
    });
    assert.equal(result, status);
    assert.equal(headChecks, status ? 1 : 2);
    assert.equal(treeChecks, status ? 1 : 2);
  }
});

test("deletions and protected release updates do not run development tests", () => {
  for (const input of [
    `refs/heads/feature ${"0".repeat(40)} refs/heads/feature ${REMOTE_SHA}`,
    `refs/heads/main ${SHA} refs/heads/main ${REMOTE_SHA}`,
    `refs/tags/v1 ${SHA} refs/tags/v1 ${REMOTE_SHA}`,
  ]) {
    assert.equal(
      runFocusedPrePush(input, {
        verify: () => assert.fail("unexpected development tests"),
      }),
      0
    );
  }
  assert.throws(() => runFocusedPrePush("malformed"), MALFORMED);
});

test("actual Git history selects new commits and rejects an uncommitted test tree", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-pre-push-test-"));
  const run = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    run("init", "-b", "feature");
    run("config", "user.name", "Test");
    run("config", "user.email", "test@example.invalid");
    run(
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--allow-empty",
      "-m",
      "initial"
    );
    const base = run("rev-parse", "HEAD");
    run("update-ref", "refs/remotes/origin/main", base);
    run(
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--allow-empty",
      "-m",
      "candidate"
    );
    const head = run("rev-parse", "HEAD");
    const moduleUrl = new URL("./pre-push.mjs", import.meta.url).href;
    const code = `import {runFocusedPrePush} from ${JSON.stringify(moduleUrl)}; runFocusedPrePush(${JSON.stringify(`refs/heads/feature ${head} refs/heads/feature ${base}`)}, {verify: (options) => {console.log(JSON.stringify(options)); return 0;}});`;
    const output = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", code, "test-driver"],
      { cwd: root, encoding: "utf8" }
    );
    assert.equal(JSON.parse(output).base, base);
    writeFileSync(path.join(root, "uncommitted.ts"), "export {};\n");
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          ["--input-type=module", "-e", code, "test-driver"],
          {
            cwd: root,
            stdio: "pipe",
          }
        ),
      DIRTY_TREE
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
