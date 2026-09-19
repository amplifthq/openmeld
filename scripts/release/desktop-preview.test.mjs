import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const legacyPublicationDisabled =
  /Legacy unsigned Desktop publication is disabled/u;

test("legacy unsigned upload refuses publication before reading artifacts", () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./desktop-preview.mjs", import.meta.url)),
      "upload",
    ],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, legacyPublicationDisabled);
});

import {
  assertDesktopPromotionVersion,
  buildDesktopCandidateMetadata,
  buildDesktopPreviewMetadata,
  buildWranglerObjectPutArgs,
  DEFAULT_DOWNLOAD_PAGE_URL,
  DEFAULT_DOWNLOAD_URL,
  DEFAULT_R2_BUCKET_NAME,
  resolveDesktopArtifactName,
  resolveDesktopReleaseCommand,
} from "./desktop-preview.mjs";

test("Desktop promotion requires an increasing stable app version", () => {
  assert.doesNotThrow(() => assertDesktopPromotionVersion("0.1.1", null));
  assert.doesNotThrow(() => assertDesktopPromotionVersion("0.1.2", "0.1.1"));
  for (const version of ["0.1.1", "0.1.0", "0.1.2-preview.0", "../0.1.2"]) {
    assert.throws(() => assertDesktopPromotionVersion(version, "0.1.1"));
  }
});

test("candidate publication selects only hash-scoped keys and rejects path injection", () => {
  const input = {
    version: "0.1.0-preview.0",
    releaseSha: "b".repeat(40),
    sha256: "a".repeat(64),
    sizeBytes: 42,
  };
  const result = buildDesktopCandidateMetadata(input);
  assert.equal(
    result.manifestKey,
    `desktop/candidates/${input.sha256}/manifest.json`
  );
  assert.equal(
    result.objectKey,
    `desktop/candidates/${input.sha256}/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64.dmg`
  );
  assert.equal(
    result.downloadPath,
    `/desktop/download?candidate=${input.sha256}`
  );
  for (const invalid of [
    { version: "../update.json" },
    { objectKey: "desktop/update.json" },
    { sha256: "../private" },
    { target: "disposable" },
    { sizeBytes: 0 },
  ]) {
    assert.throws(() =>
      buildDesktopCandidateMetadata({ ...input, ...invalid })
    );
  }
});

test("Windows publication keeps the exact pnpm JS and literal argv, never a cmd shell", () => {
  const args = [
    "exec",
    "wrangler",
    "--file",
    "C:\\build with spaces\\中文 & %PATH%\\candidate.exe",
  ];
  const entry = "C:\\tools\\pnpm\\bin\\pnpm.cjs";
  assert.deepEqual(
    resolveDesktopReleaseCommand("pnpm", args, {
      platform: "win32",
      env: { npm_execpath: entry },
      execPath: "C:\\Node\\node.exe",
    }),
    { command: "C:\\Node\\node.exe", args: [entry, ...args] }
  );
  for (const npm_execpath of [undefined, "pnpm.cjs", "C:\\tools\\pnpm.cmd"]) {
    assert.throws(() =>
      resolveDesktopReleaseCommand("pnpm", args, {
        platform: "win32",
        env: { npm_execpath },
      })
    );
  }
  assert.deepEqual(
    resolveDesktopReleaseCommand("git", ["status"], { platform: "win32" }),
    { command: "git", args: ["status"] }
  );
});

test("Windows candidate metadata uses a platform-scoped installer and no fictional ZIP", () => {
  for (const platform of ["windows-x64", "windows-arm64"]) {
    const result = buildDesktopCandidateMetadata({
      platform,
      version: "0.1.4",
      releaseSha: "b".repeat(40),
      sha256: "a".repeat(64),
      sizeBytes: 42,
      windows: {
        sha512: `${"A".repeat(86)}==`,
        publisherName: "Fixture Publisher",
      },
    });
    assert.equal(result.artifactName, `OpenMeld-Desktop-0.1.4-${platform}.exe`);
    assert.equal(result.zipObjectKey, null);
    assert.equal(result.zipDownloadPath, null);
    assert.equal(result.manifest.windows.publisherName, "Fixture Publisher");
  }
});

test("resolves the unsigned Apple silicon Desktop artifact name", () => {
  assert.equal(
    resolveDesktopArtifactName("0.1.0-preview.0"),
    "OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg"
  );
});

test("builds the Desktop update manifest consumed by the app", () => {
  assert.deepEqual(
    buildDesktopPreviewMetadata({
      sha256: "abc123",
      sizeBytes: 42,
      version: "0.1.0-preview.0",
    }),
    {
      latestVersion: "0.1.0-preview.0",
      minimumSupportedVersion: "0.1.0-preview.0",
      downloadPageUrl: DEFAULT_DOWNLOAD_PAGE_URL,
      message: null,
      macosArm64: {
        artifactName:
          "OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg",
        objectKey:
          "desktop/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg",
        url: DEFAULT_DOWNLOAD_URL,
        version: "0.1.0-preview.0",
        sha256: "abc123",
        sizeBytes: 42,
      },
    }
  );
});

test("builds remote Wrangler R2 upload arguments with release headers", () => {
  assert.deepEqual(
    buildWranglerObjectPutArgs({
      bucketName: DEFAULT_R2_BUCKET_NAME,
      cacheControl: "public, max-age=31536000, immutable",
      contentDisposition:
        'attachment; filename="OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg"',
      contentType: "application/x-apple-diskimage",
      filePath:
        "/repo/clients/desktop/dist/release/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg",
      objectKey:
        "desktop/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg",
    }),
    [
      "exec",
      "wrangler",
      "r2",
      "object",
      "put",
      "openmeld-desktop-downloads-prod/desktop/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg",
      "--file",
      "/repo/clients/desktop/dist/release/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg",
      "--content-type",
      "application/x-apple-diskimage",
      "--cache-control",
      "public, max-age=31536000, immutable",
      "--force",
      "--remote",
      "--content-disposition",
      'attachment; filename="OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg"',
    ]
  );
});
