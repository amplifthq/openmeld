#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);

export const OPENMELD_DEV_ARGS_PREFIX = [
  "clients/openmeld-cli/dist/openmeld-dev.js",
];
export const SERVICE_LIFECYCLE_EVIDENCE_DIR = "SERVICE_LIFECYCLE_EVIDENCE_DIR";
export const RECOMMENDATION_CODE = "daemon.bootstrap.recommended";
export const STATUS_CODE = "daemon.status.result";
export const STARTUP_AUTO_INSTALL_MODES = ["ask", "never", "always"];

async function main() {
  const evidenceDir = await prepareEvidenceDir(
    process.env[SERVICE_LIFECYCLE_EVIDENCE_DIR] ?? ""
  );
  const profileSelection = resolveAgentProfileSelection();
  const profileId = profileSelection.profileId;
  let initialInstalled = null;
  let primaryError = null;

  try {
    process.stdout.write(`service lifecycle evidence dir: ${evidenceDir}\n`);
    process.stdout.write(
      `service lifecycle using profile: ${profileId} (${profileSelection.source})\n`
    );

    runProfilePreflight(profileId, evidenceDir);

    const beforeStatusResult = runCliCommand(
      ["--view", "agent", "service", "status"],
      "service-status-before",
      evidenceDir
    );
    assertExitCode(beforeStatusResult, "service status before");
    initialInstalled = extractInstalled(beforeStatusResult.stdout);

    const serviceStatusResult = runCliCommand(
      ["service", "status"],
      "service-status-human-before",
      evidenceDir
    );
    assertExitCode(serviceStatusResult, "service status (human)");

    const serviceInstallResult = runCliCommand(
      ["service", "install"],
      "service-install-human",
      evidenceDir
    );
    assertExitCode(serviceInstallResult, "service install");

    const serviceUninstallResult = runCliCommand(
      ["service", "uninstall"],
      "service-uninstall-human",
      evidenceDir
    );
    assertExitCode(serviceUninstallResult, "service uninstall");

    const defaultAskResult = runCliCommand(
      ["--view", "agent", "whoami", "--profile", profileId],
      "service-lifecycle-default-ask",
      evidenceDir
    );
    assertExitCode(defaultAskResult, "startup check default mode");
    assertRecommendationMode(defaultAskResult.stdout, "ask");

    const askResult = runCliCommand(
      buildWhoamiArgsForMode({
        mode: "ask",
        profileId,
      }),
      "service-lifecycle-ask",
      evidenceDir
    );
    assertExitCode(askResult, "startup check ask");
    assertRecommendationMode(askResult.stdout, "ask");

    const afterAskStatusResult = runCliCommand(
      ["--view", "agent", "service", "status"],
      "service-lifecycle-status-after-ask",
      evidenceDir
    );
    assertExitCode(afterAskStatusResult, "service status after ask");
    assertInstalledState(afterAskStatusResult.stdout, false, "ask");

    const neverResult = runCliCommand(
      buildWhoamiArgsForMode({
        mode: "never",
        profileId,
      }),
      "service-lifecycle-never",
      evidenceDir
    );
    assertExitCode(neverResult, "startup check never");
    assertRecommendationMode(neverResult.stdout, "never");

    const afterNeverStatusResult = runCliCommand(
      ["--view", "agent", "service", "status"],
      "service-lifecycle-status-after-never",
      evidenceDir
    );
    assertExitCode(afterNeverStatusResult, "service status after never");
    assertInstalledState(afterNeverStatusResult.stdout, false, "never");

    const alwaysResult = runCliCommand(
      buildWhoamiArgsForMode({
        mode: "always",
        profileId,
      }),
      "service-lifecycle-always",
      evidenceDir
    );
    assertExitCode(alwaysResult, "startup check always");

    const afterAlwaysStatusResult = runCliCommand(
      ["--view", "agent", "service", "status"],
      "service-lifecycle-status-after-always",
      evidenceDir
    );
    assertExitCode(afterAlwaysStatusResult, "service status after always");
    assertInstalledState(afterAlwaysStatusResult.stdout, true, "always");

    process.stdout.write(
      "service lifecycle verification passed: startup auto-install matrix.\n"
    );
  } catch (error) {
    primaryError = toError(error);
  }

  const restoreError = restoreInitialInstallState(
    initialInstalled,
    evidenceDir
  );
  if (primaryError && restoreError) {
    fail(`${primaryError.message}; cleanup failed: ${restoreError.message}`);
  }
  if (primaryError) {
    throw primaryError;
  }
  if (restoreError) {
    throw restoreError;
  }
}

