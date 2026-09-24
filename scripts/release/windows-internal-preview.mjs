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
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cliBinaryManifestSchema,
  desktopProductionSourceSchema,
  desktopWindowsInternalPreviewLocation,
  desktopWindowsInternalPreviewSchema,
} from "../../packages/schemas/src/index.ts";
import { inspectWindowsInternalPreview } from "../desktop/windows-artifact.mjs";
import { buildCliBinary } from "./build-cli-binary.mjs";
import { verifyWindowsProcessArtifact } from "./windows-process-artifact.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evidenceDir = join(root, "dev-tmp/windows-internal-preview");
const cliDist = join(root, "cli/dist");
const downloadOrigin = "https://openmeld.ai";
const manifestPath = join(evidenceDir, "manifest.json");
const bundlePath = join(evidenceDir, "bundle.json");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    timeout: options.timeout ?? 300_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr ?? result.status}`
    );
  }
  return result.stdout?.trim() ?? "";
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fileMetadata(path) {
  if (!(existsSync(path) && statSync(path).isFile())) {
    throw new Error(`Missing Windows internal preview artifact: ${path}`);
  }
  return { sha256: sha256(path), sizeBytes: statSync(path).size };
}

function sourceSha() {
  return run("git", ["rev-parse", "HEAD"]);
}

function previewArtifact(role, version, path) {
  const metadata = fileMetadata(path);
  const stem =
    role === "process"
      ? "openmeld-windows-process"
      : `openmeld-${role}-windows-x64-${version}`;
  const artifactName = `${stem}-${metadata.sha256}.exe`;
  return {
    ...metadata,
    artifactName,
    objectKey: `cli/windows-preview/${artifactName}`,
    url: `${downloadOrigin}/cli/download/${artifactName}?channel=windows-preview`,
    path: relative(root, path).split(sep).join("/"),
  };
}

function releaseArtifact(file, helper) {
  return {
    url: file.url,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    windows: {
      mode: "internal-unsigned-preview",
      processHelper: {
        url: helper.url,
        sha256: helper.sha256,
        sizeBytes: helper.sizeBytes,
      },
    },
  };
}

function buildCli() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Build the internal preview on native Windows x64.");
  }
  const version = JSON.parse(
    readFileSync(join(root, "clients/openmeld-cli/package.json"), "utf8")
  ).version;
  mkdirSync(evidenceDir, { recursive: true });
  try {
    verifyWindowsProcessArtifact(cliDist, root);
  } catch {
    run(
      process.execPath,
      ["scripts/release/build-windows-process-helper.mjs"],
      {
        stdio: "inherit",
      }
    );
  }
  const helper = previewArtifact(
    "process",
    version,
    join(cliDist, "openmeld-windows-process.exe")
  );
  const serviceBuild = buildCliBinary({
    platform: "windows-x64",
    background: true,
  });
  const service = previewArtifact("service", version, serviceBuild.outFile);
  const serviceRelease = releaseArtifact(service, helper);
  const serviceSelection = {
    version,
    platforms: { "windows-x64": serviceRelease },
  };
  const cliBuild = buildCliBinary({
    platform: "windows-x64",
    service: serviceSelection,
  });
  const cli = previewArtifact("cli", version, cliBuild.outFile);
  const packageJson = JSON.parse(
    readFileSync(join(root, "clients/openmeld-cli/package.json"), "utf8")
  );
  const manifest = cliBinaryManifestSchema.parse({
    schemaVersion: 1,
    channels: {
      stable: {
        version,
        minRequiredCliVersion: packageJson.openmeld.minRequiredCliVersion,
        platforms: { "windows-x64": releaseArtifact(cli, helper) },
        service: serviceSelection,
      },
    },
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(evidenceDir, "built-cli.json"),
    `${JSON.stringify({ sourceSha: sourceSha(), version, cli, service, helper }, null, 2)}\n`
  );
  process.stdout.write(
    `Windows internal preview carriers built from ${sourceSha()}.\n`
  );
}

async function finalize() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("Finalize the internal preview on native Windows x64.");
  }
  const built = JSON.parse(
    readFileSync(join(evidenceDir, "built-cli.json"), "utf8")
  );
  if (built.sourceSha !== sourceSha()) {
    throw new Error("Windows internal preview source changed between builds.");
  }
  const desktopVersion = JSON.parse(
    readFileSync(join(root, "clients/desktop/package.json"), "utf8")
  ).version;
  const desktopPath = join(
    root,
    "clients/desktop/dist/internal-preview",
    `OpenMeld-Desktop-${desktopVersion}-windows-x64-internal-preview.exe`
  );
  const desktop = fileMetadata(desktopPath);
  const packagedSource = desktopProductionSourceSchema.parse(
    JSON.parse(
      readFileSync(
        join(root, "clients/desktop/dist/internal-preview-source.json"),
        "utf8"
      )
    )
  );
  if (
    packagedSource.releaseSha !== built.sourceSha ||
    packagedSource.target.kind !== "production" ||
    packagedSource.windows
  ) {
    throw new Error(
      "Windows Desktop preview source does not match the carrier build."
    );
  }
  await inspectWindowsInternalPreview({
    repoRoot: root,
    artifactPath: desktopPath,
    version: desktopVersion,
    sourceSha: built.sourceSha,
    expectedWebBuild: packagedSource.webBuild,
  });
  const pointer = desktopWindowsInternalPreviewSchema.parse({
    schemaVersion: 1,
    platform: "windows-x64",
    version: desktopVersion,
    releaseSha: built.sourceSha,
    ...desktop,
  });
  const location = desktopWindowsInternalPreviewLocation(pointer);
  const manifest = cliBinaryManifestSchema.parse(
    JSON.parse(readFileSync(manifestPath, "utf8"))
  );
  const files = {
    cli: built.cli,
    service: built.service,
    helper: built.helper,
    desktop: {
      ...desktop,
      path: relative(root, desktopPath).split(sep).join("/"),
      ...location,
    },
  };
  for (const [name, file] of Object.entries(files)) {
    if (fileMetadata(resolve(root, file.path)).sha256 !== file.sha256) {
      throw new Error(`${name} changed after the Windows preview build.`);
    }
  }
  writeFileSync(
    bundlePath,
    `${JSON.stringify({ sourceSha: built.sourceSha, manifest, pointer, files }, null, 2)}\n`
  );
  writeFileSync(
    join(evidenceDir, "desktop-pointer.json"),
    `${JSON.stringify(pointer, null, 2)}\n`
  );
  process.stdout.write(
    `Windows internal preview bundle ready: ${bundlePath}\n`
  );
}

async function main() {
  const command = process.argv[2];
  if (command === "build-cli") {
    buildCli();
  } else if (command === "finalize") {
    await finalize();
  } else {
    throw new Error("Use build-cli or finalize.");
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
