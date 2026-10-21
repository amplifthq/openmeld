import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const verifier = fileURLToPath(
  new URL("./require-mainline-release-sha.mjs", import.meta.url)
);

test("emits only verified first-parent SHAs for downstream release jobs", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "release-mainline-"));
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Release Test",
        "-c",
        "user.email=release-test@example.test",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
  try {
    git("init", "--quiet", "--initial-branch=main");
    git("commit", "--quiet", "--allow-empty", "-m", "initial");
    const initial = git("rev-parse", "HEAD");
    git("switch", "--quiet", "-c", "feature");
    git("commit", "--quiet", "--allow-empty", "-m", "feature");
    const feature = git("rev-parse", "HEAD");
    git("switch", "--quiet", "main");
    git("commit", "--quiet", "--allow-empty", "-m", "main");
    git("merge", "--quiet", "--no-ff", "feature", "-m", "merge feature");
    const merged = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", merged);

    for (const [sha, accepted] of [
      [initial, true],
      [merged, true],
      [feature, false],
      [merged.slice(0, 7), false],
      ["f".repeat(40), false],
    ]) {
      const result = spawnSync(process.execPath, [verifier, sha], {
        cwd,
        encoding: "utf8",
      });
      assert.equal(result.status, accepted ? 0 : 1, result.stderr);
      assert.equal(result.stdout, accepted ? `${sha}\n` : "");
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
