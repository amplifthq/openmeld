#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";

import { runCoreCurrentCliProjectionPreflight } from "./production-release.mjs";

const EXACT_SHA_PATTERN = /^[a-f0-9]{40}$/u;

try {
  const releaseSha = execFileSync(
    "git",
    ["rev-parse", "--verify", "HEAD^{commit}"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  ).trim();
  if (!EXACT_SHA_PATTERN.test(releaseSha)) {
    throw new Error(
      "Core current-CLI projection preflight requires the exact checked-out commit SHA."
    );
  }
  runCoreCurrentCliProjectionPreflight({ releaseSha });
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
