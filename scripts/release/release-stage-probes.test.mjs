import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  decideChannelAlignmentStage,
  decideCliBinaryStage,
  decideCoreProjectionStage,
  decideD1MigrationStage,
  decideNpmPublishStage,
  decideReleaseTagStage,
} from "./release-stage-probes.mjs";

const TARGET_VERSION = "0.2.43";
const TARGET_CORE_TAG = "openmeld-release-1234567890abcdef";
const TARGET_SHA = "a".repeat(40);
const ARTIFACT_SHA = "b".repeat(64);
const ARCHIVE_SHA = "c".repeat(64);
const CURRENT_VERSION_ID = "11111111-1111-1111-1111-111111111111";
const WRANGLER_RELEASE_STATE = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/wrangler-worker-release-state-4.110.0.json",
      import.meta.url
    ),
    "utf8"
  )
);

function completeBinaryInput() {
  return {
    artifactProbe: { contentLength: 68_899_792, ok: true, status: 200 },
    archiveProbe: {
      contentLength: 25_721_096,
      ok: true,
      reconstructedSha256: ARTIFACT_SHA,
      reconstructedSizeBytes: 68_899_792,
      sha256: ARCHIVE_SHA,
      status: 200,
    },
    manifest: {
      schemaVersion: 1,
      channels: {
        stable: {
          version: TARGET_VERSION,
          minRequiredCliVersion: TARGET_VERSION,
          platforms: {
            "darwin-arm64": {
              sha256: ARTIFACT_SHA,
              sizeBytes: 68_899_792,
              url: `https://openmeld.ai/cli/download/openmeld-cli-darwin-arm64-${TARGET_VERSION}`,
              archiveFormat: "gzip",
              archiveUrl: `https://openmeld.ai/cli/download/openmeld-cli-darwin-arm64-${TARGET_VERSION}.gz`,
              archiveSha256: ARCHIVE_SHA,
              archiveSizeBytes: 25_721_096,
            },
          },
        },
      },
    },
    platform: "darwin-arm64",
    targetVersion: TARGET_VERSION,
  };
}

test("skips production D1 synchronization only when the remote pending list is empty", () => {
  assert.deepEqual(
    decideD1MigrationStage({
      status: 0,
      stderr: "",
      stdout: "No migrations to apply.\n",
    }),
    {
      action: "SKIP",
      criterion: "remote-pending-list-empty",
      reason: "the remote D1 pending migration list is empty",
    }
  );
  assert.equal(
    decideD1MigrationStage({
      status: 0,
      stderr: "",
      stdout: "Migrations to be applied:\n0049_resume.sql\n",
    }).action,
    "RUN"
  );
});

test("runs D1 synchronization when its read-only probe fails", () => {
  assert.deepEqual(
    decideD1MigrationStage({
      status: 1,
      stderr: "authentication failed",
      stdout: "",
    }),
    {
      action: "RUN",
      probeFailure: true,
      reason: "D1 completion probe failed: authentication failed",
    }
  );
});

test("skips the CLI binary channel at the published-record criterion", () => {
  assert.deepEqual(decideCliBinaryStage(completeBinaryInput()), {
    action: "SKIP",
    criterion: "verified-published-record",
    reason:
      "the production manifest has 0.2.43, the darwin-arm64 raw URL matches its recorded size, and the gzip archive hashes and reconstructs the recorded binary",
  });
});

test("runs the CLI binary channel when the target version is not published", () => {
  const input = completeBinaryInput();
  input.manifest.channels.stable.version = "0.2.42";
  assert.deepEqual(decideCliBinaryStage(input), {
    action: "RUN",
    reason: "the production CLI manifest is at 0.2.42, not target 0.2.43",
  });
});

test("runs the CLI binary channel when the compressed artifact is missing", () => {
  const input = completeBinaryInput();
  input.archiveProbe = { contentLength: null, ok: false, status: 404 };
  assert.deepEqual(decideCliBinaryStage(input), {
    action: "RUN",
    reason: "the darwin-arm64 gzip archive is not downloadable (HTTP 404)",
  });
});

test("does not trust a same-size gzip archive whose bytes do not match the manifest", () => {
  const input = completeBinaryInput();
  input.archiveProbe.sha256 = "d".repeat(64);

  assert.deepEqual(decideCliBinaryStage(input), {
    action: "RUN",
    reason:
      "the darwin-arm64 gzip archive sha256 does not match the manifest record",
  });
});

