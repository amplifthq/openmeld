#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_FILE), "..", "..");
const OPENMELD_DEV_ENTRY_PATH = "clients/openmeld-cli/dist/openmeld-dev.js";
const OPENMELD_DEV_ARGS_PREFIX = [OPENMELD_DEV_ENTRY_PATH];
const SERVICE_STATUS_CODE = "daemon.status.result";
const PROFILE_ITEM_CODE = "profile.item";
const SIGNAL_CODE = "tail.signal";
const SIGNAL_TEXT_TYPE = "signal.text";
const RUN_MARKER_PREFIX = "real-dogfooding";
const MIN_NODE_MAJOR = 20;
const DEFAULT_HISTORY_LIMIT = 80;
const DEFAULT_CORRELATION_TIMEOUT_MS = 300_000;
const DEFAULT_CORRELATION_POLL_MS = 1000;
const RETRYABLE_GATEWAY_ERROR_HINTS = [
  '"code":"upstream_unreachable"',
  "couldn't find a local dev session",
  "GatewayRpcEntrypoint",
];
const DEV_LOCK_PATH = path.resolve(
  REPO_ROOT,
  ".turbo",
  "dev",
  "openmeld-dev.lock"
);
const DEV_START_TIMEOUT_MS = 60_000;
const DEV_POLL_INTERVAL_MS = 500;
const PROFILE_RESOLVE_TIMEOUT_MS = 30_000;
const PROFILE_RESOLVE_POLL_MS = 1000;
const POSITIVE_INTEGER_RE = /^\d+$/;
const POSITIVE_FLOAT_RE = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const AUTO_REPLY_PLACEHOLDER_TOKEN = "[local-execution-auto-reply]";
const DISPATCH_TOKEN_RE = /\bdispatch:([^\s]+)/;
const TASK_TOKEN_RE = /\btask:([^\s]+)/;
const DELIVERY_STABILITY_GATE_REQUIRED_CONSECUTIVE_PASSES = 3;
const DELIVERY_STABILITY_GATE_OBSERVE_WINDOW_MS = 60_000;
const DELIVERY_STABILITY_GATE_DISPATCHING_TIMEOUT_MS = 5000;
const DELIVERY_STABILITY_GATE_DEFAULT_DEDUPED_BASELINE_WINDOW_MS =
  7 * 24 * 60 * 60_000;
const DELIVERY_STABILITY_GATE_FAILED_TERMINAL_RATE_LIMIT = 0.03;
const DELIVERY_STABILITY_GATE_COLD_START_TIMEOUT_RATE_LIMIT = 0.05;
const DELIVERY_STABILITY_GATE_DISPATCHING_TIMEOUT_COUNT_LIMIT = 0;
const DELIVERY_STABILITY_GATE_DEDUPED_RATIO_SPIKE_MULTIPLIER = 2;
const DELIVERY_STABILITY_GATE_DEDUPED_RATIO_FALLBACK_LIMIT = 0.5;
const LOCAL_D1_QUERY_MAX_ATTEMPTS = 5;
const LOCAL_D1_QUERY_RETRY_MS = 250;
const SQLITE_BUSY_HINT = "SQLITE_BUSY";
const SQLITE_DATABASE_LOCKED_HINT = "database is locked";

const OBSERVABILITY_SOURCE_ASSERTIONS = [
  {
    semanticField: "health_reason",
    file: "runtime/local-execution/src/scheduler-runtime-simulator.ts",
    token: "reasonCode",
  },
  {
    semanticField: "heartbeat_sent_count",
    file: "runtime/local-execution/src/heartbeat-policy.ts",
    token: "heartbeatSentCountPerMinute",
  },
  {
    semanticField: "reconnect_success_rate",
    file: "runtime/local-execution/src/heartbeat-policy.ts",
    token: "reconnectSuccessRate",
  },
  {
    semanticField: "suspect_transition_rate",
    file: "runtime/local-execution/src/heartbeat-policy.ts",
    token: "heartbeatSuspectIntervalMs",
  },
];

export const PRECHECK_COMMANDS = [
  {
    command: "pnpm",
    args: ["check"],
    label: "workspace check",
    skipEnvVar: "OPENMELD_DOGFOODING_SKIP_WORKSPACE_CHECK",
  },
  {
    command: "pnpm",
    args: ["build"],
    label: "workspace build",
  },
  {
    command: "pnpm",
    args: [
      "--filter",
      "@openmeld/local-execution",
      "run",
      "test:runtime:observability-proof",
    ],
    label: "runtime observability proof",
  },
];

export const REQUIRED_ENV_VARS = [
  "OPENMELD_DOGFOODING_SPACE_ID",
  "OPENMELD_DAEMON_RUNTIME_LOG_PATH",
];
export const OBSERVABILITY_TOKENS = OBSERVABILITY_SOURCE_ASSERTIONS.map(
  (item) => item.semanticField
);
export const CLI_COMMAND_TEMPLATES = [
  {
    label: "service status",
    args: ["service", "status", "--view", "agent"],
  },
  {
    label: "service install",
    args: ["service", "install", "--view", "agent"],
  },
  {
    label: "space send trigger",
    args: [
      "space",
      "send",
      "<space-id>",
      "[delivery-trace] <marker> @<target-profile>",
      "--profile",
      "<sender-profile>",
      "--view",
      "agent",
    ],
  },
  {
    label: "space history",
    args: [
      "space",
      "history",
      "<space-id>",
      "--limit",
      "<history-limit>",
      "--json",
      "--profile",
      "<sender-profile>",
      "--view",
      "agent",
    ],
  },
];

const fail = (message) => {
  throw new Error(message);
};

class NonRetryableGateError extends Error {
  nonRetryable = true;
}

const failNoRetry = (message) => {
  throw new NonRetryableGateError(message);
};

const parsePositiveInteger = (input, fallbackValue, optionLabel = "value") => {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return fallbackValue;
  }

  if (!POSITIVE_INTEGER_RE.test(raw)) {
    fail(`invalid positive integer for ${optionLabel}: "${raw}"`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`invalid positive integer for ${optionLabel}: "${raw}"`);
  }
  return parsed;
};

const parseNonNegativeInteger = (
  input,
  fallbackValue,
  optionLabel = "value"
) => {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return fallbackValue;
  }

  if (!POSITIVE_INTEGER_RE.test(raw)) {
    fail(`invalid non-negative integer for ${optionLabel}: "${raw}"`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`invalid non-negative integer for ${optionLabel}: "${raw}"`);
  }
  return parsed;
};

const parsePositiveNumber = (input, fallbackValue, optionLabel = "value") => {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return fallbackValue;
  }

  const normalized = raw.endsWith("%") ? raw.slice(0, -1).trim() : raw;
  if (!POSITIVE_FLOAT_RE.test(normalized)) {
    fail(`invalid positive number for ${optionLabel}: "${raw}"`);
  }
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    fail(`invalid positive number for ${optionLabel}: "${raw}"`);
  }
  return parsed;
};

const parseDeliveryStabilityRate = (
  input,
  fallbackValue,
  optionLabel = "value"
) => {
  const parsed = parsePositiveNumber(input, fallbackValue, optionLabel);
  return parsed > 1 ? parsed / 100 : parsed;
};

const assertNodeVersion = () => {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
  if (!Number.isFinite(major) || major < MIN_NODE_MAJOR) {
    fail(
      `verify-real-dogfooding requires Node >=${MIN_NODE_MAJOR}. Current: ${process.versions.node}`
    );
  }
};

const runCommand = (input) => {
  const result = spawnSync(input.command, input.args, {
    cwd: input.cwd ?? REPO_ROOT,
    env: process.env,
    encoding: "utf8",
  });
  return result;
};

const assertExitCode = (result, label) => {
  if (result.status === 0) {
    return;
  }

  const commandError =
    result.error instanceof Error ? result.error.message : "none";
  const stderr = truncate(String(result.stderr ?? "").trim(), 1200);
  const stdout = truncate(String(result.stdout ?? "").trim(), 1200);
  fail(
    `${label} failed (exit=${String(result.status ?? "null")}, signal=${String(result.signal ?? "none")}, error=${commandError}). stdout="${stdout}" stderr="${stderr}"`
  );
};

