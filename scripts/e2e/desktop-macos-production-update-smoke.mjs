#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const PRODUCTION_APP_PATH = "/Applications/OpenMeld.app";
export const LEGACY_APP_PATH = "/Applications/OpenMeld Desktop.app";
export const PRODUCTION_BUNDLE_ID = "sh.openmeld.desktop";
export const PRODUCTION_TEAM_ID = "38FFHDPA3B";
export const PRODUCTION_EXECUTABLE = path.join(
  PRODUCTION_APP_PATH,
  "Contents/MacOS/OpenMeld"
);
export const PRODUCTION_INFO_PLIST = path.join(
  PRODUCTION_APP_PATH,
  "Contents/Info.plist"
);
export const INSTALL_RECEIPT_PATH = path.join(
  homedir(),
  "Library/Application Support/OpenMeld Desktop/desktop-update-install-receipt.txt"
);
export const SMOKE_STATE_PATH = path.join(
  tmpdir(),
  "openmeld-desktop-macos-update-smoke-state.json"
);

const STABLE_VERSION = /^\d+\.\d+\.\d+$/u;
const LINE_SPLIT = /\r?\n/u;
const RECEIPT_KEYS = new Set([
  "state",
  "sourceVersion",
  "targetVersion",
  "sourceBundle",
  "targetBundle",
]);
const MAX_RECEIPT_BYTES = 2048;
const MAX_RECEIPT_VALUE_LENGTH = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function compareStableVersions(left, right) {
  const parse = (value, label) => {
    if (!STABLE_VERSION.test(value)) {
      throw new Error(
        `Expected ${label} to be a stable Desktop version such as 0.1.5.`
      );
    }
    return value.split(".").map(Number);
  };
  const a = parse(left, "version");
  const b = parse(right, "version");
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] < b[index] ? -1 : 1;
    }
  }
  return 0;
}

export function parseSmokeArgs(argv) {
  const [phase, ...values] = argv;
  if (phase === "before") {
    if (values.length !== 2) {
      throw new Error(
        "Usage: pnpm release:desktop:smoke:macos-update -- before <current-version> <target-version>"
      );
    }
    const [currentVersion, targetVersion] = values;
    if (compareStableVersions(currentVersion, targetVersion) >= 0) {
      throw new Error("The target Desktop version must be newer than current.");
    }
    return { phase, currentVersion, targetVersion };
  }
  if (phase === "after") {
    if (values.length !== 1) {
      throw new Error(
        "Usage: pnpm release:desktop:smoke:macos-update -- after <target-version>"
      );
    }
    const [targetVersion] = values;
    compareStableVersions(targetVersion, targetVersion);
    return { phase, targetVersion };
  }
  throw new Error(
    "Choose before or after for the production macOS Desktop update smoke."
  );
}

export function assertProductionSignatureDetails(details) {
  const lines = details.split(LINE_SPLIT).map((line) => line.trim());
  if (!lines.includes(`Identifier=${PRODUCTION_BUNDLE_ID}`)) {
    throw new Error("OpenMeld.app has the wrong code-signing identifier.");
  }
  if (!lines.includes(`TeamIdentifier=${PRODUCTION_TEAM_ID}`)) {
    throw new Error("OpenMeld.app has the wrong Apple Team ID.");
  }
  if (
    !lines.some((line) =>
      line.startsWith("Authority=Developer ID Application:")
    )
  ) {
    throw new Error("OpenMeld.app is not signed by a Developer ID Application.");
  }
}

export function productionProcessPids(output) {
  const pids = [];
  for (const rawLine of output.split(LINE_SPLIT)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = /^(\d+)\s+(.+)$/u.exec(line);
    if (!match) {
      continue;
    }
    const [, pidText, command] = match;
    if (
      command === PRODUCTION_EXECUTABLE ||
      command.startsWith(`${PRODUCTION_EXECUTABLE} `)
    ) {
      pids.push(Number(pidText));
    }
  }
  return pids;
}

export function processListHasProductionApp(output) {
  return productionProcessPids(output).length > 0;
}

