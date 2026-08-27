#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENV_LINE_SPLIT_PATTERN = /\r?\n/u;
const ENV_ASSIGNMENT_PATTERN = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/u;
const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    process.exitCode = runSyncWorkerSecrets(
      parseSyncWorkerSecretsArgs(process.argv.slice(2))
    );
  } catch (error) {
    console.error(
      `[sync-worker-secrets] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}

export function parseSyncWorkerSecretsArgs(args) {
  const envName = readFlagValue(args, "--env");
  const filePath = readFlagValue(args, "--file");
  const fromEnvironment = args.includes("--from-env");
  const secretNames = collectPositionalArgs(args);

  if (!(envName && secretNames.length > 0)) {
    throw new Error(
      "Usage: sync-worker-secrets.mjs --env <name> (--file <path> | --from-env) <SECRET_KEY> [MORE_SECRET_KEYS...]"
    );
  }
  if (Boolean(filePath) === fromEnvironment) {
    throw new Error("Choose exactly one secret source: --file or --from-env.");
  }

  return { envName, filePath, fromEnvironment, secretNames };
}

export function collectSecretValuesFromEnvironment(secretNames, env) {
  const missingSecretNames = secretNames.filter(
    (secretName) => !hasValue(env[secretName])
  );
  if (missingSecretNames.length > 0) {
    throw new Error(
      `Missing required secrets in the environment: ${missingSecretNames.join(", ")}`
    );
  }

  return secretNames.map(
    (secretName) => `${secretName}=${JSON.stringify(env[secretName])}`
  );
}

export function runSyncWorkerSecrets(input, env = process.env) {
  const filteredLines = input.fromEnvironment
    ? collectSecretValuesFromEnvironment(input.secretNames, env)
    : collectSecretValuesFromFile(input.filePath, input.secretNames);
  const tempDirectory = mkdtempSync(
    path.join(os.tmpdir(), "openmeld-worker-secret-sync-")
  );
  const tempFilePath = path.join(tempDirectory, `.dev.vars.${input.envName}`);

  try {
    writeFileSync(tempFilePath, `${filteredLines.join("\n")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    const command = spawnSync(
      "wrangler",
      ["secret", "bulk", `--env=${input.envName}`, tempFilePath],
      {
        cwd: process.cwd(),
        env,
        stdio: "inherit",
      }
    );
    if (command.error) {
      throw command.error;
    }
    return command.status ?? 1;
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function collectSecretValuesFromFile(filePath, secretNames) {
  const envFilePath = path.resolve(process.cwd(), filePath);
  const parsedEntries = parseEnvFile(readFileSync(envFilePath, "utf8"));
  const missingSecretNames = secretNames.filter((secretName) => {
    const entry = parsedEntries.get(secretName);
    return !(entry && entry.normalizedValue.length > 0);
  });
  if (missingSecretNames.length > 0) {
    throw new Error(
      `Missing required secrets in ${filePath}: ${missingSecretNames.join(", ")}`
    );
  }

  const ignoredKeys = [...parsedEntries.keys()].filter(
    (key) => !secretNames.includes(key)
  );
  if (ignoredKeys.length > 0) {
    console.warn(
      `[sync-worker-secrets] Ignoring non-secret keys from ${filePath}: ${ignoredKeys.join(", ")}`
    );
  }

  return secretNames.map((secretName) => {
    const entry = parsedEntries.get(secretName);
    return `${secretName}=${entry.rawValue}`;
  });
}

function readFlagValue(argv, flagName) {
  const flagIndex = argv.indexOf(flagName);
  return flagIndex === -1 ? null : (argv[flagIndex + 1] ?? null);
}

function collectPositionalArgs(argv) {
  const positionalArgs = [];
  let skipNextValue = false;

  for (const value of argv) {
    if (skipNextValue) {
      skipNextValue = false;
      continue;
    }
    if (value === "--env" || value === "--file") {
      skipNextValue = true;
      continue;
    }
    if (value?.startsWith("--")) {
      continue;
    }
    positionalArgs.push(value);
  }

  return positionalArgs;
}

function parseEnvFile(text) {
  const entries = new Map();

  for (const line of text.split(ENV_LINE_SPLIT_PATTERN)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const match = line.match(ENV_ASSIGNMENT_PATTERN);
    if (!(match?.[1] && match[2] !== undefined)) {
      continue;
    }

    entries.set(match[1], {
      rawValue: match[2],
      normalizedValue: normalizeEnvValue(match[2]),
    });
  }

  return entries;
}

function normalizeEnvValue(rawValue) {
  const trimmedValue = rawValue.trim();
  if (
    trimmedValue.length >= 2 &&
    ((trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
      (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")))
  ) {
    return trimmedValue.slice(1, -1).trim();
  }
  return trimmedValue;
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}
