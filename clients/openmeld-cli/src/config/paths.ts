import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";

export type OpenMeldProfileId = string;
export type OpenMeldAccountKey = {
  hostKey: string;
  userKey: string;
};
export type OpenMeldEnvPreset = "prod" | "dev-local" | "canary";
type OpenMeldPathResolutionInput = {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  homeDir?: string;
};

export type { OpenMeldPathResolutionInput };

const MAX_ACCOUNT_PATH_SEGMENT_LENGTH = 128;
const OPAQUE_CACHE_PATH_SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u;
const FALLBACK_ACCOUNT_HOST_KEY = "unauthenticated";
const FALLBACK_ACCOUNT_USER_KEY = "local";
export const OPENMELD_HOME_ENV_KEY = "OPENMELD_HOME";
const OPENMELD_ENV_PRESET_ENV_KEY = "OPENMELD_ENV_PRESET";
const DEFAULT_OPENMELD_ENV_PRESET: OpenMeldEnvPreset = "prod";
const OPENMELD_DEFAULT_HOME_DIR_BY_PRESET = {
  prod: ".openmeld",
  "dev-local": ".openmeld-dev",
  canary: ".openmeld-canary",
} as const satisfies Record<OpenMeldEnvPreset, string>;
const OPENMELD_ENV_PRESET_BY_ENTRY_NAME = {
  openmeld: "prod",
  "openmeld-dev": "dev-local",
  "openmeld-canary": "canary",
} as const satisfies Record<string, OpenMeldEnvPreset>;
export type OpenMeldCliEntryName =
  keyof typeof OPENMELD_ENV_PRESET_BY_ENTRY_NAME;

export function normalizeOpenMeldProfileId(value: unknown): OpenMeldProfileId {
  const raw = String(value ?? "").trim();
  if (raw.length === 0) {
    throw new Error("openMeldProfileId is required");
  }
  // Keep filenames stable and safe.
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "_").toLowerCase();
  if (!safe || safe === "." || safe === "..") {
    throw new Error("openMeldProfileId is invalid");
  }
  if (safe.length > MAX_ACCOUNT_PATH_SEGMENT_LENGTH) {
    throw new Error("openMeldProfileId is too long");
  }
  return safe;
}

export function resolveOpenMeldEnvPreset(
  input: OpenMeldPathResolutionInput = {}
): OpenMeldEnvPreset {
  const env = input.env ?? process.env;
  const fromEnv = normalizeOpenMeldEnvPreset(env[OPENMELD_ENV_PRESET_ENV_KEY]);
  if (fromEnv) {
    return fromEnv;
  }
  return resolveOpenMeldEnvPresetFromArgv(input.argv ?? process.argv);
}

export function resolveExplicitOpenMeldEnvPreset(
  input: OpenMeldPathResolutionInput = {}
): OpenMeldEnvPreset | null {
  const env = input.env ?? process.env;
  return normalizeOpenMeldEnvPreset(env[OPENMELD_ENV_PRESET_ENV_KEY]);
}

export function resolveDefaultOpenMeldHomeDirname(
  preset: OpenMeldEnvPreset
): string {
  return OPENMELD_DEFAULT_HOME_DIR_BY_PRESET[preset];
}

export function resolveOpenMeldRootDir(
  input: OpenMeldPathResolutionInput = {}
): string {
  const env = input.env ?? process.env;
  const fromEnv = String(env[OPENMELD_HOME_ENV_KEY] ?? "").trim();
  if (fromEnv) {
    return fromEnv;
  }
  const preset = resolveOpenMeldEnvPreset(input);
  return join(
    resolveHomeDirectory(input),
    resolveDefaultOpenMeldHomeDirname(preset)
  );
}

/**
 * OS-level resources are shared by every process using the same environment
 * preset, even when a command uses an isolated OPENMELD_HOME. Their local
 * coordination files therefore live under the preset's canonical home.
 */
export function resolveOpenMeldPresetOwnedPathInput(
  input: OpenMeldPathResolutionInput = {}
): OpenMeldPathResolutionInput {
  const env = { ...(input.env ?? process.env) };
  delete env[OPENMELD_HOME_ENV_KEY];
  return {
    ...input,
    env,
  };
}

export function openMeldRootDir(): string {
  return resolveOpenMeldRootDir();
}

/**
 * Whether the effective OpenMeld home is the published `~/.openmeld` user lane.
 * Lane-specific homes (`openmeld-dev`, `openmeld-canary`, isolated dev lanes,
 * and other `OPENMELD_HOME` overrides) resolve elsewhere and must not manage
 * shared real-user state that the published lane owns.
 */
export function isPublishedOpenMeldHome(
  input: OpenMeldPathResolutionInput = {}
): boolean {
  const publishedRootDir = join(
    resolveHomeDirectory(input),
    OPENMELD_DEFAULT_HOME_DIR_BY_PRESET.prod
  );
  return resolve(resolveOpenMeldRootDir(input)) === resolve(publishedRootDir);
}

export function openMeldBackupsDir(): string {
  const root = openMeldRootDir();
  return join(dirname(root), `${basename(root)}-backups`);
}

