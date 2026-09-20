import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { desktopWebBuildIdentity } from "./web-build-identity.mjs";

test("identity follows build contents across unstaged and staged deletions", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-desktop-identity-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  try {
    git("init");
    mkdirSync(path.join(root, "clients/web"), { recursive: true });
    const source = path.join(root, "clients/web/entry.ts");
    writeFileSync(source, "first build");
    git("add", "clients/web/entry.ts");
    const original = desktopWebBuildIdentity(root);
    writeFileSync(source, "changed build");
    assert.notEqual(desktopWebBuildIdentity(root), original);
    rmSync(source);
    const deleted = desktopWebBuildIdentity(root);
    assert.notEqual(deleted, original);
    git("rm", "--cached", "clients/web/entry.ts");
    assert.equal(desktopWebBuildIdentity(root), deleted);
    writeFileSync(source, "first build");
    assert.equal(desktopWebBuildIdentity(root), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
