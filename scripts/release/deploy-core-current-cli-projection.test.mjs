import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveCoreProjectionTag } from "./core-projection-tag.mjs";
import {
  buildCoreCurrentCliProjectionDryRunStepSpec,
  deployCoreWithCurrentCliProjection,
  resolveCurrentCliProjectionReleaseManifest,
  resolveCurrentCliProjectionTarget,
} from "./deploy-core-current-cli-projection.mjs";
import { createWorkerDeploymentCapture } from "./worker-deployment-evidence.mjs";

const CURRENT_MANIFEST = JSON.parse(
  readFileSync(new URL("../../release/local-components.json", import.meta.url))
);
const TAG_MANIFEST_VERSION = CURRENT_MANIFEST.components.cli.packageVersion;
const PUBLISHED_VERSION = incrementPatch(TAG_MANIFEST_VERSION);
const TAG_COMMIT_SHA = "a".repeat(40);
const CORE_RELEASE_SHA = "b".repeat(40);
const VERSION_MISMATCH_RE = new RegExp(
  `declares CLI ${escapeRegExp(TAG_MANIFEST_VERSION)}, but the production channel is ${escapeRegExp(PUBLISHED_VERSION)}`,
  "u"
);
const SERVICE_VERSION_MISMATCH_RE = new RegExp(
  `declares OpenMeld Service ${escapeRegExp(TAG_MANIFEST_VERSION)}, but the production channel is ${escapeRegExp(PUBLISHED_VERSION)}`,
  "u"
);
const INVALID_TAG_COMMIT_RE =
  /did not resolve to an exact 40-character lowercase commit SHA/u;
const PUBLISHED_MANIFEST = {
  ...CURRENT_MANIFEST,
  components: {
    ...CURRENT_MANIFEST.components,
    cli: {
      ...CURRENT_MANIFEST.components.cli,
      packageVersion: PUBLISHED_VERSION,
    },
    service: {
      ...CURRENT_MANIFEST.components.service,
      bundleVersion: PUBLISHED_VERSION,
    },
  },
};
const PUBLISHED_MANIFEST_SOURCE = `${JSON.stringify(PUBLISHED_MANIFEST, null, 2)}\n`;
const PUBLISHED_PACKAGE_SOURCE = JSON.stringify({
  version: PUBLISHED_VERSION,
  openmeld: { minRequiredCliVersion: TAG_MANIFEST_VERSION },
});
const EXPECTED_CORE_TAG = deriveCoreProjectionTag({
  commitSha: TAG_COMMIT_SHA,
  releaseManifestSource: PUBLISHED_MANIFEST_SOURCE,
});

test("loads the Core projection from the immutable tag named by the live CLI channel", () => {
  const reads = [];
  const resolved = resolveCurrentCliProjectionReleaseManifest({
    channelManifest: {
      channels: { stable: { version: PUBLISHED_VERSION } },
    },
    readTagFile: (input) => {
      reads.push(input);
      return JSON.stringify(PUBLISHED_MANIFEST);
    },
  });

  assert.deepEqual(reads, [
    {
      path: "release/local-components.json",
      tagName: `v${PUBLISHED_VERSION}`,
    },
  ]);
  assert.deepEqual(resolved, PUBLISHED_MANIFEST);
});

test("refuses a tag manifest that does not match the live CLI channel", () => {
  assert.throws(
    () =>
      resolveCurrentCliProjectionReleaseManifest({
        channelManifest: {
          channels: { stable: { version: PUBLISHED_VERSION } },
        },
        readTagFile: () => JSON.stringify(CURRENT_MANIFEST),
      }),
    VERSION_MISMATCH_RE
  );
});

test("refuses a tag whose OpenMeld Service version does not match the live CLI channel", () => {
  assert.throws(
    () =>
      resolveCurrentCliProjectionReleaseManifest({
        channelManifest: {
          channels: { stable: { version: PUBLISHED_VERSION } },
        },
        readTagFile: () =>
          JSON.stringify({
            ...PUBLISHED_MANIFEST,
            components: {
              ...PUBLISHED_MANIFEST.components,
              service: {
                ...PUBLISHED_MANIFEST.components.service,
                bundleVersion: TAG_MANIFEST_VERSION,
              },
            },
          }),
      }),
    SERVICE_VERSION_MISMATCH_RE
  );
});

test("derives the expected Core tag from the immutable tag commit and manifest", () => {
  const reads = [];
  const target = resolveCurrentCliProjectionTarget({
    channelManifest: {
      channels: { stable: { version: PUBLISHED_VERSION } },
    },
    readTagCommit: (input) => {
      reads.push({ ...input, type: "commit" });
      return TAG_COMMIT_SHA;
    },
    readTagFile: (input) => {
      reads.push(input);
      return input.path === "clients/openmeld-cli/package.json"
        ? PUBLISHED_PACKAGE_SOURCE
        : PUBLISHED_MANIFEST_SOURCE;
    },
  });

  assert.deepEqual(reads, [
    { tagName: `v${PUBLISHED_VERSION}`, type: "commit" },
    {
      path: "release/local-components.json",
      tagName: `v${PUBLISHED_VERSION}`,
    },
    {
      path: "clients/openmeld-cli/package.json",
      tagName: `v${PUBLISHED_VERSION}`,
    },
  ]);
  assert.deepEqual(target.releaseManifest, PUBLISHED_MANIFEST);
  assert.equal(target.tagCommitSha, TAG_COMMIT_SHA);
  assert.equal(target.tagName, `v${PUBLISHED_VERSION}`);
  assert.equal(target.minRequiredCliVersion, TAG_MANIFEST_VERSION);
  assert.equal(target.expectedCoreTag, EXPECTED_CORE_TAG);
});