// Managed binary layout (binary distribution only). Each installed version
// lives under versions/<version>/openmeld; bin/openmeld is the current-version
// pointer (a symlink) that install-self / update swap atomically. The layout is
// lane-aware through resolveOpenMeldRootDir, so the dev lane uses
// ~/.openmeld-dev/versions and ~/.openmeld-dev/bin.
export function openMeldVersionsDir(
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(resolveOpenMeldRootDir(input), "versions");
}

export function openMeldManagedVersionDir(
  version: string,
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(
    openMeldVersionsDir(input),
    normalizePathSegment(version, "unknown")
  );
}

export function openMeldManagedVersionBinaryPath(
  version: string,
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(openMeldManagedVersionDir(version, input), "openmeld");
}

export function openMeldBinDir(
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(resolveOpenMeldRootDir(input), "bin");
}

export function openMeldManagedBinaryPath(
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(openMeldBinDir(input), "openmeld");
}

export function accountsDir(): string {
  return join(openMeldRootDir(), "accounts");
}

export function deviceDir(input: OpenMeldPathResolutionInput = {}): string {
  return join(resolveOpenMeldRootDir(input), "device");
}

export function deviceDaemonDir(
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(deviceDir(input), "daemon");
}

export function deviceSkillsDir(
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(deviceDir(input), "skills");
}

export function devicePreferencesPath(
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(deviceDir(input), "preferences.json");
}

export function deviceAgentRuntimePath(
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(deviceDir(input), "agent-runtime.json");
}

export function deviceProvidersDir(
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(deviceDir(input), "providers");
}

export function deviceProviderDir(
  providerId: string,
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(
    deviceProvidersDir(input),
    normalizePathSegment(providerId, "unknown")
  );
}

export function deviceProviderProfilesDir(
  providerId: string,
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(deviceProviderDir(providerId, input), "profiles");
}

export function deviceProviderProfileDir(
  providerId: string,
  profileId: string,
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(
    deviceProviderProfilesDir(providerId, input),
    normalizePathSegment(profileId, "unknown")
  );
}

export function deviceOpenClawProfilesDir(
  input: OpenMeldPathResolutionInput = {}
): string {
  return deviceProviderProfilesDir("openclaw", input);
}

export function deviceOpenClawProfileDir(
  profileId: string,
  input: OpenMeldPathResolutionInput = {}
): string {
  return deviceProviderProfileDir("openclaw", profileId, input);
}

export function deviceOpenClawProfileWorkspaceDir(
  profileId: string,
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(deviceOpenClawProfileDir(profileId, input), "workspace");
}

export function deviceOpenClawProfileBootstrapPath(
  profileId: string,
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(deviceOpenClawProfileDir(profileId, input), "bootstrap.json");
}

export function deviceSkillsStorePath(
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(deviceSkillsDir(input), "store.json");
}

export function deviceSkillsCustomTargetsPath(
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(deviceSkillsDir(input), "custom-targets.json");
}

export function deviceSkillsInstallsPath(
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(deviceSkillsDir(input), "installs.json");
}

export function legacyRuntimeConfigPath(
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(resolveOpenMeldRootDir(input), "config.json");
}

export function normalizeAccountHostKey(value: unknown): string {
  return normalizePathSegment(value, FALLBACK_ACCOUNT_HOST_KEY);
}

export function normalizeAccountUserKey(value: unknown): string {
  return normalizePathSegment(value, FALLBACK_ACCOUNT_USER_KEY);
}

export function normalizeAccountKey(
  input: Partial<OpenMeldAccountKey>
): OpenMeldAccountKey {
  return {
    hostKey: normalizeAccountHostKey(input.hostKey),
    userKey: normalizeAccountUserKey(input.userKey),
  };
}

export function accountDir(account: OpenMeldAccountKey): string {
  const normalized = normalizeAccountKey(account);
  return join(accountsDir(), normalized.hostKey, normalized.userKey);
}

export function accountProfilesDir(account: OpenMeldAccountKey): string {
  // TODO(v-next): optional `index/profiles.json` for write-through + read-through
  // refresh cache when profile listing becomes a local performance bottleneck.
  return join(accountDir(account), "profiles");
}

export function accountProfileDir(
  account: OpenMeldAccountKey,
  openMeldProfileId: OpenMeldProfileId
): string {
  // `local-meta.json` is the profile-local device envelope; workspace is one
  // section within it.
  return join(
    accountProfilesDir(account),
    normalizeOpenMeldProfileId(openMeldProfileId)
  );
}

export function accountProfileViewPath(
  account: OpenMeldAccountKey,
  openMeldProfileId: OpenMeldProfileId
): string {
  return join(accountProfileDir(account, openMeldProfileId), "view.json");
}

export function accountProfileLocalMetaPath(
  account: OpenMeldAccountKey,
  openMeldProfileId: OpenMeldProfileId
): string {
  return join(accountProfileDir(account, openMeldProfileId), "local-meta.json");
}

