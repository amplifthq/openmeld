import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  resolveChangedLocalComponents,
  resolveTouchedLocalComponents,
} from "./local-components.mjs";
import { planCliPublication, publishCli } from "./publish-cli.mjs";
import { verifyReleaseReady } from "./verify-release-ready.mjs";

const SHA = "c".repeat(40);
const OTHER_SHA = "d".repeat(40);
const REFUSED_WITHOUT_SEED = /Seed it once/u;
const REFUSED_WITHOUT_HELPER = /Windows process helper/u;
const MISSING_SERVICE_POLICY = /OpenMeld Service changed/u;
const REQUIRED_FOR_EPOCH = /service\.updatePolicy must be required/u;
const OTHER_SOURCE = /already published from d{40}/u;

// Shape of the manifest Core reads (packages/schemas local-components.ts).
function publishedManifest() {
  return {
    schemaVersion: 1,
    updatedAt: "2026-10-16T16:25:15.531Z",
    components: {
      cli: {
        commandContractVersion: "command-v1",
        packageVersion: "0.3.264",
        updatePolicy: "available",
        reason: "Existing CLI commands remain wire-compatible.",
      },
      service: {
        bundleHash: "a".repeat(64),
        portableBundleHash: "b".repeat(64),
        bundleVersion: "0.3.264",
        runtimeContractEpoch: "epoch-v1",
        serviceContractVersion: "service-v1",
        updatePolicy: "required",
        reason: "Native account checks must run each minute.",
      },
      skills: {
        bundleHash: "e".repeat(64),
        skillContractVersion: "skills-v1",
        skillIds: ["openmeld-cli"],
        updatePolicy: "available",
        reason: "Guidance clarifies existing command prefixes.",
      },
    },
  };
}

function facts(overrides = {}) {
  const published = publishedManifest().components;
  return {
    cli: { commandContractVersion: "command-v1", packageVersion: "0.3.265" },
    cliRequiredFloor: "0.3.200",
    hasWindowsProcessHelper: true,
    service: {
      bundleHash: published.service.bundleHash,
      portableBundleHash: published.service.portableBundleHash,
      bundleVersion: "0.3.265",
      runtimeContractEpoch: "epoch-v1",
      serviceContractVersion: "service-v1",
    },
    serviceRequiredFloor: "0.3.264",
    skills: {
      bundleHash: published.skills.bundleHash,
      skillContractVersion: "skills-v1",
      skillIds: ["openmeld-cli"],
    },
    ...overrides,
  };
}

const CLI_POLICY = {
  updatePolicy: "available",
  reason: "Adds a diagnostics command without changing existing ones.",
};

test("keeps the published Service and Skills when their bytes did not change", () => {
  const { changed, manifest } = planCliPublication({
    facts: facts(),
    policy: { version: "0.3.265", cli: CLI_POLICY },
    published: publishedManifest(),
    now: "2026-10-18T00:00:00.000Z",
  });
  assert.deepEqual(changed, ["cli"]);
  assert.equal(manifest.components.cli.packageVersion, "0.3.265");
  assert.deepEqual(
    manifest.components.service,
    publishedManifest().components.service
  );
  assert.deepEqual(
    manifest.components.skills,
    publishedManifest().components.skills
  );
});

test("refuses a changed Service without an explicit decision", () => {
  const changedService = facts({
    service: { ...facts().service, bundleHash: "f".repeat(64) },
  });
  assert.throws(
    () =>
      planCliPublication({
        facts: changedService,
        policy: { version: "0.3.265", cli: CLI_POLICY },
        published: publishedManifest(),
      }),
    MISSING_SERVICE_POLICY
  );
  const { manifest } = planCliPublication({
    facts: changedService,
    policy: {
      version: "0.3.265",
      cli: CLI_POLICY,
      service: {
        updatePolicy: "available",
        reason: "Faster reconnect after sleep; old Services keep working.",
      },
    },
    published: publishedManifest(),
  });
  assert.equal(manifest.components.service.bundleVersion, "0.3.265");
  assert.equal(manifest.components.service.updatePolicy, "available");
});

test("requires a required Service policy when the runtime contract changes", () => {
  const nextEpoch = facts({
    service: {
      ...facts().service,
      bundleHash: "f".repeat(64),
      runtimeContractEpoch: "epoch-v2",
    },
  });
  assert.throws(
    () =>
      planCliPublication({
        facts: nextEpoch,
        policy: {
          version: "0.3.265",
          cli: CLI_POLICY,
          service: {
            updatePolicy: "available",
            reason: "New execution contract for Project work.",
          },
        },
        published: publishedManifest(),
      }),
    REQUIRED_FOR_EPOCH
  );
});

test("refuses before the manifest is seeded or without the Windows helper", () => {
  assert.throws(
    () =>
      planCliPublication({
        facts: facts(),
        policy: { version: "0.3.265", cli: CLI_POLICY },
        published: null,
      }),
    REFUSED_WITHOUT_SEED
  );
  assert.throws(
    () =>
      planCliPublication({
        facts: facts({ hasWindowsProcessHelper: false }),
        policy: { version: "0.3.265", cli: CLI_POLICY },
        published: publishedManifest(),
      }),
    REFUSED_WITHOUT_HELPER
  );
});

