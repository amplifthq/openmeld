#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findActiveDevLockHolder, readDevLockPayload } from "./dev-lock.mjs";
import { assertRootDevPortsAvailable } from "./dev-port-owners.mjs";
import { waitForLocalDevStackReady } from "./dev-stack-readiness.mjs";
import {
  DEVELOPMENT_ENVIRONMENT_SOURCE_VARIABLE,
  DOPPLER_DEVELOPMENT_ENVIRONMENT_SOURCE,
} from "./doppler-environment.mjs";
import {
  buildProcessMatcherContext,
  isWranglerDevCommand,
  isWranglerWorkerdCommand,
  normalizeProcessMatchText,
} from "./process-matchers.mjs";
import { readProcessRows } from "./process-rows.mjs";
import { cleanupExpiredWranglerDebugLogs } from "./wrangler-log-retention.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const lockDir = join(repoRoot, ".turbo", "dev");
const lockFile = join(lockDir, "openmeld-dev.lock");
const processMatcherContext = buildProcessMatcherContext(repoRoot);
const REQUIRED_NODE_MAJOR = 24;
const ROOT_DEV_WORKSPACE_DIRS = ["clients", "packages", "services", "runtime"];
const ROOT_DEV_EXCLUDED_PACKAGE_NAMES = new Set([
  "openmeld-web",
  "@openmeld/core",
  "@openmeld/desktop",
]);
const ROOT_DEV_TURBO_FILTERS = [
  "--filter=!openmeld-web",
  "--filter=!@openmeld/core",
  "--filter=!@openmeld/desktop",
];
const SHARED_DB_PREFLIGHT_TIMEOUT_MS = 30_000;
const STANDARD_DEV_TURBO_FLAGS = new Set([
  "--concurrency",
  "--output-logs",
  "--log-order",
]);
const NEWLINE_SPLIT_REGEX = /\r?\n/u;
const JSON_OBJECT_LINE_REGEX = /^\{.*\}$/u;
const SQLITE_LOCKED_REGEX =
  /SQLITE_BUSY|database is locked|database table is locked/i;
const DB_CHECK_RESULT_NO_DIFF = "no_diff";
const DB_CHECK_RESULT_DIFF_DETECTED = "diff_detected";
const DB_CHECK_RESULT_BLOCKED = "blocked";
const DB_MIGRATE_RESULT_APPLIED = "applied";
const ISOLATED_DEV_ENV_NAME = "OPENMELD_DEV_ISOLATED";
let lockHeld = false;

if (isDirectExecution()) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  run().catch((error) => {
    releaseLock();
    console.error(`[dev-guard] ${toErrorMessage(error)}`);
    process.exit(1);
  });
}

async function run() {
  assertRequiredNodeMajor();
  const extraArgs = process.argv.slice(2);
  const isolatedDev = process.env[ISOLATED_DEV_ENV_NAME] === "1";
  assertSupportedFullStackDevArgs(extraArgs);
  ensureSingleInstanceLock();
  registerProcessCleanupHooks();
  cleanupWranglerDebugLogs();
  await cleanupStaleWranglerDevSessions();
  if (!isolatedDev) {
    assertRootDevPortsAvailable({ repoRoot });
  }
  await verifySharedDbPrerequisites(extraArgs);
  // clients/web dev is managed in a dedicated terminal window.
  const runSupervisor = createDevGuardRunSupervisor();
  const child = startTurboDev(extraArgs, runSupervisor, {
    taskName: isolatedDev ? "dev:isolated" : "dev",
  });
  if (shouldVerifyLocalDevStack(extraArgs)) {
    await verifyLocalDevStackOrExit(child, runSupervisor, { isolatedDev });
  }
}

