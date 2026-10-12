#!/usr/bin/env node

import process from "node:process";
import { runProductionRelease } from "./production-release.mjs";

// The controller must finish module evaluation before it loads status and
// admission readers, which also consume its planning functions.
try {
  await runProductionRelease(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