function resolveAgentProfileSelection() {
  const fromEnv = String(process.env.AGENT_PROFILE_ID ?? "").trim();
  if (fromEnv) {
    return {
      profileId: fromEnv,
      source: "AGENT_PROFILE_ID",
    };
  }

  const profileListResult = spawnSync(
    process.execPath,
    [...OPENMELD_DEV_ARGS_PREFIX, "--view", "agent", "profile", "list"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    }
  );

  assertExitCode(profileListResult, "profile list");

  const rows = parseNdjson(profileListResult.stdout, "profile list");
  const selected =
    rows.find((row) => row?.code === "profile.item" && row?.data?.default) ??
    rows.find((row) => row?.code === "profile.item" && row?.data?.profile) ??
    null;

  const profileId = String(selected?.data?.profile ?? "").trim();
  if (!profileId) {
    fail(
      [
        "cannot resolve agent profile for verify:local-execution:service-lifecycle.",
        "preflight options:",
        "1) Recommended: AGENT_PROFILE_ID=<agent-profile-id> pnpm run verify:local-execution:service-lifecycle",
        "2) Or export AGENT_PROFILE_ID=<agent-profile-id>",
        "3) If no agent profile exists yet, create one:",
        "   node clients/openmeld-cli/dist/openmeld-dev.js --view agent profile create <profile-name> --kind agent",
        "4) Optional (interactive terminal only): set a selected profile:",
        "   node clients/openmeld-cli/dist/openmeld-dev.js --view agent profile list",
        "   node clients/openmeld-cli/dist/openmeld-dev.js --view agent profile set <agent-profile-id>",
        "then rerun: pnpm run verify:local-execution:service-lifecycle",
      ].join("\n")
    );
  }

  return {
    profileId,
    source: "resolved from profile list",
  };
}

const buildWhoamiArgsForMode = (input) => [
  "--view",
  "agent",
  "--service-auto-install",
  input.mode,
  "whoami",
  "--profile",
  input.profileId,
];

function runProfilePreflight(profileId, evidenceDir) {
  const listResult = runCliCommand(
    ["--view", "agent", "profile", "list"],
    "service-lifecycle-profile-preflight-list",
    evidenceDir
  );
  assertExitCode(listResult, "profile preflight (profile list)");

  const rows = parseNdjson(listResult.stdout, "profile preflight list");
  const availableProfiles = rows
    .filter((row) => row?.code === "profile.item")
    .map((row) => String(row?.data?.profile ?? "").trim())
    .filter(Boolean);

  if (availableProfiles.length === 0) {
    fail(
      [
        "profile preflight failed: no agent profile found in current OpenMeld workspace.",
        "create one first:",
        "  node clients/openmeld-cli/dist/openmeld-dev.js --view agent start",
        "then rerun verify:local-execution:service-lifecycle with:",
        "  AGENT_PROFILE_ID=<agent-profile-id> pnpm run verify:local-execution:service-lifecycle",
      ].join("\n")
    );
  }

  if (!availableProfiles.includes(profileId)) {
    fail(
      [
        `profile preflight failed: AGENT_PROFILE_ID="${profileId}" not found.`,
        "available profiles:",
        ...availableProfiles.map((item) => `  - ${item}`),
        "fix:",
        "  AGENT_PROFILE_ID=<agent-profile-id> pnpm run verify:local-execution:service-lifecycle",
      ].join("\n")
    );
  }
}

