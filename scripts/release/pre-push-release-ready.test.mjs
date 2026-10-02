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
  assertDeferredReleaseBranchFacts,
  assertStampedReleaseFacts,
  resolvePullRequestReleaseMode,
} from "./release-branch-policy.mjs";

const SHA = "1".repeat(40);
const REMOTE_SHA = "2".repeat(40);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HOOK_READS_PUSH_UPDATES = /push_updates=\$\(cat\)/u;
const HOOK_RUNS_RELEASE_SELECTOR = /pre-push-release-ready\.mjs/u;
const PUSHED_OBJECT_MISMATCH_PATTERN = /does not match the checked-out HEAD/u;
const PACKAGE_VERSION_MISMATCH_PATTERN =
  /package version.*release manifest version/u;
const PREMATURE_RELEASE_STAMP_PATTERN =
  /changed without a stamped candidate diff/u;
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

test("release branch pushes select strict artifact verification regardless of their name", () => {
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
    "strict"
  );
});

test("a stamped PR validates version consistency without requiring a second PR", () => {
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

  assert.doesNotThrow(() => assertStampedReleaseFacts(facts));
  assert.equal(resolvePullRequestReleaseMode(facts), "strict");
  assert.throws(
    () =>
      assertStampedReleaseFacts({
        ...facts,
        packageVersion: "0.3.34",
      }),
    PACKAGE_VERSION_MISMATCH_PATTERN
  );
  assert.equal(
    resolvePullRequestReleaseMode({
      ...facts,
      branchName: "codex/feature-and-release",
      changedPaths: [...facts.changedPaths, "services/core/src/index.ts"],
    }),
    "strict"
  );
});

test("package metadata changes stay deferred but an unstamped version bump is rejected", () => {
  const facts = {
    changedPaths: ["clients/openmeld-cli/package.json"],
    basePackageVersion: "0.3.35",
    currentPackageVersion: "0.3.35",
    baseManifest: { version: "0.3.35" },
    currentManifest: { version: "0.3.35" },
  };
  assert.equal(resolvePullRequestReleaseMode(facts), "deferred");
  assert.throws(() =>
    resolvePullRequestReleaseMode({
      ...facts,
      currentPackageVersion: "0.3.36",
    })
  );
  assert.throws(() => assertStampedReleaseFacts({}));
});

test("a manifest-only restamp uses strict artifact verification", () => {
  const facts = {
    baseSha: `563a8ae8${"1".repeat(32)}`,
    baseManifestVersion: "0.3.35",
    basePackageVersion: "0.3.35",
    branchName: "codex/release-0.3.35-563a8ae8",
    changedPaths: ["release/local-components.json"],
    manifestVersion: "0.3.35",
    packageVersion: "0.3.35",
  };

  assert.doesNotThrow(() => assertStampedReleaseFacts(facts));
  assert.equal(resolvePullRequestReleaseMode(facts), "strict");
});

test("deferred release mode rejects only premature release stamps", () => {
  const baseManifest = {
    components: {
      cli: { packageVersion: "0.3.217" },
      service: { bundleVersion: "0.3.217" },
    },
    schemaVersion: 1,
  };

  assert.doesNotThrow(() =>
    assertDeferredReleaseBranchFacts({
      baseManifest,
      basePackageVersion: "0.3.217",
      currentManifest: structuredClone(baseManifest),
      currentPackageVersion: "0.3.217",
    })
  );
  assert.throws(
    () =>
      assertDeferredReleaseBranchFacts({
        baseManifest,
        basePackageVersion: "0.3.217",
        currentManifest: structuredClone(baseManifest),
        currentPackageVersion: "0.3.218",
      }),
    PREMATURE_RELEASE_STAMP_PATTERN
  );
  assert.throws(
    () =>
      assertDeferredReleaseBranchFacts({
        baseManifest,
        basePackageVersion: "0.3.217",
        currentManifest: {
          ...baseManifest,
          components: {
            ...baseManifest.components,
            cli: { packageVersion: "0.3.218" },
          },
        },
        currentPackageVersion: "0.3.217",
      }),
    PREMATURE_RELEASE_STAMP_PATTERN
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

test("empty pushes skip verification while malformed hook input fails safe", () => {
  assert.equal(resolvePrePushReleaseMode(""), "skip");
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
  assert.ok(!hook.includes("scripts/dev/pre-push.mjs"));
});
