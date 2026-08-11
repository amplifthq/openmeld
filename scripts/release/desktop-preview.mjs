#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const DEFAULT_R2_BUCKET_NAME = "openmeld-desktop-downloads";
export const DEFAULT_DOWNLOAD_PAGE_URL = "https://openmeld.ai/desktop";
export const DEFAULT_DOWNLOAD_URL = "https://openmeld.ai/desktop/download";
export const DESKTOP_PACKAGE_JSON_PATH = "clients/desktop/package.json";
export const DESKTOP_RELEASE_DIR = "clients/desktop/dist/release";
export const DESKTOP_R2_OBJECT_PREFIX = "desktop";

export function resolveDesktopArtifactName(version) {
  return `OpenMeld-Desktop-${version}-macos-arm64-unsigned.dmg`;
}

export function resolveDesktopArtifactPath(input) {
  return path.join(
    input.repoRoot,
    DESKTOP_RELEASE_DIR,
    resolveDesktopArtifactName(input.version)
  );
}

export function buildDesktopPreviewMetadata(input) {
  const artifactName =
    input.artifactName ?? resolveDesktopArtifactName(input.version);
  const objectKey =
    input.objectKey ?? `${DESKTOP_R2_OBJECT_PREFIX}/${artifactName}`;
  return {
    latestVersion: input.version,
    minimumSupportedVersion: input.minimumSupportedVersion ?? input.version,
    downloadPageUrl: input.downloadPageUrl ?? DEFAULT_DOWNLOAD_PAGE_URL,
    message: input.message ?? null,
    macosArm64: {
      artifactName,
      objectKey,
      url: input.downloadUrl ?? DEFAULT_DOWNLOAD_URL,
      version: input.version,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
    },
  };
}

export function buildWranglerObjectPutArgs(input) {
  const args = [
    "exec",
    "wrangler",
    "r2",
    "object",
    "put",
    `${input.bucketName}/${input.objectKey}`,
    "--file",
    input.filePath,
    "--content-type",
    input.contentType,
    "--cache-control",
    input.cacheControl,
    "--force",
    "--remote",
  ];

  if (input.contentDisposition) {
    args.push("--content-disposition", input.contentDisposition);
  }

  return args;
}

export function resolveDesktopPreviewRelease(input = {}) {
  const repoRoot = input.repoRoot ?? process.cwd();
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, DESKTOP_PACKAGE_JSON_PATH), "utf8")
  );
  const version = packageJson.version;
  if (typeof version !== "string" || version.trim().length === 0) {
    throw new Error(
      `${DESKTOP_PACKAGE_JSON_PATH} must define a non-empty version.`
    );
  }

  const artifactName = resolveDesktopArtifactName(version);
  const artifactPath = resolveDesktopArtifactPath({ repoRoot, version });
  const manifestPath = path.join(
    repoRoot,
    DESKTOP_RELEASE_DIR,
    "desktop-update.json"
  );
  const objectKey = `${DESKTOP_R2_OBJECT_PREFIX}/${artifactName}`;
  const manifestObjectKey = `${DESKTOP_R2_OBJECT_PREFIX}/update.json`;

  return {
    artifactName,
    artifactPath,
    manifestObjectKey,
    manifestPath,
    objectKey,
    repoRoot,
    version,
  };
}

