import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildStagingSmokeSetupArgs,
  STAGING_AUTH_URL,
  STAGING_GATEWAY_URL,
  STAGING_MANIFEST_URL,
  STAGING_ORIGIN,
} from "./staging-computer-update-smoke-contract.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
export const CANARY_HOME = path.join(homedir(), ".openmeld-canary");
const CANARY_CLI = path.join(CANARY_HOME, "bin", "openmeld");
const CANARY_SERVICE_LABEL = "com.openmeld.openmeld-background-service.canary";
const CANARY_UPDATE_LABEL = "com.openmeld.openmeld-service-update.canary";
const UPDATE_STATE_ROOT = path.join(CANARY_HOME, "runtime", "daemon", "state");
const API_HELPER = path.join(
  SCRIPT_DIR,
  "staging-computer-update-smoke-api.mjs"
);
const STAGING_VERSION_PATTERN = /^\d+\.\d+\.\d+-staging\./u;

export function assertLiveSmokeHost() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error(
      "Live Staging Computer smoke currently requires Apple silicon macOS."
    );
  }
}

export function assertGitWorktreeClean() {
  const result = spawnSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );
  if (result.status !== 0 || String(result.stdout).trim()) {
    throw new Error(
      "Commit the Staging smoke changes before running the live update."
    );
  }
}

export function assertCanaryLaunchdLabelsFree() {
  for (const label of [CANARY_SERVICE_LABEL, CANARY_UPDATE_LABEL]) {
    const result = spawnSync(
      "launchctl",
      ["print", `gui/${String(process.getuid())}/${label}`],
      { encoding: "utf8" }
    );
    if (result.status === 0) {
      throw new Error(
        `${label} is already running. Stop the existing Canary task before this smoke.`
      );
    }
  }
}

export async function readProtectedSetupCommand(filePath) {
  const resolved = path.resolve(filePath);
  const fileStat = await stat(resolved);
  const permissions = fileStat.mode.toString(8).slice(-3);
  if (!(fileStat.isFile() && permissions === "600")) {
    throw new Error(
      "The one-time setup command file must be a private file with mode 600."
    );
  }
  return await readFile(resolved, "utf8");
}

