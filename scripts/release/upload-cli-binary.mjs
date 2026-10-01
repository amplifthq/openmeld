#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  cliBinaryCompressedReleaseSchema,
  cliBinaryManifestSchema,
  OPENMELD_MACOS_CLI_SIGNING_IDENTITY,
} from "../../packages/schemas/src/schemas/http/cli-binary-manifest.ts";
import { localComponentsReleaseManifestSchema } from "../../packages/schemas/src/schemas/local-components.ts";
import { smokeSignedMacOsSecureStorage } from "../e2e/signed-cli-macos-secure-storage-smoke.mjs";
import {
  buildCliBinary,
  collectCliBinaryMetadata,
  DEFAULT_CLI_BINARY_PLATFORM,
} from "./build-cli-binary.mjs";
import { resolveCliBinaryDeltaForRelease } from "./cli-binary-delta.mjs";
import { signAndNotarizeCliBinary } from "./macos-cli-signing.mjs";
import { compareSemverCore } from "./release-semver.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

// Reuse the Desktop preview bucket with a cli/ prefix (per W-CLI-BIN1). The
// binary and manifest are served through a production Web route, not a public
// R2 URL (see AGENTS.md); the download base URL below is that route.
export const DEFAULT_CLI_R2_BUCKET = "openmeld-desktop-downloads-prod";
export const CLI_R2_OBJECT_PREFIX = "cli";
export const CLI_MANIFEST_OBJECT_KEY = "cli/manifest.json";
export const DEFAULT_CLI_DOWNLOAD_BASE_URL = "https://openmeld.ai/cli/download";
export const CLI_MANIFEST_SCHEMA_VERSION = 1;
export const CLI_BINARY_CODE_IDENTIFIER =
  OPENMELD_MACOS_CLI_SIGNING_IDENTITY.codeIdentifier;
const LOCAL_COMPONENTS_MANIFEST_PATH = "release/local-components.json";
const PRODUCTION_CLI_MANIFEST_URL = `${new URL(DEFAULT_CLI_DOWNLOAD_BASE_URL).origin}/${CLI_MANIFEST_OBJECT_KEY}`;

export function resolveCliMinRequiredVersion(repoRoot = REPO_ROOT) {
  const packageJson = JSON.parse(
    readFileSync(
      path.join(repoRoot, "clients", "openmeld-cli", "package.json"),
      "utf8"
    )
  );
  const floor = packageJson.openmeld?.minRequiredCliVersion;
  if (typeof floor !== "string" || floor.trim().length === 0) {
    throw new Error(
      "clients/openmeld-cli/package.json must define openmeld.minRequiredCliVersion"
    );
  }
  return floor.trim();
}

// Manifest shape mirrors the binary version-discovery contract: the binary CLI
// reads channels.stable.{version,minRequiredCliVersion} for the same version
// gate npm reads from the registry, plus per-platform download metadata.
export function buildCliManifest(input) {
  return cliBinaryManifestSchema.parse({
    schemaVersion: CLI_MANIFEST_SCHEMA_VERSION,
    channels: {
      stable: {
        version: input.version,
        ...(input.componentPolicy ? { componentPolicy: input.componentPolicy } : {}),
        minRequiredCliVersion: input.minRequiredCliVersion,
        ...(input.service ? { service: input.service } : {}),
        platforms: {
          [input.platform]: {
            url: `${input.downloadBaseUrl}/${input.artifactName}`,
            sha256: input.sha256,
            sizeBytes: input.sizeBytes,
            archiveFormat: "gzip",
            archiveUrl: `${input.downloadBaseUrl}/${input.archiveArtifactName}`,
            archiveSha256: input.archiveSha256,
            archiveSizeBytes: input.archiveSizeBytes,
            ...(input.codeIdentifier
              ? { codeIdentifier: input.codeIdentifier }
              : {}),
            ...(input.deltas?.length ? { deltas: input.deltas } : {}),
            ...(input.teamIdentifier
              ? { teamIdentifier: input.teamIdentifier }
              : {}),
          },
        },
      },
    },
  });
}

