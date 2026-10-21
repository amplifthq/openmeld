import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  areAgentControllerInterfaceAccountsSame,
  isAgentControllerUsageAccountUnavailable,
} from "@openmeld/agent-runtime";
import type {
  AgentControllerInterfaceAuthSnapshot,
  AgentControllerInterfaceSnapshot,
  AgentControllerUsageAdmission,
  AgentControllerUsageLimit,
  AgentControllerUsageLimits,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/schemas/types";

// Reuse only within a short account-observation window, measured from when the
// native check started (the time Core's two-minute freshness window counts
// from). The window is that two minutes, minus the 60s report cadence, minus
// headroom for a slow check, so a periodic pass always renews the observation
// instead of republishing one that expires before the next pass lands. Native
// checks remain coalesced and separate from heartbeats; installed binaries are
// fingerprinted independently. A completed signed-out check uses the same
// bounded window.
const LAST_GOOD_REUSE_TTL_MS = 30_000;

// An incomplete controller probe makes the current check unavailable, whether
// or not an older successful snapshot exists. A single delayed re-probe covers
// the common case where setup or another workload left the machine too busy for
// the cold controller start to complete in time. This delay gives that machine
// room to settle before the re-probe cold-starts the controller again.
export const AGENT_CONTROLLER_INTERFACE_REPROBE_DELAY_MS = 45_000;

// One-shot re-probe lifecycle for an incomplete controller check. It only
// decides whether the report-sync scheduler brings the next pass forward; it
// never becomes reported controller status, so fail-closed reporting is never
// smoothed by historical evidence.
//   idle      -> no re-probe pending (also the state after any success)
//   armed     -> first probe failed to complete; request one delayed re-probe
//   attempted -> the single re-probe also failed; no further automatic re-probe
type AgentControllerInterfaceReprobeState = "armed" | "attempted" | "idle";
type ControllerUsageObservation = Pick<
  AgentControllerInterfaceSnapshot,
  "usageAdmission" | "usageLimits"
>;

type AgentControllerInterfaceKeeperEntry = {
  commandFingerprint: AgentControllerCommandFingerprint | null;
  lastGoodSnapshot: AgentControllerInterfaceSnapshot | null;
  lastSuccessfulCheckAt: string | null;
  lastSuccessAtMs: number;
  passiveUsageObservation: ControllerUsageObservation;
  passiveUsageAuth: AgentControllerInterfaceAuthSnapshot | null;
  reuseInvalidatedByProbeFailure: boolean;
  reprobe: AgentControllerInterfaceReprobeState;
};

export type AgentControllerCommandFingerprint = {
  mtimeMs: number;
  packageJsonVersion: string | null;
  realPath: string;
  size: number;
};

const keeperEntries = new Map<string, AgentControllerInterfaceKeeperEntry>();

export function buildAgentControllerInterfaceKeeperKey(input: {
  agentId: string;
  commandPath: string | null;
}): string {
  return `${input.agentId}\u0000${input.commandPath ?? ""}`;
}

export function readReusableAgentControllerInterfaceSnapshot(input: {
  commandFingerprint: AgentControllerCommandFingerprint | null;
  keeperKey: string;
  nowMs: number;
}): AgentControllerInterfaceSnapshot | null {
  const entry = readMatchingAgentControllerInterfaceKeeperEntry(input);
  if (!entry?.lastGoodSnapshot || entry.reuseInvalidatedByProbeFailure) {
    return null;
  }
  if (input.nowMs - entry.lastSuccessAtMs >= LAST_GOOD_REUSE_TTL_MS) {
    return null;
  }
  return entry.lastGoodSnapshot;
}

export function readLastSuccessfulAgentControllerInterfaceCheckAt(input: {
  commandFingerprint: AgentControllerCommandFingerprint | null;
  keeperKey: string;
}): string | null {
  return (
    readMatchingAgentControllerInterfaceKeeperEntry(input)
      ?.lastSuccessfulCheckAt ?? null
  );
}

export function readLastKnownAgentControllerUsageLimits(input: {
  commandFingerprint: AgentControllerCommandFingerprint | null;
  keeperKey: string;
}): AgentControllerUsageLimits | null {
  return (
    readMatchingAgentControllerInterfaceKeeperEntry(input)?.lastGoodSnapshot
      ?.usageLimits ?? null
  );
}

export function readLastKnownAgentControllerAuthSnapshot(input: {
  commandFingerprint: AgentControllerCommandFingerprint | null;
  keeperKey: string;
}): AgentControllerInterfaceAuthSnapshot | null {
  return (
    readMatchingAgentControllerInterfaceKeeperEntry(input)?.lastGoodSnapshot
      ?.auth ?? null
  );
}

function readMatchingAgentControllerInterfaceKeeperEntry(input: {
  commandFingerprint: AgentControllerCommandFingerprint | null;
  keeperKey: string;
}): AgentControllerInterfaceKeeperEntry | null {
  const entry = keeperEntries.get(input.keeperKey);
  if (!entry) {
    return null;
  }
  if (
    !areAgentControllerCommandFingerprintsEqual(
      entry.commandFingerprint,
      input.commandFingerprint
    )
  ) {
    keeperEntries.delete(input.keeperKey);
    return null;
  }
  return entry;
}

export function recordAgentControllerInterfaceProbeSuccess(input: {
  commandFingerprint: AgentControllerCommandFingerprint;
  keeperKey: string;
  nowMs: number;
  snapshot: AgentControllerInterfaceSnapshot;
}): AgentControllerInterfaceSnapshot {
  const existingEntry = readMatchingAgentControllerInterfaceKeeperEntry({
    commandFingerprint: input.commandFingerprint,
    keeperKey: input.keeperKey,
  });
  const passiveUsageObservation = existingEntry?.passiveUsageObservation ?? {};
  const canBindPassiveUsage =
    !isAgentControllerUsageAccountUnavailable(input.snapshot.usageLimits) &&
    areAgentControllerInterfaceAccountsSame(
      existingEntry?.passiveUsageAuth,
      input.snapshot.auth
    );
  let completedSnapshot = input.snapshot;
  if (canBindPassiveUsage) {
    completedSnapshot = {
      ...input.snapshot,
      ...mergeObservedUsage({
        existing: input.snapshot,
        observed: passiveUsageObservation,
      }),
    };
  }
  // Signed out is a completed check, not a retryable failure. Reuse it under
  // the normal TTL; fresh checks still bypass reuse after an external sign-in.
  keeperEntries.set(input.keeperKey, {
    commandFingerprint: input.commandFingerprint,
    lastGoodSnapshot: completedSnapshot,
    lastSuccessfulCheckAt: input.snapshot.checkedAt,
    lastSuccessAtMs: input.nowMs,
    passiveUsageObservation: canBindPassiveUsage ? passiveUsageObservation : {},
    passiveUsageAuth: canBindPassiveUsage ? input.snapshot.auth : null,
    reuseInvalidatedByProbeFailure: false,
    reprobe: "idle",
  });
  return completedSnapshot;
}

export function recordAgentControllerUsageLimitsObservation(input: {
  authSnapshot: AgentControllerInterfaceAuthSnapshot;
  commandFingerprint: AgentControllerCommandFingerprint;
  keeperKey: string;
  usageAdmission?: AgentControllerUsageAdmission;
  usageLimits: AgentControllerUsageLimits;
}): boolean {
  if (
    (input.usageLimits.length === 0 && !input.usageAdmission) ||
    !hasStableProviderAccountIdentity(input.authSnapshot)
  ) {
    return false;
  }
  const existingEntry = readMatchingAgentControllerInterfaceKeeperEntry({
    commandFingerprint: input.commandFingerprint,
    keeperKey: input.keeperKey,
  });
  const entry: AgentControllerInterfaceKeeperEntry = existingEntry ?? {
    commandFingerprint: input.commandFingerprint,
    lastGoodSnapshot: null,
    lastSuccessfulCheckAt: null,
    lastSuccessAtMs: 0,
    passiveUsageObservation: {},
    passiveUsageAuth: null,
    reuseInvalidatedByProbeFailure: false,
    reprobe: "idle",
  };
  const previousPassiveUsage = areAgentControllerInterfaceAccountsSame(
    entry.passiveUsageAuth,
    input.authSnapshot
  )
    ? entry.passiveUsageObservation
    : {};
  entry.passiveUsageObservation = mergeObservedUsage({
    existing: previousPassiveUsage,
    observed: input,
  });
  entry.passiveUsageAuth = input.authSnapshot;
  if (
    entry.lastGoodSnapshot &&
    areAgentControllerInterfaceAccountsSame(
      entry.lastGoodSnapshot.auth,
      input.authSnapshot
    )
  ) {
    entry.lastGoodSnapshot = {
      ...entry.lastGoodSnapshot,
      ...mergeObservedUsage({
        existing: entry.lastGoodSnapshot,
        observed: input,
      }),
    };
  }
  keeperEntries.set(input.keeperKey, entry);
  return true;
}

function hasStableProviderAccountIdentity(
  authSnapshot: AgentControllerInterfaceAuthSnapshot
): boolean {
  return areAgentControllerInterfaceAccountsSame(authSnapshot, authSnapshot);
}

export function recordAgentControllerInterfaceProbeFailure(input: {
  keeperKey: string;
  preserveHistoricalEvidence?: boolean;
}): void {
  const existingEntry = keeperEntries.get(input.keeperKey);
  const entry = existingEntry ?? {
    commandFingerprint: null,
    lastGoodSnapshot: null,
    lastSuccessfulCheckAt: null,
    lastSuccessAtMs: 0,
    passiveUsageObservation: {},
    passiveUsageAuth: null,
    reuseInvalidatedByProbeFailure: false,
    reprobe: "idle" as AgentControllerInterfaceReprobeState,
  };
  if (input.preserveHistoricalEvidence === false) {
    entry.lastGoodSnapshot = null;
    entry.lastSuccessfulCheckAt = null;
    entry.lastSuccessAtMs = 0;
    entry.passiveUsageObservation = {};
    entry.passiveUsageAuth = null;
  }
  // Keep same-binary completed evidence for diagnostics, but never reuse it as
  // current truth after a failed check. Each completed-success-to-failure cycle
  // gets one accelerated re-probe.
  entry.reuseInvalidatedByProbeFailure = true;
  // Retiring the arm is owned by consumeArmedAgentControllerInterfaceReprobe:
  // an entry already past its one shot (attempted) never re-arms here.
  if (entry.reprobe === "idle") {
    entry.reprobe = "armed";
  }
  keeperEntries.set(input.keeperKey, entry);
}

function mergeObservedUsage(input: {
  existing: ControllerUsageObservation;
  observed: ControllerUsageObservation;
}): ControllerUsageObservation {
  const existingAdmission = input.existing.usageAdmission;
  const observedAdmission = input.observed.usageAdmission;
  const usageAdmission =
    observedAdmission &&
    (!existingAdmission ||
      Date.parse(observedAdmission.observedAt) >
        Date.parse(existingAdmission.observedAt))
      ? observedAdmission
      : existingAdmission;
  return {
    ...(usageAdmission ? { usageAdmission } : {}),
    usageLimits: mergeObservedUsageLimits({
      existing: input.existing.usageLimits,
      observed: input.observed.usageLimits ?? [],
    }),
  };
}

function mergeObservedUsageLimits(input: {
  existing: AgentControllerUsageLimits | undefined;
  observed: AgentControllerUsageLimits;
}): AgentControllerUsageLimits {
  const limitsByKey = new Map<string, AgentControllerUsageLimit>();
  for (const limit of input.existing ?? []) {
    if (limit.key !== "provider") {
      limitsByKey.set(limit.key, limit);
    }
  }
  for (const limit of input.observed) {
    const existingLimit = limitsByKey.get(limit.key);
    if (
      !existingLimit ||
      Date.parse(limit.observedAt) > Date.parse(existingLimit.observedAt)
    ) {
      limitsByKey.set(limit.key, limit);
    }
  }
  return [...limitsByKey.values()];
}

export async function resolveAgentControllerCommandFingerprint(input: {
  commandPath: string;
  launchContractKind: RuntimeAgentControllerLaunchContract["kind"];
}): Promise<AgentControllerCommandFingerprint | null> {
  try {
    const resolvedPath = await realpath(input.commandPath);
    const commandStat = await stat(resolvedPath);
    return {
      mtimeMs: commandStat.mtimeMs,
      packageJsonVersion:
        input.launchContractKind === "node_script"
          ? await resolveNearestPackageJsonVersion(resolvedPath)
          : null,
      realPath: resolvedPath,
      size: commandStat.size,
    };
  } catch {
    return null;
  }
}

// node_script launch contracts execute an npm package's vendored payload (for
// Codex/Claude Code/OpenCode/OpenClaw: a platform-specific compiled binary
// selected and spawned by the package's bin/*.js entry script) that lives
// alongside -- not inside -- the fingerprinted script file. mtime/size on the
// script alone would miss a payload swap that leaves the entry script's own
// bytes untouched.
//
// This is folded in as a defense-in-depth signal, not the primary one: a real
// `npm install`/`npm update` that bumps the installed version reliably changes
// the entry script's mtime too, because npm re-stamps every file it
// (re-)extracts with the local extraction time rather than preserving any
// original timestamp. Verified empirically (two npm installs of the exact
// same package version 2s apart produced two different mtimes; an npm version
// bump with byte-identical script content across both versions still
// produced a fresh mtime). So the existing mtime/size check already catches
// the common case. The remaining blind spot this does not cover is a
// vendored payload file replaced or corrupted without going through npm at
// all (no version bump recorded in package.json, no mtime change either) --
// closing that would require hashing the platform-specific payload binary
// directly, which this fingerprint intentionally does not do.
const PACKAGE_JSON_SEARCH_DEPTH_LIMIT = 6;

async function resolveNearestPackageJsonVersion(
  scriptRealPath: string
): Promise<string | null> {
  let currentDir = dirname(scriptRealPath);
  for (let depth = 0; depth < PACKAGE_JSON_SEARCH_DEPTH_LIMIT; depth += 1) {
    const version = await readPackageJsonVersion(
      join(currentDir, "package.json")
    );
    if (version !== undefined) {
      return version;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
  return null;
}

// Returns the parsed version string, null when package.json exists but has no
// usable version field (found the package boundary, nothing more to walk up
// for), or undefined when no package.json exists at this level yet (the
// caller keeps walking up toward the package root).
async function readPackageJsonVersion(
  packageJsonPath: string
): Promise<string | null | undefined> {
  let raw: string;
  try {
    raw = await readFile(packageJsonPath, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.length > 0
      ? parsed.version
      : null;
  } catch {
    return null;
  }
}

export function didAgentControllerCommandFingerprintRemainStable(input: {
  afterProbe: AgentControllerCommandFingerprint | null;
  beforeProbe: AgentControllerCommandFingerprint | null;
}): boolean {
  return areAgentControllerCommandFingerprintsEqual(
    input.beforeProbe,
    input.afterProbe
  );
}

function areAgentControllerCommandFingerprintsEqual(
  left: AgentControllerCommandFingerprint | null,
  right: AgentControllerCommandFingerprint | null
): boolean {
  return Boolean(
    left &&
      right &&
      left.realPath === right.realPath &&
      left.mtimeMs === right.mtimeMs &&
      left.size === right.size &&
      left.packageJsonVersion === right.packageJsonVersion
  );
}

// Reports whether any controller's first probe armed a re-probe and RETIRES
// those arms (armed -> attempted) in the same call, so the report-sync
// scheduler brings the next pass forward at most once per arm. Retiring at
// observation — rather than waiting for a later probe of that same controller
// to clear it — is what keeps a stuck arm from pinning the sync cadence
// forever: a controller can leave the ready state after arming (a controller
// CLI upgrade/repair nulls its launch contract), after which it is never probed
// again and nothing else would ever clear the arm.
export function consumeArmedAgentControllerInterfaceReprobe(): boolean {
  let armed = false;
  for (const entry of keeperEntries.values()) {
    if (entry.reprobe === "armed") {
      entry.reprobe = "attempted";
      armed = true;
    }
  }
  return armed;
}

// Pure scheduler decision for the next runtime agent controller report sync.
// When a first-probe re-probe is armed, the next pass is brought forward to at
// most the re-probe delay; otherwise it keeps the caller's base cadence. The
// re-probe pass itself runs a real background probe (a still-Error controller
// has no reusable snapshot) and flows through the existing report/refresh path,
// while an already-healthy controller reuses its held snapshot for free.
// The base cadence is anchored on when the pass started, so the time a pass
// spends checking does not stretch the interval between two checks of the same
// controller. A pass slower than the cadence still leaves this idle gap, so
// passes never run back to back.
const RUNTIME_AGENT_CONTROLLER_REPORT_PASS_MIN_IDLE_MS = 5000;

export function resolveNextRuntimeAgentControllerReportSyncAtMs(input: {
  nowMs: number;
  passStartedAtMs: number;
  baseRetryMs: number;
  hasArmedReprobe: boolean;
}): number {
  const baseNextMs = Math.max(
    input.nowMs +
      Math.min(
        input.baseRetryMs,
        RUNTIME_AGENT_CONTROLLER_REPORT_PASS_MIN_IDLE_MS
      ),
    input.passStartedAtMs + input.baseRetryMs
  );
  if (!input.hasArmedReprobe) {
    return baseNextMs;
  }
  return Math.min(
    baseNextMs,
    input.nowMs + AGENT_CONTROLLER_INTERFACE_REPROBE_DELAY_MS
  );
}

export function resetAgentControllerInterfaceKeeperForTests(): void {
  keeperEntries.clear();
}

export function ageAgentControllerInterfaceKeeperForTests(byMs: number): void {
  for (const entry of keeperEntries.values()) {
    entry.lastSuccessAtMs -= byMs;
  }
}
