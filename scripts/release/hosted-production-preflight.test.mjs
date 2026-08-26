import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runHostedProductionPreflight } from "./hosted-production-preflight.mjs";

test("current control preflights a historical release source that predates the control", async () => {
  const root = mkdtempSync(
    path.join(tmpdir(), "openmeld-historical-preflight-")
  );
  const repository = path.join(root, "repository");
  const releaseSource = path.join(root, "release-source");
  const controlRoot = path.join(root, "release-control");
  const git = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    mkdirSync(repository);
    git(repository, "init", "--initial-branch=main", "--quiet");
    git(repository, "config", "user.email", "preflight@test.openmeld.ai");
    git(repository, "config", "user.name", "OpenMeld Preflight Test");
    writeFileSync(path.join(repository, "product.txt"), "historical product\n");
    git(repository, "add", "product.txt");
    git(repository, "commit", "--quiet", "-m", "historical product");
    const releaseSha = git(repository, "rev-parse", "HEAD");

    mkdirSync(path.join(repository, "scripts", "cloudflare"), {
      recursive: true,
    });
    mkdirSync(path.join(repository, "scripts", "ci"), { recursive: true });
    writeFileSync(
      path.join(
        repository,
        "scripts",
        "cloudflare",
        "verify-worker-env-contract.mjs"
      ),
      [
        'import { readFileSync } from "node:fs";',
        'import path from "node:path";',
        'if (readFileSync(path.join(process.env.OPENMELD_VERIFICATION_ROOT, "product.txt"), "utf8") !== "historical product\\n") process.exit(91);',
        "",
      ].join("\n")
    );
    writeFileSync(
      path.join(repository, "scripts", "ci", "check-retired-identifiers.sh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'test "$(cat "$OPENMELD_VERIFICATION_ROOT/product.txt")" = "historical product"',
        "",
      ].join("\n")
    );
    git(repository, "add", "scripts");
    git(repository, "commit", "--quiet", "-m", "add current preflight control");
    git(repository, "worktree", "add", "--detach", releaseSource, releaseSha);
    git(repository, "worktree", "add", "--detach", controlRoot, "HEAD");

    await runHostedProductionPreflight({
      controlRoot,
      releaseSha,
      releaseSource,
      scope: "web",
    });

    const historicalControlProbe = spawnSync(
      "git",
      [
        "cat-file",
        "-e",
        "HEAD:scripts/release/hosted-production-preflight.mjs",
      ],
      { cwd: releaseSource, encoding: "utf8" }
    );
    assert.notEqual(historicalControlProbe.status, 0);
    assert.equal(
      existsSync(
        path.join(
          releaseSource,
          "scripts",
          "cloudflare",
          "verify-worker-env-contract.mjs"
        )
      ),
      false
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
