import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import {
  assertRequiredOpenConnectorRuntimeSecrets,
  resolveOpenConnectorSecretsIfAvailable,
} from "./openconnector-secrets.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const FULL_GIT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const options = parseOptions(process.argv.slice(2));
const deploymentConfigPath = path.join(
  repoRoot,
  `config/openconnector/wrangler.${options.environment}.jsonc`
);
const temporaryConfigName = `.openmeld-openconnector-${options.environment}.jsonc`;

const sourceDirectory = path.resolve(options.source);
const packageJsonPath = path.join(sourceDirectory, "package.json");
const temporaryConfigPath = path.join(sourceDirectory, temporaryConfigName);

if (
  options.environment === "staging" &&
  run("git", ["status", "--porcelain"], repoRoot).trim()
) {
  throw new Error(
    "The OpenMeld worktree must be clean before a staging deployment."
  );
}

if (!existsSync(packageJsonPath)) {
  throw new Error(
    `OpenConnector package.json was not found at ${packageJsonPath}.`
  );
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
if (packageJson.name !== "@oomol-lab/open-connector") {
  throw new Error(
    `${sourceDirectory} is not an @oomol-lab/open-connector checkout.`
  );
}

const dirtyFiles = run("git", ["status", "--porcelain"], sourceDirectory);
if (dirtyFiles.trim()) {
  throw new Error(
    "The OpenConnector source checkout must be clean before deployment."
  );
}

const sourceSha = run("git", ["rev-parse", "HEAD"], sourceDirectory).trim();
if (sourceSha !== options.sourceSha) {
  throw new Error(
    `OpenConnector source SHA mismatch: expected ${options.sourceSha}, found ${sourceSha}.`
  );
}

const deploymentSecrets = resolveOpenConnectorSecretsIfAvailable();
const deploymentEnvironment = deploymentSecrets
  ? { ...process.env, ...deploymentSecrets }
  : { ...process.env };

if (existsSync(temporaryConfigPath)) {
  throw new Error(
    `Refusing to overwrite the existing temporary config at ${temporaryConfigPath}.`
  );
}

if (options.environment === "staging") {
  runStreaming(
    process.execPath,
    ["scripts/cloudflare/verify-worker-env-contract.mjs"],
    repoRoot,
    process.env
  );
  runStreaming(
    process.execPath,
    [
      "scripts/cloudflare/provision-openmeld-resources.mjs",
      "--environment",
      "staging",
      "--include-open-connector",
      "--allow-pending-deploy",
      "--apply",
    ],
    repoRoot,
    process.env
  );
}

console.log(
  `Deploying OpenConnector source ${sourceSha} to ${options.environment}.`
);
copyFileSync(deploymentConfigPath, temporaryConfigPath);

try {
  if (!deploymentSecrets) {
    const secretMetadata = JSON.parse(
      run(
        path.join(sourceDirectory, "node_modules/.bin/wrangler"),
        ["secret", "list", "--config", temporaryConfigName],
        sourceDirectory
      )
    );
    assertRequiredOpenConnectorRuntimeSecrets(secretMetadata);
    console.log(
      "Verified the deployed OpenConnector secret contract; preserving existing Cloudflare secrets."
    );
  }
  runStreaming(
    "npm",
    ["run", "generate:catalog"],
    sourceDirectory,
    deploymentEnvironment
  );
  runStreaming(
    "npm",
    ["run", "build:web"],
    sourceDirectory,
    deploymentEnvironment
  );
  runStreaming(
    "node",
    ["scripts/copy-catalog-assets.ts"],
    sourceDirectory,
    deploymentEnvironment
  );
  runStreaming(
    path.join(sourceDirectory, "node_modules/.bin/wrangler"),
    [
      "d1",
      "migrations",
      "apply",
      "DB",
      "--remote",
      "--config",
      temporaryConfigName,
    ],
    sourceDirectory,
    deploymentEnvironment
  );
  const wranglerPath = path.join(sourceDirectory, "node_modules/.bin/wrangler");
  const deployArgs = ["deploy", "--config", temporaryConfigName, "--minify"];
  if (deploymentSecrets) {
    runStreamingWithInput(
      wranglerPath,
      [...deployArgs, "--secrets-file", "/dev/stdin"],
      sourceDirectory,
      deploymentEnvironment,
      JSON.stringify(deploymentSecrets)
    );
  } else {
    runStreaming(
      wranglerPath,
      deployArgs,
      sourceDirectory,
      deploymentEnvironment
    );
  }
  if (options.environment === "staging") {
    const health = await fetch("https://connectors.staging.openmeld.ai/health");
    if (!health.ok) {
      throw new Error(`OpenConnector staging health failed: ${health.status}.`);
    }
    console.log(
      `OpenConnector staging deployed from ${sourceSha}; public health passed. App authorization and action smoke remain separate checks.`
    );
  }
} finally {
  rmSync(temporaryConfigPath, { force: true });
}

function parseOptions(args) {
  const parsed = {};
  const optionArgs = args.values();
  for (const name of optionArgs) {
    if (name === "--") {
      continue;
    }
    const value = optionArgs.next().value;
    if (
      !(["--source", "--source-sha", "--environment"].includes(name) && value)
    ) {
      throw new Error(
        "Usage: deploy-openconnector.mjs --environment <production|staging> --source <checkout> --source-sha <full-sha>"
      );
    }
    const key = name.slice(2).replace("-sha", "Sha");
    if (Object.hasOwn(parsed, key)) {
      throw new Error(`Duplicate option: ${name}`);
    }
    parsed[key] = value;
  }
  if (!(parsed.source && FULL_GIT_SHA_PATTERN.test(parsed.sourceSha ?? ""))) {
    throw new Error(
      "Both --source and a full --source-sha are required for an immutable deployment."
    );
  }
  if (!["production", "staging"].includes(parsed.environment)) {
    throw new Error(
      "An explicit production or staging environment is required."
    );
  }
  return parsed;
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function runStreaming(command, args, cwd, env) {
  execFileSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });
}

function runStreamingWithInput(command, args, cwd, env, input) {
  execFileSync(command, args, {
    cwd,
    env,
    input,
    stdio: ["pipe", "inherit", "inherit"],
  });
}
