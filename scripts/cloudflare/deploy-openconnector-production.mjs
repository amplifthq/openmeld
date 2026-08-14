import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import {
  assertRequiredOpenConnectorRuntimeSecrets,
  resolveOpenConnectorProductionSecretsIfAvailable,
} from "./openconnector-production-secrets.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const deploymentConfigPath = path.join(
  repoRoot,
  "config/openconnector/wrangler.production.jsonc"
);
const temporaryConfigName = ".openmeld-openconnector-production.jsonc";

const options = parseOptions(process.argv.slice(2));
const sourceDirectory = path.resolve(options.source);
const packageJsonPath = path.join(sourceDirectory, "package.json");
const temporaryConfigPath = path.join(sourceDirectory, temporaryConfigName);

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
    "The OpenConnector source checkout must be clean before a production deployment."
  );
}

const sourceSha = run("git", ["rev-parse", "HEAD"], sourceDirectory).trim();
if (sourceSha !== options.sourceSha) {
  throw new Error(
    `OpenConnector source SHA mismatch: expected ${options.sourceSha}, found ${sourceSha}.`
  );
}

const deploymentSecrets = resolveOpenConnectorProductionSecretsIfAvailable();
const deploymentEnvironment = deploymentSecrets
  ? { ...process.env, ...deploymentSecrets }
  : { ...process.env };

if (existsSync(temporaryConfigPath)) {
  throw new Error(
    `Refusing to overwrite the existing temporary config at ${temporaryConfigPath}.`
  );
}

console.log(`Deploying OpenConnector source ${sourceSha}.`);
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
} finally {
  rmSync(temporaryConfigPath, { force: true });
}

function parseOptions(args) {
  const parsed = {};
  const optionArgs = args[0] === "--" ? args.slice(1) : args;
  for (let index = 0; index < optionArgs.length; index += 2) {
    const name = optionArgs[index];
    const value = optionArgs[index + 1];
    if ((name !== "--source" && name !== "--source-sha") || !value) {
      throw new Error(
        "Usage: pnpm deploy:openconnector:production -- --source <checkout> --source-sha <full-sha>"
      );
    }
    parsed[name.slice(2).replace("-sha", "Sha")] = value;
  }
  if (!(parsed.source && parsed.sourceSha)) {
    throw new Error(
      "Both --source and --source-sha are required for an immutable production deployment."
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
