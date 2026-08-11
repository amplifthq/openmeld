#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { selectReleaseReadyPaths } from "../release/release-ready-paths.mjs";

const input = readFileSync(0, "utf8");
const paths = input.split(/\r?\n/u).filter(Boolean);
const releaseReadyPaths = selectReleaseReadyPaths(paths);

if (releaseReadyPaths.length > 0) {
  process.stdout.write(`${releaseReadyPaths.join("\n")}\n`);
}
