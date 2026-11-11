const WINDOWS_SERVICE_POLICY_PATTERN = /needs cli and service decisions/u;

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { createCliBinaryDelta } from "./cli-binary-delta.mjs";
import {
  buildCliManifest,
  buildWranglerObjectPutArgs,
  CLI_MANIFEST_OBJECT_KEY,
  CLI_R2_OBJECT_PREFIX,
  createCompressedCliBinary,
  DEFAULT_CLI_DOWNLOAD_BASE_URL,
  DEFAULT_CLI_R2_BUCKET,
  prepareSignedCliBinary,
  prepareVerifiedCliBinary,
  resolveCliBinaryComponentPolicy,
  resolveCliMinRequiredVersion,
  resolveRetainedCliServiceSelection,
  verifyRetainedCliServiceArtifacts,
} from "./upload-cli-binary.mjs";
import { resolveWindowsPreviewComponentPolicy } from "./windows-preview-policy.mjs";

const CAPTURED_MANIFEST = JSON.parse(
  readFileSync(
    new URL(
      "../../clients/openmeld-cli/tests/fixtures/cli-binary-manifest.stable.json",
      import.meta.url
    ),
    "utf8"
  )
);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SECURE_STORAGE_SMOKE_FAILURE_PATTERN = /secure storage smoke failed/u;
const STOP_AFTER_BUILD_INPUT_PATTERN = /stop after build input/u;
const WRONG_RETAINED_SERVICE_PATTERN = /not retained target 0\.2\.13/u;
const RETAINED_SERVICE_MISMATCH_PATTERN = /gzip artifact does not match/u;
const RETAINED_SERVICE_BYTES = Buffer.from("verified retained service");
const RETAINED_SERVICE_ARCHIVE = gzipSync(RETAINED_SERVICE_BYTES);

