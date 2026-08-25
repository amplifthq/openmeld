#!/usr/bin/env node

import process from "node:process";

import { runCoreCurrentCliProjectionPreflight } from "./production-release.mjs";

try {
  runCoreCurrentCliProjectionPreflight();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
