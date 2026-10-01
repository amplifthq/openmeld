#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cliBinaryManifestSchema,
  DESKTOP_WINDOWS_INTERNAL_PREVIEW_KEY,
  desktopWindowsInternalPreviewLocation,
  desktopWindowsInternalPreviewSchema,
  localComponentsReleaseManifestSchema,
} from "../../packages/schemas/dist/index.js";
import {
  checkDesktopPublisher,
  DEFAULT_R2_BUCKET_NAME,
} from "./desktop-publisher.mjs";
import {
  acquireProductionScopeLease,
  releaseProductionScopeLease,
} from "./production-scope-lease.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const ARTIFACT_PATHS = {
  cli: /^cli\/dist\/openmeld-cli-windows-x64-[^/]+\.exe$/u,
  service: /^cli\/dist\/openmeld-service-windows-x64-[^/]+\.exe$/u,
  helper: /^cli\/dist\/openmeld-windows-process\.exe$/u,
  desktop:
    /^clients\/desktop\/dist\/internal-preview\/OpenMeld-Desktop-[^/]+-windows-x64-internal-preview\.exe$/u,
};

function git(...args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Git release identity check failed: ${args.join(" ")}`);
  }
  return result.stdout.trim();
}

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function validateArtifactFiles(
  directory,
  bundle,
  roles = Object.keys(ARTIFACT_PATHS)
) {
  const files = {};
  for (const role of roles) {
    const pattern = ARTIFACT_PATHS[role];
    const file = bundle.files?.[role];
    if (
      !file ||
      typeof file.path !== "string" ||
      !pattern.test(file.path) ||
      typeof file.sha256 !== "string" ||
      !SHA256.test(file.sha256)
    ) {
      throw new Error(`Windows preview ${role} path or hash is invalid.`);
    }
    const path = join(directory, file.path);
    if (
      statSync(path).size !== file.sizeBytes ||
      fileSha256(path) !== file.sha256
    ) {
      throw new Error(
        `Windows preview ${role} bytes changed after native build.`
      );
    }
    files[role] = { ...file, path };
  }
  return files;
}

function matchesDesktopPointer(pointer, file) {
  return (
    pointer.sha256 === file.sha256 &&
    pointer.sizeBytes === file.sizeBytes &&
    file.objectKey === desktopWindowsInternalPreviewLocation(pointer).objectKey
  );
}

function validateSourceIdentity(bundle, requireMain) {
  const sourceSha = git("rev-parse", "HEAD");
  if (
    !SHA.test(sourceSha) ||
    bundle.sourceSha !== sourceSha ||
    git("status", "--porcelain", "--untracked-files=normal")
  ) {
    throw new Error(
      "Windows preview artifact must match a clean exact release checkout."
    );
  }
  if (requireMain) {
    git("merge-base", "--is-ancestor", sourceSha, "origin/main");
  }
  return sourceSha;
}

function validateBundle(directory, requireMain, cliOnly = false) {
  const bundle = JSON.parse(
    readFileSync(
      join(
        directory,
        `dev-tmp/windows-internal-preview/${cliOnly ? "bundle-cli.json" : "bundle.json"}`
      ),
      "utf8"
    )
  );
  const sourceSha = validateSourceIdentity(bundle, requireMain);
  const manifest = cliBinaryManifestSchema.parse(bundle.manifest);
  if (!manifest.channels.stable.componentPolicy) {
    throw new Error("Windows preview requires source-matched CLI and Service component policies.");
  }
  const sourcePolicy = localComponentsReleaseManifestSchema.parse(JSON.parse(
    readFileSync(join(root, "release/local-components.json"), "utf8")
  ));
  const componentPolicy = manifest.channels.stable.componentPolicy;
  if (JSON.stringify(componentPolicy.cli) !== JSON.stringify(sourcePolicy.components.cli) ||
      JSON.stringify(componentPolicy.service) !== JSON.stringify(sourcePolicy.components.service)) {
    throw new Error("Windows preview policies do not match the exact source release manifest.");
  }
  const pointer = cliOnly
    ? undefined
    : desktopWindowsInternalPreviewSchema.parse(bundle.pointer);
  if (pointer && pointer.releaseSha !== sourceSha) {
    throw new Error(
      "Windows preview Desktop source does not match the release checkout."
    );
  }
  const cli = manifest.channels.stable.platforms["windows-x64"];
  const service = manifest.channels.stable.service?.platforms["windows-x64"];
  if (
    !(cli && service) ||
    cli.windows?.mode !== "internal-unsigned-preview" ||
    service.windows?.mode !== "internal-unsigned-preview" ||
    Object.keys(manifest.channels.stable.platforms).length !== 1
  ) {
    throw new Error(
      "Windows preview manifest must select only the unsigned Windows pair."
    );
  }
  const files = validateArtifactFiles(
    directory,
    bundle,
    cliOnly ? ["cli", "service", "helper"] : undefined
  );
  for (const role of ["cli", "service", "helper"]) {
    const file = files[role];
    const stem =
      role === "helper"
        ? "openmeld-windows-process"
        : `openmeld-${role}-windows-x64-${manifest.channels.stable.version}`;
    const name = `${stem}-${file.sha256}.exe`;
    if (
      file.artifactName !== name ||
      file.objectKey !== `cli/windows-preview/${name}` ||
      file.url !==
        `https://openmeld.ai/cli/download/${name}?channel=windows-preview`
    ) {
      throw new Error(`Windows preview ${role} download identity is invalid.`);
    }
  }
  const helper = cli.windows.processHelper;
  const matches = (release, file) =>
    release.url === file.url &&
    release.sha256 === file.sha256 &&
    release.sizeBytes === file.sizeBytes &&
    release.windows.processHelper.url === files.helper.url &&
    release.windows.processHelper.sha256 === files.helper.sha256 &&
    release.windows.processHelper.sizeBytes === files.helper.sizeBytes;
  if (
    !(matches(cli, files.cli) && matches(service, files.service)) ||
    helper.sha256 !== files.helper.sha256 ||
    (pointer && !matchesDesktopPointer(pointer, files.desktop))
  ) {
    throw new Error(
      "Windows preview manifest does not describe the exact downloaded bytes."
    );
  }
  return { manifest, pointer, files, sourceSha };
}

