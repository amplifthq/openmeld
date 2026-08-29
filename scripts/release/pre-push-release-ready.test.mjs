import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertPushedObjectsMatchHead,
  assertReleaseVerificationWorktreeClean,
  resolvePrePushReleaseMode,
} from "./pre-push-release-ready.mjs";
import {
  assertVersionedReleaseBranchFacts,
  resolvePullRequestReleaseMode,
} from "./release-branch-policy.mjs";

const SHA = "1".repeat(40);
const REMOTE_SHA = "2".repeat(40);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HOOK_READS_PUSH_UPDATES = /push_updates=\$\(cat\)/u;
const HOOK_RUNS_RELEASE_SELECTOR = /pre-push-release-ready\.mjs/u;
const PUSHED_OBJECT_MISMATCH_PATTERN = /does not match the checked-out HEAD/u;
const PACKAGE_VERSION_MISMATCH_PATTERN = /package version/u;
const BASE_COMMIT_MISMATCH_PATTERN = /base commit/u;
const RELEASE_ONLY_DIFF_PATTERN = /release-only diff/u;
const RESTAMP_VERSION_MISMATCH_PATTERN = /already declare the release version/u;
const RELEASE_RELEVANT_PATH_PATTERN = /packages\/schemas\/src\/index\.ts/u;
const PRE_PUSH_GATE_CONTROL_PATH_EXAMPLES = [
  ".husky/pre-push",
  "package.json",
  "services/core/src/local-components/update-projection.ts",
  "scripts/release/build-packaged-openmeld-cli.mjs",
  "scripts/release/cli-channel-sync.mjs",
  "scripts/release/local-components.mjs",
  "scripts/release/nested/future-gate-helper.mjs",
  "scripts/release/pre-push-release-ready.mjs",
  "scripts/release/release-ready-paths.mjs",
  "scripts/release/verify-release-ready.mjs",
];

test("a push whose destination includes main selects strict release verification", () => {
  assert.equal(
    resolvePrePushReleaseMode(
      [
        `refs/heads/feature ${SHA} refs/heads/feature ${REMOTE_SHA}`,
        `refs/heads/main ${SHA} refs/heads/main ${REMOTE_SHA}`,
      ].join("\n")
    ),
    "strict"
  );
});

test("ordinary non-main branch destinations do not block iterative pushes", () => {
  assert.equal(
    resolvePrePushReleaseMode(
      `refs/heads/feature ${SHA} refs/heads/feature ${REMOTE_SHA}\n`
    ),
    "skip"
  );
  assert.equal(
    resolvePrePushReleaseMode(
      `refs/tags/v1.2.3 ${SHA} refs/tags/v1.2.3 ${"0".repeat(40)}\n`
    ),
    "strict"
  );
});

test("an explicit versioned release branch selects strict release verification", () => {
  assert.equal(
    resolvePrePushReleaseMode(
      `refs/heads/codex/release-0.3.35-563a8ae8 ${SHA} refs/heads/codex/release-0.3.35-563a8ae8 ${REMOTE_SHA}\n`
    ),
    "strict"
  );
  assert.equal(
    resolvePrePushReleaseMode(
      `refs/heads/codex/release-not-a-version ${SHA} refs/heads/codex/release-not-a-version ${REMOTE_SHA}\n`
    ),
    "skip"
  );
});

test("release PR strict mode requires matching version, base, and release-only diff", () => {
  const facts = {
    baseSha: `563a8ae8${"1".repeat(32)}`,
    baseManifestVersion: "0.3.34",
    basePackageVersion: "0.3.34",
    branchName: "codex/release-0.3.35-563a8ae8",
    changedPaths: [
      "clients/openmeld-cli/package.json",
      "release/local-components.json",
    ],
    manifestVersion: "0.3.35",
    packageVersion: "0.3.35",
  };

  assert.doesNotThrow(() => assertVersionedReleaseBranchFacts(facts));
  assert.equal(resolvePullRequestReleaseMode(facts), "strict");
  assert.throws(
    () =>
      assertVersionedReleaseBranchFacts({
        ...facts,
        packageVersion: "0.3.34",
      }),
    PACKAGE_VERSION_MISMATCH_PATTERN
  );
  assert.throws(
    () =>
      assertVersionedReleaseBranchFacts({
        ...facts,
        baseSha: `419e5651${"2".repeat(32)}`,
      }),
    BASE_COMMIT_MISMATCH_PATTERN
  );
  assert.throws(
    () =>
      assertVersionedReleaseBranchFacts({
        ...facts,
        changedPaths: [...facts.changedPaths, "services/core/src/index.ts"],
      }),
    RELEASE_ONLY_DIFF_PATTERN
  );
});