test("refuses a release tag that does not resolve to an exact commit", () => {
  assert.throws(
    () =>
      resolveCurrentCliProjectionTarget({
        channelManifest: {
          channels: { stable: { version: PUBLISHED_VERSION } },
        },
        readTagCommit: () => "a".repeat(39),
        readTagFile: (input) =>
          input.path === "clients/openmeld-cli/package.json"
            ? PUBLISHED_PACKAGE_SOURCE
            : PUBLISHED_MANIFEST_SOURCE,
      }),
    INVALID_TAG_COMMIT_RE
  );
});

test("builds one Core dry run whose compiled projection stays on the published manifest", () => {
  const step = buildCoreCurrentCliProjectionDryRunStepSpec({
    expectedCoreTag: EXPECTED_CORE_TAG,
    releaseManifest: PUBLISHED_MANIFEST,
  });
  const defineIndex = step.args.indexOf("--define");
  const defineArgument = step.args[defineIndex + 1];
  const separatorIndex = defineArgument.indexOf(":");

  assert.equal(step.command, "pnpm");
  assert.deepEqual(step.args.slice(0, defineIndex), [
    "--dir",
    "services/core",
    "exec",
    "dotenv",
    "-e",
    "../../.env",
    "-o",
    "--",
    "wrangler",
    "deploy",
    "--minify",
    "--env",
    "prod",
    "--tag",
    EXPECTED_CORE_TAG,
  ]);
  assert.equal(
    defineArgument.slice(0, separatorIndex),
    "OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON"
  );
  assert.deepEqual(
    JSON.parse(JSON.parse(defineArgument.slice(separatorIndex + 1))),
    PUBLISHED_MANIFEST
  );
});

test("dry-runs the exact tagged projection without changing production", () => {
  const step = buildCoreCurrentCliProjectionDryRunStepSpec({
    expectedCoreTag: EXPECTED_CORE_TAG,
    releaseManifest: PUBLISHED_MANIFEST,
  });

  assert.deepEqual(step.args.slice(-3), [
    "--define",
    step.args.at(-2),
    "--dry-run",
  ]);
  assert.ok(step.args.includes(EXPECTED_CORE_TAG));
});

test("the receiver bridge binds candidate source separately from the retained CLI projection", async () => {
  const events = [];
  const capture = createWorkerDeploymentCapture({
    sourceSha: CORE_RELEASE_SHA,
    operationKey: "f".repeat(64),
    env: {},
    target: {
      workerName: "openmeld-core-prod",
      projectionTag: EXPECTED_CORE_TAG,
      outputEnvironment: "prod",
    },
  });
  try {
    capture.recordDeploymentBaseline({ status: 0, stdout: "[]" });
    await deployCoreWithCurrentCliProjection({
      deploymentOnly: true,
      releaseSha: CORE_RELEASE_SHA,
      env: capture.env,
      write: () => undefined,
      adapters: {
        readAvailabilityCatalog: (input) => {
          assert.equal(input.stableManifest.channels.stable.version, PUBLISHED_VERSION);
          return Promise.resolve({ schemaVersion: 1, entries: [] });
        },
        fetchChannelManifest: () => {
          events.push("channel");
          return {
            channels: { stable: { version: PUBLISHED_VERSION } },
          };
        },
        readTagFile: (input) =>
          input.path === "clients/openmeld-cli/package.json"
            ? PUBLISHED_PACKAGE_SOURCE
            : PUBLISHED_MANIFEST_SOURCE,
        readTagCommit: () => TAG_COMMIT_SHA,
        readHeadSha: () => CORE_RELEASE_SHA,
        readCoreWranglerConfig: () => "{}",
        runStep: (step) => events.push(step.label),
        runStartupAdmission: (input) => ({
          releaseSha: input.releaseSha,
          workerName: "openmeld-core-prod",
          versionId: "fb18a6dd-5ee3-43fd-aa64-087346c6bfd3",
          trafficPercent: 100,
        }),
      },
    });
    assert.equal(
      capture.read().versionId,
      "fb18a6dd-5ee3-43fd-aa64-087346c6bfd3"
    );
    // Admission already applied 100% traffic; the bridge must not deploy again.
    assert.deepEqual(events, [
      "channel",
      "Build Core receiver dependencies",
      "Verify Core Worker bundle module graph",
      "Verify Core deployment is visible",
    ]);
  } finally {
    capture.close();
  }
});

function incrementPatch(version) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
