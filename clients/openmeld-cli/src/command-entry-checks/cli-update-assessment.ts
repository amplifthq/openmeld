import packageJson from "../../package.json";
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

const OPENMELD_PACKAGE_NAME = "openmeld";
const CLI_UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Result of resolving how the running CLI compares to the published npm
 * release. This is the single place that derives the forced-update signal from
 * the floor (`openmeld.minRequiredCliVersion` on the npm `latest` manifest), so the
 * entry-check gate and `openmeld doctor` cannot drift apart.
 */
export type CliUpdateAssessment = {
  /**
   * True when the version check actually applies (prod lane, `openmeld` command).
   * False short-circuits silently for dev lanes and renamed binaries.
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
  environmentTarget: OpenMeldEnvironmentTarget
): boolean {
  return (
    environmentTarget.preset === "prod" &&
    environmentTarget.userFacingCommand === "openmeld"
  );
}

/**
 * Resolves the published latest version and required-update floor for the CLI.
 *
 * Reads a fresh local cache first (24h TTL) so machine-mode (`--json`) commands
 * do not pay a network probe on every invocation; only a cold/stale cache hits
 * the registry. Any network or parse failure resolves to "no signal" so the
 * caller fails open and never locks a user out over a flaky registry.
 */
export async function assessCliUpdate(input: {
  environmentTarget: OpenMeldEnvironmentTarget;
}): Promise<CliUpdateAssessment> {
  const currentVersion = packageJson.version;
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

  const info = await resolveLatestPackageInfo(currentVersion).catch(() => null);
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

async function resolveLatestPackageInfo(
  currentVersion: string
): Promise<PackageLatestInfo> {
  const cached = await readFreshCachedInfo(currentVersion);
  if (cached) {
    return cached;
  }
  const info = await fetchLatestPackageInfo(OPENMELD_PACKAGE_NAME);
  await persistInfo({ currentVersion, info });
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
