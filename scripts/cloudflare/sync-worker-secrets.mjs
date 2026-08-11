import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ENV_LINE_SPLIT_PATTERN = /\r?\n/u;
const ENV_ASSIGNMENT_PATTERN = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/u;

const args = process.argv.slice(2);
const envName = readFlagValue(args, "--env");
const filePath = readFlagValue(args, "--file");
const secretNames = collectPositionalArgs(args);

if (!(envName && filePath && secretNames.length > 0)) {
  console.error(
    [
      "Usage:",
      "node scripts/cloudflare/sync-worker-secrets.mjs --env <name> --file <path> <SECRET_KEY> [MORE_SECRET_KEYS...]",
    ].join(" ")
  );
  process.exit(1);
}

const envFilePath = path.resolve(process.cwd(), filePath);
const parsedEntries = parseEnvFile(readFileSync(envFilePath, "utf8"));
const missingSecretNames = [];
const filteredLines = [];

for (const secretName of secretNames) {
  const entry = parsedEntries.get(secretName);
  if (!(entry && entry.normalizedValue.length > 0)) {
    missingSecretNames.push(secretName);
    continue;
  }
  filteredLines.push(`${secretName}=${entry.rawValue}`);
}

if (missingSecretNames.length > 0) {
  console.error(
    `[sync-worker-secrets] Missing required secrets in ${filePath}: ${missingSecretNames.join(", ")}`
  );
  process.exit(1);
}

const ignoredKeys = [...parsedEntries.keys()].filter(
  (key) => !secretNames.includes(key)
);
if (ignoredKeys.length > 0) {
  console.warn(
    `[sync-worker-secrets] Ignoring non-secret keys from ${filePath}: ${ignoredKeys.join(", ")}`
  );
}

const tempDirectory = mkdtempSync(
  path.join(os.tmpdir(), "openmeld-worker-secret-sync-")
);
const tempFilePath = path.join(tempDirectory, ".dev.vars.prod");

try {
  writeFileSync(tempFilePath, `${filteredLines.join("\n")}\n`, "utf8");

  const command = spawnSync(
    "wrangler",
    ["secret", "bulk", `--env=${envName}`, tempFilePath],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    }
  );

  process.exit(command.status ?? 1);
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

function readFlagValue(argv, flagName) {
  const flag = argv.find((value) => value === flagName);
  if (!flag) {
    return null;
  }
  const flagIndex = argv.indexOf(flag);
  return argv[flagIndex + 1] ?? null;
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
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (!key) {
      continue;
    }

    entries.set(key, {
      rawValue,
      normalizedValue: normalizeEnvValue(rawValue),
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
