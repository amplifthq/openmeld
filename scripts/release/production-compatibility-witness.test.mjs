import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { compareGitPathContents } from "./production-release-status.mjs";

test("compares a deployed receiver boundary across real R1, R2, and R3 Git trees", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-receiver-witness-"));
  const receiverPath =
    "services/remote-agent/flue-adapter/execution-reconciliation.ts";
  const unrelatedPath = "services/remote-agent/src/unrelated-log.ts";
  const runGit = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    runGit("init", "--quiet");
    runGit("config", "user.email", "release-test@openmeld.test");
    runGit("config", "user.name", "OpenMeld Release Test");
    mkdirSync(path.dirname(path.join(root, receiverPath)), { recursive: true });
    writeFileSync(path.join(root, receiverPath), "export const version = 1;\n");
    runGit("add", ".");
    runGit("commit", "--quiet", "-m", "add old receiver");
    const r1 = runGit("rev-parse", "HEAD");

    writeFileSync(path.join(root, receiverPath), "export const version = 2;\n");
    runGit("add", ".");
    runGit("commit", "--quiet", "-m", "install receiver contract");
    const r2 = runGit("rev-parse", "HEAD");

    mkdirSync(path.dirname(path.join(root, unrelatedPath)), {
      recursive: true,
    });
    writeFileSync(path.join(root, unrelatedPath), "export const log = true;\n");
    runGit("add", ".");
    runGit("commit", "--quiet", "-m", "add unrelated backlog");
    const r3 = runGit("rev-parse", "HEAD");

    assert.equal(
      compareGitPathContents({
        cwd: root,
        fromSha: r2,
        paths: [receiverPath],
        toSha: r3,
      }),
      true
    );
    assert.equal(
      compareGitPathContents({
        cwd: root,
        fromSha: r1,
        paths: [receiverPath],
        toSha: r3,
      }),
      false
    );
    assert.throws(() =>
      compareGitPathContents({
        cwd: root,
        fromSha: "f".repeat(40),
        paths: [receiverPath],
        toSha: r3,
      })
    );
    assert.throws(() =>
      compareGitPathContents({
        cwd: root,
        fromSha: r2,
        paths: ["services/remote-agent/src/missing-at-both-refs.ts"],
        toSha: r3,
      })
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