const writeEvidence = (evidenceDir, fileName, input, result) => {
  const commandText = [input.command, ...input.args].join(" ");
  const body = [
    `$ ${commandText}`,
    `exit=${String(result.status ?? "null")}`,
    "--- stdout ---",
    String(result.stdout ?? "").trimEnd(),
    "--- stderr ---",
    String(result.stderr ?? "").trimEnd(),
    "",
  ].join("\n");

  writeFileSync(path.join(evidenceDir, `${fileName}.log`), body, "utf8");
};

const runAndRecord = (evidenceDir, fileName, input) => {
  const result = runCommand(input);
  writeEvidence(evidenceDir, fileName, input, result);
  return result;
};

const parseNdjson = (rawOutput, label) => {
  const lines = String(rawOutput)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    fail(`${label}: empty output`);
  }

  const parsed = [];
  for (const [index, line] of lines.entries()) {
    try {
      parsed.push(JSON.parse(line));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fail(`${label}: invalid json at line ${index + 1}: ${reason}`);
    }
  }
  return parsed;
};

const isRetryableGatewayCliFailure = (result) => {
  if (result.status === 0) {
    return false;
  }
  const combinedOutput = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
  return RETRYABLE_GATEWAY_ERROR_HINTS.some((hint) =>
    combinedOutput.includes(hint)
  );
};

const extractInstalled = (rawOutput) => {
  const rows = parseNdjson(rawOutput, "service status");
  const statusRow =
    rows.find((row) => row?.code === SERVICE_STATUS_CODE) ?? null;
  if (!statusRow) {
    fail(`service status missing ${SERVICE_STATUS_CODE}`);
  }
  return Boolean(statusRow.payload?.installed);
};

const resolveSpaceId = () => {
  const spaceId = String(
    String(process.env.OPENMELD_DOGFOODING_SPACE_ID ?? "").trim()
  );
  if (!spaceId) {
    fail(
      [
        "missing required env: OPENMELD_DOGFOODING_SPACE_ID",
        "example:",
        "  OPENMELD_DOGFOODING_SPACE_ID=<space-id> pnpm run verify:local-execution:real-dogfooding",
      ].join("\n")
    );
  }
  return spaceId;
};

const resolveRuntimeLogPath = () => {
  const rawPath = String(
    process.env.OPENMELD_DAEMON_RUNTIME_LOG_PATH ?? ""
  ).trim();
  if (!rawPath) {
    fail(
      [
        "missing required env: OPENMELD_DAEMON_RUNTIME_LOG_PATH",
        "example:",
        "  OPENMELD_DAEMON_RUNTIME_LOG_PATH=/tmp/openmeld-local-execution.ndjson OPENMELD_DOGFOODING_SPACE_ID=<space-id> pnpm run verify:local-execution:real-dogfooding",
      ].join("\n")
    );
  }
  const resolvedPath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(REPO_ROOT, rawPath);
  if (!existsSync(resolvedPath)) {
    fail(`runtime log path does not exist: ${resolvedPath}`);
  }
  return resolvedPath;
};

const resolveProfiles = (evidenceDir, senderOverride, targetOverride) => {
  const profileListResult = runAndRecord(
    evidenceDir,
    "delivery-stability-profile-list",
    {
      command: process.execPath,
      args: [...OPENMELD_DEV_ARGS_PREFIX, "--view", "agent", "profile", "list"],
      label: "profile list",
    }
  );
  assertExitCode(profileListResult, "profile list");

  const rows = parseNdjson(profileListResult.stdout, "profile list");
  const profileIds = rows
    .filter((row) => row?.code === PROFILE_ITEM_CODE)
    .map((row) => String(row?.data?.profile ?? "").trim())
    .filter(Boolean);

  const uniqueProfileIds = Array.from(new Set(profileIds));
  if (uniqueProfileIds.length === 0) {
    fail(
      "profile list is empty. create an agent profile before delivery-stability checks."
    );
  }

  const selectedByDefault =
    rows.find((row) => row?.code === PROFILE_ITEM_CODE && row?.data?.default) ??
    rows.find((row) => row?.code === PROFILE_ITEM_CODE) ??
    null;
  const fallbackSender = String(selectedByDefault?.data?.profile ?? "").trim();

  const senderProfile = String(senderOverride ?? "").trim() || fallbackSender;
  if (!senderProfile) {
    fail(
      [
        "cannot resolve sender profile.",
        "set env:",
        "  OPENMELD_DOGFOODING_AGENT_PROFILE=<agent-profile-id>",
      ].join("\n")
    );
  }
  if (!uniqueProfileIds.includes(senderProfile)) {
    fail(
      `OPENMELD_DOGFOODING_AGENT_PROFILE="${senderProfile}" was not found in profile list.`
    );
  }

  const targetCandidate = String(targetOverride ?? "").trim();
  const targetProfile =
    targetCandidate ||
    uniqueProfileIds.find((profileId) => profileId !== senderProfile) ||
    "";

  if (!targetProfile) {
    fail(
      [
        "cannot resolve a target profile different from sender.",
        "set env:",
        "  OPENMELD_DOGFOODING_TARGET_PROFILE=<another-agent-profile-id>",
      ].join("\n")
    );
  }

  if (targetProfile === senderProfile) {
    fail(
      "OPENMELD_DOGFOODING_TARGET_PROFILE must be different from OPENMELD_DOGFOODING_AGENT_PROFILE."
    );
  }
  if (!uniqueProfileIds.includes(targetProfile)) {
    fail(
      `OPENMELD_DOGFOODING_TARGET_PROFILE="${targetProfile}" was not found in profile list.`
    );
  }

  return {
    senderProfile,
    targetProfile,
  };
};

const resolveProfilesWithRetry = async (input) => {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < PROFILE_RESOLVE_TIMEOUT_MS) {
    try {
      return resolveProfiles(
        input.evidenceDir,
        input.senderOverride,
        input.targetOverride
      );
    } catch (error) {
      const typedError = toError(error);
      const nonRetryableHints = [
        "openmeld-dev login",
        "openmeld login",
        "openmeld-dev start",
        "openmeld init",
        "profile create",
        "profiles create",
        "cannot resolve",
      ];
      if (
        !input.startedByScript &&
        nonRetryableHints.some((hint) => typedError.message.includes(hint))
      ) {
        throw typedError;
      }
      const retryable =
        typedError.message.includes("profile list failed") ||
        typedError.message.includes("fetch failed");
      if (!retryable) {
        throw typedError;
      }
      lastError = typedError;
      await sleep(PROFILE_RESOLVE_POLL_MS);
    }
  }

  if (lastError) {
    throw new Error(
      `profile preflight timed out after ${String(PROFILE_RESOLVE_TIMEOUT_MS)}ms: ${lastError.message}`
    );
  }
  throw new Error("profile preflight timed out");
};

const resolveCliTemplateArgs = (label, replacements = {}) => {
  const template = CLI_COMMAND_TEMPLATES.find((item) => item.label === label);
  if (!template) {
    fail(`missing CLI command template: ${label}`);
  }

  return template.args.map((arg) => replacements[arg] ?? arg);
};

const readDevLockPid = () => {
  if (!existsSync(DEV_LOCK_PATH)) {
    return null;
  }
  try {
    const raw = readFileSync(DEV_LOCK_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.pid !== "number" || !Number.isFinite(parsed.pid)) {
      return null;
    }
    return parsed.pid;
  } catch {
    return null;
  }
};

const isPidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const terminateDetachedProcess = (pid) => {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) {
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
    return;
  } catch {
    // Fallback to direct pid when process group signal is unavailable.
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Ignore cleanup failures for already-dead process.
  }
};