export function assertRequiredNodeMajor(input = {}) {
  const expectedMajor = input.expectedMajor ?? REQUIRED_NODE_MAJOR;
  const actualVersion = String(input.nodeVersion ?? process.versions.node);
  const actualMajor = Number.parseInt(actualVersion.split(".")[0] ?? "", 10);

  if (actualMajor === expectedMajor) {
    return;
  }

  throw new Error(
    [
      `pnpm dev requires Node ${expectedMajor}.x.`,
      `Current Node: ${actualVersion}.`,
      "Run `nvm use` from the repo root before running `pnpm dev`.",
    ].join(" ")
  );
}

function ensureSingleInstanceLock() {
  mkdirSync(lockDir, { recursive: true });
  const lockPayload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    repoRoot,
  };

  try {
    writeLockPayload(lockPayload);
    return;
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
  }

  const existing = readDevLockPayload(lockFile);
  if (existing?.pid && isPidAlive(existing.pid)) {
    const rows = tryReadProcessRowsForLockCheck();
    const activeLockHolder = rows
      ? findActiveDevLockHolder(existing, rows, {
          repoRoot,
          matcherContext: processMatcherContext,
          isPidAlive,
        })
      : null;

    if (activeLockHolder) {
      throw new Error(
        `dev stack is already running (pid=${existing.pid}). Stop the existing stack first.`
      );
    }
    if (rows === null) {
      throw new Error(
        `existing dev lock uses a live pid (${existing.pid}) but process ownership could not be verified. Stop the existing stack first.`
      );
    }
  }

  rmSync(lockFile, { force: true });
  writeLockPayload(lockPayload);
}

function tryReadProcessRowsForLockCheck() {
  try {
    return readProcessRows({ repoRoot });
  } catch (error) {
    console.warn(
      `[dev-guard] process scan unavailable; preserving existing live lock: ${toErrorMessage(error)}`
    );
    return null;
  }
}

function writeLockPayload(payload) {
  writeFileSync(lockFile, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    flag: "wx",
  });
  lockHeld = true;
}

function cleanupWranglerDebugLogs() {
  if (process.env.OPENMELD_DEV_GUARD_SKIP_CLEANUP === "1") {
    return;
  }

  const result = cleanupExpiredWranglerDebugLogs({
    env: process.env,
  });
  if (result.deletedCount > 0) {
    console.log(
      `[dev-guard] cleaned ${result.deletedCount} expired wrangler debug logs older than ${result.retentionDays} days from ${result.logDirectory}`
    );
  }
  if (result.failedCount > 0) {
    console.warn(
      `[dev-guard] failed to clean ${result.failedCount} expired wrangler debug logs from ${result.logDirectory}`
    );
  }
}

async function cleanupStaleWranglerDevSessions() {
  if (process.env.OPENMELD_DEV_GUARD_SKIP_CLEANUP === "1") {
    return;
  }

  const rows = tryReadProcessRowsForCleanup();
  const targetPids = selectStaleWranglerDevPids(rows);

  if (targetPids.length === 0) {
    return;
  }

  const uniquePids = Array.from(new Set(targetPids)).sort((a, b) => a - b);
  console.log(
    `[dev-guard] cleaning stale wrangler dev sessions: ${uniquePids.join(", ")}`
  );

  for (const pid of uniquePids) {
    safeKill(pid, "SIGTERM");
  }

  await sleep(900);

  for (const pid of uniquePids) {
    if (isPidAlive(pid)) {
      safeKill(pid, "SIGKILL");
    }
  }
}

function tryReadProcessRowsForCleanup() {
  try {
    return readProcessRows({ repoRoot });
  } catch (error) {
    console.warn(
      `[dev-guard] process scan unavailable; skipping stale wrangler cleanup: ${toErrorMessage(error)}`
    );
    return [];
  }
}

function startTurboDev(extraArgs, runSupervisor, options = {}) {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const turboArgs = buildTurboDevArgs(extraArgs, {
    defaultConcurrency: deriveDefaultTurboConcurrency({ repoRoot }),
    taskName: options.taskName,
  });
  const child = spawn(pnpmCommand, turboArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });

  process.on("SIGINT", () => {
    child.kill("SIGINT");
  });
  process.on("SIGTERM", () => {
    child.kill("SIGTERM");
  });

  child.on("exit", (code, signal) => {
    releaseLock();
    process.exit(runSupervisor.resolveExitCode({ code, signal }));
  });

  child.on("error", (error) => {
    releaseLock();
    console.error(
      `[dev-guard] failed to start turbo: ${toErrorMessage(error)}`
    );
    process.exit(1);
  });

  return child;
}

