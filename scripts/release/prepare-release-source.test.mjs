import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareReleaseSource } from "./prepare-release-source.mjs";

test("materializes only admitted mainline source and preserves an existing checkout", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "prepare-release-source-"));
  const controlRoot = path.join(directory, "release-control");
  const sourceRoot = path.join(directory, "release-source");
  mkdirSync(controlRoot);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: controlRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "Release Test");
    git("config", "user.email", "release-test@example.test");
    git("config", "commit.gpgsign", "false");
    mkdirSync(path.join(directory, "hooks"));
    git("config", "core.hooksPath", path.join(directory, "hooks"));
    writeFileSync(path.join(controlRoot, "product.txt"), "released product\n");
    git("add", "product.txt");
    git("commit", "--quiet", "-m", "product");
    const releaseSha = git("rev-parse", "HEAD");
    git("commit", "--quiet", "--allow-empty", "-m", "new control");
    const controlSha = git("rev-parse", "HEAD");
    git("switch", "--quiet", "-c", "unmerged");
    git("commit", "--quiet", "--allow-empty", "-m", "unmerged source");
    const unmerged = git("rev-parse", "HEAD");
    git("switch", "--quiet", "main");

    for (const rejected of [unmerged, releaseSha.slice(0, 7), "f".repeat(40)]) {
      assert.throws(() =>
        prepareReleaseSource({ controlRoot, releaseSha: rejected })
      );
      assert.equal(existsSync(sourceRoot), false);
    }
    assert.deepEqual(prepareReleaseSource({ controlRoot, releaseSha }), {
      sourceRoot,
      releaseSha,
    });
    assert.equal(git("rev-parse", "HEAD"), controlSha);
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: sourceRoot,
        encoding: "utf8",
      }).trim(),
      releaseSha
    );
    assert.equal(
      spawnSync("git", ["symbolic-ref", "-q", "HEAD"], { cwd: sourceRoot })
        .status,
      1
    );
    assert.equal(
      readFileSync(path.join(sourceRoot, "product.txt"), "utf8"),
      "released product\n"
    );
    writeFileSync(path.join(sourceRoot, "keep.txt"), "existing work\n");
    assert.throws(() => prepareReleaseSource({ controlRoot, releaseSha }), {
      message: `Release source already exists: ${sourceRoot}`,
    });
    assert.equal(
      readFileSync(path.join(sourceRoot, "keep.txt"), "utf8"),
      "existing work\n"
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