export function createCompressedCliBinary(input) {
  const archive = {
    artifactName: `${input.artifactName}.gz`,
    outFile: `${input.outFile}.gz`,
  };
  writeFileSync(
    archive.outFile,
    gzipSync(readFileSync(input.outFile), { level: 9 })
  );
  return {
    ...archive,
    ...collectCliBinaryMetadata(archive.outFile),
  };
}

export function buildWranglerObjectPutArgs(input) {
  return [
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
}

export function prepareSignedCliBinary(input) {
  const notarization = input.signAndNotarize({
    env: input.env,
    outFile: input.built.outFile,
    platform: input.built.platform,
  });
  return {
    ...input.built,
    ...input.collectMetadata(input.built.outFile),
    notarization,
  };
}

export async function prepareVerifiedCliBinary(input) {
  const prepared = prepareSignedCliBinary(input);
  await input.smokeSignedSecureStorage({
    outFile: prepared.outFile,
    platform: prepared.platform,
  });
  return prepared;
}

export async function uploadCliBinary(input = {}) {
  const platform = input.platform ?? DEFAULT_CLI_BINARY_PLATFORM;
  const bucketName =
    input.bucketName ??
    process.env.OPENMELD_CLI_R2_BUCKET ??
    DEFAULT_CLI_R2_BUCKET;
  const downloadBaseUrl =
    input.downloadBaseUrl ?? DEFAULT_CLI_DOWNLOAD_BASE_URL;
  const service = Object.hasOwn(input, "service")
    ? input.service
    : await resolveCliServiceSelectionForUpload({
        fetch: input.fetch ?? fetch,
        repoRoot: input.repoRoot ?? REPO_ROOT,
      });

  const compiled = (input.buildBinary ?? buildCliBinary)({
    outDir: input.outDir,
    platform,
    version: input.version,
    service,
  });
  const built = await prepareVerifiedCliBinary({
    built: compiled,
    collectMetadata: input.collectMetadata ?? collectCliBinaryMetadata,
    env: input.env ?? process.env,
    signAndNotarize: input.signAndNotarize ?? signAndNotarizeCliBinary,
    smokeSignedSecureStorage:
      input.smokeSignedSecureStorage ?? smokeSignedMacOsSecureStorage,
  });
  if (
    built.notarization.teamId !==
    OPENMELD_MACOS_CLI_SIGNING_IDENTITY.teamIdentifier
  ) {
    throw new Error(
      "Signed CLI publisher does not match the trusted OpenMeld Apple team."
    );
  }
  const archive = (input.compressBinary ?? createCompressedCliBinary)({
    artifactName: built.artifactName,
    outFile: built.outFile,
  });
  const delta = await resolveCliBinaryDeltaForRelease({
    archiveSizeBytes: archive.sizeBytes,
    built,
    downloadBaseUrl,
    fetchImpl: input.fetch ?? fetch,
    manifestObjectKey: CLI_MANIFEST_OBJECT_KEY,
  });
  const minRequiredCliVersion = resolveCliMinRequiredVersion();
  const releasePolicy = localComponentsReleaseManifestSchema.parse(JSON.parse(
    readFileSync(path.join(input.repoRoot ?? REPO_ROOT, LOCAL_COMPONENTS_MANIFEST_PATH), "utf8")
  ));
  const manifest = buildCliManifest({
    componentPolicy: { cli: releasePolicy.components.cli, service: releasePolicy.components.service },
    archiveArtifactName: archive.artifactName,
    archiveSha256: archive.sha256,
    archiveSizeBytes: archive.sizeBytes,
    artifactName: built.artifactName,
    codeIdentifier: CLI_BINARY_CODE_IDENTIFIER,
    deltas: delta ? [delta.manifest] : [],
    downloadBaseUrl,
    minRequiredCliVersion,
    platform: built.platform,
    sha256: built.sha256,
    sizeBytes: built.sizeBytes,
    teamIdentifier: built.notarization.teamId,
    version: built.version,
    service,
  });
  const manifestPath = path.join(path.dirname(built.outFile), "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  runStep({
    args: buildWranglerObjectPutArgs({
      bucketName,
      cacheControl: "public, max-age=31536000, immutable",
      contentType: "application/octet-stream",
      filePath: built.outFile,
      objectKey: `${CLI_R2_OBJECT_PREFIX}/${built.artifactName}`,
    }),
    command: "pnpm",
    cwd: REPO_ROOT,
    label: `Upload ${CLI_R2_OBJECT_PREFIX}/${built.artifactName} to R2 bucket ${bucketName}`,
  });

  if (delta) {
    runStep({
      args: buildWranglerObjectPutArgs({
        bucketName,
        cacheControl: "public, max-age=31536000, immutable",
        contentType: "application/gzip",
        filePath: delta.outFile,
        objectKey: `${CLI_R2_OBJECT_PREFIX}/${delta.artifactName}`,
      }),
      command: "pnpm",
      cwd: REPO_ROOT,
      label: `Upload ${CLI_R2_OBJECT_PREFIX}/${delta.artifactName} to R2 bucket ${bucketName}`,
    });
  }

  runStep({
    args: buildWranglerObjectPutArgs({
      bucketName,
      cacheControl: "public, max-age=31536000, immutable",
      contentType: "application/gzip",
      filePath: archive.outFile,
      objectKey: `${CLI_R2_OBJECT_PREFIX}/${archive.artifactName}`,
    }),
    command: "pnpm",
    cwd: REPO_ROOT,
    label: `Upload ${CLI_R2_OBJECT_PREFIX}/${archive.artifactName} to R2 bucket ${bucketName}`,
  });

  runStep({
    args: buildWranglerObjectPutArgs({
      bucketName,
      cacheControl: "public, max-age=60, must-revalidate",
      contentType: "application/json; charset=utf-8",
      filePath: manifestPath,
      objectKey: CLI_MANIFEST_OBJECT_KEY,
    }),
    command: "pnpm",
    cwd: REPO_ROOT,
    label: `Upload ${CLI_MANIFEST_OBJECT_KEY} to R2 bucket ${bucketName}`,
  });

  process.stdout.write(
    [
      "",
      "[release:cli-binary] Upload complete",
      `- bucket: ${bucketName}`,
      `- artifact: ${CLI_R2_OBJECT_PREFIX}/${built.artifactName}`,
      `- archive: ${CLI_R2_OBJECT_PREFIX}/${archive.artifactName}`,
      `- delta: ${delta ? `${CLI_R2_OBJECT_PREFIX}/${delta.artifactName} (${delta.manifest.patchSizeBytes} bytes)` : "not published"}`,
      `- manifest: ${CLI_MANIFEST_OBJECT_KEY}`,
      `- version: ${built.version}`,
      `- notarization: ${built.notarization.submissionId}`,
      `- sha256: ${built.sha256}`,
      `- sizeBytes: ${built.sizeBytes}`,
      `- archiveSha256: ${archive.sha256}`,
      `- archiveSizeBytes: ${archive.sizeBytes}`,
      "",
    ].join("\n")
  );

  return { ...built, archive, bucketName, delta, manifest, manifestPath };
}