const ensureDevStack = async (evidenceDir) => {
  const existingPid = readDevLockPid();
  if (typeof existingPid === "number" && isPidAlive(existingPid)) {
    return {
      startedByScript: false,
      devPid: existingPid,
      devLogPath: null,
    };
  }

  const devLogPath = path.join(evidenceDir, "delivery-stability-dev.log");
  const devLogFd = openSync(devLogPath, "a");
  const devProcess = spawn("pnpm", ["dev"], {
    cwd: REPO_ROOT,
    env: process.env,
    detached: true,
    stdio: ["ignore", devLogFd, devLogFd],
  });
  closeSync(devLogFd);
  devProcess.unref();

  const cleanupDetachedDev = () => {
    terminateDetachedProcess(devProcess.pid);
  };
  process.on("exit", () => {
    cleanupDetachedDev();
  });

  const startAt = Date.now();
  while (Date.now() - startAt < DEV_START_TIMEOUT_MS) {
    const pid = readDevLockPid();
    if (typeof pid === "number" && isPidAlive(pid)) {
      return {
        startedByScript: true,
        devPid: pid,
        devLogPath,
      };
    }
    await sleep(DEV_POLL_INTERVAL_MS);
  }

  cleanupDetachedDev();
  fail(
    [
      "dev stack did not become ready within timeout.",
      `log: ${devLogPath}`,
    ].join("\n")
  );
};

const stopDevStack = (evidenceDir) => {
  const result = runAndRecord(evidenceDir, "delivery-stability-dev-stop", {
    command: "pnpm",
    args: ["dev:stop"],
    label: "dev stop",
  });
  assertExitCode(result, "dev stop");
};

const normalizeText = (value) => String(value ?? "").trim();

const extractReplyMetadata = (replyText) => {
  const dispatchId = normalizeText(replyText.match(DISPATCH_TOKEN_RE)?.[1]);
  const taskId = normalizeText(replyText.match(TASK_TOKEN_RE)?.[1]);
  return {
    dispatchId,
    taskId,
  };
};

const buildDispatchCorrelation = (
  rawHistory,
  sourceEventId,
  senderProfile,
  targetProfile
) => {
  const rows = parseNdjson(rawHistory, "space history");
  const signalRows = rows
    .filter((row) => row?.code === SIGNAL_CODE)
    .map((row) => row?.payload)
    .filter((payload) => payload?.type === SIGNAL_TEXT_TYPE)
    .filter((payload) => typeof payload?.data?.text === "string");

  const sourceSignal = signalRows.find(
    (payload) =>
      payload?.id === sourceEventId &&
      payload?.profile?.profileId === senderProfile
  );
  const sourceTs =
    sourceSignal && Number.isFinite(sourceSignal.ts)
      ? Number(sourceSignal.ts)
      : null;
  const replySignals = signalRows.filter(
    (payload) =>
      payload?.profile?.profileId === targetProfile &&
      (sourceTs === null ||
        (Number.isFinite(payload?.ts) && Number(payload.ts) >= sourceTs))
  );
  const latestReplySignal = replySignals.at(-1) ?? null;
  const replyText = normalizeText(latestReplySignal?.data?.text);
  const { dispatchId, taskId } = extractReplyMetadata(replyText);
  const runtimeOutputText =
    dispatchId || taskId
      ? replyText.split("\n").slice(1).join("\n").trim()
      : replyText;

  return {
    fromSender: Boolean(sourceSignal),
    fromTarget: Boolean(latestReplySignal),
    sourceSignal,
    replyEventId: normalizeText(latestReplySignal?.id),
    replyText,
    runtimeOutputText,
    dispatchId,
    taskId,
    containsPlaceholder: replyText.includes(AUTO_REPLY_PLACEHOLDER_TOKEN),
  };
};

const assertDispatchCorrelationValue = (
  correlation,
  sourceEventId,
  targetProfile
) => {
  if (!correlation.fromSender) {
    fail(
      `dispatch correlation failed: source signal missing (${sourceEventId})`
    );
  }
  if (!correlation.fromTarget) {
    fail(
      `dispatch correlation failed: reply signal missing for target profile (${targetProfile})`
    );
  }
  if (!correlation.replyEventId) {
    fail("dispatch correlation failed: missing reply event id");
  }
  if (!correlation.replyText) {
    fail("dispatch correlation failed: missing reply text");
  }
  if (correlation.containsPlaceholder) {
    fail(
      `dispatch correlation failed: placeholder token detected (${AUTO_REPLY_PLACEHOLDER_TOKEN})`
    );
  }
  if (!correlation.runtimeOutputText) {
    fail("dispatch correlation failed: missing runtime output text body");
  }

  return correlation;
};

const assertDispatchCorrelation = (
  rawHistory,
  sourceEventId,
  senderProfile,
  targetProfile
) => {
  const correlation = buildDispatchCorrelation(
    rawHistory,
    sourceEventId,
    senderProfile,
    targetProfile
  );
  return assertDispatchCorrelationValue(
    correlation,
    sourceEventId,
    targetProfile
  );
};

const escapeSqlLiteral = (value) => value.replaceAll("'", "''");

const isRetryableD1Failure = (result) => {
  const output = [
    String(result?.stdout ?? ""),
    String(result?.stderr ?? ""),
  ].join("\n");
  return (
    output.includes(SQLITE_BUSY_HINT) ||
    output.includes(SQLITE_DATABASE_LOCKED_HINT)
  );
};

const parseLocalD1QueryResult = (input, result) => {
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout ?? ""));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`${input.label}: invalid json output (${reason})`);
  }
  if (!Array.isArray(parsed)) {
    fail(`${input.label}: expected array json output`);
  }

  const firstRow = parsed[0];
  if (!(firstRow && Array.isArray(firstRow.results))) {
    fail(`${input.label}: invalid wrangler d1 json response`);
  }
  return firstRow.results;
};

const executeLocalD1Query = (input) =>
  runAndRecord(input.evidenceDir, input.evidenceName, {
    command: "npx",
    args: [
      "wrangler",
      "d1",
      "execute",
      "openmeld-db",
      "--local",
      "--command",
      input.sql,
      "--json",
    ],
    label: input.label,
    cwd: path.join(REPO_ROOT, "services/core"),
  });

const waitRetryD1Failure = (attempt, result) => {
  if (
    !isRetryableD1Failure(result) ||
    attempt + 1 >= LOCAL_D1_QUERY_MAX_ATTEMPTS
  ) {
    return false;
  }
  return true;
};

const runLocalD1Query = async (input) => {
  let attempt = 0;
  while (attempt < LOCAL_D1_QUERY_MAX_ATTEMPTS) {
    const result = executeLocalD1Query(input);
    if (result.status === 0) {
      return parseLocalD1QueryResult(input, result);
    }

    if (waitRetryD1Failure(attempt, result)) {
      const nextAttempt = attempt + 1;
      await sleep(LOCAL_D1_QUERY_RETRY_MS * nextAttempt);
      attempt += 1;
      continue;
    }

    assertExitCode(result, input.label);
  }

  fail(
    `${input.label} failed after ${String(LOCAL_D1_QUERY_MAX_ATTEMPTS)} attempts`
  );
};

const safeDeliveryStabilityNumber = (input) => {
  const value = Number(input);
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
};

const safeDeliveryStabilityRate = (numerator, denominator) => {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
};

const formatDeliveryStabilityRate = (value) =>
  `${(safeDeliveryStabilityRate(value, 1) * 100).toFixed(2)}%`;

