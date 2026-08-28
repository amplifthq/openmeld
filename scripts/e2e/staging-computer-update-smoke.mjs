#!/usr/bin/env node

import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildStagingComputerSmokePlan,
  parseStagingComputerSmokeArgs,
} from "./staging-computer-update-smoke-contract.mjs";
import { runLiveStagingComputerSmoke } from "./staging-computer-update-smoke-runner.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `[staging-computer-smoke] ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}

async function runCli(argv) {
  const options = parseStagingComputerSmokeArgs(argv);
  if (options.command === "plan") {
    printPlan();
    return;
  }
  await runLiveStagingComputerSmoke(options);
}

function printPlan() {
  process.stdout.write("OpenMeld Staging Computer update smoke:\n");
  for (const step of buildStagingComputerSmokePlan()) {
    process.stdout.write(`- ${step.label}\n`);
  }
}
