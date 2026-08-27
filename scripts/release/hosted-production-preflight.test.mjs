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

const TRUSTED_CHANNEL_GATE_FAILURE_PATTERN =
  /verify-release-ready\.mjs --current --channel-sync-check failed with exit code 93/u;

function buildHostedPreflightFixture(extraControlScripts = []) {
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
  mkdirSync(path.join(repository, "scripts", "release"), { recursive: true });
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
      'if (process.argv[2] !== "--profile" || process.argv[3] !== "production") process.exit(90);',
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
  writeFileSync(
    path.join(
      repository,
      "scripts",
      "cloudflare",
      "verify-production-queues.mjs"
    ),
    "#!/usr/bin/env node\nprocess.exit(0);\n"
  );
  for (const script of extraControlScripts) {
    writeFileSync(path.join(repository, script.path), script.content);
  }
  git(repository, "add", "scripts");
  git(repository, "commit", "--quiet", "-m", "add current preflight control");
  git(repository, "worktree", "add", "--detach", releaseSource, releaseSha);
  git(repository, "worktree", "add", "--detach", controlRoot, "HEAD");

  return {
    controlRoot,
    releaseSha,
    releaseSource,
    remove: () => rmSync(root, { force: true, recursive: true }),
  };
}

test("current control preflights a historical release source that predates the control", async () => {
  const fixture = buildHostedPreflightFixture();
  try {
    await runHostedProductionPreflight({
      controlRoot: fixture.controlRoot,
      releaseSha: fixture.releaseSha,
      releaseSource: fixture.releaseSource,
      scope: "web",
    });

    const historicalControlProbe = spawnSync(
      "git",
      [
        "cat-file",
        "-e",
        "HEAD:scripts/release/hosted-production-preflight.mjs",
      ],
      { cwd: fixture.releaseSource, encoding: "utf8" }
    );
    assert.notEqual(historicalControlProbe.status, 0);
    assert.equal(
      existsSync(
        path.join(
          fixture.releaseSource,
          "scripts",
          "cloudflare",
          "verify-worker-env-contract.mjs"
        )
      ),
      false
    );
  } finally {
    fixture.remove();
  }
});

test("hosted Core preflight runs the CLI channel compatibility gate through trusted control", async () => {
  const channelGateMarkerRelative = "channel-gate-ran.txt";
  const fixture = buildHostedPreflightFixture([
    {
      content: [
        "#!/usr/bin/env node",
        'import { writeFileSync } from "node:fs";',
        'import path from "node:path";',
        'if (process.argv[2] !== "--current" || process.argv[3] !== "--channel-sync-check") process.exit(92);',
        "writeFileSync(",
        '  path.join(process.env.OPENMELD_VERIFICATION_ROOT, "channel-gate-ran.txt"),',
        '  "ran\\n"',
        ");",
        "",
      ].join("\n"),
      path: "scripts/release/verify-release-ready.mjs",
    },
  ]);
  const channelGateMarker = path.join(
    fixture.releaseSource,
    channelGateMarkerRelative
  );

  try {
    await runHostedProductionPreflight({
      controlRoot: fixture.controlRoot,
      releaseSha: fixture.releaseSha,
      releaseSource: fixture.releaseSource,
      scope: "core",
    });

    assert.equal(existsSync(channelGateMarker), true);
  } finally {
    fixture.remove();
  }
});

test("hosted Core preflight preserves a trusted channel gate failure", async () => {
  const fixture = buildHostedPreflightFixture([
    {
      content: ["#!/usr/bin/env node", "process.exit(93);", ""].join("\n"),
      path: "scripts/release/verify-release-ready.mjs",
    },
  ]);

  try {
    await assert.rejects(
      runHostedProductionPreflight({
        controlRoot: fixture.controlRoot,
        releaseSha: fixture.releaseSha,
        releaseSource: fixture.releaseSource,
        scope: "core",
      }),
      TRUSTED_CHANNEL_GATE_FAILURE_PATTERN
    );
  } finally {
    fixture.remove();
  }
});