function putObject({ key, path, contentType, cacheControl, env }) {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "r2",
      "object",
      "put",
      `${DEFAULT_R2_BUCKET_NAME}/${key}`,
      "--file",
      path,
      "--content-type",
      contentType,
      "--cache-control",
      cacheControl,
      "--force",
      "--remote",
    ],
    { cwd: root, env, encoding: "utf8", timeout: 300_000 }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Windows preview upload stopped at ${key}: ${result.error?.message ?? result.stderr ?? result.status}`
    );
  }
}

async function main() {
  const mode = process.argv[2];
  const directory = process.argv[3];
  if (!["check", "publish", "check-cli", "publish-cli"].includes(mode)) {
    throw new Error(
      "Use check, publish, check-cli, or publish-cli with the exact-source artifact directory."
    );
  }
  if (!directory) {
    throw new Error(
      "Pass the downloaded exact-source Windows preview artifact directory."
    );
  }
  const cliOnly = mode.endsWith("-cli");
  const selected = validateBundle(
    resolve(directory),
    mode.startsWith("publish"),
    cliOnly
  );
  if (mode.startsWith("check")) {
    process.stdout.write(
      `Windows preview artifact matches ${selected.sourceSha}. No object was published.\n`
    );
    return;
  }
  const env = await checkDesktopPublisher();
  const lease = acquireProductionScopeLease({
    cwd: root,
    scope: "cli",
    sourceSha: selected.sourceSha,
  });
  try {
    for (const role of cliOnly
      ? ["helper", "service", "cli"]
      : ["helper", "service", "cli", "desktop"]) {
      const file = selected.files[role];
      putObject({
        key: file.objectKey,
        path: file.path,
        contentType: "application/octet-stream",
        cacheControl: "public, max-age=31536000, immutable",
        env,
      });
    }
    const manifestPath = join(
      root,
      "dev-tmp/windows-preview-upload-manifest.json"
    );
    writeFileSync(
      manifestPath,
      `${JSON.stringify(selected.manifest, null, 2)}\n`
    );
    putObject({
      key: "cli/windows-preview/manifest.json",
      path: manifestPath,
      contentType: "application/json; charset=utf-8",
      cacheControl: "public, max-age=60, must-revalidate",
      env,
    });
    if (selected.pointer) {
      const pointerPath = join(
        root,
        "dev-tmp/windows-preview-upload-pointer.json"
      );
      writeFileSync(
        pointerPath,
        `${JSON.stringify(selected.pointer, null, 2)}\n`
      );
      putObject({
        key: DESKTOP_WINDOWS_INTERNAL_PREVIEW_KEY,
        path: pointerPath,
        contentType: "application/json; charset=utf-8",
        cacheControl: "no-store",
        env,
      });
    }
  } finally {
    releaseProductionScopeLease({
      cwd: root,
      scope: "cli",
      leaseSha: lease.leaseSha,
    });
  }
  process.stdout.write(
    `Windows ${cliOnly ? "CLI" : "CLI and Desktop"} internal preview published from ${selected.sourceSha}. Publication closeout is pending: verify public URLs, then run guarded Core --redeploy and retain newly admitted Worker/catalogue evidence before sharing completion.\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
