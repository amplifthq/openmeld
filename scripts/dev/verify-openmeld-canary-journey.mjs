#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";
import { buildOpenMeldCanaryDefaultEnv } from "./openmeld-canary.mjs";
import {
  looksLikeEnvironmentMismatch,
  parseAgentJsonLines,
} from "./verify-openmeld-canary-service.mjs";

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const SIGN_IN_BLOCKER_RE = /sign in|log in|login|authentication required/i;

if (isDirectExecution()) {
  runCanaryJourneyVerification({
    options: parseCliOptions(process.argv.slice(2), process.env),
  }).catch((error) => {
    process.stderr.write(`${toErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}

export function parseCliOptions(argv, env = process.env) {
  const args = normalizeArgs(argv);
  if (args.includes("--help") || args.includes("-h")) {
    return { mode: "help" };
  }
  return {
    humanProfileId: readOptionValue(args, "--human-profile"),
    mode: "local",
    timeoutMs: parsePositiveInteger(
      readOptionValue(args, "--timeout-ms") ??
        env.OPENMELD_CANARY_JOURNEY_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS
    ),
  };
}

export async function runCanaryJourneyVerification(input) {
  const { options } = input;
  const commandRunner = input.commandRunner ?? runCommandCaptureWithSpawn;
  if (options.mode === "help") {
    printHelp();
    return;
  }

  const env = buildCanaryCommandEnv();
  const runId = Date.now().toString(36);
  const agentName = `canary-codex-${runId}`;
  const spaceName = `canary-space-${runId}`;
  const wakeToken = `OPENMELD_CANARY_WAKE_${runId}`;

  console.log(
    "[openmeld-canary-journey] installing current packaged candidate..."
  );
  await runCommand(commandRunner, "pnpm", ["run", "openmeld:canary:install"], {
    env,
  });

  console.log("[openmeld-canary-journey] checking canary sign-in...");
  await assertSignedIn(commandRunner, env);

  console.log("[openmeld-canary-journey] resolving Human Profile...");
  const humanProfileId =
    options.humanProfileId ??
    (await resolveSelectedHumanProfile(commandRunner, env));

  console.log(
    "[openmeld-canary-journey] refreshing and starting OpenMeld Service..."
  );
  await runCommand(
    commandRunner,
    "openmeld-canary",
    ["service", "reinstall", "--view", "human"],
    { env }
  );
  await runCommand(
    commandRunner,
    "openmeld-canary",
    ["service", "run", "--view", "agent"],
    { env }
  );

  let pendingError = null;
  try {
    console.log("[openmeld-canary-journey] creating Codex Agent Profile...");
    const agentProfileId = await createCodexAgentProfile({
      agentName,
      commandRunner,
      env,
    });

    console.log("[openmeld-canary-journey] creating Space...");
    const spaceId = await createSpace({
      commandRunner,
      env,
      humanProfileId,
      spaceName,
    });

    console.log("[openmeld-canary-journey] preparing Agent Profile...");
    const prepareEntries = parseAgentJsonLines(
      (
        await runCommand(
          commandRunner,
          "openmeld-canary",
          ["--view", "agent", "agents", "prepare", "--profile", agentProfileId],
          { env }
        )
      ).stdout
    );
    assertPrepareEvidence(prepareEntries);

    console.log("[openmeld-canary-journey] adding Agent Profile to Space...");
    await runCommand(
      commandRunner,
      "openmeld-canary",
      [
        "--view",
        "agent",
        "space",
        "add-members",
        spaceId,
        "--member",
        agentProfileId,
        "--profile",
        humanProfileId,
      ],
      { env }
    );

    console.log("[openmeld-canary-journey] sending Wake message...");
    const sendEntries = parseAgentJsonLines(
      (
        await runCommand(
          commandRunner,
          "openmeld-canary",
          [
            "--view",
            "agent",
            "space",
            "send",
            spaceId,
            `@${agentName}(wake) Reply with ${wakeToken}.`,
            "--profile",
            humanProfileId,
          ],
          { env }
        )
      ).stdout
    );
    const clientMessageId = extractClientMessageId(sendEntries);

    console.log(
      "[openmeld-canary-journey] waiting for execution authority and reply..."
    );
    await waitForTraceAndReply({
      agentProfileId,
      clientMessageId,
      commandRunner,
      env,
      humanProfileId,
      spaceId,
      timeoutMs: options.timeoutMs,
      wakeToken,
    });
  } catch (error) {
    pendingError = error;
  }

  console.log("[openmeld-canary-journey] stopping canary OpenMeld Service...");
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
    "[openmeld-canary-journey] packaged canary product journey passed."
  );
}

export function assertPrepareEvidence(entries) {
  const result = findEntry(entries, "agents.prepare.result");
  const payload = result?.payload ?? result?.data;
  assertObject(payload, "missing agents.prepare.result payload");
  assertEqualField(
    payload.runtimeReportSubmission,
    "status",
    "submitted",
    "runtime report was not submitted"
  );
  assertEqualField(
    payload.agentProfileBindingEnsure,
    "status",
    "accepted",
    "formal Agent Profile Binding was not accepted"
  );
}

export function assertTraceEvidence(payload) {
  assertObject(payload, "missing service.trace.result payload");
  if (JSON.stringify(payload).includes("binding_missing")) {
    throw new Error("trace still contains claim_eligibility.binding_missing");
  }
  assertEqualField(
    payload.trace?.dispatch,
    "status",
    "succeeded",
    "dispatch did not succeed"
  );
  const runtimeCoordinatorExecutionId =
    payload.trace?.runtimeCoordinatorExecution?.runtimeCoordinatorExecutionId ??
    payload.correlation?.runtimeCoordinatorExecutionId;
  if (!runtimeCoordinatorExecutionId) {
    throw new Error("RuntimeCoordinator execution was not found");
  }
  const runtimeCoordinatorStatus =
    payload.trace?.runtimeCoordinatorExecution?.status;
  if (
    ![
      "completed_local",
      "result_received",
      "result_accepted",
      "reply_published",
    ].includes(runtimeCoordinatorStatus)
  ) {
    throw new Error(
      "RuntimeCoordinator execution did not reach result handling"
    );
  }
  const exitCode = findDeepValue(payload.trace, ["exitCode"]);
  if (exitCode !== 0) {
    throw new Error("runtime execution did not complete with exit code 0");
  }
  const publishState = payload.trace?.resultInbox?.publishState;
  const finalVisibleStatus = payload.trace?.finalVisibleOutcome?.status;
  if (
    publishState !== "reply_published" &&
    finalVisibleStatus !== "visible_reply"
  ) {
    throw new Error("Space reply was not published");
  }
}

export function assertHistoryContainsAgentReply(input) {
  const entries = parseAgentJsonLines(input.stdout);
  for (const entry of entries) {
    const candidate = entry.payload ?? entry.data ?? entry;
    const text = String(
      candidate?.data?.text ??
        candidate?.text ??
        candidate?.payload?.data?.text ??
        ""
    );
    const profileId =
      candidate?.profile?.profileId ??
      candidate?.payload?.profile?.profileId ??
      candidate?.actorProfileId;
    if (
      profileId === input.agentProfileId &&
      text.includes(input.expectedToken)
    ) {
      return;
    }
  }
  throw new Error("Space history does not contain the expected Agent reply");
}

async function assertSignedIn(commandRunner, env) {
  const result = await commandRunner(
    "openmeld-canary",
    ["auth", "status", "--view", "agent"],
    { env }
  );
  const combinedOutput = [result.stdout, result.stderr].join("\n");
  if (looksLikeEnvironmentMismatch(combinedOutput)) {
    throw new Error(
      "Wrong OpenMeld Environment. Run `openmeld-canary auth status --view agent` for details, then sign in to the matching OpenMeld environment."
    );
  }
  if (result.exitCode !== 0 || looksLikeSignInBlocker(result.stdout)) {
    throw new Error(
      "openmeld-canary is not signed in. Run `openmeld-canary login`, then retry `pnpm run openmeld:canary:verify-journey`."
    );
  }
}

async function resolveSelectedHumanProfile(commandRunner, env) {
  const output = await runCommand(
    commandRunner,
    "openmeld-canary",
    ["whoami", "--view", "agent"],
    { env }
  );
  const whoami = findEntry(
    parseAgentJsonLines(output.stdout),
    "whoami.openmeld_profile"
  );
  const profile = whoami?.payload ?? whoami?.data;
  if (profile?.profileKind !== "human" || !profile.openMeldProfileId) {
    throw new Error(
      "openmeld-canary needs a selected Human Profile. Run `openmeld-canary start` or pass `--human-profile <human-profile-id>`."
    );
  }
  return profile.openMeldProfileId;
}

async function createCodexAgentProfile(input) {
  const output = await runCommand(
    input.commandRunner,
    "openmeld-canary",
    [
      "--view",
      "agent",
      "profile",
      "create",
      input.agentName,
      "--kind",
      "agent",
      "--agent-controller",
      "builtin:codex",
    ],
    { env: input.env }
  );
  const entry = findEntry(
    parseAgentJsonLines(output.stdout),
    "profile.created"
  );
  const data = entry?.data ?? entry?.payload;
  const agentProfileId = data?.openMeldProfileId;
  if (!agentProfileId) {
    throw new Error("failed to parse created Agent Profile ID");
  }
  return agentProfileId;
}

async function createSpace(input) {
  const output = await runCommand(
    input.commandRunner,
    "openmeld-canary",
    [
      "--view",
      "agent",
      "space",
      "create",
      "--name",
      input.spaceName,
      "--no-join",
      "--profile",
      input.humanProfileId,
    ],
    { env: input.env }
  );
  const entry = findEntry(
    parseAgentJsonLines(output.stdout),
    "space.create.created"
  );
  const data = entry?.data ?? entry?.payload;
  const spaceId = data?.spaceId;
  if (!spaceId) {
    throw new Error("failed to parse created Space ID");
  }
  return spaceId;
}

async function waitForTraceAndReply(input) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < input.timeoutMs) {
    try {
      const traceOutput = await runCommand(
        input.commandRunner,
        "openmeld-canary",
        [
          "service",
          "trace",
          "--space",
          input.spaceId,
          "--client-message",
          input.clientMessageId,
          "--target-profile",
          input.agentProfileId,
          "--profile",
          input.humanProfileId,
          "--view",
          "agent",
          "--details",
        ],
        { env: input.env }
      );
      const traceEntry = findEntry(
        parseAgentJsonLines(traceOutput.stdout),
        "service.trace.result"
      );
      assertTraceEvidence(traceEntry?.payload ?? traceEntry?.data);

      const historyOutput = await runCommand(
        input.commandRunner,
        "openmeld-canary",
        [
          "--view",
          "agent",
          "space",
          "history",
          input.spaceId,
          "--limit",
          "120",
          "--json",
          "--profile",
          input.humanProfileId,
        ],
        { env: input.env }
      );
      assertHistoryContainsAgentReply({
        agentProfileId: input.agentProfileId,
        expectedToken: input.wakeToken,
        stdout: historyOutput.stdout,
      });
      return;
    } catch (error) {
      lastError = error;
      await delay(DEFAULT_POLL_INTERVAL_MS);
    }
  }
  throw new Error(
    `timed out waiting for canary Wake journey: ${toErrorMessage(lastError)}`
  );
}

function extractClientMessageId(entries) {
  const response = findEntry(entries, "send.response");
  const payload = response?.payload ?? response?.data;
  const clientMessageId = findDeepValue(payload, [
    "clientMessageId",
    "sourceClientMessageId",
  ]);
  if (!clientMessageId) {
    throw new Error("send response did not include a clientMessageId");
  }
  return String(clientMessageId);
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
  return result;
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
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      resolvePromise({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });
  });
}

function buildCanaryCommandEnv() {
  const defaultEnv = buildOpenMeldCanaryDefaultEnv();
  return {
    ...process.env,
    OPENMELD_AUTH_URL: defaultEnv.OPENMELD_AUTH_URL,
    OPENMELD_ENV_PRESET: "canary",
    OPENMELD_GATEWAY_URL: defaultEnv.OPENMELD_GATEWAY_URL,
    OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-canary",
  };
}

function findEntry(entries, code) {
  return entries.find((entry) => entry.code === code) ?? null;
}

function findDeepValue(value, keys) {
  if (!value || typeof value !== "object") {
    return null;
  }
  for (const key of keys) {
    if (Object.hasOwn(value, key)) {
      return value[key];
    }
  }
  for (const child of Object.values(value)) {
    const found = findDeepValue(child, keys);
    if (found !== null && found !== undefined) {
      return found;
    }
  }
  return null;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(label);
  }
}

function assertEqualField(object, field, expected, label) {
  assertObject(object, label);
  if (object[field] !== expected) {
    throw new Error(label);
  }
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0) {
    return null;
  }
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

function looksLikeSignInBlocker(stdout) {
  return SIGN_IN_BLOCKER_RE.test(String(stdout));
}

function normalizeArgs(argv) {
  return argv[0] === "--" ? argv.slice(1) : argv;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage:
  pnpm run openmeld:canary:verify-journey
  pnpm run openmeld:canary:verify-journey -- --human-profile <human-profile-id>

Validates the current packaged canary with a real user-visible journey:
new Codex Agent Profile, new Space, prepare, Wake, trace, and reply.`);
}

function toErrorMessage(error) {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

function isDirectExecution() {
  return import.meta.url === `file://${process.argv[1]}`;
}
