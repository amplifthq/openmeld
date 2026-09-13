import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import {
  type CliBinaryManifest,
  type CliBinaryRelease,
  cliBinaryManifestSchema,
} from "@openmeld/schemas";
import { isBinaryDistribution } from "../runtime/distribution";
import { openMeldRootDir } from "./paths";

const VERSION_STATE_FILENAME = "version.json";
const NPM_REGISTRY_LATEST_TIMEOUT_MS = 5000;
const VERSION_CHECK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LEADING_V_PREFIX_REGEX = /^v/;
const SEMVER_CORE_REGEX =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+.*)?$/;
const NUMERIC_SEMVER_IDENTIFIER_REGEX = /^\d+$/;
const versionCache = new Map<
  string,
  { info: PackageLatestInfo; fetchedAt: number }
>();
const versionMetadataCache = new Map<
  string,
  {
    metadata: PackageVersionMetadata;
    fetchedAt: number;
  }
>();
const inFlightVersionRequests = new Map<string, Promise<PackageLatestInfo>>();
const inFlightVersionMetadataRequests = new Map<
  string,
  Promise<PackageVersionMetadata>
>();

export type OpenMeldVersionStateV1 = {
  v: 1;
  last_version?: string;
  latest_version?: string;
  last_checked_at?: string;
  dismissed_version?: string | null;
  // Projection of the published "minimum required CLI version" floor
  // (`openmeld.minRequiredCliVersion` on the npm `latest` manifest). Cached so the
  // forced-update gate can read it without a network probe on every command.
  required_floor?: string | null;
  updated_at: string;
};

export type PackageVersionMetadata = {
  version: string;
  deprecated: string | null;
};

export type PackageLatestInfo = {
  version: string;
  minRequiredCliVersion: string | null;
};

export type CliBinaryReleaseInfo = PackageLatestInfo &
  CliBinaryRelease & {
    platform: string;
    service?: CliBinaryRelease & { version: string; platform: string };
  };

export function versionStatePath(): string {
  return join(openMeldRootDir(), VERSION_STATE_FILENAME);
}

export async function readVersionState(): Promise<OpenMeldVersionStateV1 | null> {
  const raw = await readFile(versionStatePath(), "utf8").catch(() => null);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<OpenMeldVersionStateV1>;
    if (parsed.v !== 1 || typeof parsed.updated_at !== "string") {
      return null;
    }
    const lastVersion = toNonEmptyString(parsed.last_version);
    const latestVersion = toNonEmptyString(parsed.latest_version);
    const lastCheckedAt = toNonEmptyString(parsed.last_checked_at);
    const dismissedVersion =
      parsed.dismissed_version === null
        ? null
        : toNonEmptyString(parsed.dismissed_version);
    const requiredFloor = parseStoredRequiredFloor(parsed.required_floor);
    const next: OpenMeldVersionStateV1 = {
      v: 1,
      ...(lastVersion ? { last_version: lastVersion } : {}),
      ...(latestVersion ? { latest_version: latestVersion } : {}),
      ...(lastCheckedAt ? { last_checked_at: lastCheckedAt } : {}),
      ...(dismissedVersion === undefined
        ? {}
        : { dismissed_version: dismissedVersion }),
      ...(requiredFloor === undefined ? {} : { required_floor: requiredFloor }),
      updated_at: parsed.updated_at,
    };
    return next;
  } catch {
    return null;
  }
}

export async function writeVersionState(
  state: OpenMeldVersionStateV1
): Promise<void> {
  await mkdir(openMeldRootDir(), { recursive: true });
  await writeFile(versionStatePath(), `${JSON.stringify(state, null, 2)}\n`);
}

export function createInitialVersionState(input: {
  currentVersion: string;
  checkedAt?: string;
}): OpenMeldVersionStateV1 {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  return {
    v: 1,
    last_version: input.currentVersion,
    latest_version: input.currentVersion,
    last_checked_at: checkedAt,
    dismissed_version: null,
    updated_at: checkedAt,
  };
}

export function hasValidLastVersion(
  state: OpenMeldVersionStateV1 | null
): boolean {
  return Boolean(toNonEmptyString(state?.last_version));
}

