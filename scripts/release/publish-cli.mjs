#!/usr/bin/env node

// Publishes the OpenMeld CLI from a clean checkout of one main commit:
// signed binary channel -> npm package -> release tag -> release manifest.
// Each stage checks the platform first, so a rerun at the same SHA resumes.
// Core reads the manifest (cli/local-components.json) at runtime; publishing
// it is what makes the release visible to users.
//
//   node scripts/release/publish-cli.mjs --release-sha <sha> [--dry-run]
//   node scripts/release/publish-cli.mjs seed-manifest --from <manifest.json>

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { cliBinaryManifestSchema } from "../../packages/schemas/src/schemas/http/cli-binary-manifest.ts";
import { localComponentsReleaseManifestSchema } from "../../packages/schemas/src/schemas/local-components.ts";
import { buildPackagedOpenMeldCli } from "./build-packaged-openmeld-cli.mjs";
import { assertReleaseCheckout } from "./deploy-component.mjs";
import {
  buildReleaseManifest,
  collectLocalComponentFacts,
  computeServiceBundleHash,
  readLocalComponentsPolicy,
  resolveChangedLocalComponents,
  resolveReleaseDecisionErrors,
} from "./local-components.mjs";
import {
  inspectNpmCliArtifact,
  packNpmCliArtifact,
  verifyNpmCliConsumer,
} from "./npm-cli-artifact.mjs";
import { readNpmVersion } from "./npm-registry.mjs";
import {
  buildWranglerObjectPutArgs,
  CLI_MANIFEST_OBJECT_KEY,
  DEFAULT_CLI_R2_BUCKET,
  uploadCliBinary,
} from "./upload-cli-binary.mjs";

export const LOCAL_COMPONENTS_RELEASE_OBJECT_KEY = "cli/local-components.json";
// Every published manifest is also kept under its CLI version, so the current
// key can be restored from the bucket itself if it is ever lost or corrupted.
export const releaseHistoryObjectKey = (version) =>
  `cli/releases/${version}/local-components.json`;
const FULL_SHA = /^[0-9a-f]{40}$/u;
const NPM_VISIBILITY_TIMEOUT_MS = 120_000;
const R2_OBJECT_MISSING = /The specified key does not exist\./u;