test("does not trust a gzip archive unless it reconstructs the signed binary", () => {
  const input = completeBinaryInput();
  input.archiveProbe.reconstructedSha256 = "d".repeat(64);

  assert.deepEqual(decideCliBinaryStage(input), {
    action: "RUN",
    reason:
      "the darwin-arm64 gzip archive does not reconstruct the recorded binary",
  });
});

test("runs the CLI binary channel when its bounded read-only probe fails", () => {
  assert.deepEqual(
    decideCliBinaryStage({
      probeError: "This operation was aborted",
      targetVersion: TARGET_VERSION,
    }),
    {
      action: "RUN",
      probeFailure: true,
      reason: "CLI binary completion probe failed: This operation was aborted",
    }
  );
});

test("skips npm when the immutable target version already exists", () => {
  assert.deepEqual(
    decideNpmPublishStage({
      status: 0,
      stderr: "",
      stdout: `${JSON.stringify(TARGET_VERSION)}\n`,
      targetVersion: TARGET_VERSION,
    }),
    {
      action: "SKIP",
      criterion: "npm-version-exists",
      reason: "npm already publishes openmeld@0.2.43",
    }
  );
});

test("runs npm publication when the target version does not exist", () => {
  assert.equal(
    decideNpmPublishStage({
      status: 1,
      stderr: "npm error code E404",
      stdout: "",
      targetVersion: TARGET_VERSION,
    }).action,
    "RUN"
  );
});

test("skips only when matching local and origin release tags are both present", () => {
  assert.deepEqual(
    decideReleaseTagStage({
      headSha: TARGET_SHA,
      localTagSha: TARGET_SHA,
      remoteTagSha: TARGET_SHA,
      tagName: `v${TARGET_VERSION}`,
    }),
    {
      action: "SKIP",
      criterion: "local-and-origin-tag-target-match",
      reason: `v${TARGET_VERSION} already points to ${TARGET_SHA} locally and on origin`,
    }
  );
  assert.deepEqual(
    decideReleaseTagStage({
      headSha: TARGET_SHA,
      localTagSha: TARGET_SHA,
      remoteTagSha: null,
      tagName: `v${TARGET_VERSION}`,
    }),
    {
      action: "RUN",
      reason: `v${TARGET_VERSION} is not published to origin`,
    }
  );
  assert.deepEqual(
    decideReleaseTagStage({
      headSha: TARGET_SHA,
      localTagSha: TARGET_SHA,
      remoteTagSha: "c".repeat(40),
      tagName: `v${TARGET_VERSION}`,
    }),
    {
      action: "FAIL",
      reason: `origin v${TARGET_VERSION} already points to ${"c".repeat(40)}, not ${TARGET_SHA}; refusing to overwrite an immutable release tag`,
    }
  );
});

test("runs the release tag stage with diagnostic context when its probe fails", () => {
  assert.deepEqual(
    decideReleaseTagStage({
      headSha: TARGET_SHA,
      remoteProbeError: "git ls-remote timed out",
      tagName: `v${TARGET_VERSION}`,
    }),
    {
      action: "RUN",
      probeFailure: true,
      reason:
        "Origin release tag completion probe failed: git ls-remote timed out",
    }
  );
});

test("skips the Core projection only when the tagged target owns all production traffic", () => {
  assert.deepEqual(
    decideCoreProjectionStage({
      deployments: WRANGLER_RELEASE_STATE.deployments,
      targetTag: TARGET_CORE_TAG,
      versions: WRANGLER_RELEASE_STATE.versions,
    }),
    {
      action: "SKIP",
      criterion: "active-worker-version-tag",
      currentVersionIds: [CURRENT_VERSION_ID],
      reason: `Core production version ${CURRENT_VERSION_ID} already carries ${TARGET_CORE_TAG}`,
    }
  );
});

test("skips final channel alignment only when R2, npm, and Core all match", () => {
  const decision = { action: "SKIP" };
  assert.deepEqual(
    decideChannelAlignmentStage({
      binary: decision,
      core: decision,
      npm: decision,
    }),
    {
      action: "SKIP",
      criterion: "r2-npm-core-aligned",
      reason:
        "R2, npm, and the active Core projection already match the target release",
    }
  );
  assert.equal(
    decideChannelAlignmentStage({
      binary: decision,
      core: { action: "RUN" },
      npm: decision,
    }).action,
    "RUN"
  );
});