export async function ensureVersionStateReady(input: {
  currentVersion: string;
}): Promise<OpenMeldVersionStateV1> {
  const previousVersionState = await readVersionState();
  if (!previousVersionState) {
    const nextState = createInitialVersionState({
      currentVersion: input.currentVersion,
    });
    await writeVersionState(nextState);
    return nextState;
  }

  if (hasValidLastVersion(previousVersionState)) {
    return previousVersionState;
  }

  const nextState: OpenMeldVersionStateV1 = {
    ...previousVersionState,
    last_version: input.currentVersion,
    latest_version: previousVersionState.latest_version ?? input.currentVersion,
  };
  await writeVersionState(nextState);
  return nextState;
}

export function buildNextVersionState(input: {
  previous: OpenMeldVersionStateV1 | null;
  currentVersion: string;
  latestVersion?: string;
  checkedAt?: string;
  dismissedVersion?: string | null;
  // When provided (including `null`), overwrites the cached floor with the
  // freshly observed value; when omitted, the previous floor is carried
  // forward so callers that do not resolve the floor leave it untouched.
  requiredFloor?: string | null;
}): OpenMeldVersionStateV1 {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const latestVersion =
    toNonEmptyString(input.latestVersion) ??
    toNonEmptyString(input.previous?.latest_version) ??
    input.currentVersion;
  const requiredFloor =
    input.requiredFloor === undefined
      ? (input.previous?.required_floor ?? null)
      : input.requiredFloor;
  return {
    v: 1,
    last_version: input.currentVersion,
    latest_version: latestVersion,
    last_checked_at: checkedAt,
    dismissed_version:
      input.dismissedVersion ?? input.previous?.dismissed_version ?? null,
    ...(requiredFloor ? { required_floor: requiredFloor } : {}),
    updated_at: checkedAt,
  };
}

function parseStoredRequiredFloor(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return toNonEmptyString(value);
}

export async function fetchLatestPackageInfo(
  packageName: string,
  input: { forceRefresh?: boolean } = {}
): Promise<PackageLatestInfo> {
  const now = Date.now();
  const cached = input.forceRefresh ? undefined : versionCache.get(packageName);
  if (cached && now - cached.fetchedAt < VERSION_CHECK_CACHE_TTL_MS) {
    return cached.info;
  }

  const requestKey = input.forceRefresh
    ? `${packageName}:force_refresh`
    : packageName;
  const inFlight = inFlightVersionRequests.get(requestKey);
  if (inFlight) {
    return inFlight;
  }

  const request = requestLatestPackageInfo(packageName);
  inFlightVersionRequests.set(requestKey, request);

  try {
    const info = await request;
    versionCache.set(packageName, {
      info,
      fetchedAt: Date.now(),
    });
    return info;
  } finally {
    inFlightVersionRequests.delete(requestKey);
  }
}

export async function fetchLatestPackageVersion(
  packageName: string
): Promise<string> {
  const info = await fetchLatestPackageInfo(packageName);
  return info.version;
}

export async function fetchLatestCliBinaryRelease(input?: {
  platform?: string;
}): Promise<CliBinaryReleaseInfo> {
  const manifest = await requestCliBinaryManifest();
  const platform =
    toNonEmptyString(input?.platform) ?? `${process.platform}-${process.arch}`;
  const release = manifest.platforms[platform];
  if (!release) {
    throw new Error(
      `version check failed: invalid CLI manifest response: missing platform ${platform}`
    );
  }
  return {
    version: manifest.version,
    minRequiredCliVersion: manifest.minRequiredCliVersion,
    platform,
    ...release,
    ...(manifest.service
      ? {
          service: {
            ...manifest.service.platforms[platform],
            version: manifest.service.version,
            platform,
          },
        }
      : {}),
  };
}

