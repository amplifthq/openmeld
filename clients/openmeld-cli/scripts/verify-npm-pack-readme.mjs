#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const README_BASENAME = "readme.md";
const FORBIDDEN_BINARY_DIST_PREFIX = "dist/binary/";

try {
  const raw = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const parsed = JSON.parse(raw);
  const packs = Array.isArray(parsed) ? parsed : [parsed];
  const firstPack = packs.find((entry) => isRecord(entry));
  if (!(firstPack && Array.isArray(firstPack.files))) {
    throw new Error("invalid npm pack output: missing files list");
  }

  const hasReadme = firstPack.files.some((fileEntry) => {
    if (!isRecord(fileEntry) || typeof fileEntry.path !== "string") {
      return false;
    }
    return fileEntry.path.trim().toLowerCase() === README_BASENAME;
  });
  if (!hasReadme) {
    throw new Error(
      "README.md is missing from npm tarball. Ensure package.json files includes README.md."
    );
  }

  const binaryArtifactEntry = firstPack.files.find((fileEntry) => {
    if (!isRecord(fileEntry) || typeof fileEntry.path !== "string") {
      return false;
    }
    return normalizePackPath(fileEntry.path).startsWith(
      FORBIDDEN_BINARY_DIST_PREFIX
    );
  });
  if (binaryArtifactEntry) {
    throw new Error(
      `CLI binary artifact ${binaryArtifactEntry.path} must not be included in the npm tarball. Publish binaries through R2 instead.`
    );
  }

  process.stdout.write(
    "Pack guard passed: README.md is present and CLI binary artifacts are absent.\n"
  );
} catch (error) {
  const message = toErrorMessage(error);
  process.stderr.write(`Pack guard failed: ${message}\n`);
  process.exitCode = 1;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object";
}

function normalizePackPath(path) {
  return path.trim().replaceAll("\\", "/").toLowerCase();
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