test("publishes the configured CLI compatibility floor for optional and required upgrades", () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "openmeld-cli-floor-"));
  const version = "0.2.14";
  try {
    const packageDir = path.join(repoRoot, "clients", "openmeld-cli");
    mkdirSync(packageDir, { recursive: true });
    for (const minRequiredCliVersion of ["0.2.13", version]) {
      writeFileSync(
        path.join(packageDir, "package.json"),
        JSON.stringify({ version, openmeld: { minRequiredCliVersion } })
      );
      const resolvedFloor = resolveCliMinRequiredVersion(repoRoot);
      assert.equal(resolvedFloor, minRequiredCliVersion);

      const manifest = buildCliManifest({
        archiveArtifactName: `openmeld-cli-darwin-arm64-${version}.gz`,
        archiveSha256: "b".repeat(64),
        archiveSizeBytes: 25_721_096,
        artifactName: `openmeld-cli-darwin-arm64-${version}`,
        downloadBaseUrl: DEFAULT_CLI_DOWNLOAD_BASE_URL,
        minRequiredCliVersion: resolvedFloor,
        platform: "darwin-arm64",
        sha256: "a".repeat(64),
        sizeBytes: 68_899_792,
        version,
      });

      assert.equal(manifest.channels.stable.version, version);
      assert.equal(
        manifest.channels.stable.minRequiredCliVersion,
        minRequiredCliVersion
      );
    }
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("builds the captured stable CLI binary manifest shape", () => {
  const manifest = buildCliManifest({
    archiveArtifactName: "openmeld-cli-darwin-arm64-0.2.14.gz",
    archiveSha256:
      "0d3999f3bce1510e09221fd1ce883d27393db9fb5f6bd20af8d5e0f2d3c4b5a6",
    archiveSizeBytes: 25_721_096,
    artifactName: "openmeld-cli-darwin-arm64-0.2.14",
    downloadBaseUrl: DEFAULT_CLI_DOWNLOAD_BASE_URL,
    minRequiredCliVersion: "0.2.14",
    platform: "darwin-arm64",
    sha256: "95381a4f7a425eff7a79c05c446052c91eadd410af69249f912f60347918ebb0",
    sizeBytes: 68_899_792,
    version: "0.2.14",
  });

  assert.deepEqual(manifest, {
    ...CAPTURED_MANIFEST,
    channels: {
      stable: {
        ...CAPTURED_MANIFEST.channels.stable,
        platforms: {
          "darwin-arm64": {
            ...CAPTURED_MANIFEST.channels.stable.platforms["darwin-arm64"],
            archiveFormat: "gzip",
            archiveUrl:
              "https://openmeld.ai/cli/download/openmeld-cli-darwin-arm64-0.2.14.gz",
            archiveSha256:
              "0d3999f3bce1510e09221fd1ce883d27393db9fb5f6bd20af8d5e0f2d3c4b5a6",
            archiveSizeBytes: 25_721_096,
          },
        },
      },
    },
  });
});

test("selects the exact published Service for a newer CLI", () => {
  const service = resolveRetainedCliServiceSelection({
    channelManifest: CAPTURED_MANIFEST,
    targetCliVersion: "0.2.15",
    targetServiceVersion: "0.2.14",
  });
  assert.equal(service.version, "0.2.14");
  assert.deepEqual(
    service.platforms,
    CAPTURED_MANIFEST.channels.stable.platforms
  );
  assert.throws(
    () =>
      resolveRetainedCliServiceSelection({
        channelManifest: CAPTURED_MANIFEST,
        targetCliVersion: "0.2.16",
        targetServiceVersion: "0.2.13",
      }),
    WRONG_RETAINED_SERVICE_PATTERN
  );
});

test("verifies retained Service bytes before publishing a split manifest", async () => {
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  const service = {
    version: "0.2.14",
    platforms: {
      "darwin-arm64": {
        url: "https://openmeld.ai/cli/download/service-raw",
        sha256: sha256(RETAINED_SERVICE_BYTES),
        sizeBytes: RETAINED_SERVICE_BYTES.byteLength,
        archiveFormat: "gzip",
        archiveUrl: "https://openmeld.ai/cli/download/service-raw.gz",
        archiveSha256: sha256(RETAINED_SERVICE_ARCHIVE),
        archiveSizeBytes: RETAINED_SERVICE_ARCHIVE.byteLength,
      },
    },
  };
  const fetch = (url, options = {}) => {
    if (options.method === "HEAD") {
      return new Response(null, {
        headers: {
          "content-length": String(RETAINED_SERVICE_BYTES.byteLength),
        },
        status: 200,
      });
    }
    assert.equal(url, service.platforms["darwin-arm64"].archiveUrl);
    return new Response(RETAINED_SERVICE_ARCHIVE, { status: 200 });
  };

  await verifyRetainedCliServiceArtifacts({ fetch, service });
  const wrongService = structuredClone(service);
  wrongService.platforms["darwin-arm64"].archiveSha256 = "0".repeat(64);
  await assert.rejects(
    verifyRetainedCliServiceArtifacts({ fetch, service: wrongService }),
    RETAINED_SERVICE_MISMATCH_PATTERN
  );
});

test("passes an isolated staging version into the binary build", async () => {
  const calls = [];
  const version = "0.3.122-staging.20260828001527123.30530093";
  const service = {
    version: CAPTURED_MANIFEST.channels.stable.version,
    platforms: CAPTURED_MANIFEST.channels.stable.platforms,
  };
  await assert.rejects(
    async () =>
      await import("./upload-cli-binary.mjs").then(({ uploadCliBinary }) =>
        uploadCliBinary({
          buildBinary: (input) => {
            calls.push(input);
            throw new Error("stop after build input");
          },
          version,
          service,
        })
      ),
    STOP_AFTER_BUILD_INPUT_PATTERN
  );
  assert.deepEqual(calls, [
    { outDir: undefined, platform: "darwin-arm64", version, service },
  ]);
  const artifact = service.platforms["darwin-arm64"];
  const published = buildCliManifest({
    version,
    service,
    minRequiredCliVersion: "0.2.14",
    platform: "darwin-arm64",
    artifactName: `openmeld-cli-darwin-arm64-${version}`,
    archiveArtifactName: `openmeld-cli-darwin-arm64-${version}.gz`,
    downloadBaseUrl: DEFAULT_CLI_DOWNLOAD_BASE_URL,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    archiveSha256: artifact.sha256,
    archiveSizeBytes: artifact.sizeBytes,
  });
  assert.deepEqual(published.channels.stable.service, service);
});

test("compresses the final signed CLI binary into a gzip transport artifact", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "openmeld-cli-gzip-"));
  try {
    const outFile = path.join(tempDir, "openmeld-cli-darwin-arm64-0.2.14");
    const signedBytes = Buffer.from("final signed OpenMeld CLI binary\n");
    writeFileSync(outFile, signedBytes);

    const compressed = createCompressedCliBinary({
      artifactName: path.basename(outFile),
      outFile,
    });

    assert.equal(compressed.artifactName, `${path.basename(outFile)}.gz`);
    assert.deepEqual(gunzipSync(readFileSync(compressed.outFile)), signedBytes);
    assert.equal(
      compressed.sizeBytes,
      readFileSync(compressed.outFile).byteLength
    );
    assert.match(compressed.sha256, SHA256_PATTERN);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("builds a small exact-base delta that reconstructs the target byte for byte", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "openmeld-cli-delta-"));
  try {
    const baseBytes = Buffer.from("official OpenMeld 0.3.18 binary\n");
    const targetBytes = Buffer.from("official OpenMeld 0.3.19 signed binary\n");
    const targetOutFile = path.join(
      tempDir,
      "openmeld-cli-darwin-arm64-0.3.19"
    );
    writeFileSync(targetOutFile, targetBytes);

    const delta = createCliBinaryDelta({
      artifactName: path.basename(targetOutFile),
      baseBytes,
      downloadBaseUrl: DEFAULT_CLI_DOWNLOAD_BASE_URL,
      fromVersion: "0.3.18",
      outFile: targetOutFile,
      targetBytes,
    });

    const patchPayload = JSON.parse(
      gunzipSync(readFileSync(delta.outFile)).toString("utf8")
    );
    const reconstructed = Buffer.alloc(patchPayload.targetSizeBytes);
    baseBytes.copy(reconstructed);
    for (const segment of patchPayload.segments) {
      Buffer.from(segment.dataBase64, "base64").copy(
        reconstructed,
        segment.offset
      );
    }

    assert.deepEqual(reconstructed, targetBytes);
    assert.equal(delta.manifest.patchCompression, "gzip");
    assert.equal(delta.manifest.patchFormat, "block-ranges-v1");
    assert.equal(delta.manifest.fromVersion, "0.3.18");
    assert.equal(
      delta.manifest.patchSizeBytes,
      readFileSync(delta.outFile).length
    );
    assert.match(delta.manifest.patchSha256, SHA256_PATTERN);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("publishes signature identity and an optional delta in the manifest", () => {
  const delta = {
    fromSha256: "b".repeat(64),
    fromSizeBytes: 72_000_000,
    fromVersion: "0.3.18",
    patchCompression: "gzip",
    patchFormat: "block-ranges-v1",
    patchPayloadSizeBytes: 4_100_000,
    patchSha256: "c".repeat(64),
    patchSizeBytes: 990_000,
    patchUrl:
      "https://openmeld.ai/cli/download/openmeld-cli-darwin-arm64-0.3.19-delta-from-0.3.18.gz",
  };
  const manifest = buildCliManifest({
    archiveArtifactName: "openmeld-cli-darwin-arm64-0.3.19.gz",
    archiveSha256: "d".repeat(64),
    archiveSizeBytes: 25_700_000,
    artifactName: "openmeld-cli-darwin-arm64-0.3.19",
    codeIdentifier: "sh.openmeld.cli",
    deltas: [delta],
    downloadBaseUrl: DEFAULT_CLI_DOWNLOAD_BASE_URL,
    minRequiredCliVersion: "0.3.8",
    platform: "darwin-arm64",
    sha256: "a".repeat(64),
    sizeBytes: 73_000_000,
    teamIdentifier: "38FFHDPA3B",
    version: "0.3.19",
  });

  assert.deepEqual(manifest.channels.stable.platforms["darwin-arm64"].deltas, [
    delta,
  ]);
  assert.equal(
    manifest.channels.stable.platforms["darwin-arm64"].codeIdentifier,
    "sh.openmeld.cli"
  );
  assert.equal(
    manifest.channels.stable.platforms["darwin-arm64"].teamIdentifier,
    "38FFHDPA3B"
  );
});

test("builds remote R2 object put args for binary artifacts", () => {
  assert.deepEqual(
    buildWranglerObjectPutArgs({
      bucketName: DEFAULT_CLI_R2_BUCKET,
      cacheControl: "public, max-age=31536000, immutable",
      contentType: "application/octet-stream",
      filePath: "/tmp/openmeld-cli-darwin-arm64-0.2.8",
      objectKey: `${CLI_R2_OBJECT_PREFIX}/openmeld-cli-darwin-arm64-0.2.8`,
    }),
    [
      "exec",
      "wrangler",
      "r2",
      "object",
      "put",
      "openmeld-desktop-downloads-prod/cli/openmeld-cli-darwin-arm64-0.2.8",
      "--file",
      "/tmp/openmeld-cli-darwin-arm64-0.2.8",
      "--content-type",
      "application/octet-stream",
      "--cache-control",
      "public, max-age=31536000, immutable",
      "--force",
      "--remote",
    ]
  );
});

test("builds remote R2 object put args for the CLI manifest", () => {
  assert.deepEqual(
    buildWranglerObjectPutArgs({
      bucketName: DEFAULT_CLI_R2_BUCKET,
      cacheControl: "public, max-age=60, must-revalidate",
      contentType: "application/json; charset=utf-8",
      filePath: "/tmp/manifest.json",
      objectKey: CLI_MANIFEST_OBJECT_KEY,
    }),
    [
      "exec",
      "wrangler",
      "r2",
      "object",
      "put",
      "openmeld-desktop-downloads-prod/cli/manifest.json",
      "--file",
      "/tmp/manifest.json",
      "--content-type",
      "application/json; charset=utf-8",
      "--cache-control",
      "public, max-age=60, must-revalidate",
      "--force",
      "--remote",
    ]
  );
});

test("signs and notarizes before collecting release metadata", () => {
  const calls = [];
  const prepared = prepareSignedCliBinary({
    built: {
      artifactName: "openmeld-cli-darwin-arm64-0.2.14",
      outFile: "/tmp/openmeld-cli-darwin-arm64-0.2.14",
      platform: "darwin-arm64",
      sha256: "unsigned-sha",
      sizeBytes: 100,
      version: "0.2.14",
    },
    collectMetadata: (outFile) => {
      calls.push(["metadata", outFile]);
      return { sha256: "signed-sha", sizeBytes: 120 };
    },
    env: {},
    signAndNotarize: (input) => {
      calls.push(["sign", input.outFile, input.platform]);
      return { submissionId: "submission-id" };
    },
  });

  assert.deepEqual(calls, [
    ["sign", "/tmp/openmeld-cli-darwin-arm64-0.2.14", "darwin-arm64"],
    ["metadata", "/tmp/openmeld-cli-darwin-arm64-0.2.14"],
  ]);
  assert.equal(prepared.sha256, "signed-sha");
  assert.equal(prepared.sizeBytes, 120);
  assert.deepEqual(prepared.notarization, { submissionId: "submission-id" });
});

test("smokes secure storage after signing and before accepting the binary for upload", async () => {
  const calls = [];
  const prepared = await prepareVerifiedCliBinary({
    built: {
      artifactName: "openmeld-cli-darwin-arm64-0.2.14",
      outFile: "/tmp/openmeld-cli-darwin-arm64-0.2.14",
      platform: "darwin-arm64",
      sha256: "unsigned-sha",
      sizeBytes: 100,
      version: "0.2.14",
    },
    collectMetadata: (outFile) => {
      calls.push(["metadata", outFile]);
      return { sha256: "signed-sha", sizeBytes: 120 };
    },
    env: {},
    signAndNotarize: (input) => {
      calls.push(["sign", input.outFile, input.platform]);
      return { submissionId: "submission-id" };
    },
    smokeSignedSecureStorage: (input) => {
      calls.push(["smoke", input.outFile, input.platform]);
    },
  });

  assert.deepEqual(calls, [
    ["sign", "/tmp/openmeld-cli-darwin-arm64-0.2.14", "darwin-arm64"],
    ["metadata", "/tmp/openmeld-cli-darwin-arm64-0.2.14"],
    ["smoke", "/tmp/openmeld-cli-darwin-arm64-0.2.14", "darwin-arm64"],
  ]);
  assert.equal(prepared.sha256, "signed-sha");
});

test("rejects a signed binary when the secure storage smoke fails", async () => {
  await assert.rejects(
    prepareVerifiedCliBinary({
      built: {
        artifactName: "openmeld-cli-darwin-arm64-0.2.14",
        outFile: "/tmp/openmeld-cli-darwin-arm64-0.2.14",
        platform: "darwin-arm64",
        sha256: "unsigned-sha",
        sizeBytes: 100,
        version: "0.2.14",
      },
      collectMetadata: () => ({ sha256: "signed-sha", sizeBytes: 120 }),
      env: {},
      signAndNotarize: () => ({ submissionId: "submission-id" }),
      smokeSignedSecureStorage: () => {
        throw new Error("secure storage smoke failed");
      },
    }),
    SECURE_STORAGE_SMOKE_FAILURE_PATTERN
  );
});

test("policy provenance does not attach production identity to custom staging artifacts", () => {
  const releaseManifest = JSON.parse(
    readFileSync(
      new URL("./fixtures/local-components-v0.3.264.json", import.meta.url),
      "utf8"
    )
  );
  const cliVersion = releaseManifest.components.cli.packageVersion;
  const serviceVersion = releaseManifest.components.service.bundleVersion;
  assert.deepEqual(
    resolveCliBinaryComponentPolicy({
      releaseManifest,
      cliVersion,
      serviceVersion,
    }),
    {
      cli: releaseManifest.components.cli,
      service: releaseManifest.components.service,
    }
  );
  assert.equal(
    resolveCliBinaryComponentPolicy({
      releaseManifest,
      cliVersion: `${cliVersion}-staging.fixture`,
      serviceVersion,
    }),
    undefined
  );
  assert.equal(
    resolveCliBinaryComponentPolicy({
      releaseManifest,
      cliVersion,
      serviceVersion: "0.0.0",
    }),
    undefined
  );
});
test("native preview needs fresh CLI and Service decisions for its exact version", async () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const { version } = JSON.parse(
    readFileSync(join(repoRoot, "clients/openmeld-cli/package.json"), "utf8")
  );
  const policy = JSON.parse(
    readFileSync(join(repoRoot, "release/local-components-policy.json"), "utf8")
  );
  if (policy.version === version && policy.service) {
    const resolved = await resolveWindowsPreviewComponentPolicy({
      repoRoot,
      version,
    });
    assert.equal(resolved.service.bundleVersion, version);
    assert.equal(resolved.service.updatePolicy, policy.service.updatePolicy);
  }
  const root = mkdtempSync(join(tmpdir(), "windows-preview-policy-"));
  try {
    mkdirSync(join(root, "release"));
    writeFileSync(
      join(root, "release/local-components-policy.json"),
      JSON.stringify({ version, cli: policy.cli })
    );
    await assert.rejects(
      resolveWindowsPreviewComponentPolicy({ repoRoot: root, version }),
      WINDOWS_SERVICE_POLICY_PATTERN
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