test("compares the portable Service hash when the Windows helper is absent", () => {
  const portable = facts({
    hasWindowsProcessHelper: false,
    service: { ...facts().service, bundleHash: "9".repeat(64) },
  });
  assert.deepEqual(
    resolveChangedLocalComponents({
      facts: portable,
      published: publishedManifest(),
    }),
    ["cli"]
  );
});

function createSource(version) {
  const root = mkdtempSync(path.join(tmpdir(), "publish-cli-"));
  mkdirSync(path.join(root, "clients/openmeld-cli"), { recursive: true });
  writeFileSync(
    path.join(root, "clients/openmeld-cli/package.json"),
    JSON.stringify({ version })
  );
  return root;
}

function createPlatform(state) {
  const calls = [];
  return {
    calls,
    platform: {
      readNpmVersion: () => state.npm,
      readPublishedRelease: () => state.published,
      readChannelVersion: () => state.channel,
      buildPackagedCli: () => calls.push("build"),
      uploadBinary: () => calls.push("binary"),
      publishNpm: () => {
        calls.push("npm");
        state.npm = { version: "0.3.265", gitHead: SHA };
      },
      ensureTag: ({ tag }) => calls.push(`tag:${tag}`),
      writeRelease: (manifest) => {
        calls.push("manifest");
        state.published = manifest;
      },
      sleep: async () => undefined,
    },
  };
}

test("resumes at the same SHA without republishing and refuses a version from another commit", async () => {
  const cwd = createSource("0.3.265");
  try {
    const finished = createPlatform({
      npm: { version: "0.3.265", gitHead: SHA },
      published: {
        ...publishedManifest(),
        components: {
          ...publishedManifest().components,
          cli: {
            ...publishedManifest().components.cli,
            packageVersion: "0.3.265",
          },
        },
      },
    });
    assert.equal(
      (
        await publishCli({
          releaseSha: SHA,
          cwd,
          dryRun: true,
          platform: finished.platform,
        })
      ).status,
      "current"
    );
    assert.deepEqual(finished.calls, []);

    const foreign = createPlatform({
      npm: { version: "0.3.265", gitHead: OTHER_SHA },
      published: publishedManifest(),
    });
    await assert.rejects(
      publishCli({
        releaseSha: SHA,
        cwd,
        dryRun: true,
        platform: foreign.platform,
      }),
      OTHER_SOURCE
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("detects touched components from pull request paths", () => {
  assert.deepEqual(
    resolveTouchedLocalComponents([
      "clients/openmeld-cli/skills/openmeld-cli/SKILL.md",
    ]),
    ["cli", "skills"]
  );
  assert.deepEqual(
    resolveTouchedLocalComponents(["runtime/local-service/src/index.ts"]),
    ["cli", "service"]
  );
  assert.deepEqual(
    resolveTouchedLocalComponents(["clients/web/src/routes/login.tsx"]),
    []
  );
});

test("does not publish npm, a tag, or a release manifest before the binary succeeds", async () => {
  const cwd = createSource("0.3.265");
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    git("add", ".");
    git(
      "-c",
      "user.name=Release test",
      "-c",
      "user.email=release@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "test: release fixture"
    );
    const releaseSha = git("rev-parse", "HEAD");
    const { platform, calls } = createPlatform({
      npm: null,
      published: publishedManifest(),
    });
    let rejectBinary;
    let started;
    const binaryStarted = new Promise((resolve) => {
      started = resolve;
    });
    platform.uploadBinary = () => {
      calls.push("binary");
      started();
      return new Promise((_resolve, reject) => {
        rejectBinary = reject;
      });
    };
    const publication = publishCli({
      cwd,
      releaseSha,
      platform,
      collectFacts: async () => facts(),
      readPolicy: async () => ({ version: "0.3.265", cli: CLI_POLICY }),
    });
    const rejected = assert.rejects(publication, {
      message: "binary upload failed",
    });
    await binaryStarted;
    assert.deepEqual(calls, ["build", "binary"]);
    rejectBinary(new Error("binary upload failed"));
    await rejected;
    assert.deepEqual(calls, ["build", "binary"]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("defers the decision when a pull request changes components without a version bump", async () => {
  const written = [];
  const skipped = await verifyReleaseReady({
    options: { base: "base", force: false },
    resolveChangedPaths: () => ["clients/web/src/a.tsx"],
    write: (text) => written.push(text),
  });
  assert.equal(skipped.status, "skipped");
  let built = false;
  const deferred = await verifyReleaseReady({
    options: { base: "base", force: false },
    repoRoot: process.cwd(),
    resolveChangedPaths: () => [
      "clients/openmeld-cli/skills/openmeld-cli/SKILL.md",
    ],
    buildPackagedCli: () => {
      built = true;
    },
    readNpmVersion: () => ({ version: "0.3.264", gitHead: SHA }),
    write: (text) => written.push(text),
  });
  assert.equal(built, true);
  assert.equal(deferred.status, "deferred");
});
