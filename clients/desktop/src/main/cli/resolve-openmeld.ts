import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize as normalizePath, sep } from "node:path";
import process from "node:process";
import {
  canExecute,
  executableNamesForPlatform,
  resolveExecutableOnPath,
} from "./path-search";

type ResolveOpenMeldBinInput = {
  override?: string | null;
  env?: NodeJS.ProcessEnv;
  homeDir?: string | null;
};

type ActiveBundleState = {
  bundleId: string;
  daemonVersion: string;
  entryScriptRelativePath: string;
  sourceKind: DaemonBundleSourceKind;
};

const ACTIVE_BUNDLE_SCHEMA_V2 = "openmeld-daemon-active-bundle-v2";
const DEFAULT_OPENMELD_HOME_BY_PRESET = {
  prod: ".openmeld",
  "dev-local": ".openmeld-dev",
  canary: ".openmeld-canary",
} as const;
type OpenMeldEnvPreset = keyof typeof DEFAULT_OPENMELD_HOME_BY_PRESET;
type DaemonBundleSourceKind =
  | "workspace"
  | "package_install"
  | "npx_cache"
  | "unknown";

/**
 * Resolves the `openmeld` entry the Desktop GUI drives.
 *
 * Order:
 * 1. explicit override
 * 2. `OPENMELD_BIN`
 * 3. `openmeld` found on PATH
 * 4. current lane's active daemon bundle entry
 * 5. bare `openmeld` so the CLI driver can report a typed spawn failure
 */
export function resolveOpenMeldBin(
  input: ResolveOpenMeldBinInput = {}
): string {
  const env = input.env ?? process.env;
  return (
    normalizeOptionalText(input.override) ??
    normalizeOptionalText(env.OPENMELD_BIN) ??
    resolveOpenMeldOnPath(env) ??
    resolveActiveBundleOpenMeldBin({ env, homeDir: input.homeDir }) ??
    "openmeld"
  );
}

function resolveOpenMeldOnPath(env: NodeJS.ProcessEnv): string | null {
  return resolveExecutableOnPath({
    env,
    names: executableNamesForPlatform("openmeld", env),
  });
}

function resolveActiveBundleOpenMeldBin(input: {
  env: NodeJS.ProcessEnv;
  homeDir?: string | null;
}): string | null {
  const openMeldRoot = resolveOpenMeldRootDir(input);
  const envPreset = resolveOpenMeldEnvPreset(input.env.OPENMELD_ENV_PRESET);
  const state = readActiveBundleState(
    join(openMeldRoot, "runtime", "daemon", "state", "active-bundle.json")
  );
  if (!state) {
    return null;
  }
  if (!isBundleSourceAllowedForLane(state.sourceKind, envPreset)) {
    return null;
  }
  if (!isSafePathSegment(state.bundleId)) {
    return null;
  }
  const relativeEntry = normalizeRelativePath(state.entryScriptRelativePath);
  if (!relativeEntry) {
    return null;
  }
  const entryPath = join(
    openMeldRoot,
    "runtime",
    "daemon",
    "bundles",
    state.bundleId,
    relativeEntry
  );
  return canExecute(entryPath) ? entryPath : null;
}

function readActiveBundleState(path: string): ActiveBundleState | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed.v !== 2 ||
      parsed.schema !== ACTIVE_BUNDLE_SCHEMA_V2 ||
      parsed.bundleFormat !== "self_contained_v1"
    ) {
      return null;
    }
    const bundleId = normalizeOptionalString(parsed.bundleId);
    const daemonVersion = normalizeOptionalString(parsed.daemonVersion);
    const entryScriptRelativePath = normalizeOptionalString(
      parsed.entryScriptRelativePath
    );
    const sourceKind = normalizeDaemonBundleSourceKind(parsed.sourceKind);
    return bundleId && daemonVersion && entryScriptRelativePath && sourceKind
      ? { bundleId, daemonVersion, entryScriptRelativePath, sourceKind }
      : null;
  } catch {
    return null;
  }
}

function resolveOpenMeldRootDir(input: {
  env: NodeJS.ProcessEnv;
  homeDir?: string | null;
}): string {
  const fromEnv = normalizeOptionalText(input.env.OPENMELD_HOME);
  if (fromEnv) {
    return fromEnv;
  }
  const preset = resolveOpenMeldEnvPreset(input.env.OPENMELD_ENV_PRESET);
  const home =
    normalizeOptionalText(input.homeDir) ??
    normalizeOptionalText(input.env.HOME) ??
    homedir();
  return join(home, DEFAULT_OPENMELD_HOME_BY_PRESET[preset]);
}

function resolveOpenMeldEnvPreset(
  value: string | undefined
): OpenMeldEnvPreset {
  const normalized = normalizeOptionalText(value)?.toLowerCase();
  if (
    normalized === "prod" ||
    normalized === "dev-local" ||
    normalized === "canary"
  ) {
    return normalized;
  }
  return "prod";
}

function normalizeDaemonBundleSourceKind(
  value: unknown
): DaemonBundleSourceKind | null {
  if (
    value === "workspace" ||
    value === "package_install" ||
    value === "npx_cache" ||
    value === "unknown"
  ) {
    return value;
  }
  return null;
}

function isBundleSourceAllowedForLane(
  sourceKind: DaemonBundleSourceKind,
  envPreset: OpenMeldEnvPreset
): boolean {
  return (
    sourceKind === "package_install" ||
    sourceKind === "npx_cache" ||
    (sourceKind === "workspace" && envPreset === "dev-local")
  );
}

function isSafePathSegment(value: string): boolean {
  return (
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

function normalizeRelativePath(value: string): string | null {
  if (isAbsolute(value)) {
    return null;
  }
  const normalized = normalizePath(value);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${sep}`) ||
    normalized.includes(`${sep}..${sep}`)
  ) {
    return null;
  }
  return normalized;
}

function normalizeOptionalText(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" ? normalizeOptionalText(value) : null;
}
