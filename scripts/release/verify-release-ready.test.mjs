import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  isReleaseReadyPath,
  selectReleaseReadyPaths,
} from "./release-ready-paths.mjs";
import {
  evaluateDeferredReleaseState,
  parseReleaseReadyArgs,
  readJsonAtBase,
  readJsonFile,
  resolveChannelSyncCheckEnabled,
} from "./verify-release-ready.mjs";

const BASE_MANIFEST = {
  schemaVersion: 1,
  updatedAt: "2026-08-10T00:00:00.000Z",
  components: {
    cli: {
      commandContractVersion: "cli-v1",
      packageVersion: "1.2.3",
      reason: "Current release.",
      updatePolicy: "available",
    },
    service: {
      bundleHash: "base-service-hash",
      bundleVersion: "1.2.3",
      reason: "Current release.",
      runtimeContractEpoch: "runtime-v1",
      serviceContractVersion: "service-v1",
      updatePolicy: "available",
    },
    skills: {
      bundleHash: "base-skills-hash",
      reason: "Current release.",
      skillContractVersion: "skills-v1",
      skillIds: ["openmeld-cli"],
      updatePolicy: "available",
    },
  },
};
const BASE_VERSION_MISMATCH_PATTERN = /must match the PR base/u;
const BASE_MANIFEST_READ_CONTEXT_PATTERN =
  /base-sha:release\/local-components\.json/u;
const BASE_PACKAGE_READ_CONTEXT_PATTERN =
  /base-sha:clients\/openmeld-cli\/package\.json/u;
const MANIFEST_STAMP_PATTERN = /manifest must remain identical/u;
const WORKTREE_MANIFEST_READ_CONTEXT_PATTERN =
  /\/repo\/release\/local-components\.json/u;
const WORKTREE_PACKAGE_READ_CONTEXT_PATTERN =
  /\/repo\/clients\/openmeld-cli\/package\.json/u;

test("detects paths that require the release-ready gate", () => {
  assert.equal(isReleaseReadyPath("release/local-components.json"), true);
  assert.equal(
    isReleaseReadyPath("clients/openmeld-cli/src/space/send.ts"),
    true
  );
  assert.equal(
    isReleaseReadyPath(
      "clients/openmeld-cli/src/local-service/dispatch/task.ts"
    ),
    true
  );
  assert.equal(
    isReleaseReadyPath("clients/openmeld-cli/skills/openmeld-cli/SKILL.md"),
    true
  );
  assert.equal(
    isReleaseReadyPath("packages/schemas/src/schemas/daemon/task-result.ts"),
    true
  );
  assert.equal(
    isReleaseReadyPath(
      "packages/schemas/src/schemas/http/organization-documents.ts"
    ),
    true
  );
  assert.equal(
    isReleaseReadyPath("runtime/adapters/core/src/launch-contract.ts"),
    true
  );
  assert.equal(isReleaseReadyPath("clients/web/src/routes/index.tsx"), false);
});

test("normalizes and filters release-ready paths", () => {
  assert.deepEqual(
    selectReleaseReadyPaths([
      "clients\\openmeld-cli\\skills\\openmeld-cli\\SKILL.md",
      "clients/web/src/routes/index.tsx",
      "release/local-components.json",
    ]),
    [
      "clients/openmeld-cli/skills/openmeld-cli/SKILL.md",
      "release/local-components.json",
    ]
  );
});

test("the pre-install path selector runs without loading repository dependencies", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const result = spawnSync(
    process.execPath,
    [
      "--permission",
      `--allow-fs-read=${join(repoRoot, "scripts/ci")}`,
      `--allow-fs-read=${join(repoRoot, "scripts/release")}`,
      join(repoRoot, "scripts/ci/select-release-ready-paths.mjs"),
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      input: "clients/openmeld-cli/src/index.ts\nclients/web/src/index.tsx\n",
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "clients/openmeld-cli/src/index.ts\n");
});

test("parses release-ready options", () => {
  assert.deepEqual(
    parseReleaseReadyArgs(["--", "--base", "origin/main", "--force"]),
    {
      base: "origin/main",
      channelSyncCheck: false,
      currentOnly: false,
      deferRelease: false,
      force: true,
      skipChannelSyncCheck: false,
    }
  );
  assert.deepEqual(parseReleaseReadyArgs(["--current"]), {
    base: null,
    channelSyncCheck: false,
    currentOnly: true,
    deferRelease: false,
    force: false,
    skipChannelSyncCheck: false,
  });
  assert.deepEqual(
    parseReleaseReadyArgs([
      "--channel-sync-check",
      "--skip-channel-sync-check",
    ]),
    {
      base: null,
      channelSyncCheck: true,
      currentOnly: false,
      deferRelease: false,
      force: false,
      skipChannelSyncCheck: true,
    }
  );
  assert.deepEqual(
    parseReleaseReadyArgs(["--defer-release", "--base", "base-sha"]),
    {
      base: "base-sha",
      channelSyncCheck: false,
      currentOnly: false,
      deferRelease: true,
      force: false,
      skipChannelSyncCheck: false,
    }
  );
});

