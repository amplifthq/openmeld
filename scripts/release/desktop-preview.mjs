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
import { desktopProductionSourceSchema } from "../../packages/schemas/dist/desktop-client.js";
import {
  desktopCandidateLocation,
  desktopCandidateManifestKey,
  desktopCandidateManifestSchema,
  desktopCandidateUpdateArtifact,
  desktopPromotedReleaseKey,
  desktopPromotedReleaseSchema,
  desktopReleasePlatformSchema,
} from "../../packages/schemas/dist/desktop-release.js";
import {
  readInstalledDesktopPlatform,
  readWindowsDesktopSigning,
} from "../desktop/installed-platform.ts";
import { desktopProductionSource } from "../desktop/signed-package.ts";
import { DEFAULT_APPLE_TEAM_ID } from "./apple-release-signing.mjs";
import {
  checkDesktopPublisher,
  DEFAULT_R2_BUCKET_NAME,
  desktopPublisherCredentials,
} from "./desktop-publisher.mjs";
import { requireMainlineReleaseSha } from "./require-mainline-release-sha.mjs";

const DMG_SUFFIX = /\.dmg$/;
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const NODE_ENTRY = /\.[cm]?js$/iu;

export function resolveDesktopReleaseCommand(command, args, input = {}) {
  const platform = input.platform ?? process.platform;
  if (platform !== "win32" || command !== "pnpm") {
    return { command, args };
  }
  const entry = (input.env ?? process.env).npm_execpath;
  if (!(entry && path.win32.isAbsolute(entry) && NODE_ENTRY.test(entry))) {
    throw new Error(
      "Run Windows Desktop release commands through the root pnpm scripts so the exact pnpm JavaScript entry is available."
    );
  }
  return {
    command: input.execPath ?? process.execPath,
    args: [entry, ...args],
  };
}

async function inspectPlatformCandidate(
  repoRoot,
  artifactPath,
  version,
  platform
) {
  if (platform === "macos-arm64") {
    return {
      releaseSha: inspectSignedCandidate(
        repoRoot,
        artifactPath,
        version,
        artifactPath.replace(DMG_SUFFIX, ".zip")
      ),
      windows: null,
    };
  }
  // Reuse the approved, clean, merged source guard before inspecting Windows
  // bytes. A sidecar receipt is never proof of a signed installer payload.
  const { releaseSha: approvedSha } = desktopProductionSource(process.env);
  const windows = readWindowsDesktopSigning(process.env, platform);
  const { inspectWindowsDesktopCandidate } = await import(
    "../desktop/windows-artifact.mjs"
  );
  return {
    releaseSha: await inspectWindowsDesktopCandidate({
      repoRoot,
      artifactPath,
      version,
      approvedSha,
      windows,
    }),
    windows,
  };
}

export function buildDesktopCandidateMetadata(input) {
  const manifest = desktopCandidateManifestSchema.parse({
    schemaVersion: 1,
    target: "production",
    platform: "macos-arm64",
    ...input,
  });
  return { manifest, ...desktopCandidateLocation(manifest) };
}

export function inspectDesktopCandidateCommand(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    const details = [
      `Desktop candidate verification failed: ${[command, ...args].map((argument) => JSON.stringify(argument)).join(" ")}`,
      `Exit status: ${result.status ?? "none"}; signal: ${result.signal ?? "none"}`,
      result.error?.message,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean);
    throw new Error(details.join("\n"), { cause: result.error });
  }
  return (result.stdout ?? "") + (result.stderr ?? "");
}