function normalizeTurboArgs(extraArgs) {
  if (extraArgs[0] === "--") {
    return extraArgs.slice(1);
  }
  return extraArgs;
}

export function classifyDevEntryArgs(extraArgs) {
  const normalizedArgs = normalizeTurboArgs(extraArgs);
  const firstUnsupportedArg = findFirstUnsupportedDevArg(normalizedArgs);

  if (firstUnsupportedArg) {
    return {
      kind: "nonstandard",
      normalizedArgs,
      firstUnsupportedArg,
    };
  }

  return {
    kind: "standard",
    normalizedArgs,
    firstUnsupportedArg: null,
  };
}

export function buildTurboDevArgs(extraArgs, options = {}) {
  const normalizedArgs = normalizeTurboArgs(extraArgs);
  const taskName = options.taskName ?? "dev";
  if (taskName !== "dev" && taskName !== "dev:isolated") {
    throw new Error(`unsupported root dev task: ${taskName}`);
  }
  const turboArgs = ["turbo", "run", taskName, ...ROOT_DEV_TURBO_FILTERS];
  if (!hasExplicitConcurrencyArg(normalizedArgs)) {
    const defaultConcurrency = resolveDefaultConcurrency(options);
    turboArgs.push(`--concurrency=${String(defaultConcurrency)}`);
  }
  return [...turboArgs, ...normalizedArgs];
}

export function deriveDefaultTurboConcurrency(options = {}) {
  const targetRepoRoot = resolve(String(options.repoRoot ?? repoRoot));
  return Math.max(countRootDevLanePackages(targetRepoRoot) + 2, 2);
}

export function hasExplicitConcurrencyArg(args) {
  return normalizeTurboArgs(args).some((arg, index, list) => {
    if (arg === "--concurrency") {
      const next = list[index + 1];
      return typeof next === "string" && next.trim().length > 0;
    }
    return arg.startsWith("--concurrency=");
  });
}

function resolveDefaultConcurrency(options) {
  const value = Number.parseInt(String(options.defaultConcurrency ?? ""), 10);
  if (!Number.isFinite(value) || value < 2) {
    throw new Error("default dev concurrency must be a finite integer >= 2");
  }
  return value;
}

function countRootDevLanePackages(targetRepoRoot) {
  let packageCount = 0;

  for (const workspaceDir of ROOT_DEV_WORKSPACE_DIRS) {
    const absoluteWorkspaceDir = join(targetRepoRoot, workspaceDir);
    for (const packageJsonPath of walkPackageJsonPaths(absoluteWorkspaceDir)) {
      const manifest = readPackageManifest(packageJsonPath);
      if (!hasDevScript(manifest.scripts)) {
        continue;
      }
      if (ROOT_DEV_EXCLUDED_PACKAGE_NAMES.has(String(manifest.name ?? ""))) {
        continue;
      }
      packageCount += 1;
    }
  }

  return packageCount;
}

function* walkPackageJsonPaths(rootDirectory) {
  try {
    const entries = readdirSync(rootDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }

      const fullPath = join(rootDirectory, entry.name);
      if (entry.isDirectory()) {
        yield* walkPackageJsonPaths(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === "package.json") {
        yield fullPath;
      }
    }
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return;
    }
    throw error;
  }
}

function readPackageManifest(packageJsonPath) {
  const raw = readFileSync(packageJsonPath, "utf8");
  return JSON.parse(raw);
}

function hasDevScript(scripts) {
  return Boolean(
    scripts &&
      typeof scripts === "object" &&
      typeof scripts.dev === "string" &&
      scripts.dev.trim().length > 0
  );
}