const readDeliveryStabilityDispatchMetrics = async (input) => {
  const nowMs = Math.max(0, Math.trunc(input.nowMs));
  const observeWindowMs = Math.max(
    1,
    Math.trunc(
      input.observeWindowMs ?? DELIVERY_STABILITY_GATE_OBSERVE_WINDOW_MS
    )
  );
  const dispatchingTimeoutMs = Math.max(
    1,
    Math.trunc(
      input.dispatchingTimeoutMs ??
        DELIVERY_STABILITY_GATE_DISPATCHING_TIMEOUT_MS
    )
  );
  const observeFromMs = Math.max(0, nowMs - observeWindowMs);
  const dispatchingTimeoutAtMs = Math.max(0, nowMs - dispatchingTimeoutMs);

  const summaryRows = await runLocalD1Query({
    evidenceDir: input.evidenceDir,
    evidenceName: `delivery-stability-metrics-summary-attempt-${String(
      input.attempt
    )}`,
    label: "delivery stability metrics summary",
    sql: [
      "SELECT",
      "COALESCE(SUM(CASE WHEN status = 'failed_terminal' THEN 1 ELSE 0 END), 0) AS failed_terminal_count",
      ", COALESCE(SUM(CASE WHEN status IN ('succeeded','failed_retryable','failed_terminal','blocked') THEN 1 ELSE 0 END), 0) AS completed_relevant_count",
      ", COALESCE(SUM(CASE WHEN status = 'deduped' THEN 1 ELSE 0 END), 0) AS deduped_count",
      ", COALESCE(SUM(CASE WHEN status = 'dispatching' AND last_attempt_at_ms <= ",
      String(dispatchingTimeoutAtMs),
      " THEN 1 ELSE 0 END), 0) AS dispatching_timeout_count",
      "FROM openMeldDaemon_dispatch_ledger",
      "WHERE last_attempt_at_ms >=",
      String(observeFromMs),
    ].join(" "),
  });

  const coldStartRows = await runLocalD1Query({
    evidenceDir: input.evidenceDir,
    evidenceName: `delivery-stability-metrics-dlq-attempt-${String(
      input.attempt
    )}`,
    label: "delivery stability metrics dlq",
    sql: [
      "SELECT COALESCE(COUNT(*), 0) AS cold_start_timeout_count",
      "FROM openMeldDaemon_dlq",
      "WHERE error_code = 'daemon.delivery.timeout'",
      `AND failed_at_ms >= ${String(observeFromMs)}`,
    ].join(" "),
  });

  const summary = summaryRows?.[0] ?? {};
  const coldStartSummary = coldStartRows?.[0] ?? {};

  const failedTerminalCount = safeDeliveryStabilityNumber(
    summary.failed_terminal_count
  );
  const completedRelevantCount = safeDeliveryStabilityNumber(
    summary.completed_relevant_count
  );
  const dedupedCount = safeDeliveryStabilityNumber(summary.deduped_count);
  const dispatchingTimeoutCount = safeDeliveryStabilityNumber(
    summary.dispatching_timeout_count
  );
  const coldStartTimeoutCount = safeDeliveryStabilityNumber(
    coldStartSummary.cold_start_timeout_count
  );

  const completedRelevantRateDenominator = completedRelevantCount || 1;
  const dedupedRatioDenominator = completedRelevantCount + dedupedCount || 1;

  return {
    observeWindowMs,
    failedTerminalCount,
    failedTerminalRate: safeDeliveryStabilityRate(
      failedTerminalCount,
      completedRelevantRateDenominator
    ),
    coldStartTimeoutCount,
    coldStartTimeoutRate: safeDeliveryStabilityRate(
      coldStartTimeoutCount,
      completedRelevantRateDenominator
    ),
    dispatchingTimeoutCount,
    dedupedCount,
    dedupedRatio: safeDeliveryStabilityRate(
      dedupedCount,
      dedupedRatioDenominator
    ),
  };
};

