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
const TARGET_MIN_REQUIRED_CLI_VERSION = "0.2.40";
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
const NPM_VERSION_FLOOR_FIXTURE = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/npm-view-openmeld-0.3.130-version-floor.json",
      import.meta.url
    ),
    "utf8"
  )
);

function buildCapturedNpmVersionFloorStdout(input) {
  return `${JSON.stringify({
    ...NPM_VERSION_FLOOR_FIXTURE.response,
    version: input.version,
    "openmeld.minRequiredCliVersion": input.minRequiredCliVersion,
  })}\n`;
}

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
          minRequiredCliVersion: TARGET_MIN_REQUIRED_CLI_VERSION,
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
    targetMinRequiredCliVersion: TARGET_MIN_REQUIRED_CLI_VERSION,
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
      "the production manifest has 0.2.43 with required floor 0.2.40, the darwin-arm64 raw URL matches its recorded size, and the gzip archive hashes and reconstructs the recorded binary",
  });
});

test("fails before mutating immutable R2 artifacts when the version exists with the wrong required floor", () => {
  const input = completeBinaryInput();
  input.manifest.channels.stable.minRequiredCliVersion = "0.2.39";

  assert.deepEqual(decideCliBinaryStage(input), {
    action: "FAIL",
    reason:
      "the production CLI manifest for 0.2.43 is immutable with required floor 0.2.39, not target 0.2.40; publish a new release instead of retrying this version",
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

test("fails closed when a published target version has a missing compressed artifact", () => {
  const input = completeBinaryInput();
  input.archiveProbe = { contentLength: null, ok: false, status: 404 };
  assert.deepEqual(decideCliBinaryStage(input), {
    action: "FAIL",
    reason:
      "the production CLI manifest already publishes 0.2.43, so its darwin-arm64 artifacts are immutable; the gzip archive is not downloadable (HTTP 404); investigate the published record or publish a new version instead of retrying this version",
  });
});

test("fails closed when a published target version has an incomplete artifact record", () => {
  const input = completeBinaryInput();
  input.manifest.channels.stable.platforms["darwin-arm64"].archiveSizeBytes =
    undefined;

  assert.deepEqual(decideCliBinaryStage(input), {
    action: "FAIL",
    reason:
      "the production CLI manifest already publishes 0.2.43, so its darwin-arm64 artifacts are immutable; the manifest record is incomplete; investigate the published record or publish a new version instead of retrying this version",
  });
});

test("fails closed when a published target version has mismatched artifact sizes", () => {
  const rawInput = completeBinaryInput();
  rawInput.artifactProbe.contentLength -= 1;
  assert.deepEqual(decideCliBinaryStage(rawInput), {
    action: "FAIL",
    reason:
      "the production CLI manifest already publishes 0.2.43, so its darwin-arm64 artifacts are immutable; the raw artifact size does not match the manifest record (68899791 != 68899792); investigate the published record or publish a new version instead of retrying this version",
  });

  const archiveInput = completeBinaryInput();
  archiveInput.archiveProbe.contentLength -= 1;
  assert.deepEqual(decideCliBinaryStage(archiveInput), {
    action: "FAIL",
    reason:
      "the production CLI manifest already publishes 0.2.43, so its darwin-arm64 artifacts are immutable; the gzip archive size does not match the manifest record (25721095 != 25721096); investigate the published record or publish a new version instead of retrying this version",
  });
});

test("does not trust a same-size gzip archive whose bytes do not match the manifest", () => {
  const input = completeBinaryInput();
  input.archiveProbe.sha256 = "d".repeat(64);

  assert.deepEqual(decideCliBinaryStage(input), {
    action: "FAIL",
    reason:
      "the production CLI manifest already publishes 0.2.43, so its darwin-arm64 artifacts are immutable; the gzip archive sha256 does not match the manifest record; investigate the published record or publish a new version instead of retrying this version",
  });
});

test("does not trust a gzip archive unless it reconstructs the signed binary", () => {
  const input = completeBinaryInput();
  input.archiveProbe.reconstructedSha256 = "d".repeat(64);

  assert.deepEqual(decideCliBinaryStage(input), {
    action: "FAIL",
    reason:
      "the production CLI manifest already publishes 0.2.43, so its darwin-arm64 artifacts are immutable; the gzip archive does not reconstruct the recorded binary; investigate the published record or publish a new version instead of retrying this version",
  });
});

test("fails closed when the immutable binary completion probe is inconclusive", () => {
  assert.deepEqual(
    decideCliBinaryStage({
      probeError: "This operation was aborted",
      targetVersion: TARGET_VERSION,
    }),
    {
      action: "FAIL",
      probeFailure: true,
      reason:
        "CLI binary completion probe could not prove whether 0.2.43 is already published: This operation was aborted; refusing to rerun immutable binary publication without conclusive evidence",
    }
  );
});

test("parses the captured npm multi-field response when the immutable target version already exists", () => {
  const response = NPM_VERSION_FLOOR_FIXTURE.response;
  assert.deepEqual(
    decideNpmPublishStage({
      status: 0,
      stderr: "",
      stdout: `${JSON.stringify(response)}\n`,
      targetMinRequiredCliVersion: response["openmeld.minRequiredCliVersion"],
      targetVersion: response.version,
    }),
    {
      action: "SKIP",
      criterion: "npm-version-and-floor-exist",
      reason:
        "npm already publishes openmeld@0.3.130 with required floor 0.3.117",
    }
  );
});

test("fails final alignment before mutation when an immutable channel is wrong", () => {
  const immutableNpmFailure = {
    action: "FAIL",
    reason: "npm immutable metadata differs",
  };

  assert.deepEqual(
    decideChannelAlignmentStage({
      binary: { action: "SKIP" },
      core: { action: "SKIP" },
      npm: immutableNpmFailure,
    }),
    {
      action: "FAIL",
      reason: "npm immutable metadata differs",
    }
  );
});

test("fails closed when an immutable npm package has the wrong required floor", () => {
  const response = NPM_VERSION_FLOOR_FIXTURE.response;
  assert.deepEqual(
    decideNpmPublishStage({
      status: 0,
      stderr: "",
      stdout: buildCapturedNpmVersionFloorStdout({
        minRequiredCliVersion: "0.3.116",
        version: response.version,
      }),
      targetMinRequiredCliVersion: response["openmeld.minRequiredCliVersion"],
      targetVersion: response.version,
    }),
    {
      action: "FAIL",
      reason:
        "npm openmeld@0.3.130 is immutable with required floor 0.3.116, not target 0.3.117; publish a new release instead of retrying this version",
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
