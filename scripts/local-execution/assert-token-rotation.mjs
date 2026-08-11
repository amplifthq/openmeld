#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const HOURS_TO_MS = 60 * 60 * 1000;
const TOKEN_SCHEMA = "openmeld-daemon-token-v1";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.tokenFile) {
    fail("missing --token-file <path>");
  }

  const fullPath = path.resolve(process.cwd(), args.tokenFile);
  const raw = await readFile(fullPath, "utf8");
  const tokenState = parseTokenState(raw);
  assertTokenAge(tokenState, args.maxAgeHours);

  process.stdout.write(
    `token rotation check passed: ${path.relative(process.cwd(), fullPath)}\n`
  );
}

function parseArgs(argv) {
  let tokenFile = "";
  let maxAgeHours = 24;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--token-file") {
      tokenFile = String(argv[i + 1] ?? "").trim();
      i += 1;
      continue;
    }
    if (token === "--max-age-hours") {
      const parsed = Number.parseInt(String(argv[i + 1] ?? ""), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        fail("--max-age-hours must be a positive integer");
      }
      maxAgeHours = parsed;
      i += 1;
      continue;
    }
    fail(`unknown argument: ${token}`);
  }

  return {
    tokenFile,
    maxAgeHours,
  };
}

function parseTokenState(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`invalid token JSON: ${reason}`);
  }

  if (!isPlainObject(parsed)) {
    fail("token file must be a JSON object");
  }

  const token = normalizeString(parsed.token);
  const schema = normalizeString(parsed.schema);
  const issuedAt = normalizeString(parsed.issuedAt);
  const updatedAt = normalizeString(parsed.updatedAt);
  const requiredFields = [token, issuedAt, updatedAt];
  if (requiredFields.some((value) => !value)) {
    fail("token file must include non-empty token, issuedAt, and updatedAt");
  }
  if (parsed.v !== 1) {
    fail("token file must include v=1");
  }
  if (schema !== TOKEN_SCHEMA) {
    fail(`token schema must be ${TOKEN_SCHEMA}`);
  }
  if (token.length < 16) {
    fail("token length must be >= 16");
  }

  return {
    schema,
    token,
    issuedAt,
    updatedAt,
  };
}

function assertTokenAge(tokenState, maxAgeHours) {
  const updatedAtMs = Date.parse(tokenState.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    fail("updatedAt is not a valid ISO timestamp");
  }

  const ageMs = Date.now() - updatedAtMs;
  if (ageMs < 0) {
    fail("updatedAt cannot be in the future");
  }

  const maxAgeMs = maxAgeHours * HOURS_TO_MS;
  if (ageMs > maxAgeMs) {
    fail(
      `token is older than allowed window (${maxAgeHours}h): age_ms=${Math.floor(ageMs)}`
    );
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  fail(`assert-token-rotation failed: ${reason}`);
});