function isMissingDirectoryError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function registerProcessCleanupHooks() {
  process.on("exit", () => {
    releaseLock();
  });

  process.on("uncaughtException", (error) => {
    releaseLock();
    console.error(`[dev-guard] uncaught exception: ${toErrorMessage(error)}`);
    process.exit(1);
  });

  process.on("unhandledRejection", (error) => {
    releaseLock();
    console.error(`[dev-guard] unhandled rejection: ${toErrorMessage(error)}`);
    process.exit(1);
  });
}

function releaseLock() {
  if (!lockHeld) {
    return;
  }
  lockHeld = false;
  rmSync(lockFile, { force: true });
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function safeKill(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {
    // Ignore cleanup errors for already-dead processes.
  }
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isAlreadyExistsError(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function printHelp() {
  console.log("OpenMeld dev guard");
  console.log("");
  console.log("Recommended shared Doppler workflow:");
  console.log("  pnpm dev:doctor");
  console.log("  pnpm dev:worktree");
  console.log(
    "  pnpm dev:web:worktree  # Start in a second terminal after the Worker stack is ready"
  );
  console.log(
    "  pnpm dev:worktree:sandbox  # Use only for Remote Agent Sandbox tools; Docker is required"
  );
  console.log("  pnpm dev:stop");
  console.log("");
  console.log("Advanced and legacy commands:");
  console.log("  pnpm dev");
  console.log("  pnpm dev -- --concurrency=<n>");
  console.log("  pnpm dev:isolated");
  console.log("  pnpm dev:raw -- --filter=<package>");
  console.log("  pnpm dev:web  # Start clients/web in a separate terminal");
  console.log(
    "  pnpm dev:web:isolated  # Attach clients/web to this worktree's isolated stack"
  );
  console.log(
    "  pnpm dev:desktop  # Start OpenMeld Desktop in a separate terminal"
  );
  console.log("");
  console.log("Behavior:");
  console.log("  - pnpm dev is the standard full-stack local startup entry");
  console.log(
    "  - Root dev excludes openmeld-web, standalone Core, and OpenMeld Desktop"
  );
  console.log(
    "  - Auth dev starts Auth and Core in one Wrangler process so one Miniflare instance owns shared local D1 state"
  );
  console.log(
    "  - Only standard turbo scheduling flags are allowed with pnpm dev"
  );
  console.log(
    "  - Use pnpm dev:raw for partial or filtered dev runs that bypass full-stack guardrails"
  );
  console.log(
    "  - Root dev blocks before Turbo when another worktree owns a required inspector port"
  );
  console.log(
    "  - pnpm dev:isolated reserves worktree-specific ports, Wrangler state, service discovery, and OPENMELD_HOME"
  );
  console.log(
    "  - pnpm dev:worktree is the preferred wrapper: it checks Doppler and starts the Docker-free isolated lane"
  );
  console.log(
    "  - pnpm dev:worktree:sandbox uses the same Doppler environment with Remote Agent Sandbox tools enabled"
  );
  console.log(
    "  - clients/web and OpenMeld Desktop dev are managed independently"
  );
  console.log("");
  console.log("Environment:");
  console.log(
    "  OPENMELD_DEV_GUARD_SKIP_CLEANUP=1    Skip stale wrangler dev session and debug log cleanup"
  );
  console.log(
    "  OPENMELD_DEV_STACK_TIMEOUT_MS=<ms>    Override full-stack readiness timeout"
  );
}

function isDirectExecution() {
  return process.argv[1] ? resolve(process.argv[1]) === scriptPath : false;
}

export function selectStaleWranglerDevPids(rows, options = {}) {
  const { currentPid = process.pid, matcherContext = processMatcherContext } =
    options;

  return rows
    .filter((row) => row.pid !== currentPid)
    .filter((row) =>
      matchesStaleDevWorker({
        matcherContext,
        normalizedCommand: normalizeProcessMatchText(row.command),
      })
    )
    .map((row) => row.pid);
}

export function createDevGuardRunSupervisor() {
  let verificationFailed = false;

  return {
    markVerificationFailed() {
      verificationFailed = true;
    },
    resolveExitCode(input) {
      if (verificationFailed || input.signal) {
        return 1;
      }
      return input.code ?? 0;
    },
  };
}

export function shouldVerifySharedDbPrerequisites(extraArgs) {
  return shouldVerifyLocalDevStack(extraArgs);
}

export function verifySharedDbPrerequisites(extraArgs, options = {}) {
  return ensureSharedDbReady(extraArgs, options);
}

export async function ensureSharedDbReady(extraArgs, options = {}) {
  if (!shouldVerifySharedDbPrerequisites(extraArgs)) {
    return;
  }

  const runCommandWithStatusFn =
    options.runCommandWithStatusFn ?? runPnpmCommandWithStatus;
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? Math.trunc(options.timeoutMs)
      : SHARED_DB_PREFLIGHT_TIMEOUT_MS;

  const initialCheck = await runSharedDbCommand({
    args: ["db:check"],
    cwd: repoRoot,
    expectedCommand: "db:check",
    runCommandWithStatusFn,
    timeoutMs,
    timeoutMessage: "full-stack dev requires the shared OPENMELD_DB gate",
  });

  if (initialCheck.summary.result === DB_CHECK_RESULT_BLOCKED) {
    throw buildSharedDbBlockedError(initialCheck.summary.blockedReason);
  }

  if (initialCheck.summary.result !== DB_CHECK_RESULT_NO_DIFF) {
    console.log(
      "[dev-guard] Shared OPENMELD_DB drift detected; applying local migrations..."
    );
    await applySharedDbMigrations({
      runCommandWithStatusFn,
      timeoutMs,
    });

    const postMigrateCheck = await runSharedDbCommand({
      args: ["db:check"],
      cwd: repoRoot,
      expectedCommand: "db:check",
      runCommandWithStatusFn,
      timeoutMs,
      timeoutMessage:
        "full-stack dev requires the shared OPENMELD_DB gate after local migrations",
    });

    if (postMigrateCheck.summary.result === DB_CHECK_RESULT_BLOCKED) {
      throw buildSharedDbBlockedError(postMigrateCheck.summary.blockedReason);
    }
    if (postMigrateCheck.summary.result !== DB_CHECK_RESULT_NO_DIFF) {
      throw new Error(
        "Shared OPENMELD_DB migration drift remains after local migrations. Run `pnpm db:check` and resolve the remaining drift before retrying `pnpm dev`."
      );
    }
  }

  const physicalVerify = await verifyAppliedSharedDbMigrations({
    runCommandWithStatusFn,
    timeoutMs,
  });
  if (physicalVerify.summary.result === DB_CHECK_RESULT_NO_DIFF) {
    console.log("[dev-guard] Shared OPENMELD_DB ready.");
    return;
  }
  if (physicalVerify.summary.result === DB_CHECK_RESULT_BLOCKED) {
    throw buildSharedDbBlockedError(physicalVerify.summary.blockedReason);
  }

  console.log(
    "[dev-guard] Local OPENMELD_DB is behind the committed migration history; applying pending migrations..."
  );
  await applySharedDbMigrations({
    runCommandWithStatusFn,
    timeoutMs,
  });

  const postMigrateVerify = await verifyAppliedSharedDbMigrations({
    runCommandWithStatusFn,
    timeoutMs,
  });
  if (postMigrateVerify.summary.result === DB_CHECK_RESULT_NO_DIFF) {
    console.log("[dev-guard] Shared OPENMELD_DB ready.");
    return;
  }
  if (postMigrateVerify.summary.result === DB_CHECK_RESULT_BLOCKED) {
    throw buildSharedDbBlockedError(postMigrateVerify.summary.blockedReason);
  }

  throw new Error(
    "Local OPENMELD_DB is still behind the committed migration history after applying migrations. Run `pnpm db:verify:dev` and resolve the reported drift before retrying `pnpm dev`."
  );
}

async function applySharedDbMigrations(input) {
  const migrateResult = await runSharedDbCommand({
    args: ["db:migrate:dev"],
    cwd: repoRoot,
    expectedCommand: "db:migrate:dev",
    runCommandWithStatusFn: input.runCommandWithStatusFn,
    timeoutMs: input.timeoutMs,
    timeoutMessage:
      "full-stack dev requires local shared OPENMELD_DB migrations before startup",
  });

  if (migrateResult.summary.result !== DB_MIGRATE_RESULT_APPLIED) {
    throw buildSharedDbBlockedError(migrateResult.summary.blockedReason);
  }
}

function verifyAppliedSharedDbMigrations(input) {
  return runSharedDbCommand({
    args: ["db:verify:dev"],
    cwd: repoRoot,
    expectedCommand: "db:verify:dev",
    runCommandWithStatusFn: input.runCommandWithStatusFn,
    timeoutMs: input.timeoutMs,
    timeoutMessage:
      "full-stack dev requires the applied local OPENMELD_DB migrations to match committed migration history",
  });
}

async function verifyLocalDevStackOrExit(child, runSupervisor, options = {}) {
  try {
    const readiness = await waitForLocalDevStackReady({
      authBaseUrl: options.isolatedDev
        ? process.env.OPENMELD_AUTH_URL
        : undefined,
      gatewayBaseUrl: options.isolatedDev
        ? process.env.OPENMELD_GATEWAY_URL
        : undefined,
      logger: console,
      restartCommand: resolveDevStackRestartCommand(options.isolatedDev),
    });
    console.log(
      `[dev-guard] local OpenMeld dev stack ready: ${readiness.summary}`
    );
  } catch (error) {
    console.error(`[dev-guard] ${toErrorMessage(error)}`);
    runSupervisor.markVerificationFailed();
    child.kill("SIGTERM");
  }
}

export function resolveDevStackRestartCommand(isolatedDev, env = process.env) {
  if (!isolatedDev) {
    return undefined;
  }
  if (
    env[DEVELOPMENT_ENVIRONMENT_SOURCE_VARIABLE] !==
    DOPPLER_DEVELOPMENT_ENVIRONMENT_SOURCE
  ) {
    return "pnpm dev:isolated";
  }
  return env.OPENMELD_DEV_REMOTE_AGENT_SANDBOX_ENABLED === "true"
    ? "pnpm dev:worktree:sandbox"
    : "pnpm dev:worktree";
}

function shouldVerifyLocalDevStack(extraArgs) {
  return classifyDevEntryArgs(extraArgs).kind === "standard";
}

function matchesStaleDevWorker(input) {
  return (
    isWranglerDevCommand(input.normalizedCommand, input.matcherContext) ||
    isWranglerWorkerdCommand(input.normalizedCommand, input.matcherContext)
  );
}

function runPnpmCommandWithStatus(args, options = {}) {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  return new Promise((resolvePromise, reject) => {
    const child = spawn(pnpmCommand, args, {
      cwd: options.cwd ?? repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolvePromise({
        stdout,
        stderr,
        status: code,
        signal,
      });
    });
  });
}

function formatPnpmCommandFailure(result) {
  return `command failed (${result.signal ?? result.status ?? "unknown"}): ${[
    result.stdout.trim(),
    result.stderr.trim(),
  ]
    .filter((value) => value.length > 0)
    .join(" | ")}`;
}

function findFirstUnsupportedDevArg(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!isStandardDevTurboArg(arg)) {
      return arg;
    }
    if (
      STANDARD_DEV_TURBO_FLAGS.has(arg) &&
      index + 1 < args.length &&
      !args[index + 1].startsWith("-")
    ) {
      index += 1;
    }
  }

  return null;
}

function isStandardDevTurboArg(arg) {
  if (!arg.startsWith("-")) {
    return false;
  }

  if (arg === "--filter" || arg.startsWith("--filter=")) {
    return false;
  }

  if (STANDARD_DEV_TURBO_FLAGS.has(arg)) {
    return true;
  }

  const [flagName] = arg.split("=", 1);
  return STANDARD_DEV_TURBO_FLAGS.has(flagName);
}

function assertSupportedFullStackDevArgs(extraArgs) {
  const classification = classifyDevEntryArgs(extraArgs);
  if (classification.kind === "standard") {
    return;
  }

  throw new Error(
    `\`pnpm dev\` only supports full-stack startup plus standard turbo scheduling flags. Unsupported argument: \`${classification.firstUnsupportedArg}\`. Use \`pnpm dev:raw -- ${classification.normalizedArgs.join(" ")}\` for partial or filtered dev runs.`
  );
}

async function runSharedDbCommand(input) {
  const result = await withTimeout(
    input.runCommandWithStatusFn(input.args, {
      cwd: input.cwd,
    }),
    input.timeoutMs,
    input.timeoutMessage
  );

  return {
    rawResult: result,
    summary: parseDbCommandFactSummary(result, input.expectedCommand),
  };
}

function parseDbCommandFactSummary(result, expectedCommand) {
  const candidate = findLastJsonObjectLine(
    `${result.stdout}\n${result.stderr}`
  );
  if (!candidate) {
    throw new Error(
      `shared OPENMELD_DB gate returned invalid ${expectedCommand} output: ${formatPnpmCommandFailure(result)}`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new Error(
      `shared OPENMELD_DB gate returned malformed ${expectedCommand} JSON: ${toErrorMessage(error)}`
    );
  }

  if (!isDbCommandFactSummary(parsed, expectedCommand)) {
    throw new Error(
      `shared OPENMELD_DB gate returned invalid ${expectedCommand} summary shape.`
    );
  }

  return parsed;
}

function findLastJsonObjectLine(raw) {
  const lines = raw
    .split(NEWLINE_SPLIT_REGEX)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = extractJsonObjectCandidate(lines[index]);
    if (!candidate) {
      continue;
    }
    return candidate;
  }

  return null;
}

function extractJsonObjectCandidate(line) {
  if (JSON_OBJECT_LINE_REGEX.test(line)) {
    return line;
  }

  const objectStart = line.indexOf("{");
  const objectEnd = line.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) {
    return null;
  }

  const candidate = line.slice(objectStart, objectEnd + 1);
  return JSON_OBJECT_LINE_REGEX.test(candidate) ? candidate : null;
}

