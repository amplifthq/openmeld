#!/usr/bin/env node

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findActiveDevLockHolder, readDevLockPayload } from "./dev-lock.mjs";
import {
  LocalDevStackReadinessError,
  waitForLocalDevStackReady,
} from "./dev-stack-readiness.mjs";
import {
  buildProcessMatcherContext,
  isDevGuardCommand,
  isRepoProcessCommand,
  normalizeProcessMatchText,
} from "./process-matchers.mjs";
import { readProcessRows } from "./process-rows.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OPENMELD_DEV_ENTRY_COMMAND = "openmeld-dev";
const CLI_ENTRY_PATH = join(
  REPO_ROOT,
  "clients",
  "openmeld-cli",
  "dist",
  "openmeld-dev.js"
);
const OPENMELD_DEV_LOCK_PATH = join(
  REPO_ROOT,
  ".turbo",
  "dev",
  "openmeld-dev.lock"
);
const OPENMELD_DEV_SHORT_PROBE_TIMEOUT_MS = 2500;
const OPENMELD_DEV_STARTUP_TIMEOUT_MS = 30_000;
const PASSIVE_QUERY_FLAGS = new Set([
  "--help",
  "--version",
  "-V",
  "-h",
  "help",
]);
const LOCAL_ONLY_ROOT_COMMANDS = new Set([
  "prompt",
  "view",
  "local-state",
  "uninstall",
  "reset",
  "upgrade",
  "skills",
  "agents",
  "service",
  "doctor",
  "logout",
]);
const PREFLIGHT_ROOT_COMMANDS = new Set([
  "start",
  "login",
  "whoami",
  "send",
  "setup",
  "tail",
]);
const SHELL_SAFE_ARG_RE = /^[A-Za-z0-9_./:=@-]+$/u;