test("deferred feature verification accepts changed artifact facts only when release state matches the base", () => {
  const result = evaluateDeferredReleaseState({
    baseManifest: BASE_MANIFEST,
    basePackageJson: { version: "1.2.3" },
    currentManifest: structuredClone(BASE_MANIFEST),
    currentPackageJson: { version: "1.2.3" },
    facts: {
      cli: { commandContractVersion: "cli-v1", packageVersion: "1.2.3" },
      service: {
        bundleHash: "feature-service-hash",
        bundleVersion: "1.2.3",
        runtimeContractEpoch: "runtime-v1",
        serviceContractVersion: "service-v1",
      },
      skills: {
        bundleHash: "base-skills-hash",
        skillContractVersion: "skills-v1",
        skillIds: ["openmeld-cli"],
      },
    },
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.pendingReleaseImpacts, [
    "service.bundleHash: base=base-service-hash feature=feature-service-hash",
  ]);
});

test("deferred feature verification rejects a feature version bump or manifest stamp", () => {
  const bumpedVersion = evaluateDeferredReleaseState({
    baseManifest: BASE_MANIFEST,
    basePackageJson: { version: "1.2.3" },
    currentManifest: structuredClone(BASE_MANIFEST),
    currentPackageJson: { version: "1.2.4" },
    facts: null,
  });
  const stampedManifest = structuredClone(BASE_MANIFEST);
  stampedManifest.updatedAt = "2026-08-11T00:00:00.000Z";
  const stamped = evaluateDeferredReleaseState({
    baseManifest: BASE_MANIFEST,
    basePackageJson: { version: "1.2.3" },
    currentManifest: stampedManifest,
    currentPackageJson: { version: "1.2.3" },
    facts: null,
  });

  assert.match(bumpedVersion.errors.join("\n"), BASE_VERSION_MISMATCH_PATTERN);
  assert.match(stamped.errors.join("\n"), MANIFEST_STAMP_PATTERN);
});

test("base JSON reads preserve Git and parse failure context", async () => {
  const gitFailure = new Error("git show failed");
  await assert.rejects(
    readJsonAtBase(
      {
        base: "base-sha",
        path: "release/local-components.json",
        repoRoot: "/repo",
      },
      {
        execFile: () => Promise.reject(gitFailure),
      }
    ),
    (error) => {
      assert.match(error.message, BASE_MANIFEST_READ_CONTEXT_PATTERN);
      assert.equal(error.cause, gitFailure);
      return true;
    }
  );

  await assert.rejects(
    readJsonAtBase(
      {
        base: "base-sha",
        path: "clients/openmeld-cli/package.json",
        repoRoot: "/repo",
      },
      {
        execFile: () => Promise.resolve({ stdout: "not json" }),
      }
    ),
    (error) => {
      assert.match(error.message, BASE_PACKAGE_READ_CONTEXT_PATTERN);
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    }
  );
});

test("worktree JSON reads preserve file and parse failure context", async () => {
  const readFailure = new Error("permission denied");
  await assert.rejects(
    readJsonFile("/repo/release/local-components.json", {
      readFile: () => Promise.reject(readFailure),
    }),
    (error) => {
      assert.match(error.message, WORKTREE_MANIFEST_READ_CONTEXT_PATTERN);
      assert.equal(error.cause, readFailure);
      return true;
    }
  );

  await assert.rejects(
    readJsonFile("/repo/clients/openmeld-cli/package.json", {
      readFile: () => Promise.resolve("not json"),
    }),
    (error) => {
      assert.match(error.message, WORKTREE_PACKAGE_READ_CONTEXT_PATTERN);
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    }
  );
});

test("channel-sync check defaults off and requires explicit opt-in", () => {
  const baseOptions = {
    channelSyncCheck: false,
    skipChannelSyncCheck: false,
  };

  assert.deepEqual(
    resolveChannelSyncCheckEnabled({ env: {}, options: baseOptions }),
    { enabled: false, skipped: false }
  );
  assert.deepEqual(
    resolveChannelSyncCheckEnabled({
      env: {},
      options: { ...baseOptions, channelSyncCheck: true },
    }),
    { enabled: true, skipped: false }
  );
  assert.deepEqual(
    resolveChannelSyncCheckEnabled({
      env: { OPENMELD_RELEASE_CHANNEL_SYNC_CHECK: "1" },
      options: baseOptions,
    }),
    { enabled: true, skipped: false }
  );
});

test("the channel-sync escape hatch overrides the enable flag/env and is exposed via flag or env", () => {
  assert.deepEqual(
    resolveChannelSyncCheckEnabled({
      env: {},
      options: { channelSyncCheck: true, skipChannelSyncCheck: true },
    }),
    { enabled: false, skipped: true }
  );
  assert.deepEqual(
    resolveChannelSyncCheckEnabled({
      env: {
        OPENMELD_RELEASE_CHANNEL_SYNC_CHECK: "1",
        OPENMELD_SKIP_CHANNEL_SYNC_CHECK: "1",
      },
      options: { channelSyncCheck: false, skipChannelSyncCheck: false },
    }),
    { enabled: false, skipped: true }
  );
});