test("release PR strict mode allows a manifest-only restamp of an already declared version", () => {
  const facts = {
    baseSha: `563a8ae8${"1".repeat(32)}`,
    baseManifestVersion: "0.3.35",
    basePackageVersion: "0.3.35",
    branchName: "codex/release-0.3.35-563a8ae8",
    changedPaths: ["release/local-components.json"],
    manifestVersion: "0.3.35",
    packageVersion: "0.3.35",
  };

  assert.doesNotThrow(() => assertVersionedReleaseBranchFacts(facts));
  assert.equal(resolvePullRequestReleaseMode(facts), "strict");
  assert.throws(
    () =>
      assertVersionedReleaseBranchFacts({
        ...facts,
        basePackageVersion: "0.3.34",
      }),
    RESTAMP_VERSION_MISMATCH_PATTERN
  );
  assert.throws(
    () =>
      assertVersionedReleaseBranchFacts({
        ...facts,
        baseManifestVersion: "0.3.34",
      }),
    RESTAMP_VERSION_MISMATCH_PATTERN
  );
});

test("deleting main or a tag still selects strict release verification", () => {
  const deletedSha = "0".repeat(40);
  assert.equal(
    resolvePrePushReleaseMode(
      `(delete) ${deletedSha} refs/heads/main ${REMOTE_SHA}\n`
    ),
    "strict"
  );
  assert.equal(
    resolvePrePushReleaseMode(
      `(delete) ${deletedSha} refs/tags/v1.2.3 ${REMOTE_SHA}\n`
    ),
    "strict"
  );
});

test("a protected deletion keeps a mixed feature push strict", () => {
  const deletedSha = "0".repeat(40);
  const featureUpdate = `refs/heads/feature ${SHA} refs/heads/feature ${REMOTE_SHA}`;
  assert.equal(
    resolvePrePushReleaseMode(
      [
        featureUpdate,
        `(delete) ${deletedSha} refs/heads/main ${REMOTE_SHA}`,
      ].join("\n")
    ),
    "strict"
  );
  assert.equal(
    resolvePrePushReleaseMode(
      [
        featureUpdate,
        `(delete) ${deletedSha} refs/tags/v1.2.3 ${REMOTE_SHA}`,
      ].join("\n")
    ),
    "strict"
  );
});

test("only deleting ordinary non-main branches skips release verification", () => {
  assert.equal(
    resolvePrePushReleaseMode(
      `(delete) ${"0".repeat(40)} refs/heads/feature ${REMOTE_SHA}\n`
    ),
    "skip"
  );
});

test("empty or malformed hook input fails safe to strict verification", () => {
  assert.equal(resolvePrePushReleaseMode(""), "strict");
  assert.equal(resolvePrePushReleaseMode("not a push ref line"), "strict");
});

test("rejects a pushed object that does not resolve to the checked-out HEAD", () => {
  const pushedSha = "3".repeat(40);
  assert.throws(
    () =>
      assertPushedObjectsMatchHead(
        `refs/heads/release-candidate ${pushedSha} refs/heads/feature ${REMOTE_SHA}\n`,
        {
          resolveCommit: (value) => (value === "HEAD" ? SHA : pushedSha),
        }
      ),
    PUSHED_OBJECT_MISMATCH_PATTERN
  );
});

test("accepts branch and annotated-tag objects that resolve to HEAD", () => {
  const tagObjectSha = "4".repeat(40);
  const resolveCommit = (value) =>
    value === "HEAD" || value === SHA || value === tagObjectSha ? SHA : value;

  assert.doesNotThrow(() =>
    assertPushedObjectsMatchHead(
      [
        `refs/heads/feature ${SHA} refs/heads/feature ${REMOTE_SHA}`,
        `refs/tags/v1.2.3 ${tagObjectSha} refs/tags/v1.2.3 ${REMOTE_SHA}`,
      ].join("\n"),
      { resolveCommit }
    )
  );
});

