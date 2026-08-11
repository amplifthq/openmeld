import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { OpenMeldPathResolutionInput } from "./paths";
import {
  resolveDefaultOpenMeldHomeDirname,
  resolveExplicitOpenMeldEnvPreset,
  resolveOpenMeldEnvPreset,
  resolveOpenMeldRootDir,
} from "./paths";

const PUBLISHED_PRODUCTION_OPENMELD_ROOT = normalizeComparablePath(
  join(homedir(), resolveDefaultOpenMeldHomeDirname("prod"))
);

export function assertNoPublishedProductionMutationDuringTests(
  pathInput: OpenMeldPathResolutionInput,
  targetName: string
): void {
  if (!isTestProcess(pathInput)) {
    return;
  }
  if (!isPublishedProductionOpenMeldRoot(pathInput)) {
    return;
  }
  throw new Error(
    [
      `Refusing to mutate ${targetName} in the published production lane during tests.`,
      "Set OPENMELD_HOME to a fresh temporary directory, or run the validation through openmeld-dev or openmeld-canary.",
    ].join(" ")
  );
}

/**
 * The OS service manager registration (launchd label / systemd unit / Windows
 * service name) is a per-user global resource keyed only by the env preset.
 * OPENMELD_HOME isolates lane files but does NOT isolate this registration, so
 * a process with an isolated root can still stop, boot out, or uninstall the
 * real published production service. Fail closed before any such mutation:
 * - test processes must never mutate the production registration, and
 * - a non-test process whose effective root left the published production
 *   lane must state its intent with an explicit OPENMELD_ENV_PRESET.
 */
export function assertSafePublishedProductionServiceRegistrationMutation(
  operation: string,
  pathInput: OpenMeldPathResolutionInput = {}
): void {
  if (resolveOpenMeldEnvPreset(pathInput) !== "prod") {
    return;
  }
  if (isTestProcess(pathInput)) {
    throw new Error(
      [
        `Refusing to ${operation} the published production OpenMeld Service registration during tests.`,
        "OPENMELD_HOME does not isolate the OS service manager registration.",
        "Target an isolated lane with OPENMELD_ENV_PRESET=dev-local or OPENMELD_ENV_PRESET=canary, or stub the service manager.",
      ].join(" ")
    );
  }
  if (resolveExplicitOpenMeldEnvPreset(pathInput) === "prod") {
    return;
  }
  if (isPublishedProductionOpenMeldRoot(pathInput)) {
    return;
  }
  throw new Error(
    [
      `Refusing to ${operation} the published production OpenMeld Service registration:`,
      "the effective OpenMeld root is outside the published production lane, but the service identity resolved to the production label.",
      "Set OPENMELD_ENV_PRESET explicitly to state which service registration this command must mutate.",
    ].join(" ")
  );
}

export function isPublishedProductionOpenMeldRoot(
  pathInput: OpenMeldPathResolutionInput
): boolean {
  return (
    normalizeComparablePath(resolveOpenMeldRootDir(pathInput)) ===
    PUBLISHED_PRODUCTION_OPENMELD_ROOT
  );
}

export function isTestProcess(
  pathInput: OpenMeldPathResolutionInput = {}
): boolean {
  const env = pathInput.env ?? process.env;
  const argv = pathInput.argv ?? process.argv;
  return (
    env.NODE_ENV === "test" ||
    env.VITEST === "true" ||
    typeof env.VITEST_WORKER_ID === "string" ||
    typeof env.JEST_WORKER_ID === "string" ||
    argv.some((arg) => arg.includes("vitest"))
  );
}

function normalizeComparablePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