export function resolveRetainedCliServiceSelection(input) {
  if (input.targetCliVersion === input.targetServiceVersion) {
    return undefined;
  }
  if (
    compareSemverCore(input.targetServiceVersion, input.targetCliVersion) > 0
  ) {
    throw new Error(
      `OpenMeld Service ${input.targetServiceVersion} cannot be selected for older CLI ${input.targetCliVersion}.`
    );
  }
  const stable = input.channelManifest?.channels?.stable;
  if (!stable) {
    throw new Error(
      "The production CLI manifest is missing channels.stable, so its Service artifact cannot be retained."
    );
  }
  const selected = stable.service ?? {
    platforms: stable.platforms,
    version: stable.version,
  };
  if (selected.version !== input.targetServiceVersion) {
    throw new Error(
      `The production CLI channel selects Service ${selected.version}, not retained target ${input.targetServiceVersion}. Publish a coupled Service release instead of guessing an artifact.`
    );
  }
  return selected;
}

async function resolveCliServiceSelectionForUpload(input) {
  const localComponents = JSON.parse(
    readFileSync(
      path.join(input.repoRoot, LOCAL_COMPONENTS_MANIFEST_PATH),
      "utf8"
    )
  );
  const targetCliVersion =
    localComponents?.components?.cli?.packageVersion ?? null;
  const targetServiceVersion =
    localComponents?.components?.service?.bundleVersion ?? null;
  if (!(targetCliVersion && targetServiceVersion)) {
    throw new Error(
      "release/local-components.json must declare CLI and Service versions before publishing the CLI binary."
    );
  }
  if (targetCliVersion === targetServiceVersion) {
    return undefined;
  }
  const response = await input.fetch(PRODUCTION_CLI_MANIFEST_URL);
  if (!response.ok) {
    throw new Error(
      `Cannot read the production CLI manifest needed to retain Service ${targetServiceVersion} (HTTP ${response.status}).`
    );
  }
  const channelManifest = cliBinaryManifestSchema.parse(await response.json());
  const service = resolveRetainedCliServiceSelection({
    channelManifest,
    targetCliVersion,
    targetServiceVersion,
  });
  await verifyRetainedCliServiceArtifacts({
    fetch: input.fetch,
    service,
  });
  return service;
}