test("ignores deletion objects when checking the pushed commit", () => {
  assert.doesNotThrow(() =>
    assertPushedObjectsMatchHead(
      `(delete) ${"0".repeat(40)} refs/heads/feature ${REMOTE_SHA}\n`,
      {
        resolveCommit: (value) => {
          assert.equal(value, "HEAD");
          return SHA;
        },
      }
    )
  );
});

test("rejects a dirty release-relevant worktree but allows unrelated changes", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "openmeld-pre-push-"));
  const gitOptions = {
    cwd: repoRoot,
    env: isolatedGitTestEnvironment(process.env),
  };
  try {
    await mkdir(join(repoRoot, "packages/schemas/src"), { recursive: true });
    await writeFile(
      join(repoRoot, "packages/schemas/src/index.ts"),
      "export {};\n"
    );
    await writeFile(join(repoRoot, "README.md"), "baseline\n");
    execFileSync("git", ["init", "--quiet"], gitOptions);
    execFileSync("git", ["config", "user.email", "test@openmeld.local"], {
      ...gitOptions,
    });
    execFileSync("git", ["config", "user.name", "OpenMeld Test"], {
      ...gitOptions,
    });
    execFileSync("git", ["add", "."], gitOptions);
    execFileSync("git", ["commit", "--quiet", "-m", "test: seed repo"], {
      ...gitOptions,
    });

    await writeFile(join(repoRoot, "README.md"), "unrelated change\n");
    assert.doesNotThrow(() =>
      assertReleaseVerificationWorktreeClean({ repoRoot })
    );

    await writeFile(
      join(repoRoot, "packages/schemas/src/index.ts"),
      "export const masked = true;\n"
    );
    assert.throws(
      () => assertReleaseVerificationWorktreeClean({ repoRoot }),
      RELEASE_RELEVANT_PATH_PATTERN
    );
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

test("rejects dirty pre-push gate control paths", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "openmeld-pre-push-control-"));
  const gitOptions = {
    cwd: repoRoot,
    env: isolatedGitTestEnvironment(process.env),
  };
  try {
    for (const path of PRE_PUSH_GATE_CONTROL_PATH_EXAMPLES) {
      await mkdir(dirname(join(repoRoot, path)), { recursive: true });
      await writeFile(join(repoRoot, path), `baseline: ${path}\n`);
    }
    execFileSync("git", ["init", "--quiet"], gitOptions);
    execFileSync(
      "git",
      ["config", "user.email", "test@openmeld.local"],
      gitOptions
    );
    execFileSync("git", ["config", "user.name", "OpenMeld Test"], gitOptions);
    execFileSync("git", ["add", "."], gitOptions);
    execFileSync(
      "git",
      ["commit", "--quiet", "-m", "test: seed repo"],
      gitOptions
    );

    for (const path of PRE_PUSH_GATE_CONTROL_PATH_EXAMPLES) {
      await writeFile(join(repoRoot, path), `dirty: ${path}\n`);
      assert.throws(
        () => assertReleaseVerificationWorktreeClean({ repoRoot }),
        (error) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes(path));
          return true;
        }
      );
      execFileSync("git", ["restore", "--worktree", "--", path], gitOptions);
    }
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
});

function isolatedGitTestEnvironment(env) {
  const isolated = { ...env };
  for (const name of Object.keys(isolated)) {
    if (name.startsWith("GIT_")) {
      delete isolated[name];
    }
  }
  return isolated;
}

test("the Git hook preserves pushed-ref input without repeating candidate checks", () => {
  const hook = readFileSync(join(REPO_ROOT, ".husky/pre-push"), "utf8");

  assert.match(hook, HOOK_READS_PUSH_UPDATES);
  assert.match(hook, HOOK_RUNS_RELEASE_SELECTOR);
  assert.ok(!hook.includes("verify:pre-push:checks"));
});
