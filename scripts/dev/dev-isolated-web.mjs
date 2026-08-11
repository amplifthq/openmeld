#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildIsolatedWebStartupMessages,
  resolveIsolatedDevPresentation,
  resolveIsolatedWebDopplerCommand,
} from "./dev-isolated.mjs";
import {
  buildIsolatedDevEnvironment,
  releaseIsolatedDevLane,
  reserveIsolatedDevLane,
} from "./dev-isolated-lane.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const presentation = resolveIsolatedDevPresentation();

run().catch((error) => {
  console.error(`[${presentation.webCommandLabel}] ${toErrorMessage(error)}`);
  process.exit(1);
});

async function run() {
  const lane = await reserveIsolatedDevLane({
    kind: "web",
    pid: process.pid,
    repoRoot,
    stackStartCommand: presentation.stackStartCommand,
  });
  const isolatedEnvironment = buildIsolatedDevEnvironment(lane);
  for (const message of buildIsolatedWebStartupMessages({
    laneId: lane.laneId,
    presentation,
    webPort: lane.ports.web,
  })) {
    console.log(message);
  }

  try {
    const exitCode = await runWeb({
      env: { ...process.env, ...isolatedEnvironment },
    });
    process.exitCode = exitCode;
  } finally {
    await releaseIsolatedDevLane({
      kind: "web",
      pid: process.pid,
      repoRoot,
    });
  }
}

function runWeb(input) {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const dopplerCommand = resolveIsolatedWebDopplerCommand(
    input.env,
    pnpmCommand
  );
  const command = dopplerCommand?.executable ?? pnpmCommand;
  const args = dopplerCommand?.args ?? [
    "--filter",
    "openmeld-web",
    "run",
    "dev:isolated",
  ];

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: input.env,
      stdio: "inherit",
    });
    const forwardSigint = () => child.kill("SIGINT");
    const forwardSigterm = () => child.kill("SIGTERM");
    process.once("SIGINT", forwardSigint);
    process.once("SIGTERM", forwardSigterm);
    const removeSignalHandlers = () => {
      process.off("SIGINT", forwardSigint);
      process.off("SIGTERM", forwardSigterm);
    };
    child.once("error", (error) => {
      removeSignalHandlers();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      removeSignalHandlers();
      resolvePromise(signal ? 1 : (code ?? 1));
    });
  });
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