export async function verifyRetainedCliServiceArtifacts(input) {
  for (const [platform, artifact] of Object.entries(input.service.platforms)) {
    const parsedArtifact = cliBinaryCompressedReleaseSchema.safeParse(artifact);
    if (!parsedArtifact.success) {
      throw new Error(
        `Retained Service ${input.service.version} ${platform} has incomplete raw or gzip artifact metadata.`
      );
    }
    const rawHead = await input.fetch(artifact.url, { method: "HEAD" });
    if (!rawHead.ok) {
      throw new Error(
        `Retained Service ${input.service.version} ${platform} raw artifact is unavailable at ${artifact.url} (HTTP ${rawHead.status}).`
      );
    }
    const rawLength = Number(rawHead.headers.get("content-length"));
    if (rawLength !== artifact.sizeBytes) {
      throw new Error(
        `Retained Service ${input.service.version} ${platform} raw artifact size does not match its immutable manifest (${String(rawLength)} != ${String(artifact.sizeBytes)}).`
      );
    }
    const archiveResponse = await input.fetch(artifact.archiveUrl);
    if (!archiveResponse.ok) {
      throw new Error(
        `Retained Service ${input.service.version} ${platform} gzip artifact is unavailable at ${artifact.archiveUrl} (HTTP ${archiveResponse.status}).`
      );
    }
    const archiveBytes = Buffer.from(await archiveResponse.arrayBuffer());
    const archiveHash = createHash("sha256").update(archiveBytes).digest("hex");
    if (
      archiveBytes.byteLength !== artifact.archiveSizeBytes ||
      archiveHash !== artifact.archiveSha256
    ) {
      throw new Error(
        `Retained Service ${input.service.version} ${platform} gzip artifact does not match its immutable manifest.`
      );
    }
    const rawBytes = gunzipSync(archiveBytes);
    const rawHash = createHash("sha256").update(rawBytes).digest("hex");
    if (
      rawBytes.byteLength !== artifact.sizeBytes ||
      rawHash !== artifact.sha256
    ) {
      throw new Error(
        `Retained Service ${input.service.version} ${platform} gzip artifact does not reconstruct the declared raw artifact.`
      );
    }
  }
}

function runStep(input) {
  process.stdout.write(`\n[release:cli-binary] ${input.label}\n`);
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await uploadCliBinary();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
