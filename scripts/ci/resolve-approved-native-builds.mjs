#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u;
const ALLOW_BUILDS_ENTRY_PATTERN =
  /^\s{2}(?:'([^']+)'|"([^"]+)"|([^:#]+)):\s*(true|false)\s*$/u;
const ALLOW_BUILDS_HEADER_PATTERN = /^allowBuilds:\s*$/u;
const LINE_SPLIT_PATTERN = /\r?\n/u;
const TOP_LEVEL_YAML_KEY_PATTERN = /^\S/u;

export function resolveApprovedNativeBuilds(workspaceFile) {
  const lines = readFileSync(workspaceFile, "utf8").split(LINE_SPLIT_PATTERN);
  const approved = [];
  let inAllowBuilds = false;
  for (const line of lines) {
    if (ALLOW_BUILDS_HEADER_PATTERN.test(line)) {
      inAllowBuilds = true;
      continue;
    }
    if (inAllowBuilds && TOP_LEVEL_YAML_KEY_PATTERN.test(line)) {
      break;
    }
    if (!inAllowBuilds) {
      continue;
    }
    const match = ALLOW_BUILDS_ENTRY_PATTERN.exec(line);
    if (!match || match[4] !== "true") {
      continue;
    }
    const packageName = String(match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!PACKAGE_NAME_PATTERN.test(packageName)) {
      throw new Error(`Invalid approved native build package: ${packageName}`);
    }
    approved.push(packageName);
  }
  if (approved.length === 0) {
    throw new Error(
      "Trusted control declares no approved native dependency builds."
    );
  }
  return approved.toSorted();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const workspaceFile = path.resolve(
      process.argv[2] ?? "pnpm-workspace.yaml"
    );
    process.stdout.write(
      `${resolveApprovedNativeBuilds(workspaceFile).join("\n")}\n`
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
