#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";

import { buildOpenMeldCanaryDefaultEnv } from "./openmeld-canary.mjs";

const PRODUCTION_GATEWAY_URL = "https://gateway.openmeld.ai";
const LINE_SPLIT_RE = /\r?\n/u;
const SIGN_IN_BLOCKER_RE = /sign in|log in|login|authentication required/i;

if (isDirectExecution()) {
  runCanaryServiceVerification({
    options: parseCliOptions(process.argv.slice(2), process.env),
  }).catch((error) => {
    process.stderr.write(`${toErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}

export function parseCliOptions(argv, env = process.env) {
  const args = normalizeArgs(argv);
  const remote = args.includes("--remote");
  const cleanup = args.includes("--cleanup");
  const help = args.includes("--help") || args.includes("-h");

  if (help) {
    return { mode: "help" };
  }
  if (cleanup && remote) {
    throw new Error("--cleanup cannot be combined with --remote");
  }
  if (cleanup) {
    return { mode: "cleanup" };
  }
  if (!remote) {
    const target = buildLocalCanaryVerificationTarget();
    return {
      mode: "local",
      gatewayUrl: target.gatewayUrl,
      authBaseUrl: target.authBaseUrl,
    };
  }

  const gatewayUrl = normalizeOptionalText(env.OPENMELD_GATEWAY_URL);
  const authBaseUrl = normalizeOptionalText(env.OPENMELD_AUTH_URL);
  if (!(gatewayUrl && authBaseUrl)) {
    throw new Error(
      "--remote requires OPENMELD_GATEWAY_URL and OPENMELD_AUTH_URL. Use matching Gateway/Auth URLs for the same OpenMeld environment."
    );
  }
  return {
    mode: "remote",
    gatewayUrl,
    authBaseUrl,
  };
}

export async function runCanaryServiceVerification(input) {
  const { options } = input;
  const commandRunner = input.commandRunner ?? runCommandCaptureWithSpawn;
  if (options.mode === "help") {
    printHelp();
    return;
  }
  if (options.mode === "cleanup") {
    await runCanaryCleanup(commandRunner);
    return;
  }

  const env = buildCanaryCommandEnv({
    gatewayUrl: options.gatewayUrl,
    authBaseUrl: options.authBaseUrl,
  });
  const expectedTarget = {
    preset: "canary",
    gatewayUrl: options.gatewayUrl,
    authBaseUrl: options.authBaseUrl,
    userFacingCommand: "openmeld-canary",
  };

  console.log(
    "[openmeld-canary-verify] installing current packaged candidate..."
  );
  await runCommand(commandRunner, "pnpm", ["run", "openmeld:canary:install"], {
    env,
  });

  console.log(
    "[openmeld-canary-verify] clearing existing canary OpenMeld Service..."
  );
  await runCommand(
    commandRunner,
    "openmeld-canary",
    ["service", "stop", "--view", "agent"],
    {
      env,
      allowFailure: true,
    }
  );

  if (options.mode === "remote") {
    const authStatus = await commandRunner(
      "openmeld-canary",
      ["auth", "status", "--view", "human"],
      { env }
    );
    if (authStatus.stdout.includes("Wrong OpenMeld Environment")) {
      throw new Error(
        "remote smoke selected a Gateway/Auth pair that does not match the active sign-in"
      );
    }
    if (
      looksLikeSignInBlocker(authStatus.stdout) ||
      authStatus.exitCode !== 0
    ) {
      console.log(
        "[openmeld-canary-verify] remote smoke is blocked by sign-in for the selected OpenMeld environment."
      );
      console.log(authStatus.stdout.trim());
      return;
    }
  }

  console.log("[openmeld-canary-verify] refreshing OpenMeld Service...");
  await runCommand(
    commandRunner,
    "openmeld-canary",
    ["service", "reinstall", "--view", "human"],
    {
      env,
    }
  );

  console.log("[openmeld-canary-verify] starting managed OpenMeld Service...");
  await runCommand(
    commandRunner,
    "openmeld-canary",
    ["service", "run", "--view", "agent"],
    {
      env,
    }
  );

  let pendingError = null;
  try {
    console.log(
      "[openmeld-canary-verify] checking managed OpenMeld Service status..."
    );
    const status = await commandRunner(
      "openmeld-canary",
      ["service", "status", "--view", "agent"],
      { env }
    );
    const statusPayload = findAgentPayload({
      stdout: status.stdout,
      code: "daemon.status.result",
    });
    assertCanaryServiceStatusPayload({
      payload: statusPayload,
      expectedTarget,
      platform: process.platform,
    });

    if (options.mode === "local") {
      console.log(
        "[openmeld-canary-verify] checking explicit environment mismatch..."
      );
      await assertLocalMismatchFailsFast(commandRunner);
    }
  } catch (error) {
    pendingError = error;
  }

  console.log("[openmeld-canary-verify] stopping managed OpenMeld Service...");
  await runCommand(
    commandRunner,
    "openmeld-canary",
    ["service", "stop", "--view", "agent"],
    {
      env,
      allowFailure: pendingError !== null,
    }
  );
  if (pendingError) {
    throw pendingError;
  }
  console.log(
    "[openmeld-canary-verify] packaged canary Service validation passed."
  );
}

export function buildLocalCanaryVerificationTarget() {
  const defaultEnv = buildOpenMeldCanaryDefaultEnv();
  return {
    preset: "canary",
    gatewayUrl: defaultEnv.OPENMELD_GATEWAY_URL,
    authBaseUrl: defaultEnv.OPENMELD_AUTH_URL,
    userFacingCommand: "openmeld-canary",
  };
}

export function parseAgentJsonLines(stdout) {
  return String(stdout)
    .split(LINE_SPLIT_RE)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === "object" ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

export function assertCanaryServiceStatusPayload(input) {
  const { expectedTarget, payload, platform } = input;
  assertObject(payload, "daemon.status.result payload");

  const environmentTarget = payload.environmentTarget;
  assertObject(environmentTarget, "missing environmentTarget");
  assertEqualField(environmentTarget, "preset", expectedTarget.preset);
  assertEqualField(environmentTarget, "gatewayUrl", expectedTarget.gatewayUrl);
  assertEqualField(
    environmentTarget,
    "authBaseUrl",
    expectedTarget.authBaseUrl
  );
  assertEqualField(
    environmentTarget,
    "userFacingCommand",
    expectedTarget.userFacingCommand
  );

  const runtime = payload.runtime;
  assertObject(runtime, "missing runtime status");
  assertEqualField(runtime, "managedBySystemService", true);
  if (platform === "darwin") {
    assertEqualField(runtime, "serviceController", "launchd");
  } else if (
    runtime.serviceController !== "launchd" &&
    runtime.serviceController !== "windows-service"
  ) {
    throw new Error(
      `unexpected serviceController: ${String(runtime.serviceController)}`
    );
  }

  const anomalies = payload.inventory?.anomalies ?? [];
  if (!Array.isArray(anomalies)) {
    throw new Error("inventory.anomalies must be an array");
  }
  if (anomalies.length > 0) {
    throw new Error(`Service anomalies present: ${JSON.stringify(anomalies)}`);
  }
}

function findAgentPayload(input) {
  const entries = parseAgentJsonLines(input.stdout);
  const entry = entries.find((candidate) => candidate.code === input.code);
  if (!entry) {
    throw new Error(`missing Agent View payload ${input.code}`);
  }
  return entry.payload;
}

async function assertLocalMismatchFailsFast(commandRunner) {
  const localTarget = buildLocalCanaryVerificationTarget();
  const env = buildCanaryCommandEnv({
    gatewayUrl: PRODUCTION_GATEWAY_URL,
    authBaseUrl: localTarget.authBaseUrl,
  });
  const humanResult = await commandRunner(
    "openmeld-canary",
    ["auth", "status", "--view", "human"],
    { env }
  );
  const agentResult = await commandRunner(
    "openmeld-canary",
    ["auth", "status", "--view", "agent"],
    { env }
  );
  const combinedOutput = [
    humanResult.stdout,
    humanResult.stderr,
    agentResult.stdout,
    agentResult.stderr,
  ].join("\n");
  if (
    humanResult.exitCode === 0 ||
    agentResult.exitCode === 0 ||
    !combinedOutput.includes("Wrong OpenMeld Environment") ||
    !looksLikeEnvironmentMismatch(combinedOutput)
  ) {
    throw new Error(
      "expected explicit Gateway/Auth mismatch to fail fast with non-zero exit as Wrong OpenMeld Environment"
    );
  }
}

async function runCanaryCleanup(commandRunner) {
  const target = buildLocalCanaryVerificationTarget();
  const env = buildCanaryCommandEnv(target);
  console.log("[openmeld-canary-verify] stopping canary OpenMeld Service...");
  await runCommand(
    commandRunner,
    "openmeld-canary",
    ["service", "stop", "--view", "agent"],
    {
      env,
      allowFailure: true,
    }
  );
  console.log("[openmeld-canary-verify] current canary status:");
  await runCommand(
    commandRunner,
    "openmeld-canary",
    ["service", "status", "--view", "human"],
    {
      env,
      allowFailure: true,
    }
  );
  console.log(
    "[openmeld-canary-verify] Optional cleanup: run `pnpm openmeld:canary:remove` to remove the canary wrapper and packed artifact, or `openmeld-canary repair local-state` to repair only the canary lane."
  );
}

function buildCanaryCommandEnv(input) {
  return {
    ...process.env,
    OPENMELD_ENV_PRESET: "canary",
    OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-canary",
    OPENMELD_GATEWAY_URL: input.gatewayUrl,
    OPENMELD_AUTH_URL: input.authBaseUrl,
  };
}

async function runCommand(commandRunner, command, args, options = {}) {
  const result = await commandRunner(command, args, options);
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.exitCode !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${String(result.exitCode)}`
    );
  }
}

function runCommandCaptureWithSpawn(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      rejectPromise(error);
    });
    child.on("exit", (code) => {
      resolvePromise({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });
  });
}

function looksLikeSignInBlocker(stdout) {
  return SIGN_IN_BLOCKER_RE.test(String(stdout));
}

export function looksLikeEnvironmentMismatch(output) {
  const text = String(output);
  return (
    text.includes("Wrong OpenMeld Environment") ||
    text.includes('"guidanceReason":"mismatch"') ||
    text.includes('"state":"mismatch"')
  );
}

function normalizeArgs(argv) {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

function normalizeOptionalText(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label);
  }
}

function assertEqualField(object, field, expected) {
  if (object[field] !== expected) {
    throw new Error(
      `${field} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(object[field])}`
    );
  }
}

function printHelp() {
  console.log(`Usage:
  pnpm run openmeld:canary:verify-service
  pnpm run openmeld:canary:verify-service -- --remote
  pnpm run openmeld:canary:verify-service -- --cleanup

Default mode validates the current packaged canary against the local dev stack.
Remote mode requires explicit OPENMELD_GATEWAY_URL and OPENMELD_AUTH_URL for the same OpenMeld environment.
Cleanup mode stops the canary service and prints lane-scoped cleanup guidance.`);
}

function toErrorMessage(error) {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

function isDirectExecution() {
  return import.meta.url === `file://${process.argv[1]}`;
}
