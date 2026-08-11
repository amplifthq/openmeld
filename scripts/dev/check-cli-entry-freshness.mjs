#!/usr/bin/env node

import { opendir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

const TRACKED_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
]);

async function main() {
  const [entryPath, buildCommand, ...sourcePaths] = process.argv.slice(2);
  if (!(entryPath && buildCommand) || sourcePaths.length === 0) {
    throw new Error(
      "usage: check-cli-entry-freshness <entry> <build-command> <source...>"
    );
  }

  const entry = await stat(entryPath).catch(() => null);
  if (!entry?.isFile()) {
    printStale({
      buildCommand,
      entryPath,
      reason: "CLI entry is missing.",
    });
    process.exitCode = 1;
    return;
  }

  const staleSource = await findNewestStaleSource({
    entryMtimeMs: entry.mtimeMs,
    sourcePaths,
  });
  if (!staleSource) {
    return;
  }

  printStale({
    buildCommand,
    entryPath,
    reason: `Source is newer than the CLI entry: ${staleSource}`,
  });
  process.exitCode = 1;
}

async function findNewestStaleSource(input) {
  let newestStaleSource = null;
  let newestMtimeMs = input.entryMtimeMs;
  for (const sourcePath of input.sourcePaths) {
    const candidate = await findNewestStaleSourceInPath({
      entryMtimeMs: input.entryMtimeMs,
      sourcePath,
    });
    if (candidate && candidate.mtimeMs > newestMtimeMs) {
      newestMtimeMs = candidate.mtimeMs;
      newestStaleSource = candidate.path;
    }
  }
  return newestStaleSource;
}

async function findNewestStaleSourceInPath(input) {
  const source = await stat(input.sourcePath).catch(() => null);
  if (!source) {
    return null;
  }
  if (source.isFile()) {
    return findStaleSourceFile({
      entryMtimeMs: input.entryMtimeMs,
      source,
      sourcePath: input.sourcePath,
    });
  }
  if (!source.isDirectory()) {
    return null;
  }
  return await findNewestStaleSourceInDirectory(input);
}

async function findNewestStaleSourceInDirectory(input) {
  let newest = null;
  const dir = await opendir(input.sourcePath);
  for await (const entry of dir) {
    const childPath = join(input.sourcePath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const child = await findNewestStaleSourceInPath({
        entryMtimeMs: input.entryMtimeMs,
        sourcePath: childPath,
      });
      if (child && (!newest || child.mtimeMs > newest.mtimeMs)) {
        newest = child;
      }
      continue;
    }
    if (!(entry.isFile() && isTrackedFile(childPath))) {
      continue;
    }
    const child = findStaleSourceFile({
      entryMtimeMs: input.entryMtimeMs,
      source: await stat(childPath),
      sourcePath: childPath,
    });
    if (child && (!newest || child.mtimeMs > newest.mtimeMs)) {
      newest = child;
    }
  }
  return newest;
}

function findStaleSourceFile(input) {
  if (
    !isTrackedFile(input.sourcePath) ||
    input.source.mtimeMs <= input.entryMtimeMs
  ) {
    return null;
  }
  return {
    path: input.sourcePath,
    mtimeMs: input.source.mtimeMs,
  };
}

function isTrackedFile(path) {
  const name = basename(path);
  if (name.startsWith(".")) {
    return false;
  }
  return TRACKED_EXTENSIONS.has(name.slice(name.lastIndexOf(".")));
}

function printStale(input) {
  process.stderr.write(
    [
      "openmeld-dev build is stale.",
      input.reason,
      `CLI entry: ${input.entryPath}`,
      "Rebuild before running dev-local smoke:",
      `  ${input.buildCommand}`,
      "",
    ].join("\n")
  );
}

main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