const evaluateDeliveryStabilityGate = (input) => {
  const { metrics } = input;
  const limits = input.limits ?? {
    failedTerminalRateLimit: DELIVERY_STABILITY_GATE_FAILED_TERMINAL_RATE_LIMIT,
    coldStartTimeoutRateLimit:
      DELIVERY_STABILITY_GATE_COLD_START_TIMEOUT_RATE_LIMIT,
    dispatchingTimeoutCountLimit:
      DELIVERY_STABILITY_GATE_DISPATCHING_TIMEOUT_COUNT_LIMIT,
    dedupedRatioSpikeMultiplier:
      DELIVERY_STABILITY_GATE_DEDUPED_RATIO_SPIKE_MULTIPLIER,
    dedupedRatioFallbackLimit:
      DELIVERY_STABILITY_GATE_DEDUPED_RATIO_FALLBACK_LIMIT,
  };

  const reasons = [];
  if (metrics.failedTerminalRate > limits.failedTerminalRateLimit) {
    reasons.push(
      `failed_terminal_rate=${formatDeliveryStabilityRate(
        metrics.failedTerminalRate
      )} > ${formatDeliveryStabilityRate(limits.failedTerminalRateLimit)}`
    );
  }
  if (metrics.coldStartTimeoutRate > limits.coldStartTimeoutRateLimit) {
    reasons.push(
      `cold_start_timeout_rate=${formatDeliveryStabilityRate(
        metrics.coldStartTimeoutRate
      )} > ${formatDeliveryStabilityRate(limits.coldStartTimeoutRateLimit)}`
    );
  }
  if (metrics.dispatchingTimeoutCount > limits.dispatchingTimeoutCountLimit) {
    reasons.push(
      `dispatching_timeout_count=${String(metrics.dispatchingTimeoutCount)} > ${String(limits.dispatchingTimeoutCountLimit)}`
    );
  }

  const dedupedRatioBaseline =
    typeof input.dedupedRatioBaseline === "number"
      ? Math.max(0, input.dedupedRatioBaseline)
      : 0;
  const dedupedRatioLimit =
    dedupedRatioBaseline > 0
      ? Math.min(1, dedupedRatioBaseline * limits.dedupedRatioSpikeMultiplier)
      : limits.dedupedRatioFallbackLimit;
  if (metrics.dedupedRatio > dedupedRatioLimit) {
    reasons.push(
      `deduped_ratio=${formatDeliveryStabilityRate(metrics.dedupedRatio)} > ${formatDeliveryStabilityRate(
        dedupedRatioLimit
      )}`
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    dedupedRatioLimit,
    limits,
  };
};

const readDeliveryStabilityGateObservation = async (input) => {
  const nowMs = Math.max(0, Math.trunc(input.nowMs));
  const observeWindowMs = Math.max(
    1,
    Math.trunc(
      input.observeWindowMs ?? DELIVERY_STABILITY_GATE_OBSERVE_WINDOW_MS
    )
  );
  const dispatchingTimeoutMs = Math.max(
    1,
    Math.trunc(
      input.dispatchingTimeoutMs ??
        DELIVERY_STABILITY_GATE_DISPATCHING_TIMEOUT_MS
    )
  );
  const baselineWindowMs = Math.max(
    1,
    Math.trunc(
      input.baselineWindowMs ??
        DELIVERY_STABILITY_GATE_DEFAULT_DEDUPED_BASELINE_WINDOW_MS
    )
  );

  const metrics = await readDeliveryStabilityDispatchMetrics({
    attempt: input.attempt,
    evidenceDir: input.evidenceDir,
    nowMs,
    observeWindowMs,
    dispatchingTimeoutMs,
  });

  const baselineObservationEndMs = Math.max(0, nowMs - observeWindowMs);
  const baselineObservation = await readDeliveryStabilityDispatchMetrics({
    attempt: `baseline-${String(input.attempt)}`,
    evidenceDir: input.evidenceDir,
    nowMs: baselineObservationEndMs,
    observeWindowMs: baselineWindowMs,
    dispatchingTimeoutMs,
  });

  const gateLimits = {
    failedTerminalRateLimit: Number.isFinite(input.failedTerminalRateLimit)
      ? Math.max(0, Math.min(1, input.failedTerminalRateLimit))
      : DELIVERY_STABILITY_GATE_FAILED_TERMINAL_RATE_LIMIT,
    coldStartTimeoutRateLimit: Number.isFinite(input.coldStartTimeoutRateLimit)
      ? Math.max(0, Math.min(1, input.coldStartTimeoutRateLimit))
      : DELIVERY_STABILITY_GATE_COLD_START_TIMEOUT_RATE_LIMIT,
    dispatchingTimeoutCountLimit: Number.isFinite(
      input.dispatchingTimeoutCountLimit
    )
      ? Math.max(0, Math.floor(input.dispatchingTimeoutCountLimit))
      : DELIVERY_STABILITY_GATE_DISPATCHING_TIMEOUT_COUNT_LIMIT,
    dedupedRatioSpikeMultiplier: Math.max(
      1,
      input.dedupedRatioSpikeMultiplier ||
        DELIVERY_STABILITY_GATE_DEDUPED_RATIO_SPIKE_MULTIPLIER
    ),
    dedupedRatioFallbackLimit: Math.max(
      0,
      Math.min(
        1,
        input.dedupedRatioFallbackLimit ||
          DELIVERY_STABILITY_GATE_DEDUPED_RATIO_FALLBACK_LIMIT
      )
    ),
  };

  const evaluation = evaluateDeliveryStabilityGate({
    metrics,
    dedupedRatioBaseline: baselineObservation.dedupedRatio,
    limits: gateLimits,
  });

  return {
    attempt: input.attempt,
    metrics,
    baselineObservation,
    limits: gateLimits,
    evaluation,
  };
};

const selectDispatchSnapshot = async (input) => {
  const escapedSourceEventId = escapeSqlLiteral(input.sourceEventId);
  const ledgerRows = await runLocalD1Query({
    evidenceDir: input.evidenceDir,
    evidenceName: `delivery-stability-ledger-attempt-${String(input.attempt)}`,
    label: "delivery stability ledger query",
    sql: [
      "SELECT dispatch_id, source_event_id, status, last_attempt_at_ms, attempt_count",
      "FROM openMeldDaemon_dispatch_ledger",
      `WHERE source_event_id='${escapedSourceEventId}'`,
      "ORDER BY last_attempt_at_ms DESC",
      "LIMIT 1;",
    ].join(" "),
  });
  const outboxRows = await runLocalD1Query({
    evidenceDir: input.evidenceDir,
    evidenceName: `delivery-stability-outbox-attempt-${String(input.attempt)}`,
    label: "delivery stability outbox query",
    sql: [
      "SELECT dispatch_id, source_event_id, idempotency_key, status, updated_at_ms",
      "FROM openMeldDaemon_outbox",
      `WHERE source_event_id='${escapedSourceEventId}'`,
      "ORDER BY updated_at_ms DESC",
      "LIMIT 1;",
    ].join(" "),
  });

  const ledgerRow = ledgerRows[0] ?? null;
  const outboxRow = outboxRows[0] ?? null;
  return {
    ledgerDispatchId: normalizeText(ledgerRow?.dispatch_id),
    outboxDispatchId: normalizeText(outboxRow?.dispatch_id),
    ledgerStatus: normalizeText(ledgerRow?.status),
    outboxStatus: normalizeText(outboxRow?.status),
  };
};

const assertDispatchSnapshotReady = async (input) => {
  const snapshot = await selectDispatchSnapshot({
    evidenceDir: input.evidenceDir,
    sourceEventId: input.sourceEventId,
    attempt: input.attempt,
  });
  if (!snapshot.ledgerDispatchId) {
    fail("delivery stability ledger query returned no dispatch_id");
  }
  if (snapshot.ledgerDispatchId !== snapshot.outboxDispatchId) {
    if (!snapshot.outboxDispatchId) {
      process.stdout.write(
        `delivery stability outbox snapshot not ready yet: ledger=${snapshot.ledgerDispatchId}\n`
      );
      return snapshot;
    }
    fail(
      `dispatch mismatch between ledger/outbox: ledger=${snapshot.ledgerDispatchId}, outbox=${snapshot.outboxDispatchId}`
    );
  }
  return snapshot;
};

const assertDispatchSnapshotNotTerminal = (snapshot) => {
  const status = snapshot.ledgerStatus;
  if (status === "failed_terminal" || status === "blocked") {
    failNoRetry(
      `dispatch reached terminal state before reply correlation: status=${status}`
    );
  }
};

const assertDispatchSnapshotAgainstReplyWhenPresent = (
  snapshot,
  replyDispatchId
) => {
  if (!replyDispatchId) {
    return;
  }
  if (snapshot.ledgerDispatchId !== replyDispatchId) {
    fail(
      `dispatch mismatch between ledger and reply: ledger=${snapshot.ledgerDispatchId}, reply=${replyDispatchId}`
    );
  }
};

const resolveDispatchDlqState = async (input) => {
  const escapedDispatchId = escapeSqlLiteral(input.dispatchId);
  const dlqRows = await runLocalD1Query({
    evidenceDir: input.evidenceDir,
    evidenceName: `delivery-stability-dlq-attempt-${String(input.attempt)}`,
    label: "delivery stability dlq query",
    sql: [
      "SELECT dispatch_id, error_code, failed_at_ms",
      "FROM openMeldDaemon_dlq",
      `WHERE dispatch_id='${escapedDispatchId}'`,
      "ORDER BY failed_at_ms DESC",
      "LIMIT 1;",
    ].join(" "),
  });
  if (dlqRows.length > 0) {
    const first = dlqRows[0];
    failNoRetry(
      `delivery stability dlq query hit terminal record: dispatch_id=${normalizeText(
        first?.dispatch_id
      )}, error_code=${normalizeText(first?.error_code)}`
    );
  }
};

const extractRuntimeEntryDispatchId = (entry) =>
  normalizeText(
    entry?.dispatchId ?? entry?.dispatch_id ?? entry?.payload?.dispatchId
  );

const extractRuntimeEntryTaskId = (entry) =>
  normalizeText(entry?.taskId ?? entry?.task_id ?? entry?.payload?.taskId);

const extractRuntimeEntryOutputText = (entry) => {
  const outputTextCandidates = [
    entry?.adapterOutput,
    entry?.output,
    entry?.responseText,
    entry?.payload?.adapterOutput,
    entry?.payload?.output,
    entry?.payload?.result?.output,
    entry?.result?.output,
  ].map(normalizeText);
  return outputTextCandidates.find((value) => value.length > 0) ?? "";
};

const readRuntimeLogCorrelation = (input) => {
  const raw = readFileSync(input.runtimeLogPath, "utf8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Runtime structured logs can contain non-json lines; ignore safely.
    }
  }
  if (entries.length === 0) {
    fail(`runtime log contains no json entries: ${input.runtimeLogPath}`);
  }

  const dispatchMatches = entries.filter(
    (entry) => extractRuntimeEntryDispatchId(entry) === input.dispatchId
  );
  if (dispatchMatches.length === 0) {
    fail(
      `runtime log correlation failed: no record found for dispatch=${input.dispatchId}`
    );
  }
  const expectedTaskId = normalizeText(input.taskId);
  const strictTaskMatches =
    expectedTaskId.length > 0
      ? dispatchMatches.filter(
          (entry) => extractRuntimeEntryTaskId(entry) === expectedTaskId
        )
      : dispatchMatches;
  if (expectedTaskId.length > 0 && strictTaskMatches.length === 0) {
    fail(
      `runtime log correlation failed: no strict task match for dispatch=${input.dispatchId} task=${expectedTaskId}`
    );
  }

  const entriesWithOutput = strictTaskMatches.filter(
    (entry) => extractRuntimeEntryOutputText(entry).length > 0
  );
  if (entriesWithOutput.length === 0) {
    fail(
      `runtime log correlation failed: matching records found but output missing for dispatch=${input.dispatchId} task=${input.taskId}`
    );
  }

  const record = entriesWithOutput.at(-1) ?? null;
  const outputText = extractRuntimeEntryOutputText(record);
  if (!outputText) {
    fail(
      `runtime log correlation failed: missing output text for dispatch=${input.dispatchId}`
    );
  }
  const adapterOutputMarker = outputText.slice(0, 48);
  if (!adapterOutputMarker) {
    fail("runtime log correlation failed: adapter output marker is empty");
  }
  return {
    adapterOutputMarker,
  };
};

const assertRuntimeOutputCorrelation = (input) => {
  const runtimeCorrelation = readRuntimeLogCorrelation({
    runtimeLogPath: input.runtimeLogPath,
    dispatchId: input.dispatchId,
    taskId: input.taskId,
  });
  if (!input.replyText.includes(runtimeCorrelation.adapterOutputMarker)) {
    fail(
      "runtime output correlation failed: reply text does not contain adapter output marker"
    );
  }
  return runtimeCorrelation;
};

const waitForCondition = async (input) => {
  const startedAt = Date.now();
  let lastError = null;
  let attempt = 0;

  while (Date.now() - startedAt <= input.timeoutMs) {
    attempt += 1;
    try {
      await input.evaluate(attempt);
      return;
    } catch (error) {
      if (error instanceof NonRetryableGateError) {
        throw error;
      }
      lastError = toError(error);
      if (Date.now() - startedAt >= input.timeoutMs) {
        break;
      }
      await sleep(input.pollIntervalMs);
    }
  }

  const tail = lastError ? ` lastError="${lastError.message}"` : "";
  fail(`${input.label} timed out after ${String(input.timeoutMs)}ms.${tail}`);
};