function isDbCommandFactSummary(value, expectedCommand) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.command === expectedCommand &&
      typeof value.cwd === "string" &&
      typeof value.phase === "string" &&
      typeof value.subject === "string" &&
      typeof value.result === "string" &&
      [
        DB_CHECK_RESULT_NO_DIFF,
        DB_CHECK_RESULT_DIFF_DETECTED,
        DB_CHECK_RESULT_BLOCKED,
        DB_MIGRATE_RESULT_APPLIED,
      ].includes(value.result) &&
      ("blockedReason" in value
        ? value.blockedReason === null ||
          typeof value.blockedReason === "string"
        : false)
  );
}

function buildSharedDbBlockedError(blockedReason) {
  const normalizedBlockedReason =
    typeof blockedReason === "string" && blockedReason.trim().length > 0
      ? blockedReason.trim()
      : "unknown shared OPENMELD_DB blocker";

  if (SQLITE_LOCKED_REGEX.test(normalizedBlockedReason)) {
    return new Error(
      `Shared OPENMELD_DB is blocked: ${normalizedBlockedReason}. Run \`pnpm dev:stop\` and retry \`pnpm dev\`.`
    );
  }

  return new Error(
    `Shared OPENMELD_DB is blocked: ${normalizedBlockedReason}. Resolve the shared OPENMELD_DB blocker, then retry \`pnpm dev\`.`
  );
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${message} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