function inspectSignedCandidate(repoRoot, artifactPath, version, zipPath) {
  const temporary = mkdtempSync(path.join(tmpdir(), "openmeld-candidate-"));
  const mount = path.join(temporary, "mount");
  mkdirSync(mount);
  let mounted = false;
  const inspect = inspectDesktopCandidateCommand;
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
    const app = path.join(mount, "OpenMeld.app");
    inspect("codesign", ["--verify", "--deep", "--strict", app]);
    const signature = inspect("codesign", ["-dvvv", app]);
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
    inspect("xcrun", ["stapler", "validate", "-v", app]);
    inspect("spctl", ["--assess", "--type", "execute", app]);
    if (zipPath) {
      const zipRoot = path.join(temporary, "zip");
      inspect("ditto", ["-x", "-k", zipPath, zipRoot]);
      const zipApp = path.join(zipRoot, "OpenMeld.app");
      inspect("codesign", ["--verify", "--deep", "--strict", zipApp]);
      inspect("xcrun", ["stapler", "validate", "-v", zipApp]);
      const zipSignature = inspect("codesign", ["-dvvv", zipApp]);
      const digest = (value) =>
        value.split("\n").find((line) => line.startsWith("CDHash="));
      if (!digest(signature) || digest(signature) !== digest(zipSignature)) {
        throw new Error(
          "Desktop DMG and update ZIP must contain the same signed app."
        );
      }
    }
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

export async function uploadDesktopCandidate(input = {}) {
  const publisherEnv = await checkDesktopPublisher(input);
  const repoRoot = input.repoRoot ?? process.cwd();
  const { version } = JSON.parse(
    readFileSync(path.join(repoRoot, DESKTOP_PACKAGE_JSON_PATH), "utf8")
  );
  const { platform } = readInstalledDesktopPlatform(process.env);
  const mac = platform === "macos-arm64";
  const artifactPath = path.join(
    repoRoot,
    "clients/desktop/dist/production-preview",
    `OpenMeld-Desktop-${version}-${platform}.${mac ? "dmg" : "exe"}`
  );
  const zipPath = mac ? artifactPath.replace(DMG_SUFFIX, ".zip") : null;
  const { releaseSha, windows } = await inspectPlatformCandidate(
    repoRoot,
    artifactPath,
    version,
    platform
  );
  const candidate = buildDesktopCandidateMetadata({
    platform,
    version,
    releaseSha,
    sha256: hashFileSha256(artifactPath),
    sizeBytes: statSync(artifactPath).size,
    ...(zipPath
      ? {
          zip: {
            sha256: hashFileSha256(zipPath),
            sha512: createHash("sha512")
              .update(readFileSync(zipPath))
              .digest("base64"),
            sizeBytes: statSync(zipPath).size,
          },
        }
      : {
          windows: {
            publisherName: windows.publisherName,
            sha512: createHash("sha512")
              .update(readFileSync(artifactPath))
              .digest("base64"),
          },
        }),
  });
  const manifestPath = path.join(
    repoRoot,
    "clients/desktop/dist/production-preview/candidate.json"
  );
  writeFileSync(
    manifestPath,
    `${JSON.stringify(candidate.manifest, null, 2)}\n`
  );
  if (
    await reuseDesktopCandidate({
      repoRoot,
      manifest: candidate.manifest,
      env: publisherEnv,
    })
  ) {
    process.stdout.write(
      `Verified existing immutable Desktop candidate: ${candidate.manifest.sha256}\n`
    );
    return candidate;
  }
  const existing = await fetch(
    new URL(candidate.downloadPath, DEFAULT_DOWNLOAD_PAGE_URL),
    { method: "HEAD", cache: "no-store", redirect: "error" }
  );
  if (existing.status !== 404) {
    throw new Error(
      `Candidate already exists or cannot be checked (${existing.status}); immutable candidates cannot be overwritten.`
    );
  }
  const uploadedKeys = [];
  for (const item of [
    {
      objectKey: candidate.objectKey,
      filePath: artifactPath,
      contentType: mac
        ? "application/x-apple-diskimage"
        : "application/vnd.microsoft.portable-executable",
      contentDisposition: `attachment; filename="${candidate.artifactName}"`,
    },
    ...(zipPath
      ? [
          {
            objectKey: candidate.zipObjectKey,
            filePath: zipPath,
            contentType: "application/zip",
          },
        ]
      : []),
    {
      objectKey: candidate.manifestKey,
      filePath: manifestPath,
      contentType: "application/json; charset=utf-8",
    },
  ]) {
    try {
      runStep({
        command: "pnpm",
        cwd: repoRoot,
        env: publisherEnv,
        label: `Upload immutable Desktop candidate ${item.objectKey}`,
        args: buildWranglerObjectPutArgs({
          ...item,
          bucketName: DEFAULT_R2_BUCKET_NAME,
          cacheControl: "public, max-age=31536000, immutable",
        }),
      });
      uploadedKeys.push(item.objectKey);
    } catch (error) {
      throw new Error(
        `Desktop candidate upload stopped at ${item.objectKey}. Completed in this attempt: ${uploadedKeys.join(", ") || "none"}. The attempted object may have been written; inspect these exact R2 keys before retrying. Promotion was not attempted. Cause: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  process.stdout.write(
    `${JSON.stringify({ ...candidate, url: new URL(candidate.downloadPath, "https://openmeld.ai").href }, null, 2)}\n`
  );
  return candidate;
}

// A retry after successful R2 publication must recover the same bytes, not
// rebuild or overwrite a published candidate. R2 metadata is authoritative;
// public downloads must also prove that the complete candidate is available.
export async function reuseDesktopCandidate({
  repoRoot,
  manifest,
  env,
  readObject = (key) => readDesktopReleaseObject(repoRoot, key, env),
  verifyArtifact = verifyDesktopPublicArtifact,
}) {
  const raw = await readObject(desktopCandidateManifestKey(manifest.sha256));
  if (raw === null) {
    return false;
  }
  const published = desktopCandidateManifestSchema.parse(raw);
  if (JSON.stringify(published) !== JSON.stringify(manifest)) {
    throw new Error(
      "Published candidate metadata differs; immutable candidates cannot be overwritten."
    );
  }
  const location = desktopCandidateLocation(manifest);
  const update = desktopCandidateUpdateArtifact(manifest);
  if (!update) {
    throw new Error("Published candidate is missing its update artifact.");
  }
  await verifyArtifact({
    pathname: location.downloadPath,
    sha256: manifest.sha256,
    size: manifest.sizeBytes,
  });
  await verifyArtifact({
    pathname: update.path,
    sha256: update.sha256,
    size: update.sizeBytes,
  });
  return true;
}

export function assertDesktopPromotionVersion(next, current) {
  // The promoted channel ships stable, monotonically increasing app versions.
  if (
    !STABLE_VERSION.test(next) ||
    (current !== null && !STABLE_VERSION.test(current))
  ) {
    throw new Error("Desktop promotion requires a stable app version.");
  }
  if (current !== null) {
    const a = next.split(".").map(Number);
    const b = current.split(".").map(Number);
    const difference = a
      .map((value, index) => value - b[index])
      .find((value) => value !== 0);
    if (!(difference > 0)) {
      throw new Error("Desktop app version must increase before promotion.");
    }
  }
}

export async function promoteDesktopCandidate(id, expectedVersion) {
  const { env: publisherEnv } = desktopPublisherCredentials();
  const { releaseSha } = requireMainlineReleaseSha({
    releaseSha: process.env.OPENMELD_DESKTOP_RELEASE_SHA,
  });
  const repoRoot = process.cwd();
  const manifestPath = path.join(
    repoRoot,
    "clients/desktop/dist/production-preview/candidate.json"
  );
  const manifest = desktopCandidateManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8"))
  );
  const updateArtifact = desktopCandidateUpdateArtifact(manifest);
  if (
    id !== manifest.sha256 ||
    manifest.releaseSha !== releaseSha ||
    !updateArtifact ||
    !expectedVersion
  ) {
    throw new Error(
      "Specify the reviewed candidate hash and expected current version (or none)."
    );
  }
  const location = desktopCandidateLocation(manifest);
  const publishedManifestPath = path.join(
    repoRoot,
    "clients/desktop/dist/production-preview/published-candidate.json"
  );
  runStep({
    command: "pnpm",
    cwd: repoRoot,
    env: publisherEnv,
    label: "Verify immutable candidate metadata",
    args: [
      "exec",
      "wrangler",
      "r2",
      "object",
      "get",
      `${DEFAULT_R2_BUCKET_NAME}/${desktopCandidateManifestKey(id)}`,
      "--remote",
      "--file",
      publishedManifestPath,
    ],
  });
  const published = desktopCandidateManifestSchema.parse(
    JSON.parse(readFileSync(publishedManifestPath, "utf8"))
  );
  if (JSON.stringify(published) !== JSON.stringify(manifest)) {
    throw new Error(
      "Published candidate metadata differs from the reviewed candidate."
    );
  }
  // Upload owns native signature/source inspection. The immutable published
  // manifest and public artifact hashes bind promotion to those exact bytes;
  // inspecting another local copy adds no guarantee.
  // Complete public reads prove the deployed routes and both immutable artifacts
  // before the sole mutable pointer becomes visible to clients.
  for (const [pathname, sha256, size] of [
    [location.downloadPath, manifest.sha256, manifest.sizeBytes],
    [updateArtifact.path, updateArtifact.sha256, updateArtifact.sizeBytes],
  ]) {
    await verifyDesktopPublicArtifact({ pathname, sha256, size });
  }
  process.stdout.write(
    "[release:desktop-preview] Public artifacts verified; checking the authoritative pointer under the release lease.\n"
  );
  try {
    await commitDesktopPromotion({
      repoRoot,
      manifest,
      expectedVersion,
      env: publisherEnv,
    });
  } catch (error) {
    throw new Error(
      `Desktop pointer phase failed: ${error instanceof Error ? error.message : String(error)}. The pointer may have changed; inspect its authoritative R2 object before retrying. Do not infer the published version from this command's exit status.`
    );
  }
  process.stdout.write(`Promoted Desktop ${manifest.version}: ${id}\n`);
}

export async function verifyDesktopPublicArtifact(input) {
  const url = new URL(input.pathname, "https://openmeld.ai");
  (input.write ?? ((line) => process.stdout.write(line)))(
    `[release:desktop-preview] Verify full public download ${url.href}; pointer write has not started.\n`
  );
  try {
    const fetchArtifact = input.fetchArtifact ?? fetch;
    const options = { redirect: "manual", cache: "no-store" };
    let current = url;
    let response = await fetchArtifact(current, options);
    for (
      let redirects = 0;
      [301, 302, 303, 307, 308].includes(response.status);
      redirects += 1
    ) {
      const location = response.headers.get("location");
      const next = location ? new URL(location, current) : null;
      if (
        !next ||
        next.username ||
        next.password ||
        ![
          "https://openmeld.ai",
          "https://app.openmeld.ai",
          "https://downloads.openmeld.ai",
        ].includes(next.origin) ||
        !next.pathname.startsWith("/desktop/") ||
        redirects >= 3
      ) {
        throw new Error(
          "Untrusted Desktop download redirect or redirect limit exceeded"
        );
      }
      await response.body?.cancel();
      current = next;
      response = await fetchArtifact(current, options);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      bytes.length !== input.size ||
      createHash("sha256").update(bytes).digest("hex") !== input.sha256
    ) {
      throw new Error(
        `size/hash mismatch (received ${bytes.length} bytes; expected ${input.size})`
      );
    }
  } catch (error) {
    throw new Error(
      `Desktop public download verification failed for ${url.href}: ${error instanceof Error ? error.message : String(error)}. No pointer write was attempted by this invocation. Inspect the public artifact, then rerun the guarded promotion with the same reviewed candidate.`
    );
  }
}

// Wrangler talks directly to R2: public CDN/browser projections never authorize
// a promotion. Only its explicit missing-object response means an empty channel.
export function readDesktopReleaseObject(repoRoot, key, env = process.env) {
  const invocation = resolveDesktopReleaseCommand("pnpm", [
    "exec",
    "wrangler",
    "r2",
    "object",
    "get",
    `${DEFAULT_R2_BUCKET_NAME}/${key}`,
    "--remote",
    "--pipe",
  ]);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.status === 0) {
    return JSON.parse(result.stdout);
  }
  if (
    result.status === 1 &&
    result.stderr?.includes("The specified key does not exist.")
  ) {
    return null;
  }
  throw new Error(
    `Could not read authoritative Desktop release object: ${key}: ${result.stderr?.trim() || result.error?.message || `exit ${result.status}`}`
  );
}

async function readPromotedDesktopCandidate(platform, readObject) {
  const rawPointer = await readObject(desktopPromotedReleaseKey(platform));
  if (rawPointer === null) {
    return null;
  }
  const pointer = desktopPromotedReleaseSchema.parse(rawPointer);
  const candidate = desktopCandidateManifestSchema.parse(
    await readObject(desktopCandidateManifestKey(pointer.candidate))
  );
  if (
    candidate.sha256 !== pointer.candidate ||
    candidate.platform !== platform ||
    !desktopCandidateUpdateArtifact(candidate)
  ) {
    throw new Error("Invalid promoted Desktop candidate.");
  }
  return candidate;
}

export async function readDesktopReleaseStatus({
  repoRoot = process.cwd(),
  env = process.env,
  readObject = (key) => readDesktopReleaseObject(repoRoot, key, env),
} = {}) {
  const results = [];
  for (const platform of desktopReleasePlatformSchema.options) {
    try {
      const candidate = await readPromotedDesktopCandidate(
        platform,
        readObject
      );
      if (candidate === null) {
        results.push({ platform, state: "unpublished" });
        continue;
      }
      results.push({
        platform,
        state: "promoted",
        version: candidate.version,
        sourceSha: candidate.releaseSha,
        candidate: candidate.sha256,
      });
    } catch (error) {
      results.push({
        platform,
        state: "unknown",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export async function commitDesktopPromotion({
  repoRoot,
  manifest,
  expectedVersion,
  env = process.env,
  readObject = (key) => readDesktopReleaseObject(repoRoot, key, env),
  writePointer = (pointer, key) =>
    writeDesktopPromotionPointer(repoRoot, pointer, key, env),
}) {
  manifest = desktopCandidateManifestSchema.parse(manifest);
  if (!desktopCandidateUpdateArtifact(manifest)) {
    throw new Error(
      "Desktop promotion requires a complete platform update artifact."
    );
  }
  const pointerKey = desktopPromotedReleaseKey(manifest.platform);
  // desktop-release.yml serializes promotion with its concurrency group; the
  // expected-version check still refuses a pointer that moved underneath it.
  const current = await readPromotedDesktopCandidate(
    manifest.platform,
    readObject
  );
  const currentVersion = current?.version ?? null;
  if ((currentVersion ?? "none") !== expectedVersion) {
    throw new Error(
      "Promoted Desktop version changed or could not be verified."
    );
  }
  assertDesktopPromotionVersion(manifest.version, currentVersion);
  await writePointer(
    desktopPromotedReleaseSchema.parse({
      schemaVersion: 1,
      candidate: manifest.sha256,
      promotedAt: new Date().toISOString(),
    }),
    pointerKey
  );
}

function writeDesktopPromotionPointer(repoRoot, value, pointerKey, env) {
  const pointerPath = path.join(
    repoRoot,
    "clients/desktop/dist/production-preview/promoted.json"
  );
  writeFileSync(pointerPath, `${JSON.stringify(value)}\n`);
  runStep({
    command: "pnpm",
    cwd: repoRoot,
    env,
    label: "Promote the reviewed Desktop release",
    args: buildWranglerObjectPutArgs({
      bucketName: DEFAULT_R2_BUCKET_NAME,
      objectKey: pointerKey,
      filePath: pointerPath,
      contentType: "application/json",
      cacheControl: "no-store",
    }),
  });
}
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
  const invocation = resolveDesktopReleaseCommand(input.command, input.args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: input.cwd,
    env: input.env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${input.command} ${input.args.join(" ")} failed ${result.signal ? `on signal ${result.signal}` : `with exit code ${result.status}`}`
    );
  }
}

function printUsage() {
  process.stderr.write(
    [
      "Usage:",
      "  pnpm run release:desktop-preview:build",
      "  OPENMELD_DESKTOP_RELEASE_SHA=<approved-merged-release-sha> pnpm run release:desktop-preview:upload-candidate",
      "  node scripts/release/desktop-preview.mjs status (after building @openmeld/schemas)",
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
      await uploadDesktopCandidate();
    } else if (command === "promote") {
      await promoteDesktopCandidate(process.argv[3], process.argv[4]);
    } else if (command === "status") {
      const { env } = desktopPublisherCredentials();
      const results = await readDesktopReleaseStatus({ env });
      for (const result of results) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      }
      if (results.some((result) => result.state === "unknown")) {
        process.exitCode = 1;
      }
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
