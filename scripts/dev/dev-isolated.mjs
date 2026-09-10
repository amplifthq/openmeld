#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildIsolatedDevEnvironment,
  buildIsolatedDevUrl,
  releaseIsolatedDevLane,
  reserveIsolatedDevLane,
} from "./dev-isolated-lane.mjs";
import {
  buildDopplerComponentCommand,
  DEVELOPMENT_ENVIRONMENT_SOURCE_VARIABLE,
  DOPPLER_DEVELOPMENT_COMPONENT_VARIABLE,
  DOPPLER_DEVELOPMENT_ENVIRONMENT_SOURCE,
} from "./doppler-environment.mjs";
import { acquireLocalResources } from "./local-resources.mjs";
import { runOwnedCommand } from "./owned-command.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const devGuardPath = resolve(repoRoot, "scripts/dev/dev-guard.mjs");

if (isDirectExecution()) {
  runIsolatedDev().catch((error) => {
    const presentation = resolveIsolatedDevPresentation(
      process.env,
      resolveIsolatedDevLaunchOptions(process.argv.slice(2))
    );
    console.error(`[${presentation.commandLabel}] ${toErrorMessage(error)}`);
    process.exit(1);
  });
}

export function resolveIsolatedDevLaunchOptions(args) {
  const devGuardArgs = [];
  let remoteAgentSandboxEnabled = true;
  let scheduledEventsEnabled = false;

  for (const arg of args) {
    if (arg === "--no-sandbox") {
      remoteAgentSandboxEnabled = false;
      continue;
    }
    if (arg === "--test-scheduled") {
      scheduledEventsEnabled = true;
      continue;
    }
    devGuardArgs.push(arg);
  }

  return {
    devGuardArgs,
    remoteAgentSandboxEnabled,
    scheduledEventsEnabled,
  };
}

export function resolveIsolatedDevPresentation(
  env = process.env,
  options = {}
) {
  const usesDoppler =
    env[DEVELOPMENT_ENVIRONMENT_SOURCE_VARIABLE] ===
    DOPPLER_DEVELOPMENT_ENVIRONMENT_SOURCE;
  const usesDopplerSandbox =
    usesDoppler && options.remoteAgentSandboxEnabled === true;
  let commandLabel = "dev:isolated";
  let stackStartCommand = "pnpm dev:isolated";
  if (usesDoppler) {
    commandLabel = "dev:worktree";
    stackStartCommand = "pnpm dev:worktree";
  }
  if (usesDopplerSandbox) {
    commandLabel = "dev:worktree:sandbox";
    stackStartCommand = "pnpm dev:worktree:sandbox";
  }
  return {
    commandLabel,
    stackStartCommand,
    webStartCommand: usesDoppler
      ? "pnpm dev:web:worktree"
      : "pnpm dev:web:isolated",
    webCommandLabel: usesDoppler ? "dev:web:worktree" : "dev:web:isolated",
  };
}

export function buildIsolatedWebStartupMessages(input) {
  const prefix = `[${input.presentation.webCommandLabel}]`;
  return [
    `${prefix} Starting Web for worktree lane ${input.laneId}: ${buildIsolatedDevUrl(input.laneId, input.webPort)}`,
    `${prefix} The first page load can take about one minute while Web and Cloudflare compile. Keep the page open; later loads should be fast.`,
  ];
}

export function resolveIsolatedWebDopplerCommand(
  env = process.env,
  pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
) {
  if (
    env[DEVELOPMENT_ENVIRONMENT_SOURCE_VARIABLE] !==
      DOPPLER_DEVELOPMENT_ENVIRONMENT_SOURCE ||
    env[DOPPLER_DEVELOPMENT_COMPONENT_VARIABLE] === "web"
  ) {
    return null;
  }
  return buildDopplerComponentCommand(
    "web",
    [pnpmCommand, "--filter", "openmeld-web", "run", "dev:isolated"],
    env
  );
}

export async function runIsolatedDev(args = process.argv.slice(2)) {
  const options = resolveIsolatedDevLaunchOptions(args);
  const presentation = resolveIsolatedDevPresentation(process.env, options);
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Dev startup cancelled."));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const reservation = await acquireLocalResources({
    kind: "stack",
    repoRoot,
    signal: controller.signal,
  });
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
  try {
    const lane = await reserveIsolatedDevLane({
      kind: "stack",
      pid: process.pid,
      repoRoot,
    });
    const isolatedEnvironment = {
      ...buildIsolatedDevEnvironment(lane),
      OPENMELD_DEV_REMOTE_AGENT_SANDBOX_ENABLED: String(
        options.remoteAgentSandboxEnabled
      ),
    };
    printLaneSummary(lane, options, presentation);

    try {
      const exitCode = await runDevGuard({
        env: { ...process.env, ...isolatedEnvironment },
        extraArgs: options.devGuardArgs,
      });
      process.exitCode = exitCode;
    } finally {
      await releaseIsolatedDevLane({
        kind: "stack",
        pid: process.pid,
        repoRoot,
      });
    }
  } finally {
    await reservation.release();
  }
}

function runDevGuard(input) {
  return runOwnedCommand(process.execPath, [devGuardPath, ...input.extraArgs], {
    cwd: repoRoot,
    env: input.env,
  });
}

function printLaneSummary(lane, options, presentation) {
  const prefix = `[${presentation.commandLabel}]`;
  console.log(`${prefix} Starting worktree lane ${lane.laneId}.`);
  console.log(
    `${prefix} Auth ${buildIsolatedDevUrl(lane.laneId, lane.ports.auth)} | Gateway ${buildIsolatedDevUrl(lane.laneId, lane.ports.gateway)} | Remote Agent ${buildIsolatedDevUrl(lane.laneId, lane.ports.remoteAgent)}`
  );
  console.log(
    `${prefix} Web ${buildIsolatedDevUrl(lane.laneId, lane.ports.web)}`
  );
  console.log(
    `${prefix} State ${lane.wranglerStateDirectory} | OPENMELD_HOME ${lane.openMeldHome}`
  );
  console.log(
    `${prefix} After the Worker stack reports ready, open a second terminal in this worktree and run: ${presentation.webStartCommand}`
  );
  if (!options.remoteAgentSandboxEnabled) {
    console.log(
      `${prefix} Remote Agent Sandbox tools and Wrangler containers are disabled; Docker is not required.`
    );
  }
  if (options.scheduledEventsEnabled) {
    console.log(
      `${prefix} Trigger one local Routine scheduler tick with: curl -X POST ${buildIsolatedDevUrl(lane.laneId, lane.ports.gateway)}/__dev/routines/tick`
    );
  }
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isDirectExecution() {
  return process.argv[1] && resolve(process.argv[1]) === scriptPath;
}