export async function fetchPackageVersionMetadata(input: {
  packageName: string;
  version: string;
}): Promise<PackageVersionMetadata> {
  const packageName = input.packageName.trim();
  const version = input.version.trim();
  const cacheKey = `${packageName}@${version}`;
  const now = Date.now();
  const cached = versionMetadataCache.get(cacheKey);
  if (cached && now - cached.fetchedAt < VERSION_CHECK_CACHE_TTL_MS) {
    return cached.metadata;
  }

  const inFlight = inFlightVersionMetadataRequests.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = requestPackageVersionMetadata({
    packageName,
    version,
  });
  inFlightVersionMetadataRequests.set(cacheKey, request);

  try {
    const metadata = await request;
    versionMetadataCache.set(cacheKey, {
      metadata,
      fetchedAt: Date.now(),
    });
    return metadata;
  } finally {
    inFlightVersionMetadataRequests.delete(cacheKey);
  }
}

export function resetVersionCheckCacheForTests(): void {
  versionCache.clear();
  versionMetadataCache.clear();
  inFlightVersionRequests.clear();
  inFlightVersionMetadataRequests.clear();
}

async function requestLatestPackageInfo(
  packageName: string
): Promise<PackageLatestInfo> {
  if (isBinaryDistribution()) {
    return await requestLatestPackageInfoFromCliManifest();
  }
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
    {
      method: "GET",
      signal: AbortSignal.timeout(NPM_REGISTRY_LATEST_TIMEOUT_MS),
    }
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`version check failed: HTTP ${response.status}: ${raw}`);
  }
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; openmeld?: unknown };
    const version =
      typeof parsed.version === "string" ? parsed.version.trim() : "";
    if (!version) {
      throw new Error("missing version");
    }
    return {
      version,
      minRequiredCliVersion: readMinRequiredCliVersion(parsed.openmeld),
    };
  } catch (error) {
    throw new Error(
      `version check failed: invalid registry response: ${toErrorMessage(error)}`
    );
  }
}

// Binary distribution reads the same version-gate inputs (latest version +
// minRequiredCliVersion floor) from the R2 cli/manifest.json instead of the npm
// registry. The gate logic (floorBreached) is unchanged; only the data source
// differs. The URL is a production Web route; override with
// OPENMELD_CLI_BINARY_MANIFEST_URL for non-prod lanes.
const CLI_BINARY_MANIFEST_URL =
  toNonEmptyString(process.env.OPENMELD_CLI_BINARY_MANIFEST_URL) ??
  "https://openmeld.ai/cli/manifest.json";

async function requestLatestPackageInfoFromCliManifest(): Promise<PackageLatestInfo> {
  const manifest = await requestCliBinaryManifest();
  return {
    version: manifest.version,
    minRequiredCliVersion: manifest.minRequiredCliVersion,
  };
}

type ParsedCliBinaryManifest = CliBinaryManifest["channels"]["stable"] & {
  minRequiredCliVersion: string | null;
};

async function requestCliBinaryManifest(): Promise<ParsedCliBinaryManifest> {
  const response = await fetch(CLI_BINARY_MANIFEST_URL, {
    method: "GET",
    signal: AbortSignal.timeout(NPM_REGISTRY_LATEST_TIMEOUT_MS),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`version check failed: HTTP ${response.status}: ${raw}`);
  }
  try {
    return parseCliBinaryManifest(raw);
  } catch (error) {
    throw new Error(
      `version check failed: invalid CLI manifest response: ${toErrorMessage(error)}`
    );
  }
}

function parseCliBinaryManifest(raw: string): ParsedCliBinaryManifest {
  const parsed = cliBinaryManifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  const stable = parsed.data.channels.stable;
  return {
    ...stable,
    minRequiredCliVersion: stable.minRequiredCliVersion ?? null,
  };
}

function readMinRequiredCliVersion(openmeld: unknown): string | null {
  if (!openmeld || typeof openmeld !== "object") {
    return null;
  }
  const value = (openmeld as { minRequiredCliVersion?: unknown })
    .minRequiredCliVersion;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  // A malformed floor must be treated as "no signal", never a hard gate:
  // `compareSemver` falls back to lexical compare on unparseable input, which
  // could wrongly read as a floor breach. Validate before trusting it.
  return trimmed.length > 0 && isPlainReleaseVersion(trimmed) ? trimmed : null;
}

