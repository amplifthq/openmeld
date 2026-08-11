import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDesktopPreviewMetadata,
  buildWranglerObjectPutArgs,
  DEFAULT_DOWNLOAD_PAGE_URL,
  DEFAULT_DOWNLOAD_URL,
  DEFAULT_R2_BUCKET_NAME,
  resolveDesktopArtifactName,
} from "./desktop-preview.mjs";

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
      "openmeld-desktop-downloads/desktop/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64-unsigned.dmg",
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
