#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startDevelopmentPostgres } from "../../tooling/postgresql/development.mjs";
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
import { acquireLocalResources, RESOURCE_TOKEN } from "./local-resources.mjs";
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
  const postgresqlEnabled = true;
  let postgresqlSnapshot;

  for (const arg of args) {
    if (arg.startsWith("--d1-snapshot=")) {
      const filename = arg.slice("--d1-snapshot=".length);
      if (!filename || postgresqlSnapshot) {
        throw new Error(
          "Provide one D1 snapshot path with --d1-snapshot=<path>."
        );
      }
      postgresqlSnapshot = resolve(filename);
      continue;
    }
    if (arg === "--postgresql") {
      continue;
    }
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
    postgresqlEnabled,
    ...(postgresqlSnapshot ? { postgresqlSnapshot } : {}),
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
  pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  script = resolveIsolatedWebScript(env)
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
    [pnpmCommand, "--filter", "openmeld-web", "run", script],
    env
  );
}

export const WEB_DEV_HEAP_LIMIT_MB = 8192;
const HEAP_LIMIT_OPTION_PATTERN = /(^|\s)--max-old-space-size(=|\s)/;

/**
 * Vite's dev server can run out of the default Node heap under heavy HMR.
 * Raises the limit for the Web dev runtime only, and keeps any NODE_OPTIONS
 * already set; a heap size chosen there wins.
 */
export function withWebDevHeapLimit(env = process.env) {
  const nodeOptions = env.NODE_OPTIONS?.trim() ?? "";
  if (HEAP_LIMIT_OPTION_PATTERN.test(nodeOptions)) {
    return env;
  }
  const heapOption = `--max-old-space-size=${WEB_DEV_HEAP_LIMIT_MB}`;
  return {
    ...env,
    NODE_OPTIONS: nodeOptions ? `${nodeOptions} ${heapOption}` : heapOption,
  };
}

export function resolveIsolatedWebScript(env = process.env) {
  return env.OPENMELD_DESKTOP_PILOT === "1" ? "desktop:pilot" : "dev:isolated";
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
      [RESOURCE_TOKEN]: reservation.token,
      ...buildIsolatedDevEnvironment(lane),
      OPENMELD_DEV_REMOTE_AGENT_SANDBOX_ENABLED: String(
        options.remoteAgentSandboxEnabled
      ),
    };
    const postgres = await startDevelopmentPostgres(
      lane.wranglerStateDirectory,
      {
        snapshot: options.postgresqlSnapshot,
      }
    );
    printLaneSummary(lane, options, presentation);

    try {
      const exitCode = await runDevGuard({
        env: {
          ...process.env,
          ...isolatedEnvironment,
          ...postgres.env,
        },
        extraArgs: options.devGuardArgs,
      });
      process.exitCode = exitCode;
    } finally {
      await postgres.stop();
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