const waitForDispatchCorrelation = async (input) => {
  await waitForCondition({
    label: "dispatch correlation",
    timeoutMs: input.timeoutMs,
    pollIntervalMs: input.pollIntervalMs,
    evaluate: async (attempt) => {
      const historyResult = runCliCommand(
        input.evidenceDir,
        `delivery-stability-space-history-attempt-${String(attempt)}`,
        resolveCliTemplateArgs("space history", {
          "<space-id>": input.spaceId,
          "<history-limit>": String(input.historyLimit),
          "<sender-profile>": input.senderProfile,
        }),
        "space history"
      );
      const correlation = buildDispatchCorrelation(
        historyResult.stdout,
        input.sourceEventId,
        input.senderProfile,
        input.targetProfile
      );
      const snapshot = await assertDispatchSnapshotReady({
        evidenceDir: input.evidenceDir,
        sourceEventId: input.sourceEventId,
        attempt,
      });
      assertDispatchSnapshotNotTerminal(snapshot);
      await resolveDispatchDlqState({
        evidenceDir: input.evidenceDir,
        dispatchId: snapshot.ledgerDispatchId,
        attempt,
      });
      const assertedCorrelation = assertDispatchCorrelationValue(
        correlation,
        input.sourceEventId,
        input.targetProfile
      );
      assertDispatchSnapshotAgainstReplyWhenPresent(
        snapshot,
        assertedCorrelation.dispatchId
      );
      assertRuntimeOutputCorrelation({
        runtimeLogPath: input.runtimeLogPath,
        dispatchId: snapshot.ledgerDispatchId,
        taskId: assertedCorrelation.taskId,
        replyText: assertedCorrelation.replyText,
      });
    },
  });
};

const runDeliveryStabilityGateChecks = async (input) => {
  const observationNowMs = Math.max(0, Math.floor(input.nowMs ?? Date.now()));
  const observation = await readDeliveryStabilityGateObservation({
    attempt: input.attempt,
    evidenceDir: input.evidenceDir,
    nowMs: observationNowMs,
    observeWindowMs: input.observeWindowMs,
    dispatchingTimeoutMs: input.dispatchingTimeoutMs,
    baselineWindowMs: input.baselineWindowMs,
    failedTerminalRateLimit: input.failedTerminalRateLimit,
    coldStartTimeoutRateLimit: input.coldStartTimeoutRateLimit,
    dispatchingTimeoutCountLimit: input.dispatchingTimeoutCountLimit,
    dedupedRatioSpikeMultiplier: input.dedupedRatioSpikeMultiplier,
    dedupedRatioFallbackLimit: input.dedupedRatioFallbackLimit,
  });

  const deliveryStabilitySummary = {
    attempt: input.attempt,
    nowMs: observationNowMs,
    metrics: observation.metrics,
    baseline: {
      dedupedRatio: observation.baselineObservation.dedupedRatio,
      dedupedRatioLimit: observation.evaluation.dedupedRatioLimit,
    },
    evaluation: {
      ok: observation.evaluation.ok,
      limits: observation.limits,
      reasons: observation.evaluation.reasons,
    },
  };
  writeFileSync(
    path.join(
      input.evidenceDir,
      `delivery-stability-attempt-${String(input.attempt)}.json`
    ),
    `${JSON.stringify(deliveryStabilitySummary, null, 2)}\n`,
    "utf8"
  );

  if (!deliveryStabilitySummary.evaluation.ok) {
    fail(
      [
        `delivery stability gate failed at attempt ${String(input.attempt)}`,
        ...deliveryStabilitySummary.evaluation.reasons,
      ].join("\n")
    );
  }

  process.stdout.write(
    `${[
      `delivery stability metrics attempt ${String(input.attempt)} passed`,
      `failed_terminal_rate=${formatDeliveryStabilityRate(
        deliveryStabilitySummary.metrics.failedTerminalRate
      )} (limit ${formatDeliveryStabilityRate(
        deliveryStabilitySummary.evaluation.limits.failedTerminalRateLimit
      )})`,
      `cold_start_timeout_rate=${formatDeliveryStabilityRate(
        deliveryStabilitySummary.metrics.coldStartTimeoutRate
      )} (limit ${formatDeliveryStabilityRate(
        deliveryStabilitySummary.evaluation.limits.coldStartTimeoutRateLimit
      )})`,
      `dispatching_timeout_count=${String(
        deliveryStabilitySummary.metrics.dispatchingTimeoutCount
      )} (limit ${String(
        deliveryStabilitySummary.evaluation.limits.dispatchingTimeoutCountLimit
      )})`,
      `deduped_ratio=${formatDeliveryStabilityRate(
        deliveryStabilitySummary.metrics.dedupedRatio
      )} (baseline=${formatDeliveryStabilityRate(
        deliveryStabilitySummary.baseline.dedupedRatio
      )}, spikeLimit=${formatDeliveryStabilityRate(
        deliveryStabilitySummary.baseline.dedupedRatioLimit
      )})`,
    ].join("\n")}\n`
  );
};

const extractSignalIdFromSendResponse = (rawOutput, label) => {
  const rows = parseNdjson(rawOutput, label);
  const responseRow = rows.find((row) => row?.code === "send.response") ?? null;
  const signalId = String(responseRow?.payload?.id ?? "").trim();
  if (!signalId) {
    fail(`${label}: missing send.response payload.id`);
  }
  return signalId;
};

const assertObservabilitySourceContract = () => {
  for (const item of OBSERVABILITY_SOURCE_ASSERTIONS) {
    const fullPath = path.resolve(REPO_ROOT, item.file);
    if (!existsSync(fullPath)) {
      fail(`missing observability source file: ${item.file}`);
    }
    const raw = readFileSync(fullPath, "utf8");
    if (!raw.includes(item.token)) {
      fail(
        `observability token missing for ${item.semanticField}: expected "${item.token}" in ${item.file}`
      );
    }
  }
};

const truncate = (value, maxLength) => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
};

const prepareEvidenceDir = (inputPath) => {
  const trimmed = inputPath.trim();
  if (trimmed) {
    const fullPath = path.resolve(REPO_ROOT, trimmed);
    mkdirSync(fullPath, { recursive: true });
    return fullPath;
  }
  return mkdtemp(path.join(os.tmpdir(), "local-execution-dogfooding-"));
};

const runPrecheckCommands = (evidenceDir) => {
  for (const [index, command] of PRECHECK_COMMANDS.entries()) {
    if (
      command.skipEnvVar &&
      String(process.env[command.skipEnvVar] ?? "").trim() === "1"
    ) {
      process.stdout.write(
        `skip precheck "${command.label}" because ${command.skipEnvVar}=1\n`
      );
      continue;
    }

    const result = runAndRecord(
      evidenceDir,
      `delivery-stability-precheck-${index + 1}-${command.label.replace(/\s+/g, "-")}`,
      command
    );
    if (
      result.status !== 0 &&
      command.skipEnvVar &&
      String(process.env[command.skipEnvVar] ?? "").trim() !== "1"
    ) {
      const hint = `Hint: set ${command.skipEnvVar}=1 to bypass this precheck when unrelated workspace issues are being handled by another owner.`;
      const stderr = truncate(String(result.stderr ?? "").trim(), 900);
      fail(`${command.label} failed.\n${hint}\n${stderr}`);
    }
    assertExitCode(result, command.label);
  }
};

const runCliCommand = (evidenceDir, evidenceName, args, label) => {
  const result = runAndRecord(evidenceDir, evidenceName, {
    command: process.execPath,
    args: [...OPENMELD_DEV_ARGS_PREFIX, ...args],
    label,
  });
  assertExitCode(result, label);
  return result;
};