async function main() {
  const child = await startOpenMeldDevProcess();

  child.on("error", (error) => {
    reportAndExit(error);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

export async function startOpenMeldDevProcess(input = {}) {
  const statFn = input.statFn ?? stat;
  const spawnFn = input.spawnFn ?? spawn;
  const args = input.args ?? process.argv.slice(2);
  const forwardedArgs = normalizeForwardedArgs(args);

  await assertCliBuildExists({ statFn });
  await verifyOpenMeldDevLocalStackBeforeSpawn(
    forwardedArgs,
    input.preflightOptions
  );

  return spawnFn(process.execPath, [CLI_ENTRY_PATH, ...forwardedArgs], {
    cwd: input.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...(input.env ?? {}),
      OPENMELD_USER_FACING_CLI_COMMAND:
        String(process.env.OPENMELD_USER_FACING_CLI_COMMAND ?? "").trim() ||
        OPENMELD_DEV_ENTRY_COMMAND,
    },
    stdio: "inherit",
  });
}

export function normalizeForwardedArgs(args) {
  if (args[0] === "--") {
    return args.slice(1);
  }
  return args;
}

export function classifyOpenMeldDevCommandPreflight(args) {
  const normalizedArgs = normalizeForwardedArgs(args);

  if (isPassiveOpenMeldDevQuery(normalizedArgs)) {
    return {
      kind: "skip",
      reason: "passive_query",
      commandTokens: [],
    };
  }

  const commandTokens = collectLeadingCommandTokens(normalizedArgs, 2);
  const [firstToken, secondToken] = commandTokens;

  if (!firstToken) {
    return {
      kind: "skip",
      reason: "passive_query",
      commandTokens,
    };
  }

  if (PREFLIGHT_ROOT_COMMANDS.has(firstToken)) {
    return {
      kind: "preflight",
      reason: "requires_local_stack",
      commandTokens,
      routeKey: firstToken,
    };
  }

  if (LOCAL_ONLY_ROOT_COMMANDS.has(firstToken)) {
    return {
      kind: "skip",
      reason: "local_only",
      commandTokens,
    };
  }

  if (firstToken === "auth") {
    if (secondToken === "login") {
      return {
        kind: "preflight",
        reason: "requires_local_stack",
        commandTokens,
        routeKey: "auth login",
      };
    }
    return {
      kind: "skip",
      reason: "local_only",
      commandTokens,
    };
  }

  if (firstToken === "profile" || firstToken === "profiles") {
    return {
      kind: "preflight",
      reason: "requires_local_stack",
      commandTokens,
      routeKey: firstToken,
    };
  }

  if (firstToken === "space" || firstToken === "spaces") {
    return {
      kind: "preflight",
      reason: "requires_local_stack",
      commandTokens,
      routeKey: firstToken,
    };
  }

  if (firstToken === "repair" || firstToken === "local-state") {
    return {
      kind: "skip",
      reason: "local_only",
      commandTokens,
    };
  }

  return {
    kind: "skip",
    reason: "unknown_command",
    commandTokens,
  };
}

export function shouldPreflightOpenMeldDevCommand(args) {
  return classifyOpenMeldDevCommandPreflight(args).kind === "preflight";
}

export async function verifyOpenMeldDevLocalStackBeforeSpawn(
  args,
  options = {}
) {
  const classification = classifyOpenMeldDevCommandPreflight(args);
  if (classification.kind !== "preflight") {
    return {
      classification,
      skipped: true,
    };
  }

  const waitForLocalDevStackReadyFn =
    options.waitForLocalDevStackReadyFn ?? waitForLocalDevStackReady;
  const hasActiveDevLockHolderFn =
    options.hasActiveDevLockHolderFn ?? hasActiveOpenMeldDevLockHolder;
  const startupTimeoutMs =
    options.startupTimeoutMs ?? OPENMELD_DEV_STARTUP_TIMEOUT_MS;
  const shortProbeTimeoutMs =
    options.shortProbeTimeoutMs ?? OPENMELD_DEV_SHORT_PROBE_TIMEOUT_MS;
  const env = options.env ?? process.env;
  const activeDevLockHolder = await hasActiveDevLockHolderFn();
  const timeoutMs = activeDevLockHolder
    ? startupTimeoutMs
    : shortProbeTimeoutMs;

  try {
    const readiness = await waitForLocalDevStackReadyFn({
      authBaseUrl: normalizeOptionalUrl(env.OPENMELD_AUTH_URL),
      gatewayBaseUrl: normalizeOptionalUrl(env.OPENMELD_GATEWAY_URL),
      timeoutMs,
    });
    return {
      classification,
      skipped: false,
      activeDevLockHolder,
      readiness,
      timeoutMs,
    };
  } catch (error) {
    throw buildOpenMeldDevLocalStackPreflightError({
      args,
      activeDevLockHolder,
      error,
    });
  }
}

function normalizeOptionalUrl(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function hasActiveOpenMeldDevLockHolder(options = {}) {
  const lockPath = options.lockPath ?? OPENMELD_DEV_LOCK_PATH;
  const readDevLockPayloadFn =
    options.readDevLockPayloadFn ?? readDevLockPayload;
  const readProcessRowsFn = options.readProcessRowsFn ?? readProcessRows;
  const findActiveDevLockHolderFn =
    options.findActiveDevLockHolderFn ?? findActiveDevLockHolder;
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const matcherContext =
    options.matcherContext ?? buildProcessMatcherContext(repoRoot);

  try {
    const rows = readProcessRowsFn({ repoRoot });
    const lockPayload = readDevLockPayloadFn(lockPath);
    if (
      lockPayload &&
      findActiveDevLockHolderFn(lockPayload, rows, {
        repoRoot,
        matcherContext,
      })
    ) {
      return true;
    }

    return rows.some((row) => {
      const normalizedCommand = normalizeProcessMatchText(row.command);
      return (
        isRepoProcessCommand(normalizedCommand, matcherContext) &&
        isDevGuardCommand(normalizedCommand, matcherContext)
      );
    });
  } catch {
    return false;
  }
}

function buildOpenMeldDevLocalStackPreflightError(input) {
  const retryCommand = formatOpenMeldDevRetryCommand(input.args);

  if (input.error instanceof LocalDevStackReadinessError) {
    return new Error(
      buildOpenMeldDevLocalStackFailureMessage({
        retryCommand,
        activeDevLockHolder: input.activeDevLockHolder,
        error: input.error,
      })
    );
  }

  return new Error(
    [
      input.activeDevLockHolder
        ? "Local OpenMeld dev stack is still starting."
        : "Local OpenMeld dev stack is not ready.",
      `Details: ${describeUnknownPreflightError(input.error)}`,
      input.activeDevLockHolder
        ? `Wait for \`pnpm dev\` to finish readiness, then retry \`${retryCommand}\`.`
        : `Run \`pnpm dev\`, wait for readiness, then retry \`${retryCommand}\`.`,
    ].join("\n")
  );
}

function buildOpenMeldDevLocalStackFailureMessage(input) {
  if (input.error.failure === "local_dev_session_missing") {
    return [
      "Local OpenMeld dev stack is not ready.",
      `${capitalizeSentence(input.error.targetSummary ?? "gateway auth chain")} is missing a required local Worker session.`,
      `Details: ${formatReadinessErrorDetail(input.error)}`,
      `Run \`pnpm dev:stop\`, then \`pnpm dev\`, then retry \`${input.retryCommand}\`.`,
    ].join("\n");
  }

  return [
    input.activeDevLockHolder
      ? "Local OpenMeld dev stack is still starting."
      : "Local OpenMeld dev stack is not ready.",
    buildReadinessTargetSummaryLine(input.error),
    `Details: ${formatReadinessErrorDetail(input.error)}`,
    input.activeDevLockHolder
      ? `Wait for \`pnpm dev\` to finish readiness, then retry \`${input.retryCommand}\`.`
      : `Run \`pnpm dev\`, wait for readiness, then retry \`${input.retryCommand}\`.`,
  ].join("\n");
}

function buildReadinessTargetSummaryLine(error) {
  if (error.targetSummary === null) {
    return "The local OpenMeld dev stack readiness check did not complete.";
  }

  const statusVerb =
    error.failure === "target_unhealthy" ? "is unhealthy." : "is unavailable.";
  return `${capitalizeSentence(error.targetSummary)} ${statusVerb}`;
}

function formatReadinessErrorDetail(error) {
  if (typeof error.status === "number") {
    const raw = String(error.raw ?? "").trim();
    return raw.length > 0
      ? `HTTP ${error.status}: ${truncateText(raw)}`
      : `HTTP ${error.status}`;
  }

  const raw = String(error.raw ?? "").trim();
  if (raw.length > 0) {
    return truncateText(raw);
  }

  return truncateText(error.message);
}

function describeUnknownPreflightError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatOpenMeldDevRetryCommand(args) {
  const normalizedArgs = normalizeForwardedArgs(args);
  const renderedArgs = normalizedArgs.map((value, index, values) =>
    shouldRedactFlagValue(values[index - 1])
      ? "<redacted>"
      : quoteShellArg(value)
  );
  if (renderedArgs.length === 0) {
    return OPENMELD_DEV_ENTRY_COMMAND.trim();
  }
  return `${OPENMELD_DEV_ENTRY_COMMAND} ${renderedArgs.join(" ")}`;
}

function shouldRedactFlagValue(previousArg) {
  return previousArg === "--ott" || previousArg === "--password";
}

function quoteShellArg(value) {
  if (SHELL_SAFE_ARG_RE.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function isPassiveOpenMeldDevQuery(args) {
  for (const arg of args) {
    if (arg === "--") {
      break;
    }
    if (PASSIVE_QUERY_FLAGS.has(arg)) {
      return true;
    }
  }

  return collectLeadingCommandTokens(args, 2).length === 0;
}

function collectLeadingCommandTokens(args, maxTokens) {
  if (maxTokens <= 0) {
    return [];
  }

  const tokens = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (typeof arg !== "string" || arg.length === 0) {
      continue;
    }

    if (arg === "--") {
      break;
    }

    if (arg === "--view" || arg === "--service-auto-install") {
      if (hasKnownGlobalFlagValue(args[index + 1])) {
        index += 1;
      }
      continue;
    }

    if (
      arg.startsWith("--view=") ||
      arg.startsWith("--service-auto-install=")
    ) {
      continue;
    }

    if (arg.startsWith("-")) {
      continue;
    }

    tokens.push(arg);
    if (tokens.length >= maxTokens) {
      break;
    }
  }

  return tokens;
}

function hasKnownGlobalFlagValue(value) {
  return (
    typeof value === "string" && value.length > 0 && !value.startsWith("-")
  );
}

async function assertCliBuildExists(input = {}) {
  const statFn = input.statFn ?? stat;

  try {
    await statFn(CLI_ENTRY_PATH);
  } catch {
    throw new Error(
      `repo-local openmeld-dev build is missing at ${CLI_ENTRY_PATH}. Run \`pnpm turbo run build --filter=openmeld\` first.`
    );
  }
}

function capitalizeSentence(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function truncateText(text, maxLength = 220) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function reportAndExit(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

main().catch((error) => {
  reportAndExit(error);
});
