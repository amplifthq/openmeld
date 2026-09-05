import type { OpenMeldEnvironmentTarget } from "../config/openmeld-environment-target";
import {
  buildNextVersionState,
  compareSemver,
  fetchLatestPackageInfo,
  isPlainReleaseVersion,
  type PackageLatestInfo,
  readVersionState,
  writeVersionState,
} from "../config/version-state";
import type { OpenMeldDistribution } from "../runtime/distribution";
import { resolveOpenMeldDistribution } from "../runtime/distribution";
import { OPENMELD_VERSION } from "../runtime/version";

const OPENMELD_PACKAGE_NAME = "openmeld";
const CLI_UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Result of resolving how the running CLI compares to its published release
 * channel. npm installs read npm's `latest` manifest; managed binaries read the
 * configured R2 manifest. This is the single place that derives the
 * forced-update signal from the channel's minimum required version, so the
 * entry-check gate and `openmeld doctor` cannot drift apart.
 */
export type CliUpdateAssessment = {
  /**
   * True when the version check actually applies to the current production
   * distribution or an explicitly configured binary canary.
   */
  checked: boolean;
  currentVersion: string;
  latestVersion: string | null;
  requiredFloor: string | null;
  updateAvailable: boolean;
  /**
   * True only when the running version is strictly below the published floor.
   * This is the positive confirmation that gates forced updates; any failure to
   * resolve the floor leaves it false (fail-open).
   */
  floorBreached: boolean;
};

export function isCliUpdateCheckApplicable(
  environmentTarget: OpenMeldEnvironmentTarget,
  input: {
    distribution?: OpenMeldDistribution;
    manifestUrl?: string | null;
  } = {}
): boolean {
  const distribution = input.distribution ?? resolveOpenMeldDistribution();
  const productionCheck =
    environmentTarget.preset === "prod" &&
    (distribution === "binary" ||
      environmentTarget.userFacingCommand === "openmeld");
  if (productionCheck) {
    return true;
  }
  return (
    environmentTarget.preset === "canary" &&
    environmentTarget.userFacingCommand === "openmeld-canary" &&
    distribution === "binary" &&
    Boolean(
      normalizeOptionalText(
        input.manifestUrl ?? process.env.OPENMELD_CLI_BINARY_MANIFEST_URL
      )
    )
  );
}

/**
 * Resolves the published latest version and required-update floor for the
 * current distribution's release channel (npm for npm installs, R2 for managed
 * binaries).
 *
 * Reads a fresh local cache first (24h TTL) so machine-mode (`--json`) commands
 * do not pay a network probe on every invocation; only a cold/stale cache hits
 * the channel. Background maintenance and explicit update actions can bypass
 * that cache with `forceRefresh` so a known release is never hidden by an older
 * command check. Any network or parse failure resolves to "no signal" so the
 * caller fails open and never locks a user out over a flaky release channel.
 */
export async function assessCliUpdate(input: {
  environmentTarget: OpenMeldEnvironmentTarget;
  forceRefresh?: boolean;
}): Promise<CliUpdateAssessment> {
  const currentVersion = OPENMELD_VERSION;
  const unchecked: CliUpdateAssessment = {
    checked: false,
    currentVersion,
    latestVersion: null,
    requiredFloor: null,
    updateAvailable: false,
    floorBreached: false,
  };
  if (!isCliUpdateCheckApplicable(input.environmentTarget)) {
    return unchecked;
  }

  const info = await resolveLatestPackageInfo({
    currentVersion,
    forceRefresh: input.forceRefresh === true,
  }).catch(() => null);
  if (!info?.version) {
    // Fail-open: we tried, but have no authoritative signal.
    return { ...unchecked, checked: true };
  }

  // Only trust a well-formed floor. A malformed value (corrupted cache or a
  // bad publish) is treated as "no signal" so it fails open instead of wrongly
  // gating via `compareSemver`'s lexical fallback.
  const requiredFloor =
    info.minRequiredCliVersion &&
    isPlainReleaseVersion(info.minRequiredCliVersion)
      ? info.minRequiredCliVersion
      : null;
  const floorBreached =
    requiredFloor !== null && compareSemver(currentVersion, requiredFloor) < 0;
  return {
    checked: true,
    currentVersion,
    latestVersion: info.version,
    requiredFloor,
    updateAvailable: compareSemver(currentVersion, info.version) < 0,
    floorBreached,
  };
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

async function resolveLatestPackageInfo(input: {
  currentVersion: string;
  forceRefresh: boolean;
}): Promise<PackageLatestInfo> {
  const cached = input.forceRefresh
    ? null
    : await readFreshCachedInfo(input.currentVersion);
  if (cached) {
    return cached;
  }
  const info = await fetchLatestPackageInfo(OPENMELD_PACKAGE_NAME, {
    forceRefresh: input.forceRefresh,
  });
  await persistInfo({ currentVersion: input.currentVersion, info });
  return info;
}

async function readFreshCachedInfo(
  currentVersion: string
): Promise<PackageLatestInfo | null> {
  const state = await readVersionState().catch(() => null);
  if (
    state?.last_version !== currentVersion ||
    !state.latest_version ||
    !state.last_checked_at
  ) {
    return null;
  }
  const checkedAt = Date.parse(state.last_checked_at);
  if (
    Number.isNaN(checkedAt) ||
    Date.now() - checkedAt >= CLI_UPDATE_CACHE_TTL_MS
  ) {
    return null;
  }
  const cachedRequiredFloor = state.required_floor ?? null;
  if (
    cachedRequiredFloor !== null &&
    !isPlainReleaseVersion(cachedRequiredFloor)
  ) {
    return null;
  }
  return {
    version: state.latest_version,
    minRequiredCliVersion: cachedRequiredFloor,
  };
}

async function persistInfo(input: {
  currentVersion: string;
  info: PackageLatestInfo;
}): Promise<void> {
  const previous = await readVersionState().catch(() => null);
  await writeVersionState(
    buildNextVersionState({
      previous,
      currentVersion: input.currentVersion,
      latestVersion: input.info.version,
      requiredFloor: input.info.minRequiredCliVersion,
    })
  ).catch(() => undefined);
}