const runCliCommandWithGatewayRetry = async (input) => {
  const startedAt = Date.now();
  let attempt = 0;
  let lastRetryError = null;

  while (Date.now() - startedAt <= input.timeoutMs) {
    attempt += 1;
    const evidenceName = `${input.evidenceNamePrefix}-attempt-${String(attempt)}`;
    const result = runAndRecord(input.evidenceDir, evidenceName, {
      command: process.execPath,
      args: [...OPENMELD_DEV_ARGS_PREFIX, ...input.args],
      label: input.label,
    });
    if (result.status === 0) {
      return result;
    }
    if (!isRetryableGatewayCliFailure(result)) {
      assertExitCode(result, input.label);
    }

    lastRetryError = new Error(
      `${input.label} retryable failure (attempt ${String(attempt)}): ${truncate(String(result.stdout ?? "").trim(), 500)}`
    );
    if (Date.now() - startedAt >= input.timeoutMs) {
      break;
    }
    await sleep(input.pollIntervalMs);
  }

  if (lastRetryError) {
    fail(
      `${input.label} retry timed out after ${String(input.timeoutMs)}ms: ${lastRetryError.message}`
    );
  }
  fail(`${input.label} retry timed out after ${String(input.timeoutMs)}ms`);
};

const toError = (error) =>
  error instanceof Error ? error : new Error(String(error));

const appendError = (primaryError, nextError, label) => {
  if (!nextError) {
    return primaryError;
  }
  const typedNextError = toError(nextError);
  if (primaryError) {
    return new Error(
      `${primaryError.message}; ${label}: ${typedNextError.message}`
    );
  }
  return typedNextError;
};

const restoreInitialServiceState = (input) => {
  if (typeof input.initialInstalled !== "boolean") {
    return null;
  }

  const restoreAction = input.initialInstalled ? "install" : "uninstall";
  runCliCommand(
    input.evidenceDir,
    `delivery-stability-service-restore-${restoreAction}`,
    ["service", restoreAction, "--view", "agent"],
    `restore service ${restoreAction}`
  );
  const restoreStatusResult = runCliCommand(
    input.evidenceDir,
    `delivery-stability-service-status-after-restore-${restoreAction}`,
    ["service", "status", "--view", "agent"],
    "service status after restore"
  );
  const restoredInstalled = extractInstalled(restoreStatusResult.stdout);
  if (restoredInstalled !== input.initialInstalled) {
    fail(
      `service restore mismatch: expected installed=${String(input.initialInstalled)}, got installed=${String(restoredInstalled)}`
    );
  }
  return null;
};