export function createPlatform({ cwd, env, bucket, spawn = spawnSync }) {
  const run = (command, args, options = {}) => {
    const result = spawn(command, args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        `${command} ${args.join(" ")} failed (${String(result.status)}): ${result.stderr ?? ""}`.trim()
      );
    }
    return result.stdout ?? "";
  };
  const readObject = (key) => {
    const directory = mkdtempSync(path.join(tmpdir(), "openmeld-cli-release-"));
    const file = path.join(directory, "object.json");
    try {
      const result = spawn(
        "pnpm",
        [
          "exec",
          "wrangler",
          "r2",
          "object",
          "get",
          `${bucket}/${key}`,
          "--remote",
          "--file",
          file,
        ],
        { cwd, env, encoding: "utf8" }
      );
      if (result.status !== 0) {
        if (R2_OBJECT_MISSING.test(`${result.stderr}${result.stdout}`)) {
          return null;
        }
        throw new Error(`Reading ${bucket}/${key} failed: ${result.stderr}`);
      }
      return JSON.parse(readFileSync(file, "utf8"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
  const writeObject = (key, value) => {
    const directory = mkdtempSync(path.join(tmpdir(), "openmeld-cli-release-"));
    const file = path.join(directory, "object.json");
    try {
      writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
      run(
        "pnpm",
        buildWranglerObjectPutArgs({
          bucketName: bucket,
          cacheControl: "no-store",
          contentType: "application/json; charset=utf-8",
          filePath: file,
          objectKey: key,
        })
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
  return {
    readPublishedRelease: () => {
      const value = readObject(LOCAL_COMPONENTS_RELEASE_OBJECT_KEY);
      return value ? localComponentsReleaseManifestSchema.parse(value) : null;
    },
    readChannel: () => {
      const value = readObject(CLI_MANIFEST_OBJECT_KEY);
      return value
        ? cliBinaryManifestSchema.parse(value).channels.stable
        : null;
    },
    readPublishedNpmServiceHashes: async ({ version, releaseSha }) => {
      const directory = mkdtempSync(
        path.join(tmpdir(), "openmeld-published-npm-")
      );
      try {
        const filename = run(
          "npm",
          [
            "pack",
            `openmeld@${version}`,
            "--pack-destination",
            directory,
            "--silent",
          ],
          { capture: true }
        ).trim();
        if (filename !== `openmeld-${version}.tgz`) {
          throw new Error(
            "npm returned an unexpected published artifact name."
          );
        }
        const artifact = path.join(directory, filename);
        await inspectNpmCliArtifact(artifact, { version, gitHead: releaseSha });
        run("tar", ["-xzf", artifact, "-C", directory, "package/dist"]);
        const rootDir = path.join(directory, "package/dist");
        return {
          bundleHash: await computeServiceBundleHash({ rootDir }),
          portableBundleHash: await computeServiceBundleHash({
            rootDir,
            excludeWindows: true,
          }),
        };
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    writeRelease: (manifest) => {
      writeObject(
        releaseHistoryObjectKey(manifest.components.cli.packageVersion),
        manifest
      );
      writeObject(LOCAL_COMPONENTS_RELEASE_OBJECT_KEY, manifest);
    },
    readNpmVersion,
    buildPackagedCli: () => buildPackagedOpenMeldCli({ repoRoot: cwd, env }),
    uploadBinary: (releaseManifest) =>
      uploadCliBinary({ env, releaseManifest }),
    publishNpm: async () => {
      const artifact = await packNpmCliArtifact({ cwd, env });
      try {
        await verifyNpmCliConsumer(artifact.path, artifact.manifest, env);
        run("npm", [
          "publish",
          artifact.path,
          "--registry=https://registry.npmjs.org/",
        ]);
      } finally {
        artifact.cleanup();
      }
    },
    ensureTag: ({ tag, sha }) => {
      const repository = run(
        "gh",
        ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
        { capture: true }
      ).trim();
      const existing = spawn(
        "gh",
        [
          "api",
          `repos/${repository}/git/ref/tags/${tag}`,
          "--jq",
          ".object.sha",
        ],
        { cwd, env, encoding: "utf8" }
      );
      if (existing.status === 0) {
        if (existing.stdout.trim() !== sha) {
          throw new Error(
            `Tag ${tag} already points at ${existing.stdout.trim()}, not ${sha}.`
          );
        }
        return;
      }
      run(
        "gh",
        [
          "api",
          `repos/${repository}/git/refs`,
          "-f",
          `ref=refs/tags/${tag}`,
          "-f",
          `sha=${sha}`,
        ],
        { capture: true }
      );
    },
    sleep,
  };
}

// Core refuses to serve Wake work without this manifest, so a Core deploy
// checks it first (scripts/release/deploy-core-worker.mjs).
export function readPublishedCliRelease({
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  return createPlatform({
    cwd,
    env,
    bucket: env.OPENMELD_CLI_R2_BUCKET ?? DEFAULT_CLI_R2_BUCKET,
  }).readPublishedRelease();
}

function log(message) {
  process.stdout.write(`[publish-cli] ${message}\n`);
}

async function waitForNpmGitHead({ platform, version, releaseSha, npm }) {
  const deadline = Date.now() + NPM_VISIBILITY_TIMEOUT_MS;
  let visible = npm;
  while (visible?.gitHead !== releaseSha) {
    if (visible?.gitHead) {
      throw new Error(
        `openmeld@${version} is already published from ${visible.gitHead}. Bump clients/openmeld-cli/package.json and release/local-components-policy.json.`
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `openmeld@${version} gitHead is still missing on the npm registry after ${NPM_VISIBILITY_TIMEOUT_MS / 1000}s. Verify \`npm view openmeld@${version} gitHead\` and rerun this command.`
      );
    }
    await platform.sleep(10_000);
    visible = platform.readNpmVersion(version);
  }
}

// Contract changes are judged against the release users run now.
function publishedBase(published) {
  return {
    cliRequiredFloor: null,
    commandContractVersion: published.components.cli.commandContractVersion,
    runtimeContractEpoch: published.components.service.runtimeContractEpoch,
    serviceContractVersion: published.components.service.serviceContractVersion,
    serviceRequiredFloor: null,
    skillContractVersion: published.components.skills.skillContractVersion,
  };
}

export function planCliPublication({ facts, policy, published, now }) {
  if (!published) {
    throw new Error(
      `No release manifest at ${DEFAULT_CLI_R2_BUCKET}/${LOCAL_COMPONENTS_RELEASE_OBJECT_KEY}. Seed it once with \`node scripts/release/publish-cli.mjs seed-manifest --from <manifest.json>\`.`
    );
  }
  if (!facts.hasWindowsProcessHelper) {
    throw new Error(
      "The packaged CLI is missing the Windows process helper. Publish through the GitHub lane, which builds it on Windows in the same run."
    );
  }
  const changed = resolveChangedLocalComponents({ facts, published });
  const errors = resolveReleaseDecisionErrors({
    base: publishedBase(published),
    changed,
    facts,
    policy,
  });
  if (errors.length > 0) {
    throw new Error(
      [
        `CLI ${facts.cli.packageVersion} cannot be published:`,
        ...errors.map((error) => `- ${error}`),
      ].join("\n")
    );
  }
  const manifest = localComponentsReleaseManifestSchema.parse(
    buildReleaseManifest({ changed, facts, policy, published, now })
  );
  return { changed, manifest };
}

function assertMatchingChannelPolicy(channelPolicy, manifest, version) {
  if (
    !(
      channelPolicy &&
      isDeepStrictEqual(channelPolicy.cli, manifest.components.cli) &&
      isDeepStrictEqual(channelPolicy.service, manifest.components.service)
    )
  ) {
    throw new Error(
      `CLI ${version} release manifest disagrees with the binary channel Service policy.`
    );
  }
}

async function readVerifiedNpmHashes({
  platform,
  channelPolicy,
  version,
  releaseSha,
}) {
  if (!channelPolicy) {
    throw new Error(
      `CLI ${version} binary channel has no component policy; cannot safely resume.`
    );
  }
  const hashes = await platform.readPublishedNpmServiceHashes({
    version,
    releaseSha,
  });
  if (
    !(hashes.bundleHash && hashes.portableBundleHash) ||
    hashes.bundleHash !== channelPolicy.service.bundleHash ||
    hashes.portableBundleHash !== channelPolicy.service.portableBundleHash
  ) {
    throw new Error(
      `CLI ${version} published npm Service bytes disagree with the binary channel.`
    );
  }
  return hashes;
}

function assertResumablePublication({ channelVersion, npm, version }) {
  if (channelVersion === version && !npm) {
    throw new Error(
      `CLI ${version} binary is published but npm is not yet visible; wait for npm before resuming.`
    );
  }
  if (npm && channelVersion !== version) {
    throw new Error(
      `CLI ${version} npm package is published without its matching binary channel; cannot safely resume.`
    );
  }
}

export async function publishCli({
  releaseSha,
  cwd = process.cwd(),
  env = process.env,
  dryRun = false,
  collectFacts = collectLocalComponentFacts,
  readPolicy = readLocalComponentsPolicy,
  platform = createPlatform({
    cwd,
    env,
    bucket: env.OPENMELD_CLI_R2_BUCKET ?? DEFAULT_CLI_R2_BUCKET,
  }),
}) {
  if (!FULL_SHA.test(releaseSha ?? "")) {
    throw new Error("--release-sha must be an exact 40-character commit SHA.");
  }
  if (!dryRun) {
    assertReleaseCheckout({ cwd, sha: releaseSha });
  }
  const { version } = JSON.parse(
    readFileSync(path.join(cwd, "clients/openmeld-cli/package.json"), "utf8")
  );
  const npm = platform.readNpmVersion(version);
  if (npm) {
    await waitForNpmGitHead({ platform, version, releaseSha, npm });
  }
  const published = platform.readPublishedRelease();
  const channel = platform.readChannel();
  const channelVersion = channel?.version ?? null;
  const channelPolicy =
    channelVersion === version ? (channel.componentPolicy ?? null) : null;
  if (npm && published?.components.cli.packageVersion === version) {
    assertMatchingChannelPolicy(channelPolicy, published, version);
    await readVerifiedNpmHashes({
      platform,
      channelPolicy,
      version,
      releaseSha,
    });
    if (!dryRun) {
      platform.ensureTag({ tag: `v${version}`, sha: releaseSha });
    }
    log(
      `openmeld@${version} and its release manifest are already published from ${releaseSha}.`
    );
    return { status: "current", version };
  }
  assertResumablePublication({ channelVersion, npm, version });
  platform.buildPackagedCli();
  let facts = await collectFacts({
    repoRoot: cwd,
    requireServiceBundle: true,
  });
  if (channelVersion === version) {
    const hashes = await readVerifiedNpmHashes({
      platform,
      channelPolicy,
      version,
      releaseSha,
    });
    facts = { ...facts, service: { ...facts.service, ...hashes } };
  }
  const policy = await readPolicy(cwd);
  const { changed, manifest } = planCliPublication({
    facts,
    policy,
    published,
  });
  if (channelVersion === version) {
    assertMatchingChannelPolicy(channelPolicy, manifest, version);
  }
  log(
    `openmeld@${version}: ${changed.join(", ")} changed; Service ${manifest.components.service.bundleVersion}.`
  );
  if (dryRun) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return { status: "planned", version, manifest };
  }
  if (channelVersion === version) {
    log(`Binary channel already serves ${version}.`);
  } else {
    await platform.uploadBinary(manifest);
  }
  if (npm) {
    log(`npm already has openmeld@${version}.`);
  } else {
    await platform.publishNpm();
    await waitForNpmGitHead({
      platform,
      version,
      releaseSha,
      npm: platform.readNpmVersion(version),
    });
  }
  platform.ensureTag({ tag: `v${version}`, sha: releaseSha });
  platform.writeRelease(manifest);
  const readBack = platform.readPublishedRelease();
  if (readBack?.components.cli.packageVersion !== version) {
    throw new Error("The release manifest did not read back after upload.");
  }
  log(`Published openmeld@${version}; Core serves it within one minute.`);
  return { status: "published", version, manifest };
}

// One-time migration: publish the last committed manifest so a Core that reads
// R2 sees the release users already run.
export function seedManifest({
  from,
  cwd = process.cwd(),
  env = process.env,
  platform,
}) {
  const manifest = localComponentsReleaseManifestSchema.parse(
    JSON.parse(readFileSync(from, "utf8"))
  );
  const target =
    platform ??
    createPlatform({
      cwd,
      env,
      bucket: env.OPENMELD_CLI_R2_BUCKET ?? DEFAULT_CLI_R2_BUCKET,
    });
  const existing = target.readPublishedRelease();
  if (existing) {
    log(
      `A release manifest is already published (CLI ${existing.components.cli.packageVersion}); nothing to seed.`
    );
    return existing;
  }
  target.writeRelease(manifest);
  log(
    `Seeded CLI ${manifest.components.cli.packageVersion} / Service ${manifest.components.service.bundleVersion}.`
  );
  return manifest;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    allowPositionals: true,
    options: {
      "release-sha": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      from: { type: "string" },
    },
  });
  try {
    if (positionals[0] === "seed-manifest") {
      if (!values.from) {
        throw new Error("seed-manifest requires --from <manifest.json>.");
      }
      seedManifest({ from: values.from });
    } else {
      await publishCli({
        releaseSha:
          values["release-sha"] ??
          execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
        dryRun: values["dry-run"],
      });
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
