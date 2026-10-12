import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const STATUS_UNAVAILABLE = /GitHub status admission unavailable in fixture/u;

test("automatic release CLI reaches status admission and reports its error", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openmeld-release-cli-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    // Keep Git real, with a local-only origin. The first GitHub read is the
    // external boundary: reject it before any release or network operation.
    writeFileSync(path.join(root, "fixture.txt"), "release fixture\n");
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "Release Test");
    git("config", "user.email", "release-test@openmeld.ai");
    const capture = path.join(root, ".git", "github-call.json");
    const preload = path.join(root, ".git", "github-boundary.mjs");
    writeFileSync(
      preload,
      `
import childProcess from "node:child_process";
import { writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const original = childProcess.execFileSync;
childProcess.execFileSync = (command, args, options) => {
  if (command === "gh" || command === "gh.exe") {
    writeFileSync(${JSON.stringify(capture)}, JSON.stringify(args));
    throw new Error("GitHub status admission unavailable in fixture");
  }
  return original(command, args, options);
};
syncBuiltinESMExports();
`
    );
    git("add", "fixture.txt");
    git("commit", "--quiet", "-m", "fixture");
    git("remote", "add", "origin", root);
    const manifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
    );
    const [, script, command] = manifest.scripts.deploy.split(" ");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        path.join(repositoryRoot, script),
        command,
        "--base",
        "HEAD",
      ],
      { cwd: root, encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, STATUS_UNAVAILABLE);
    assert.deepEqual(JSON.parse(readFileSync(capture, "utf8")), [
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "--jq",
      ".nameWithOwner",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
