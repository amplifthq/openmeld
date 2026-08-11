#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { localComponentsReleaseManifestSchema } from "../../packages/schemas/src/schemas/local-components.ts";

import { fetchCliChannelManifest } from "./cli-channel-sync.mjs";

const RELEASE_MANIFEST_PATH = "release/local-components.json";
const RELEASE_MANIFEST_DEFINE =
  "OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON";

export function resolveCurrentCliProjectionReleaseManifest(input) {
  const channelVersion = input.channelManifest?.channels?.stable?.version;
  if (!channelVersion) {
    throw new Error(
      "Core receiver deploy refused: the production CLI channel does not declare channels.stable.version."
    );
  }

  const tagName = `v${channelVersion}`;
  let source;
  try {
    source = input.readTagFile({ path: RELEASE_MANIFEST_PATH, tagName });
  } catch (error) {
    throw new Error(
      `Core receiver deploy refused: could not read ${RELEASE_MANIFEST_PATH} from immutable tag ${tagName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let json;
  try {
    json = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Core receiver deploy refused: ${tagName}:${RELEASE_MANIFEST_PATH} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const parsed = localComponentsReleaseManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Core receiver deploy refused: ${tagName}:${RELEASE_MANIFEST_PATH} is invalid: ${parsed.error.message}`
    );
  }

  const manifestCliVersion = parsed.data.components.cli.packageVersion;
  if (manifestCliVersion !== channelVersion) {
    throw new Error(
      `Core receiver deploy refused: ${tagName}:${RELEASE_MANIFEST_PATH} declares CLI ${manifestCliVersion}, but the production channel is ${channelVersion}.`
    );
  }
  const manifestServiceVersion = parsed.data.components.service.bundleVersion;
  if (manifestServiceVersion !== channelVersion) {
    throw new Error(
      `Core receiver deploy refused: ${tagName}:${RELEASE_MANIFEST_PATH} declares OpenMeld Service ${manifestServiceVersion}, but the production channel is ${channelVersion}.`
    );
  }
  return parsed.data;
}

export function buildCoreCurrentCliProjectionDeployStepSpec(input) {
  const manifestJson = JSON.stringify(input.releaseManifest);
  return {
    args: [
      "--dir",
      "services/core",
      "exec",
      "dotenv",
      "-e",
      "../../.env",
      "-o",
      "--",
      "wrangler",
      "deploy",
      "--minify",
      "--env",
      "prod",
      "--define",
      `${RELEASE_MANIFEST_DEFINE}:${JSON.stringify(manifestJson)}`,
    ],
    command: "pnpm",
    label: "Deploy Core with the current published CLI projection",
  };
}

export async function deployCoreWithCurrentCliProjection(input = {}) {
  const cwd = input.cwd ?? process.cwd();
  const adapters = {
    fetchChannelManifest:
      input.adapters?.fetchChannelManifest ?? fetchCliChannelManifest,
    readTagFile:
      input.adapters?.readTagFile ??
      ((tagInput) =>
        execFileSync(
          resolveCommandBinary("git"),
          ["show", `${tagInput.tagName}:${tagInput.path}`],
          { cwd, encoding: "utf8" }
        )),
    runStep: input.adapters?.runStep ?? ((step) => runStep({ ...step, cwd })),
  };

  const channelManifest = await adapters.fetchChannelManifest();
  const releaseManifest = resolveCurrentCliProjectionReleaseManifest({
    channelManifest,
    readTagFile: adapters.readTagFile,
  });
  adapters.runStep({
    args: ["--dir", "services/core", "run", "build:workspace-dependencies"],
    command: "pnpm",
    label: "Build Core receiver dependencies",
  });
  const step = buildCoreCurrentCliProjectionDeployStepSpec({ releaseManifest });
  adapters.runStep(step);
  return { channelVersion: releaseManifest.components.cli.packageVersion };
}

function runStep(input) {
  process.stdout.write(`\n[production-release] ${input.label}\n`);
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
      `${input.command} ${input.args.join(" ")} failed with exit code ${String(result.status)}`
    );
  }
}

function resolveCommandBinary(command) {
  if (process.platform !== "win32") {
    return command;
  }
  if (command === "git") {
    return "git.exe";
  }
  if (command === "pnpm") {
    return "pnpm.cmd";
  }
  return command;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  deployCoreWithCurrentCliProjection().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
