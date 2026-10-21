#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildIsolatedWebStartupMessages,
  resolveIsolatedDevPresentation,
  resolveIsolatedWebDopplerCommand,
  resolveIsolatedWebScript,
  withWebDevHeapLimit,
} from "./dev-isolated.mjs";
import {
  buildIsolatedDevEnvironment,
  releaseIsolatedDevLane,
  reserveIsolatedDevLane,
} from "./dev-isolated-lane.mjs";
import { acquireLocalResources } from "./local-resources.mjs";
import { runOwnedCommand } from "./owned-command.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const presentation = resolveIsolatedDevPresentation();

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const run = process.argv.includes("--runtime")
    ? async () => {
        process.exitCode = await runWeb(
          { env: process.env },
          "dev:isolated:runtime"
        );
      }
    : runIsolatedWeb;
  run().catch((error) => {
    console.error(`[${presentation.webCommandLabel}] ${toErrorMessage(error)}`);
    process.exit(1);
  });
}

export async function runIsolatedWeb() {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Web startup cancelled."));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const reservation = await acquireLocalResources({
    kind: "web",
    repoRoot,
    signal: controller.signal,
  });
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
  try {
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
  } finally {
    await reservation.release();
  }
}

function runWeb(input, script = resolveIsolatedWebScript(input.env)) {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const env = withWebDevHeapLimit(input.env);
  const dopplerCommand = resolveIsolatedWebDopplerCommand(
    env,
    pnpmCommand,
    script
  );
  const command = dopplerCommand?.executable ?? pnpmCommand;
  const args = dopplerCommand?.args ?? [
    "--filter",
    "openmeld-web",
    "run",
    script,
  ];

  return runOwnedCommand(command, args, {
    cwd: repoRoot,
    env: dopplerCommand?.env ?? env,
  });
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
