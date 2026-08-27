import { chmod, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  assertCoalescedStagingUpdate,
  parseStagingWebSetupCommand,
  readStagingSetupSensitiveValues,
} from "./staging-computer-update-smoke-contract.mjs";
import {
  assertCanaryLaunchdLabelsFree,
  assertCliVersion,
  assertGitWorktreeClean,
  assertLiveSmokeHost,
  CANARY_HOME,
  cleanupCanaryServices,
  pass,
  preserveCanaryHome,
  REPO_ROOT,
  readProtectedSetupCommand,
  readStagingManifest,
  restartCanaryService,
  runCommand,
  runFocusedUpdateContracts,
  runStagingApiHelper,
  runStagingSetup,
  waitForCoreToReportCurrentVersion,
  waitForNewStagingManifest,
  waitForServiceRunning,
  waitForUpdateOperation,
} from "./staging-computer-update-smoke-local.mjs";

const LIVE_UPDATE_START_TIMEOUT_MS = 6 * 60 * 1000;
const LIVE_UPDATE_FINISH_TIMEOUT_MS = 15 * 60 * 1000;
const TERMINAL_UPDATE_PHASES = new Set(["needs_help", "restored", "updated"]);

export async function runLiveStagingComputerSmoke(options) {
  assertLiveSmokeHost();
  assertGitWorktreeClean();
  assertCanaryLaunchdLabelsFree();

  const setupCommand = await readProtectedSetupCommand(
    options.setupCommandFile
  );
  const parsedSetup = parseStagingWebSetupCommand(setupCommand);
  const sensitiveValues = readStagingSetupSensitiveValues(
    parsedSetup.setupArgs
  );
  const runRoot = path.join(
    REPO_ROOT,
    "dev-tmp",
    "staging-computer-smoke",
    `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${String(process.pid)}`
  );
  const backupHome = path.join(runRoot, "previous-canary-home");
  const lifecycle = {
    previousHomePreserved: false,
    smokeHomeCreated: false,
    stagingComputerConnected: false,
  };
  let runFailure = null;
  let cleanupFailure = null;

  await mkdir(runRoot, { recursive: true, mode: 0o700 });
  await chmod(runRoot, 0o700);
  try {
    await executeStagingComputerUpdateSmoke({
      backupHome,
      lifecycle,
      parsedSetup,
      runRoot,
      sensitiveValues,
    });
    process.stdout.write("[staging-computer-smoke] PASS\n");
  } catch (error) {
    runFailure = error;
  } finally {
    cleanupFailure = await cleanupStagingComputerUpdateSmoke({
      backupHome,
      lifecycle,
      runFailure,
      runRoot,
      sensitiveValues,
    });
  }
  if (cleanupFailure) {
    throw cleanupFailure;
  }
  if (runFailure) {
    throw runFailure;
  }
}

async function executeStagingComputerUpdateSmoke(input) {
  runFocusedUpdateContracts({ sensitiveValues: input.sensitiveValues });
  pass("Update safety contracts");

  const baselineManifest = await readStagingManifest();
  pass("Staging CLI channel", baselineManifest.version);

  input.lifecycle.previousHomePreserved = await preserveCanaryHome(
    input.backupHome
  );
  input.lifecycle.smokeHomeCreated = true;
  await runStagingSetup(input);
  input.lifecycle.stagingComputerConnected = true;
  assertCliVersion({
    expectedVersion: baselineManifest.version,
    sensitiveValues: input.sensitiveValues,
  });
  await waitForServiceRunning({
    expectedVersion: baselineManifest.version,
    sensitiveValues: input.sensitiveValues,
  });
  pass("Canary Computer connected", baselineManifest.version);

  runCommand({
    args: ["staging:cli:publish"],
    command: "pnpm",
    label: "publish a newer Staging CLI",
    sensitiveValues: input.sensitiveValues,
    timeoutMs: 30 * 60 * 1000,
  });
  const targetManifest = await waitForNewStagingManifest(
    baselineManifest.version
  );
  pass("New Staging CLI published", targetManifest.version);

  enableAutomaticUpdates(input.sensitiveValues);
  restartCanaryService({ sensitiveValues: input.sensitiveValues });
  const operationId = await verifyAutomaticAndManualUpdate({
    sensitiveValues: input.sensitiveValues,
    targetVersion: targetManifest.version,
  });
  await verifyCompletedUpdate({
    operationId,
    sensitiveValues: input.sensitiveValues,
    targetVersion: targetManifest.version,
  });
}

function enableAutomaticUpdates(sensitiveValues) {
  const maintenance = runStagingApiHelper({
    command: "enable-automatic-updates",
    sensitiveValues,
  });
  if (maintenance.automaticUpdatesEnabled !== true) {
    throw new Error("Canary Computer did not enable automatic updates.");
  }
}

async function verifyAutomaticAndManualUpdate(input) {
  const automaticOperation = await waitForUpdateOperation({
    predicate: (operation) =>
      operation.requestSource === "automatic" &&
      operation.targetVersion === input.targetVersion &&
      !TERMINAL_UPDATE_PHASES.has(operation.phase),
    timeoutMs: LIVE_UPDATE_START_TIMEOUT_MS,
  });
  pass("Automatic update started", automaticOperation.operationId);

  const manualResult = runStagingApiHelper({
    command: "request-update",
    sensitiveValues: input.sensitiveValues,
  });
  const operationId = assertCoalescedStagingUpdate({
    automaticOperation,
    manualResult,
  });
  pass("Manual Update reused the same operation", operationId);
  return operationId;
}

async function verifyCompletedUpdate(input) {
  const completed = await waitForUpdateOperation({
    predicate: (operation) =>
      operation.operationId === input.operationId &&
      TERMINAL_UPDATE_PHASES.has(operation.phase),
    timeoutMs: LIVE_UPDATE_FINISH_TIMEOUT_MS,
  });
  if (completed.phase !== "updated") {
    throw new Error(
      `Staging update finished in ${completed.phase}: ${completed.errorMessage ?? "no error detail"}`
    );
  }
  assertCliVersion({
    expectedVersion: input.targetVersion,
    sensitiveValues: input.sensitiveValues,
  });
  await waitForServiceRunning({
    expectedVersion: input.targetVersion,
    sensitiveValues: input.sensitiveValues,
  });
  await waitForCoreToReportCurrentVersion({
    expectedVersion: input.targetVersion,
    sensitiveValues: input.sensitiveValues,
  });
  pass("Service recovered on one final version", input.targetVersion);
}

async function cleanupStagingComputerUpdateSmoke(input) {
  const cleanupFailures = [];
  if (input.lifecycle.stagingComputerConnected) {
    try {
      runStagingApiHelper({
        command: "forget-current-computer",
        sensitiveValues: input.sensitiveValues,
      });
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (input.lifecycle.smokeHomeCreated) {
    cleanupCanaryServices({
      cleanupFailures,
      sensitiveValues: input.sensitiveValues,
    });
    try {
      await rm(CANARY_HOME, { force: true, recursive: true });
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (input.lifecycle.previousHomePreserved) {
    try {
      await rename(input.backupHome, CANARY_HOME);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (cleanupFailures.length === 0) {
    await rm(input.runRoot, { force: true, recursive: true });
    pass("Previous Canary state restored");
    return null;
  }
  return new AggregateError(
    [...(input.runFailure ? [input.runFailure] : []), ...cleanupFailures],
    `Staging smoke cleanup needs help. Preserved files remain at ${input.runRoot}.`
  );
}