export async function preserveCanaryHome(backupHome) {
  const existing = await stat(CANARY_HOME).catch((error) => {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (!existing) {
    return false;
  }
  await rename(CANARY_HOME, backupHome);
  return true;
}

export function runFocusedUpdateContracts(input) {
  runCommand({
    args: [
      "--filter",
      "openmeld",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.config.ts",
      "--maxWorkers=1",
      "tests/openmeld-tools-update-coordinator.test.ts",
      "tests/daemon-service-update-coordinator.test.ts",
      "tests/daemon-service-update-worker-manager.test.ts",
      "tests/local-service-dispatch-result-outbox.test.ts",
    ],
    command: "pnpm",
    label: "verify update coordination, recovery, and result acknowledgement",
    sensitiveValues: input.sensitiveValues,
    timeoutMs: 5 * 60 * 1000,
  });
  runCommand({
    args: [
      "--filter",
      "openmeld",
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.integration.config.ts",
      "--maxWorkers=1",
      "tests/local-service-run-catalog-signal.integration.test.ts",
    ],
    command: "pnpm",
    label: "verify result acknowledgement before controlled drain",
    sensitiveValues: input.sensitiveValues,
    timeoutMs: 5 * 60 * 1000,
  });
}

export async function readStagingManifest() {
  const response = await fetch(STAGING_MANIFEST_URL, {
    headers: { "user-agent": "openmeld-staging-computer-smoke" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(
      `Staging CLI manifest returned HTTP ${String(response.status)}.`
    );
  }
  const manifest = await response.json();
  const version = String(manifest?.channels?.stable?.version ?? "").trim();
  const release = manifest?.channels?.stable?.platforms?.["darwin-arm64"];
  const artifactUrls = [release?.url, release?.archiveUrl];
  if (
    !STAGING_VERSION_PATTERN.test(version) ||
    artifactUrls.some(
      (url) =>
        typeof url !== "string" ||
        !url.startsWith(`${STAGING_ORIGIN}/cli/download/`)
    )
  ) {
    throw new Error("Staging CLI manifest points outside the Staging channel.");
  }
  return { version };
}

export async function waitForNewStagingManifest(previousVersion) {
  return await waitForValue({
    label: "new Staging CLI manifest",
    timeoutMs: 60_000,
    read: readStagingManifest,
    accept: (manifest) => manifest.version !== previousVersion,
  });
}

export async function runStagingSetup(input) {
  const response = await fetch(input.parsedSetup.setupUrl, {
    headers: { "user-agent": "openmeld-staging-computer-smoke" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Staging Setup returned HTTP ${String(response.status)}.`);
  }
  const scriptPath = path.join(input.runRoot, "setup.sh");
  await writeFile(scriptPath, await response.text(), {
    encoding: "utf8",
    mode: 0o700,
  });
  runCommand({
    args: [scriptPath, ...buildStagingSmokeSetupArgs(input.parsedSetup)],
    command: "sh",
    env: stagingCanaryEnv(),
    label: "connect an isolated Canary Computer",
    sensitiveValues: input.sensitiveValues,
    timeoutMs: 10 * 60 * 1000,
  });
}

export function restartCanaryService(input) {
  runCanaryCli({
    args: ["service", "stop", "--view", "agent"],
    label: "stop Canary Service before automatic update check",
    sensitiveValues: input.sensitiveValues,
  });
  runCanaryCli({
    args: ["service", "start", "--view", "agent"],
    label: "restart Canary Service for automatic update check",
    sensitiveValues: input.sensitiveValues,
    timeoutMs: 2 * 60 * 1000,
  });
}

export function assertCliVersion(input) {
  const result = runCanaryCli({
    args: ["--version"],
    label: "read Canary CLI version",
    sensitiveValues: input.sensitiveValues,
  });
  if (result.stdout.trim() !== input.expectedVersion) {
    throw new Error(
      `Canary CLI is ${result.stdout.trim()}, expected ${input.expectedVersion}.`
    );
  }
}

export async function waitForServiceRunning(input) {
  await waitForValue({
    label: `Canary Service ${input.expectedVersion}`,
    timeoutMs: 2 * 60 * 1000,
    read: () => {
      const result = runCanaryCli({
        args: ["service", "status", "--json"],
        allowFailure: true,
        label: "read Canary Service status",
        sensitiveValues: input.sensitiveValues,
        timeoutMs: 30_000,
      });
      const payload = parseJsonEnvelope(result.stdout);
      return {
        runtimeStatus:
          payload?.payload?.runtime?.status ?? payload?.runtime?.status ?? null,
        serviceVersion:
          payload?.payload?.runtime?.serviceVersion ??
          payload?.payload?.environmentTarget?.currentVersion ??
          payload?.runtime?.serviceVersion ??
          null,
      };
    },
    accept: (status) =>
      status.runtimeStatus === "running" &&
      (!status.serviceVersion ||
        status.serviceVersion === input.expectedVersion),
  });
}

export async function waitForUpdateOperation(input) {
  return await waitForValue({
    label: "OpenMeld Tools update operation",
    timeoutMs: input.timeoutMs,
    read: readCurrentUpdateOperation,
    accept: (operation) => Boolean(operation && input.predicate(operation)),
  });
}

export async function waitForCoreToReportCurrentVersion(input) {
  await waitForValue({
    label: `Staging Core current version ${input.expectedVersion}`,
    timeoutMs: 2 * 60 * 1000,
    read: () =>
      runStagingApiHelper({
        command: "request-update",
        sensitiveValues: input.sensitiveValues,
      }),
    accept: (result) =>
      result.status === "current" &&
      result.currentVersion === input.expectedVersion,
  });
}

export function runStagingApiHelper(input) {
  const result = runCommand({
    args: [API_HELPER, input.command],
    command: "bun",
    env: stagingCanaryEnv(),
    label: `Staging API ${input.command}`,
    sensitiveValues: input.sensitiveValues,
    timeoutMs: 30_000,
  });
  const parsed = parseJsonEnvelope(result.stdout);
  if (!parsed) {
    throw new Error(`Staging API ${input.command} returned no JSON.`);
  }
  return parsed;
}

export function cleanupCanaryServices(input) {
  if (existsSync(CANARY_CLI)) {
    for (const args of [
      ["service", "stop", "--view", "agent"],
      ["service", "uninstall", "--view", "agent"],
    ]) {
      try {
        runCanaryCli({
          allowFailure: true,
          args,
          label: `cleanup ${args[1]} Canary Service`,
          sensitiveValues: input.sensitiveValues,
        });
      } catch (error) {
        input.cleanupFailures.push(error);
      }
    }
  }
  for (const label of [CANARY_SERVICE_LABEL, CANARY_UPDATE_LABEL]) {
    const result = spawnSync(
      "launchctl",
      ["bootout", `gui/${String(process.getuid())}/${label}`],
      { encoding: "utf8" }
    );
    if (result.error) {
      input.cleanupFailures.push(result.error);
    }
  }
}

export function runCommand(input) {
  const result = spawnSync(input.command, input.args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: input.env ?? process.env,
    maxBuffer: 20 * 1024 * 1024,
    timeout: input.timeoutMs ?? 60_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (!input.allowFailure && result.status !== 0) {
    const detail = sanitizeSensitiveText(
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
      input.sensitiveValues
    );
    throw new Error(
      `${input.label} failed with exit ${String(result.status)}${detail ? `:\n${detail}` : "."}`
    );
  }
  return result;
}

export function pass(label, detail) {
  process.stdout.write(
    `[staging-computer-smoke] PASS ${label}${detail ? `: ${detail}` : ""}\n`
  );
}

async function readCurrentUpdateOperation() {
  const candidates = [
    ["service-update.json", "service"],
    ["tools-update.json", "tools"],
    ["service-update-last.json", "service"],
    ["tools-update-last.json", "tools"],
  ];
  for (const [filename, kind] of candidates) {
    const state = await readJsonIfPresent(
      path.join(UPDATE_STATE_ROOT, filename)
    );
    if (!state) {
      continue;
    }
    if (kind === "service") {
      return {
        errorMessage: state.errorMessage ?? null,
        operationId: state.jobId,
        phase: state.phase,
        requestSource: state.requestSource,
        targetVersion: state.targetVersion,
      };
    }
    return {
      errorMessage: state.errorMessage ?? null,
      ...state.operation,
    };
  }
  return null;
}

async function readJsonIfPresent(filePath) {
  const raw = await readFile(filePath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  return raw === null ? null : JSON.parse(raw);
}

function runCanaryCli(input) {
  return runCommand({
    ...input,
    command: CANARY_CLI,
    env: stagingCanaryEnv(),
    timeoutMs: input.timeoutMs ?? 60_000,
  });
}

function stagingCanaryEnv() {
  return {
    ...process.env,
    OPENMELD_ACCEPT_DISCLAIMER: "1",
    OPENMELD_AUTH_URL: STAGING_AUTH_URL,
    OPENMELD_ENV_PRESET: "canary",
    OPENMELD_GATEWAY_URL: STAGING_GATEWAY_URL,
    OPENMELD_HOME: CANARY_HOME,
    OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-canary",
  };
}

async function waitForValue(input) {
  const deadline = Date.now() + input.timeoutMs;
  let lastValue = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      lastValue = await input.read();
      if (input.accept(lastValue)) {
        return lastValue;
      }
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `${input.label} did not become ready before timeout.${lastError ? ` ${String(lastError)}` : ""}${lastValue ? ` Last state: ${JSON.stringify(lastValue)}` : ""}`
  );
}

function parseJsonEnvelope(output) {
  for (const line of String(output).split("\n")) {
    const trimmed = line.trim();
    if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      return parsed?.payload ?? parsed;
    } catch {
      // Ignore non-JSON progress lines and keep looking for the JSON envelope.
    }
  }
  return null;
}

function sanitizeSensitiveText(value, sensitiveValues = []) {
  let sanitized = String(value ?? "").trim();
  for (const sensitiveValue of sensitiveValues) {
    sanitized = sanitized.replaceAll(sensitiveValue, "[redacted]");
  }
  return sanitized;
}