export function hashFileSha256(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

export function writeDesktopPreviewManifest(input) {
  const sizeBytes = statSync(input.artifactPath).size;
  const sha256 = hashFileSha256(input.artifactPath);
  const manifest = buildDesktopPreviewMetadata({
    artifactName: input.artifactName,
    downloadPageUrl: input.downloadPageUrl,
    downloadUrl: input.downloadUrl,
    objectKey: input.objectKey,
    sha256,
    sizeBytes,
    version: input.version,
  });

  mkdirSync(path.dirname(input.manifestPath), { recursive: true });
  writeFileSync(
    input.manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  return { manifest, sha256, sizeBytes };
}

export function buildDesktopPreview(input = {}) {
  const release = resolveDesktopPreviewRelease(input);
  runStep({
    args: ["-C", "clients/desktop", "run", "package:mac:arm64:unsigned"],
    command: "pnpm",
    cwd: release.repoRoot,
    label: "Build unsigned macOS arm64 OpenMeld Desktop DMG",
  });

  if (!existsSync(release.artifactPath)) {
    throw new Error(
      `Expected Desktop artifact was not created: ${release.artifactPath}`
    );
  }

  const metadata = writeDesktopPreviewManifest({
    artifactName: release.artifactName,
    artifactPath: release.artifactPath,
    downloadPageUrl: input.downloadPageUrl,
    downloadUrl: input.downloadUrl,
    manifestPath: release.manifestPath,
    objectKey: release.objectKey,
    version: release.version,
  });

  process.stdout.write(
    [
      "",
      "[release:desktop-preview] Build output",
      `- DMG: ${release.artifactPath}`,
      `- manifest: ${release.manifestPath}`,
      `- sha256: ${metadata.sha256}`,
      `- sizeBytes: ${metadata.sizeBytes}`,
      "",
    ].join("\n")
  );

  return { ...release, ...metadata };
}

export function uploadDesktopPreview(input = {}) {
  const bucketName =
    input.bucketName ??
    process.env.OPENMELD_DESKTOP_R2_BUCKET ??
    DEFAULT_R2_BUCKET_NAME;
  const release = resolveDesktopPreviewRelease(input);

  if (!existsSync(release.artifactPath)) {
    throw new Error(
      `Desktop DMG is missing. Run pnpm run release:desktop-preview:build first: ${release.artifactPath}`
    );
  }

  const metadata = writeDesktopPreviewManifest({
    artifactName: release.artifactName,
    artifactPath: release.artifactPath,
    downloadPageUrl: input.downloadPageUrl,
    downloadUrl: input.downloadUrl,
    manifestPath: release.manifestPath,
    objectKey: release.objectKey,
    version: release.version,
  });

  runStep({
    args: buildWranglerObjectPutArgs({
      bucketName,
      cacheControl: "public, max-age=31536000, immutable",
      contentDisposition: `attachment; filename="${release.artifactName}"`,
      contentType: "application/x-apple-diskimage",
      filePath: release.artifactPath,
      objectKey: release.objectKey,
    }),
    command: "pnpm",
    cwd: release.repoRoot,
    label: `Upload ${release.objectKey} to R2 bucket ${bucketName}`,
  });

  runStep({
    args: buildWranglerObjectPutArgs({
      bucketName,
      cacheControl: "public, max-age=60, must-revalidate",
      contentType: "application/json; charset=utf-8",
      filePath: release.manifestPath,
      objectKey: release.manifestObjectKey,
    }),
    command: "pnpm",
    cwd: release.repoRoot,
    label: `Upload ${release.manifestObjectKey} to R2 bucket ${bucketName}`,
  });

  process.stdout.write(
    [
      "",
      "[release:desktop-preview] Upload complete",
      `- page: ${DEFAULT_DOWNLOAD_PAGE_URL}`,
      `- download: ${DEFAULT_DOWNLOAD_URL}`,
      `- bucket: ${bucketName}`,
      `- object: ${release.objectKey}`,
      `- sha256: ${metadata.sha256}`,
      `- sizeBytes: ${metadata.sizeBytes}`,
      "",
    ].join("\n")
  );

  return { ...release, ...metadata, bucketName };
}

function runStep(input) {
  process.stdout.write(`\n[release:desktop-preview] ${input.label}\n`);
  const result = spawnSync(resolveCommandBinary(input.command), input.args, {
    cwd: input.cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${input.command} ${input.args.join(" ")} failed with exit code ${result.status}`
    );
  }
}

function resolveCommandBinary(command) {
  if (process.platform !== "win32") {
    return command;
  }
  return command === "pnpm" ? "pnpm.cmd" : command;
}

function printUsage() {
  process.stderr.write(
    [
      "Usage:",
      "  pnpm run release:desktop-preview:build",
      "  OPENMELD_DESKTOP_R2_BUCKET=openmeld-desktop-downloads pnpm run release:desktop-preview:upload",
      "",
    ].join("\n")
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = process.argv[2] ?? "build";
    if (command === "build") {
      buildDesktopPreview();
    } else if (command === "upload") {
      uploadDesktopPreview();
    } else {
      printUsage();
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