const verifyServiceStateAndSpaceCorrelation = async (input) => {
  const serviceStatusArgs = resolveCliTemplateArgs("service status");
  const serviceInstallArgs = resolveCliTemplateArgs("service install");
  const beforeStatusResult = runCliCommand(
    input.evidenceDir,
    "delivery-stability-service-status-before",
    serviceStatusArgs,
    "service status before"
  );
  input.flowState.initialInstalled = extractInstalled(
    beforeStatusResult.stdout
  );

  runCliCommand(
    input.evidenceDir,
    "delivery-stability-service-install",
    serviceInstallArgs,
    "service install"
  );

  const afterInstallStatusResult = runCliCommand(
    input.evidenceDir,
    "delivery-stability-service-status-after-install",
    serviceStatusArgs,
    "service status after install"
  );
  const installedAfterInstall = extractInstalled(
    afterInstallStatusResult.stdout
  );
  if (!installedAfterInstall) {
    fail("expected installed=true after service install");
  }

  const marker = `${RUN_MARKER_PREFIX}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  writeFileSync(
    path.join(input.evidenceDir, "delivery-stability-run-marker.txt"),
    `${marker}\n`,
    "utf8"
  );

  const triggerResult = await runCliCommandWithGatewayRetry({
    evidenceDir: input.evidenceDir,
    evidenceNamePrefix: "delivery-stability-space-send-trigger",
    args: resolveCliTemplateArgs("space send trigger", {
      "<space-id>": input.spaceId,
      "[delivery-trace] <marker> @<target-profile>": `[delivery-trace] ${marker} @${input.profiles.targetProfile}`,
      "<target-profile>": input.profiles.targetProfile,
      "<sender-profile>": input.profiles.senderProfile,
    }),
    label: "space send trigger",
    timeoutMs: input.correlationTimeoutMs,
    pollIntervalMs: input.correlationPollMs,
  });
  const sourceEventId = extractSignalIdFromSendResponse(
    triggerResult.stdout,
    "space send trigger"
  );
  writeFileSync(
    path.join(input.evidenceDir, "delivery-stability-source-event-id.txt"),
    `${sourceEventId}\n`,
    "utf8"
  );

  await waitForDispatchCorrelation({
    evidenceDir: input.evidenceDir,
    spaceId: input.spaceId,
    sourceEventId,
    senderProfile: input.profiles.senderProfile,
    targetProfile: input.profiles.targetProfile,
    runtimeLogPath: input.runtimeLogPath,
    historyLimit: input.historyLimit,
    timeoutMs: input.correlationTimeoutMs,
    pollIntervalMs: input.correlationPollMs,
  });
};

const executeRealDogfoodingFlow = async (input) => {
  runPrecheckCommands(input.evidenceDir);
  assertObservabilitySourceContract();

  const devState = await ensureDevStack(input.evidenceDir);
  input.flowState.startedDevStack = devState.startedByScript;

  const profiles = await resolveProfilesWithRetry({
    evidenceDir: input.evidenceDir,
    senderOverride: process.env.OPENMELD_DOGFOODING_AGENT_PROFILE,
    targetOverride: process.env.OPENMELD_DOGFOODING_TARGET_PROFILE,
    startedByScript: devState.startedByScript,
  });
  process.stdout.write(
    `dogfooding sender/target profiles: ${profiles.senderProfile} / ${profiles.targetProfile}\n`
  );

  let consecutivePasses = 0;
  for (
    let pass = 1;
    pass <= input.deliveryStabilityRequiredConsecutivePasses;
    pass += 1
  ) {
    process.stdout.write(
      `Delivery stability gate attempt ${String(pass)}/${String(input.deliveryStabilityRequiredConsecutivePasses)}\n`
    );

    await verifyServiceStateAndSpaceCorrelation({
      ...input,
      profiles,
      runtimeLogPath: input.runtimeLogPath,
    });

    await runDeliveryStabilityGateChecks({
      attempt: pass,
      evidenceDir: input.evidenceDir,
      observeWindowMs: input.deliveryStabilityObserveWindowMs,
      dispatchingTimeoutMs: input.deliveryStabilityDispatchingTimeoutMs,
      baselineWindowMs: input.deliveryStabilityDedupedRatioBaselineWindowMs,
      failedTerminalRateLimit: input.deliveryStabilityFailedTerminalRateLimit,
      coldStartTimeoutRateLimit:
        input.deliveryStabilityColdStartTimeoutRateLimit,
      dispatchingTimeoutCountLimit:
        input.deliveryStabilityDispatchingTimeoutCountLimit,
      dedupedRatioSpikeMultiplier:
        input.deliveryStabilityDedupedRatioSpikeMultiplier,
      dedupedRatioFallbackLimit:
        input.deliveryStabilityDedupedRatioFallbackLimit,
    });

    consecutivePasses += 1;
    process.stdout.write(
      `Delivery stability gate passed in this attempt. consecutive pass=${String(consecutivePasses)}\n`
    );
  }

  process.stdout.write(
    `Real dogfooding verification passed: dispatch chain correlation + runtime output correlation + service state + observability contracts + Delivery stability gate ${String(consecutivePasses)}/${String(input.deliveryStabilityRequiredConsecutivePasses)}.\n`
  );
};

async function main() {
  assertNodeVersion();

  const evidenceDir = await prepareEvidenceDir(
    String(
      process.env.OPENMELD_DOGFOODING_DELIVERY_STABILITY_EVIDENCE_DIR ?? ""
    )
  );
  const spaceId = resolveSpaceId();
  const runtimeLogPath = resolveRuntimeLogPath();
  const historyLimit = parsePositiveInteger(
    process.env.OPENMELD_DOGFOODING_DELIVERY_STABILITY_HISTORY_LIMIT,
    DEFAULT_HISTORY_LIMIT,
    "OPENMELD_DOGFOODING_DELIVERY_STABILITY_HISTORY_LIMIT"
  );
  const correlationTimeoutMs = parsePositiveInteger(
    process.env.OPENMELD_DOGFOODING_DELIVERY_STABILITY_CORRELATION_TIMEOUT_MS,
    DEFAULT_CORRELATION_TIMEOUT_MS,
    "OPENMELD_DOGFOODING_DELIVERY_STABILITY_CORRELATION_TIMEOUT_MS"
  );
  const correlationPollMs = parsePositiveInteger(
    process.env.OPENMELD_DOGFOODING_DELIVERY_STABILITY_CORRELATION_POLL_MS,
    DEFAULT_CORRELATION_POLL_MS,
    "OPENMELD_DOGFOODING_DELIVERY_STABILITY_CORRELATION_POLL_MS"
  );
  const deliveryStabilityRequiredConsecutivePasses = parsePositiveInteger(
    process.env
      .OPENMELD_DOGFOODING_DELIVERY_STABILITY_REQUIRED_CONSECUTIVE_PASSES,
    DELIVERY_STABILITY_GATE_REQUIRED_CONSECUTIVE_PASSES,
    "OPENMELD_DOGFOODING_DELIVERY_STABILITY_REQUIRED_CONSECUTIVE_PASSES"
  );
  const deliveryStabilityObserveWindowMs = parsePositiveInteger(
    process.env.OPENMELD_DOGFOODING_DELIVERY_STABILITY_OBSERVE_WINDOW_MS,
    DELIVERY_STABILITY_GATE_OBSERVE_WINDOW_MS,
    "OPENMELD_DOGFOODING_DELIVERY_STABILITY_OBSERVE_WINDOW_MS"
  );
  const deliveryStabilityDispatchingTimeoutMs = parsePositiveInteger(
    process.env.OPENMELD_DOGFOODING_DELIVERY_STABILITY_DISPATCHING_TIMEOUT_MS,
    DELIVERY_STABILITY_GATE_DISPATCHING_TIMEOUT_MS,
    "OPENMELD_DOGFOODING_DELIVERY_STABILITY_DISPATCHING_TIMEOUT_MS"
  );
  const deliveryStabilityDedupedRatioBaselineWindowMs = parsePositiveInteger(
    process.env
      .OPENMELD_DOGFOODING_DELIVERY_STABILITY_DEDUPED_RATIO_BASELINE_WINDOW_MS,
    DELIVERY_STABILITY_GATE_DEFAULT_DEDUPED_BASELINE_WINDOW_MS,
    "OPENMELD_DOGFOODING_DELIVERY_STABILITY_DEDUPED_RATIO_BASELINE_WINDOW_MS"
  );
  const deliveryStabilityFailedTerminalRateLimit = parseDeliveryStabilityRate(
    process.env
      .OPENMELD_DOGFOODING_DELIVERY_STABILITY_FAILED_TERMINAL_RATE_LIMIT,
    DELIVERY_STABILITY_GATE_FAILED_TERMINAL_RATE_LIMIT,
    "OPENMELD_DOGFOODING_DELIVERY_STABILITY_FAILED_TERMINAL_RATE_LIMIT"
  );
  const deliveryStabilityColdStartTimeoutRateLimit = parseDeliveryStabilityRate(
    process.env
      .OPENMELD_DOGFOODING_DELIVERY_STABILITY_COLD_START_TIMEOUT_RATE_LIMIT,
    DELIVERY_STABILITY_GATE_COLD_START_TIMEOUT_RATE_LIMIT,
    "OPENMELD_DOGFOODING_DELIVERY_STABILITY_COLD_START_TIMEOUT_RATE_LIMIT"
  );
  const deliveryStabilityDispatchingTimeoutCountLimit = parseNonNegativeInteger(
    process.env
      .OPENMELD_DOGFOODING_DELIVERY_STABILITY_DISPATCHING_TIMEOUT_COUNT_LIMIT,
    DELIVERY_STABILITY_GATE_DISPATCHING_TIMEOUT_COUNT_LIMIT,
    "OPENMELD_DOGFOODING_DELIVERY_STABILITY_DISPATCHING_TIMEOUT_COUNT_LIMIT"
  );
  const deliveryStabilityDedupedRatioSpikeMultiplier = parsePositiveNumber(
    process.env
      .OPENMELD_DOGFOODING_DELIVERY_STABILITY_DEDUPED_RATIO_SPIKE_MULTIPLIER,
    DELIVERY_STABILITY_GATE_DEDUPED_RATIO_SPIKE_MULTIPLIER,
    "OPENMELD_DOGFOODING_DELIVERY_STABILITY_DEDUPED_RATIO_SPIKE_MULTIPLIER"
  );
  const deliveryStabilityDedupedRatioFallbackLimit = parseDeliveryStabilityRate(
    process.env
      .OPENMELD_DOGFOODING_DELIVERY_STABILITY_DEDUPED_RATIO_FALLBACK_LIMIT,
    DELIVERY_STABILITY_GATE_DEDUPED_RATIO_FALLBACK_LIMIT,
    "OPENMELD_DOGFOODING_DELIVERY_STABILITY_DEDUPED_RATIO_FALLBACK_LIMIT"
  );

  process.stdout.write(`Delivery stability evidence dir: ${evidenceDir}\n`);
  process.stdout.write(`Space id: ${spaceId}\n`);
  process.stdout.write(`Runtime log: ${runtimeLogPath}\n`);
  process.stdout.write(
    `Delivery stability correlation timeout/poll: ${String(
      correlationTimeoutMs
    )}ms / ${String(correlationPollMs)}ms\n`
  );
  process.stdout.write(
    `Delivery stability gate: passes=${String(
      deliveryStabilityRequiredConsecutivePasses
    )}, observeWindowMs=${String(deliveryStabilityObserveWindowMs)}, dispatchingTimeoutMs=${String(deliveryStabilityDispatchingTimeoutMs)}, baselineWindowMs=${String(deliveryStabilityDedupedRatioBaselineWindowMs)}\n`
  );

  const flowState = {
    initialInstalled: null,
    startedDevStack: false,
  };
  let primaryError = null;

  try {
    await executeRealDogfoodingFlow({
      evidenceDir,
      spaceId,
      runtimeLogPath,
      historyLimit,
      correlationTimeoutMs,
      correlationPollMs,
      deliveryStabilityRequiredConsecutivePasses,
      deliveryStabilityObserveWindowMs,
      deliveryStabilityDispatchingTimeoutMs,
      deliveryStabilityDedupedRatioBaselineWindowMs,
      deliveryStabilityFailedTerminalRateLimit,
      deliveryStabilityColdStartTimeoutRateLimit,
      deliveryStabilityDispatchingTimeoutCountLimit,
      deliveryStabilityDedupedRatioSpikeMultiplier,
      deliveryStabilityDedupedRatioFallbackLimit,
      flowState,
    });
  } catch (error) {
    primaryError = toError(error);
  }

  try {
    restoreInitialServiceState({
      evidenceDir,
      initialInstalled: flowState.initialInstalled,
    });
  } catch (restoreError) {
    primaryError = appendError(primaryError, restoreError, "cleanup failed");
  }

  try {
    if (flowState.startedDevStack) {
      stopDevStack(evidenceDir);
    }
  } catch (stopError) {
    primaryError = appendError(primaryError, stopError, "dev-stop failed");
  }

  if (primaryError) {
    throw primaryError;
  }
}

export const TEST_ONLY = {
  DEFAULT_CORRELATION_POLL_MS,
  DEFAULT_CORRELATION_TIMEOUT_MS,
  assertDispatchCorrelation,
  assertDispatchCorrelationValue,
  assertDispatchSnapshotNotTerminal,
  buildDispatchCorrelation,
  extractReplyMetadata,
  extractSignalIdFromSendResponse,
  isRetryableGatewayCliFailure,
  parsePositiveNumber,
  parseDeliveryStabilityRate,
  readDeliveryStabilityDispatchMetrics,
  evaluateDeliveryStabilityGate,
  readDeliveryStabilityGateObservation,
  parsePositiveInteger,
  readRuntimeLogCorrelation,
  waitForCondition,
};

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_FILE) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify-real-dogfooding failed: ${message}\n`);
    process.exit(1);
  });
}