async function requestPackageVersionMetadata(input: {
  packageName: string;
  version: string;
}): Promise<PackageVersionMetadata> {
  if (isBinaryDistribution()) {
    // Binary distribution has no npm-style per-version deprecation metadata.
    return { version: input.version, deprecated: null };
  }
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(input.packageName)}/${encodeURIComponent(input.version)}`,
    {
      method: "GET",
      signal: AbortSignal.timeout(NPM_REGISTRY_LATEST_TIMEOUT_MS),
    }
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`version check failed: HTTP ${response.status}: ${raw}`);
  }
  try {
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      deprecated?: unknown;
    };
    const resolvedVersion =
      typeof parsed.version === "string" && parsed.version.trim().length > 0
        ? parsed.version.trim()
        : input.version;
    const deprecated =
      typeof parsed.deprecated === "string" &&
      parsed.deprecated.trim().length > 0
        ? parsed.deprecated.trim()
        : null;
    return {
      version: resolvedVersion,
      deprecated,
    };
  } catch (error) {
    throw new Error(
      `version check failed: invalid registry response: ${toErrorMessage(error)}`
    );
  }
}

// A forced-update floor must be a plain published release version — no
// prerelease, no build metadata. This is stricter than general semver on
// purpose: it rejects malformed values (e.g. "9.0.0+bad meta") so they fail
// open instead of hard-gating, and sidesteps prerelease-precedence ambiguity
// since a floor is always a shipped stable release. Must match the release
// tool's plain-version check in scripts/release/local-components.mjs.
const PLAIN_RELEASE_VERSION_RE = /^\d+\.\d+\.\d+$/;

export function isPlainReleaseVersion(value: string): boolean {
  return PLAIN_RELEASE_VERSION_RE.test(value.trim());
}

export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!(left && right)) {
    return a.localeCompare(b);
  }
  if (left.major !== right.major) {
    return left.major > right.major ? 1 : -1;
  }
  if (left.minor !== right.minor) {
    return left.minor > right.minor ? 1 : -1;
  }
  if (left.patch !== right.patch) {
    return left.patch > right.patch ? 1 : -1;
  }
  return comparePrereleaseIdentifiers(left.prerelease, right.prerelease);
}

function parseSemver(value: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[] | null;
} | null {
  const normalized = value.trim().replace(LEADING_V_PREFIX_REGEX, "");
  const match = normalized.match(SEMVER_CORE_REGEX);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : null,
  };
}

function comparePrereleaseIdentifiers(
  left: string[] | null,
  right: string[] | null
): number {
  if (!(left || right)) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }

  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];
    const lengthComparison = comparePrereleaseLengthAtIndex(
      leftIdentifier,
      rightIdentifier
    );
    if (lengthComparison !== 0) {
      return lengthComparison;
    }
    if (!(leftIdentifier && rightIdentifier)) {
      continue;
    }
    const compared = compareSinglePrereleaseIdentifier(
      leftIdentifier,
      rightIdentifier
    );
    if (compared !== 0) {
      return compared;
    }
  }
  return 0;
}

function comparePrereleaseLengthAtIndex(
  leftIdentifier: string | undefined,
  rightIdentifier: string | undefined
): number {
  if (leftIdentifier === undefined && rightIdentifier === undefined) {
    return 0;
  }
  if (leftIdentifier === undefined) {
    return -1;
  }
  if (rightIdentifier === undefined) {
    return 1;
  }
  return 0;
}

function compareSinglePrereleaseIdentifier(
  leftIdentifier: string,
  rightIdentifier: string
): number {
  if (leftIdentifier === rightIdentifier) {
    return 0;
  }

  const leftNumber = toNumericPrereleaseIdentifier(leftIdentifier);
  const rightNumber = toNumericPrereleaseIdentifier(rightIdentifier);
  if (leftNumber !== null && rightNumber !== null) {
    if (leftNumber === rightNumber) {
      return 0;
    }
    return leftNumber > rightNumber ? 1 : -1;
  }
  if (leftNumber !== null) {
    return -1;
  }
  if (rightNumber !== null) {
    return 1;
  }
  return leftIdentifier > rightIdentifier ? 1 : -1;
}

function toNumericPrereleaseIdentifier(identifier: string): number | null {
  if (!NUMERIC_SEMVER_IDENTIFIER_REGEX.test(identifier)) {
    return null;
  }
  return Number(identifier);
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