export function assertProcessRestarted(beforePids, afterPids) {
  if (afterPids.length === 0) {
    throw new Error("OpenMeld.app is not running after the update.");
  }
  const before = new Set(beforePids);
  const reused = afterPids.filter((pid) => before.has(pid));
  if (reused.length > 0) {
    throw new Error(
      `The pre-update OpenMeld process is still running after the update (PID ${reused.join(", ")}).`
    );
  }
}

export function parseInstallReceipt(content) {
  if (Buffer.byteLength(content, "utf8") > MAX_RECEIPT_BYTES) {
    throw new Error("Desktop update install receipt is too large.");
  }
  const result = {};
  for (const line of content.split(LINE_SPLIT)) {
    if (!line) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error("Desktop update install receipt is malformed.");
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (
      !RECEIPT_KEYS.has(key) ||
      !value ||
      value.length > MAX_RECEIPT_VALUE_LENGTH ||
      Object.hasOwn(result, key)
    ) {
      throw new Error("Desktop update install receipt is malformed.");
    }
    result[key] = value;
  }
  return result;
}

export function assertReceiptMatchesTarget(receipt, targetVersion) {
  if (receipt.targetVersion !== targetVersion) {
    throw new Error(
      `Desktop update receipt targets ${receipt.targetVersion ?? "unknown"}, not ${targetVersion}.`
    );
  }
  if (receipt.targetBundle !== "OpenMeld.app") {
    throw new Error("Desktop update receipt does not target OpenMeld.app.");
  }
  if (receipt.state !== "application_started") {
    throw new Error(
      `Desktop update receipt stopped at ${receipt.state ?? "unknown"} instead of application_started.`
    );
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: options.timeout ?? 30_000,
  });
  if (result.error) {
    throw result.error;
  }
  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed${output ? `: ${output}` : ""}`
    );
  }
  return output;
}

function readPlistValue(key) {
  return run("/usr/libexec/PlistBuddy", [
    "-c",
    `Print :${key}`,
    PRODUCTION_INFO_PLIST,
  ]).trim();
}

function readProcessList() {
  return run("/bin/ps", ["-axo", "pid=,command="]);
}

async function waitForProductionProcess(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const pids = productionProcessPids(readProcessList());
    if (pids.length > 0) {
      return pids;
    }
    await sleep(250);
  }
  return [];
}

function writeSmokeState(state) {
  mkdirSync(path.dirname(SMOKE_STATE_PATH), { recursive: true });
  writeFileSync(SMOKE_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function readSmokeState() {
  if (!existsSync(SMOKE_STATE_PATH)) {
    throw new Error(
      "Missing the paired before-smoke state. Run the before phase on this release Mac first."
    );
  }
  const state = JSON.parse(readFileSync(SMOKE_STATE_PATH, "utf8"));
  if (
    state?.schemaVersion !== 1 ||
    state.appPath !== PRODUCTION_APP_PATH ||
    !Array.isArray(state.beforePids) ||
    state.beforePids.length === 0 ||
    !state.beforePids.every(
      (pid) => Number.isInteger(pid) && pid > 0
    ) ||
    typeof state.currentVersion !== "string" ||
    typeof state.targetVersion !== "string" ||
    compareStableVersions(state.currentVersion, state.targetVersion) >= 0
  ) {
    throw new Error("The local Desktop A-to-B smoke state is malformed.");
  }
  return state;
}

function readReceiptIfPresent() {
  if (!existsSync(INSTALL_RECEIPT_PATH)) {
    return null;
  }
  return parseInstallReceipt(readFileSync(INSTALL_RECEIPT_PATH, "utf8"));
}

function assertLocalReleaseMac() {
  if (process.env.GITHUB_ACTIONS === "true") {
    throw new Error(
      "Run the production Desktop A-to-B smoke on the local release Mac, not GitHub Actions."
    );
  }
  if (process.platform !== "darwin") {
    throw new Error("The production Desktop A-to-B smoke requires macOS.");
  }
  const machine = run("/usr/bin/uname", ["-m"]).trim();
  if (machine !== "arm64") {
    throw new Error(
      `The production Desktop release currently requires Apple silicon; uname -m returned ${machine}.`
    );
  }
}

function inspectInstalledProductionApp(expectedVersion) {
  if (!existsSync(PRODUCTION_APP_PATH)) {
    throw new Error(
      `Expected the installed production app at ${PRODUCTION_APP_PATH}.`
    );
  }
  if (existsSync(LEGACY_APP_PATH)) {
    throw new Error(
      `Remove the stale legacy ${LEGACY_APP_PATH} before release smoke so Launch Services has one unambiguous production app.`
    );
  }
  const version = readPlistValue("CFBundleShortVersionString");
  const bundleId = readPlistValue("CFBundleIdentifier");
  if (version !== expectedVersion) {
    throw new Error(
      `Expected OpenMeld.app ${expectedVersion}, found ${version}.`
    );
  }
  if (bundleId !== PRODUCTION_BUNDLE_ID) {
    throw new Error(
      `Expected bundle ID ${PRODUCTION_BUNDLE_ID}, found ${bundleId}.`
    );
  }

  run("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    PRODUCTION_APP_PATH,
  ]);
  const signature = run("/usr/bin/codesign", [
    "--display",
    "--verbose=4",
    PRODUCTION_APP_PATH,
  ]);
  assertProductionSignatureDetails(signature);
  run("/usr/bin/xcrun", ["stapler", "validate", PRODUCTION_APP_PATH]);
  run("/usr/sbin/spctl", [
    "--assess",
    "--type",
    "execute",
    "--verbose=4",
    PRODUCTION_APP_PATH,
  ]);

  return {
    appPath: PRODUCTION_APP_PATH,
    bundleId,
    teamId: PRODUCTION_TEAM_ID,
    version,
  };
}

async function runBefore(input) {
  const app = inspectInstalledProductionApp(input.currentVersion);
  let pids = productionProcessPids(readProcessList());
  if (pids.length === 0) {
    run("/usr/bin/open", [PRODUCTION_APP_PATH]);
    pids = await waitForProductionProcess(15_000);
  }
  if (pids.length === 0) {
    throw new Error("OpenMeld.app did not start from its production executable.");
  }

  writeSmokeState({
    schemaVersion: 1,
    currentVersion: input.currentVersion,
    targetVersion: input.targetVersion,
    beforePids: pids,
    appPath: PRODUCTION_APP_PATH,
    recordedAt: new Date().toISOString(),
  });

  return {
    phase: "before",
    currentVersion: input.currentVersion,
    targetVersion: input.targetVersion,
    app,
    beforePids: pids,
    processRunningFromProductionPath: true,
    previousReceipt: readReceiptIfPresent(),
    statePath: SMOKE_STATE_PATH,
    next:
      "After the separately authorized promotion, use this running production A to Check, Download, and Restart to update. Do not manually reopen B before the after check.",
  };
}

async function runAfter(input) {
  const state = readSmokeState();
  if (state.targetVersion !== input.targetVersion) {
    throw new Error(
      `The paired before-smoke expected ${state.targetVersion}, not ${input.targetVersion}.`
    );
  }

  const app = inspectInstalledProductionApp(input.targetVersion);
  const afterPids = await waitForProductionProcess(20_000);
  assertProcessRestarted(state.beforePids, afterPids);

  const receipt = readReceiptIfPresent();
  if (receipt) {
    assertReceiptMatchesTarget(receipt, input.targetVersion);
  }

  const completedState = {
    ...state,
    afterPids,
    completedAt: new Date().toISOString(),
    result: "pass",
  };
  writeSmokeState(completedState);

  return {
    phase: "after",
    targetVersion: input.targetVersion,
    app,
    beforePids: state.beforePids,
    afterPids,
    processRunningFromProductionPath: true,
    processRestarted: true,
    receipt,
    statePath: SMOKE_STATE_PATH,
    receiptNote: receipt
      ? "The updater receipt confirms the target Main process started."
      : "No receipt exists. This is acceptable only when production A predates receipt instrumentation; PID replacement plus the executable-path relaunch check remains authoritative for this run.",
  };
}

export async function runProductionUpdateSmoke(argv = process.argv.slice(2)) {
  assertLocalReleaseMac();
  const input = parseSmokeArgs(argv);
  const report =
    input.phase === "before" ? await runBefore(input) : await runAfter(input);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `[desktop:macos-update-smoke] ${input.phase.toUpperCase()} PASS\n`
  );
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProductionUpdateSmoke().catch((error) => {
    process.stderr.write(
      `[desktop:macos-update-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