function runCliCommand(args, evidenceFileName, evidenceDir) {
  const result = spawnSync(
    process.execPath,
    [...OPENMELD_DEV_ARGS_PREFIX, ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    }
  );

  writeEvidence(evidenceDir, evidenceFileName, args, result);
  return result;
}

function assertExitCode(result, label) {
  const status = result.status;
  if (typeof status === "number" && status === 0) {
    return;
  }

  const stderr = truncate(String(result.stderr ?? "").trim(), 1200);
  const stdout = truncate(String(result.stdout ?? "").trim(), 1200);
  fail(
    `${label} failed (exit=${String(status ?? "null")}). stdout="${stdout}" stderr="${stderr}"`
  );
}

export function extractInstalled(rawOutput) {
  const rows = parseNdjson(rawOutput, "service status");
  const statusRow = rows.find((row) => row?.code === STATUS_CODE) ?? null;
  if (!statusRow) {
    fail(`missing ${STATUS_CODE} in service status output`);
  }
  return Boolean(statusRow.payload?.installed);
}

function assertInstalledState(rawOutput, expectedInstalled, modeLabel) {
  const installed = extractInstalled(rawOutput);
  if (installed !== expectedInstalled) {
    fail(
      `expected installed=${String(expectedInstalled)} after ${modeLabel}, got installed=${String(installed)}`
    );
  }
}

export function assertRecommendationMode(rawOutput, expectedMode) {
  const rows = parseNdjson(rawOutput, `startup check (${expectedMode})`);
  const recommendation =
    rows.find((row) => row?.code === RECOMMENDATION_CODE) ?? null;

  if (!recommendation) {
    fail(`missing ${RECOMMENDATION_CODE} for mode=${expectedMode}`);
  }

  const mode = String(recommendation.payload?.autoInstallMode ?? "");
  if (mode !== expectedMode) {
    fail(
      `unexpected autoInstallMode for mode=${expectedMode}, got autoInstallMode="${mode}"`
    );
  }
}

export function parseNdjson(rawOutput, label) {
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
      fail(`${label}: invalid JSON at line ${index + 1}: ${reason}`);
    }
  }
  return parsed;
}

function writeEvidence(evidenceDir, fileName, args, result) {
  const commandText = [
    process.execPath,
    ...OPENMELD_DEV_ARGS_PREFIX,
    ...args,
  ].join(" ");
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
}

async function prepareEvidenceDir(inputPath) {
  const trimmedPath = inputPath.trim();
  if (trimmedPath) {
    await mkdir(trimmedPath, { recursive: true });
    return path.resolve(process.cwd(), trimmedPath);
  }

  return mkdtemp(path.join(os.tmpdir(), "service-lifecycle-"));
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function fail(message) {
  throw new Error(message);
}

function restoreInitialInstallState(initialInstalled, evidenceDir) {
  if (typeof initialInstalled !== "boolean") {
    return null;
  }

  try {
    const expectedAction = initialInstalled ? "install" : "uninstall";
    const restoreResult = runCliCommand(
      ["service", expectedAction],
      `service-restore-${expectedAction}`,
      evidenceDir
    );
    assertExitCode(restoreResult, `restore ${expectedAction}`);

    const verifyResult = runCliCommand(
      ["--view", "agent", "service", "status"],
      `service-restore-status-after-${expectedAction}`,
      evidenceDir
    );
    assertExitCode(verifyResult, "service status after restore");

    const restoredInstalled = extractInstalled(verifyResult.stdout);
    if (restoredInstalled !== initialInstalled) {
      fail(
        `restore verification failed: expected installed=${String(initialInstalled)}, got installed=${String(restoredInstalled)}`
      );
    }

    return null;
  } catch (error) {
    return toError(error);
  }
}

function toError(error) {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_FILE) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify-service-lifecycle failed: ${message}\n`);
    process.exit(1);
  });
}