export function accountProfileWorkspacePath(
  account: OpenMeldAccountKey,
  openMeldProfileId: OpenMeldProfileId
): string {
  return join(accountProfileDir(account, openMeldProfileId), "workspace");
}

export function accountProfileSpaceCacheDir(
  account: OpenMeldAccountKey,
  openMeldProfileId: OpenMeldProfileId
): string {
  return join(accountProfileDir(account, openMeldProfileId), "space-cache");
}

export function legacyAccountProfileSpacesDir(
  account: OpenMeldAccountKey,
  openMeldProfileId: OpenMeldProfileId
): string {
  return join(accountProfileDir(account, openMeldProfileId), "spaces");
}

export function profileDir(openMeldProfileId: OpenMeldProfileId): string {
  return join(openMeldRootDir(), "profiles", openMeldProfileId);
}

export function runtimeDir(input: OpenMeldPathResolutionInput = {}): string {
  return join(resolveOpenMeldRootDir(input), "runtime");
}

export function runtimeLogsDir(): string {
  return join(runtimeDir(), "logs");
}

export function sessionsDir(): string {
  return join(runtimeDir(), "sessions");
}

export function systemDir(input: OpenMeldPathResolutionInput = {}): string {
  return join(resolveOpenMeldRootDir(input), "system");
}

export function skillsDir(): string {
  return join(openMeldRootDir(), "skills");
}

export function organizationSkillsDir(
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(resolveOpenMeldRootDir(input), "organization-skills");
}

export function organizationSkillReleaseDir(
  organizationId: string,
  skillId: string,
  releaseId: string,
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(
    organizationSkillsDir(input),
    requireOpaqueCachePathSegment(organizationId, "organizationId"),
    requireOpaqueCachePathSegment(skillId, "skillId"),
    requireOpaqueCachePathSegment(releaseId, "releaseId")
  );
}

export function profileIdentityPath(
  openMeldProfileId: OpenMeldProfileId
): string {
  return join(profileDir(openMeldProfileId), "profile.json");
}

export function spacesDir(openMeldProfileId: OpenMeldProfileId): string {
  return join(profileDir(openMeldProfileId), "spaces");
}

export function locksDir(
  openMeldProfileId: OpenMeldProfileId,
  input: OpenMeldPathResolutionInput = {}
): string {
  return join(runtimeDir(input), "locks", openMeldProfileId);
}

export function profileViewPath(openMeldProfileId: OpenMeldProfileId): string {
  return join(profileDir(openMeldProfileId), "view.json");
}

function normalizePathSegment(value: unknown, fallback: string): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }

  const safe = normalized.replace(/[^a-z0-9._-]+/g, "_");
  if (!safe) {
    return fallback;
  }

  if (safe === "." || safe === "..") {
    return fallback;
  }

  return safe.slice(0, MAX_ACCOUNT_PATH_SEGMENT_LENGTH);
}

function requireOpaqueCachePathSegment(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (
    normalized.length === 0 ||
    normalized.length > 256 ||
    normalized === "." ||
    normalized === ".." ||
    !OPAQUE_CACHE_PATH_SEGMENT_RE.test(normalized)
  ) {
    throw new Error(`${label} is not safe for the Organization Skills cache`);
  }
  return normalized;
}

function resolveOpenMeldEnvPresetFromArgv(argv: string[]): OpenMeldEnvPreset {
  return (
    resolveKnownOpenMeldEnvPresetFromArgv(argv) ?? DEFAULT_OPENMELD_ENV_PRESET
  );
}

export function resolveKnownOpenMeldEnvPresetFromArgv(
  argv: string[]
): OpenMeldEnvPreset | null {
  const entryName = resolveOpenMeldCliEntryNameFromArgv(argv);
  if (!entryName) {
    return null;
  }
  return OPENMELD_ENV_PRESET_BY_ENTRY_NAME[entryName] ?? null;
}

export function resolveOpenMeldCliEntryNameFromArgv(
  argv: string[]
): OpenMeldCliEntryName | null {
  return resolveCliEntryName(argv[1]);
}

function resolveCliEntryName(
  value: string | undefined
): OpenMeldCliEntryName | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const parsed = parse(raw);
  const normalizedName = parsed.name.trim().toLowerCase();
  if (!normalizedName) {
    return null;
  }
  if (!isOpenMeldCliEntryName(normalizedName)) {
    return null;
  }
  return normalizedName;
}

function isOpenMeldCliEntryName(value: string): value is OpenMeldCliEntryName {
  return value in OPENMELD_ENV_PRESET_BY_ENTRY_NAME;
}

function normalizeOpenMeldEnvPreset(
  value: string | undefined
): OpenMeldEnvPreset | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    normalized === "prod" ||
    normalized === "dev-local" ||
    normalized === "canary"
  ) {
    return normalized;
  }
  return null;
}

function resolveHomeDirectory(input: OpenMeldPathResolutionInput): string {
  if (input.homeDir) {
    return input.homeDir;
  }
  const env = input.env ?? process.env;
  const fromEnv = String(env.HOME ?? "").trim();
  if (fromEnv) {
    return fromEnv;
  }
  return homedir();
}
