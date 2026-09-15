#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { desktopProductionSourceSchema } from "../../packages/schemas/src/desktop-client.ts";
import {
  desktopCandidateLocation,
  desktopCandidateManifestSchema,
} from "../../packages/schemas/src/desktop-release.ts";
import { DEFAULT_APPLE_TEAM_ID } from "./macos-cli-signing.mjs";

export function buildDesktopCandidateMetadata(input) {
  const manifest = desktopCandidateManifestSchema.parse({
    schemaVersion: 1,
    target: "production",
    platform: "macos-arm64",
    ...input,
  });
  return { manifest, ...desktopCandidateLocation(manifest) };
}

function inspectSignedCandidate(repoRoot, artifactPath, version) {
  const temporary = mkdtempSync(path.join(tmpdir(), "openmeld-candidate-"));
  const mount = path.join(temporary, "mount");
  mkdirSync(mount);
  let mounted = false;
  const inspect = (command, args) => {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(
        `Desktop candidate verification failed: ${command}: ${result.stderr}`
      );
    }
    return result.stdout + result.stderr;
  };
  try {
    inspect("codesign", ["--verify", "--strict", artifactPath]);
    inspect("hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mount,
      artifactPath,
    ]);
    mounted = true;
    const app = path.join(mount, "OpenMeld Desktop.app");
    inspect("codesign", ["--verify", "--deep", "--strict", app]);
    const signature = inspect("codesign", ["-dvv", app]);
    if (
      !(
        signature
          .split("\n")
          .includes(`TeamIdentifier=${DEFAULT_APPLE_TEAM_ID}`) &&
        signature.split("\n").includes("Identifier=sh.openmeld.desktop")
      )
    ) {
      throw new Error(
        "Desktop candidate must have the production Developer ID identity."
      );
    }
    inspect("xcrun", ["stapler", "validate", app]);
    inspect("spctl", ["--assess", "--type", "execute", app]);
    const resources = path.join(app, "Contents/Resources");
    const receipt = JSON.parse(
      readFileSync(
        path.join(resources, "desktop-production-source.json"),
        "utf8"
      )
    );
    const marker = JSON.parse(
      readFileSync(
        path.join(resources, "desktop-renderer/desktop-build.json"),
        "utf8"
      )
    );
    desktopProductionSourceSchema.parse(receipt);
    const target = receipt.target;
    if (
      target.kind !== "production" ||
      JSON.stringify(marker.installedTarget) !== JSON.stringify(target) ||
      marker.webBuild !== receipt.webBuild
    ) {
      throw new Error(
        "Desktop candidate does not contain the production renderer target."
      );
    }
    const bundledVersion = inspect("/usr/libexec/PlistBuddy", [
      "-c",
      "Print CFBundleShortVersionString",
      path.join(app, "Contents/Info.plist"),
    ]).trim();
    if (bundledVersion !== version) {
      throw new Error(
        "Desktop candidate version does not match the release checkout."
      );
    }
    const head = inspect("git", ["-C", repoRoot, "rev-parse", "HEAD"]).trim();
    if (
      receipt.releaseSha !== head ||
      process.env.OPENMELD_DESKTOP_RELEASE_SHA !== head
    ) {
      throw new Error(
        "Desktop candidate must match the exact approved release SHA."
      );
    }
    inspect("git", [
      "-C",
      repoRoot,
      "merge-base",
      "--is-ancestor",
      head,
      "origin/main",
    ]);
    if (inspect("git", ["-C", repoRoot, "status", "--porcelain"]).trim()) {
      throw new Error(
        "Desktop candidate publication requires a clean release checkout."
      );
    }
    return receipt.releaseSha;
  } finally {
    if (mounted) {
      inspect("hdiutil", ["detach", mount]);
    }
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function uploadDesktopCandidate(input = {}) {
  const repoRoot = input.repoRoot ?? process.cwd();
  const { version } = JSON.parse(
    readFileSync(path.join(repoRoot, DESKTOP_PACKAGE_JSON_PATH), "utf8")
  );
  const artifactPath = path.join(
    repoRoot,
    "clients/desktop/dist/production-preview",
    `OpenMeld-Desktop-${version}-macos-arm64.dmg`
  );
  const releaseSha = inspectSignedCandidate(repoRoot, artifactPath, version);
  const candidate = buildDesktopCandidateMetadata({
    version,
    releaseSha,
    sha256: hashFileSha256(artifactPath),
    sizeBytes: statSync(artifactPath).size,
  });
  const manifestPath = path.join(
    repoRoot,
    "clients/desktop/dist/production-preview/candidate.json"
  );
  writeFileSync(
    manifestPath,
    `${JSON.stringify(candidate.manifest, null, 2)}\n`
  );
  for (const item of [
    {
      objectKey: candidate.objectKey,
      filePath: artifactPath,
      contentType: "application/x-apple-diskimage",
      contentDisposition: `attachment; filename="${candidate.artifactName}"`,
    },
    {
      objectKey: candidate.manifestKey,
      filePath: manifestPath,
      contentType: "application/json; charset=utf-8",
    },
  ]) {
    runStep({
      command: "pnpm",
      cwd: repoRoot,
      label: `Upload immutable Desktop candidate ${item.objectKey}`,
      args: buildWranglerObjectPutArgs({
        ...item,
        bucketName: DEFAULT_R2_BUCKET_NAME,
        cacheControl: "public, max-age=31536000, immutable",
      }),
    });
  }
  process.stdout.write(
    `${JSON.stringify({ ...candidate, url: new URL(candidate.downloadPath, "https://openmeld.ai").href }, null, 2)}\n`
  );
  return candidate;
}

export const DEFAULT_R2_BUCKET_NAME = "openmeld-desktop-downloads-prod";
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
      "  OPENMELD_DESKTOP_RELEASE_SHA=<approved-merged-release-sha> pnpm run release:desktop-preview:upload-candidate",
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
      throw new Error(
        "Legacy unsigned Desktop publication is disabled. Use upload-candidate for an approved signed production preview."
      );
    } else if (command === "upload-candidate") {
      uploadDesktopCandidate();
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
