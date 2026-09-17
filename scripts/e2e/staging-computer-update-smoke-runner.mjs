import { chmod, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  parseStagingWebSetupCommand,
  readStagingSetupSensitiveValues,
} from "./staging-computer-update-smoke-contract.mjs";
import {
  assertCanaryLaunchdLabelsFree,
  assertCanaryServiceIdentityUnchanged,
  assertCliVersion,
  assertGitWorktreeClean,
  assertLiveSmokeHost,
  CANARY_HOME,
  cleanupCanaryServices,
  pass,
  preserveCanaryHome,
  REPO_ROOT,
  readCanaryServiceIdentity,
  readProtectedSetupCommand,
  readStagingManifest,
  runCanaryMaintenanceTick,
  runCommand,
  runFocusedUpdateContracts,
  runStagingApiHelper,
  runStagingSetup,
  waitForCoreServiceConnected,
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
  assertCliVersion({
    expectedVersion: baselineManifest.version,
    sensitiveValues: input.sensitiveValues,
  });
  await waitForServiceRunning({
    expectedServiceVersion: baselineManifest.serviceVersion,
    expectedVersion: baselineManifest.version,
    sensitiveValues: input.sensitiveValues,
  });
  await waitForCoreServiceConnected({
    sensitiveValues: input.sensitiveValues,
  });
  input.lifecycle.stagingComputerConnected = true;
  pass("Canary Computer connected", baselineManifest.version);

  runCommand({
    args: ["staging:cli:publish"],
    command: "pnpm",
    label: "publish the accepted Service baseline",
    sensitiveValues: input.sensitiveValues,
    timeoutMs: 30 * 60 * 1000,
  });
  const serviceManifest = await waitForNewStagingManifest(
    baselineManifest.version
  );
  pass("Service baseline published", serviceManifest.version);

  runCommand({
    args: ["staging:cli:publish", "--", "--retain-service"],
    command: "pnpm",
    label: "publish the first split Staging CLI",
    sensitiveValues: input.sensitiveValues,
    timeoutMs: 30 * 60 * 1000,
  });
  const firstCliManifest = await waitForNewStagingManifest(
    serviceManifest.version
  );
  pass("First split Staging CLI published", firstCliManifest.version);

  enableAutomaticUpdates(input.sensitiveValues);
  runCanaryMaintenanceTick({ sensitiveValues: input.sensitiveValues });
  const firstOperationId = await waitForAutomaticUpdate({
    sensitiveValues: input.sensitiveValues,
    targetVersion: firstCliManifest.version,
  });
  await verifyCompletedUpdate({
    operationId: firstOperationId,
    sensitiveValues: input.sensitiveValues,
    targetCliVersion: firstCliManifest.version,
    targetServiceVersion: serviceManifest.version,
  });

  const retainedServiceIdentity = readCanaryServiceIdentity({
    sensitiveValues: input.sensitiveValues,
  });
  runCommand({
    args: ["staging:cli:publish", "--", "--retain-service"],
    command: "pnpm",
    label: "publish the second split Staging CLI",
    sensitiveValues: input.sensitiveValues,
    timeoutMs: 30 * 60 * 1000,
  });
  const secondCliManifest = await waitForNewStagingManifest(
    firstCliManifest.version
  );
  pass("Second split Staging CLI published", secondCliManifest.version);

  runCanaryMaintenanceTick({ sensitiveValues: input.sensitiveValues });
  const secondOperationId = await waitForAutomaticUpdate({
    sensitiveValues: input.sensitiveValues,
    targetVersion: secondCliManifest.version,
  });
  await verifyCompletedUpdate({
    operationId: secondOperationId,
    sensitiveValues: input.sensitiveValues,
    targetCliVersion: secondCliManifest.version,
    targetServiceVersion: serviceManifest.version,
  });
  const finalServiceIdentity = readCanaryServiceIdentity({
    sensitiveValues: input.sensitiveValues,
  });
  assertCanaryServiceIdentityUnchanged(
    retainedServiceIdentity,
    finalServiceIdentity
  );
  pass(
    "Healthy Service retained across second CLI-only update",
    `pid ${String(finalServiceIdentity.pid)}`
  );
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

async function waitForAutomaticUpdate(input) {
  const automaticOperation = await waitForUpdateOperation({
    predicate: (operation) =>
      operation.requestSource === "automatic" &&
      operation.targetVersion === input.targetVersion &&
      !TERMINAL_UPDATE_PHASES.has(operation.phase),
    timeoutMs: LIVE_UPDATE_START_TIMEOUT_MS,
  });
  pass("Automatic update started", automaticOperation.operationId);
  return automaticOperation.operationId;
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
    expectedVersion: input.targetCliVersion,
    sensitiveValues: input.sensitiveValues,
  });
  await waitForServiceRunning({
    expectedServiceVersion: input.targetServiceVersion,
    expectedVersion: input.targetCliVersion,
    sensitiveValues: input.sensitiveValues,
  });
  await waitForCoreToReportCurrentVersion({
    expectedVersion: input.targetCliVersion,
    sensitiveValues: input.sensitiveValues,
  });
  pass(
    "Split update reached its declared targets",
    `${input.targetCliVersion} / ${input.targetServiceVersion}`
  );
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
      if (input.runFailure) {
        await rename(
          CANARY_HOME,
          path.join(input.runRoot, "failed-canary-home")
        );
      } else {
        await rm(CANARY_HOME, { force: true, recursive: true });
      }
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
    if (!input.runFailure) {
      await rm(input.runRoot, { force: true, recursive: true });
    }
    pass("Previous Canary state restored");
    return null;
  }
  return new AggregateError(
    [...(input.runFailure ? [input.runFailure] : []), ...cleanupFailures],
    formatStagingSmokeCleanupMessage({
      runFailure: input.runFailure,
      runRoot: input.runRoot,
    })
  );
}

export function formatStagingSmokeCleanupMessage(input) {
  const runFailure = toErrorMessage(input.runFailure);
  return `${runFailure ? `Staging smoke failed: ${runFailure} ` : ""}Cleanup also needs help. Preserved files remain at ${input.runRoot}.`;
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message.trim();
  }
  return String(error ?? "").trim();
}
