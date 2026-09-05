import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, normalize, posix, win32 } from "node:path";
import {
  runtimeAgentControllerLaunchContractSchema,
  runtimeAgentControllerSettingsSchema,
} from "@openmeld/schemas";
import type {
  RuntimeAgentControllerLaunchContract,
  RuntimeTransportMode,
} from "@openmeld/schemas/types";
import { normalizeGatewayBaseUrl } from "./base-url";
import {
  acquireLock,
  isOpenMeldLockError,
  isOpenMeldOrphanedLockError,
  type OpenMeldLock,
  runWithHeldLock,
} from "./lock";
import {
  deviceAgentRuntimePath,
  devicePreferencesPath,
  deviceSkillsCustomTargetsPath,
  deviceSkillsInstallsPath,
  deviceSkillsStorePath,
  legacyRuntimeConfigPath,
  resolveOpenMeldEnvPreset,
} from "./paths";

export type RuntimeViewCustomization = {
  messages?: {
    human?: Record<string, string>;
    agent?: Record<string, string>;
  };
  render?: {
    human?: {
      dataMode?: "payload" | "envelope";
    };
    agent?: {
      envelopeMode?: "verbose" | "compact";
    };
  };
};

export type RuntimeSkillsAgentConfig = {
  skillsDir?: string;
  globalSkillsDir?: string;
};

export type RuntimeSkillsCustomTarget = {
  id?: string;
  name: string;
  dir: string;
};

export type RuntimeSkillsInstallRecord = {
  targetId: string;
  targetDir: string;
  mode: "symlink" | "copy";
  status: "installed" | "skipped" | "failed";
  skillIds: string[];
  reason?: string;
  updatedAt: string;
};

export type RuntimeSkillsConfig = {
  storeDir?: string;
  agents?: Record<string, RuntimeSkillsAgentConfig>;
  customTargets?: RuntimeSkillsCustomTarget[];
  installs?: RuntimeSkillsInstallRecord[];
};

export type RuntimeDaemonDispatchConfig = {
  globalConcurrency?: number;
  queueMax?: number;
};

export type RuntimeDaemonConfig = {
  dispatch?: RuntimeDaemonDispatchConfig;
};

export type RuntimeOpenMeldToolsMaintenanceConfig = {
  automaticUpdatesEnabled: boolean;
};

export type RuntimeDaemonDispatchLimits = {
  globalConcurrency: number;
  queueMax: number;
};

export type RuntimeAgentTransportMode = RuntimeTransportMode;
export type RuntimeAgentStreamingMode = "final" | "stream";

export type RuntimeAgentControllerConversationIdMappingSpec = {
  sourceField: string;
  mappingVersion: number;
};

export type RuntimeAgentControllerSettings = {
  transportMode: RuntimeAgentTransportMode;
  streamingMode: RuntimeAgentStreamingMode;
  timeoutMs: number | null;
  retry: number;
  contextIdMappingSpec: RuntimeAgentControllerConversationIdMappingSpec;
};

export const DEFAULT_RUNTIME_AGENT_TRANSPORT_MODE: RuntimeAgentTransportMode =
  "local-cli";
export const DEFAULT_RUNTIME_AGENT_STREAMING_MODE: RuntimeAgentStreamingMode =
  "final";
// Normal Agent execution has no fixed wall-clock timeout. Long-running tasks
// should end by explicit result, failure, cancellation, or stale progress
// evidence policy, not by a hard-coded elapsed-time cutoff.
export const DEFAULT_LOCAL_ADAPTER_TIMEOUT_MS = null as number | null;
export const DEFAULT_RUNTIME_AGENT_RETRY = 0;
export const DEFAULT_RUNTIME_AGENT_CONTEXT_MAPPING_VERSION = 1;
export const DEFAULT_RUNTIME_AGENT_CONTEXT_SOURCE_FIELD =
  "OPENMELD_CLI_CONTEXT_ID";
export const DEFAULT_RUNTIME_DAEMON_GLOBAL_CONCURRENCY = 10;
export const DEFAULT_RUNTIME_DAEMON_QUEUE_MAX = 50;

export type RuntimeAgentControllerState = {
  agentId: string;
  displayName: string;
  enabled: boolean;
  launchContract?: RuntimeAgentControllerLaunchContract;
  transportMode?: RuntimeAgentTransportMode;
  streamingMode?: RuntimeAgentStreamingMode;
  timeoutMs?: number | null;
  retry?: number;
  contextIdMappingSpec?: RuntimeAgentControllerConversationIdMappingSpec;
  registeredAt: string;
  updatedAt: string;
};

export type RuntimeDeviceRuntimeState = {
  controllers?: RuntimeAgentControllerState[];
};

export type RuntimeStartV1OnboardingState = {
  disclaimerAcceptedVersion?: string;
  lastCompletedAt?: string;
  localAgentsSetupCompletedAt?: string;
};

export type RuntimeOnboardingConfig = {
  disclaimerAcceptedAt?: string;
  startV1?: RuntimeStartV1OnboardingState;
};

export type RuntimeConfigFallbackReason = "invalid_json" | "invalid_version";

export type RuntimeConfigReadHealth = {
  parseFallback: boolean;
  reason?: RuntimeConfigFallbackReason;
};

type RuntimeConfigV1 = {
  v: 1;
  baseUrl?: string;
  viewCustomization?: RuntimeViewCustomization;
  skills?: RuntimeSkillsConfig;
  daemon?: RuntimeDaemonConfig;
  openMeldToolsMaintenance?: RuntimeOpenMeldToolsMaintenanceConfig;
  deviceRuntimeState?: RuntimeDeviceRuntimeState;
  onboarding?: RuntimeOnboardingConfig;
  updatedAt: string;
};

type DevicePreferencesV1 = {
  v: 1;
  baseUrl?: string;
  viewCustomization?: RuntimeViewCustomization;
  daemon?: RuntimeDaemonConfig;
  openMeldToolsMaintenance?: RuntimeOpenMeldToolsMaintenanceConfig;
  onboarding?: RuntimeOnboardingConfig;
  updatedAt: string;
};

type DeviceAgentRuntimeV1 = {
  v: 1;
  deviceRuntimeState?: RuntimeDeviceRuntimeState;
  updatedAt: string;
};

type DeviceSkillsStoreV1 = {
  v: 1;
  storeDir?: string;
  agents?: Record<string, RuntimeSkillsAgentConfig>;
  updatedAt: string;
};

type DeviceSkillsCustomTargetsV1 = {
  v: 1;
  customTargets: RuntimeSkillsCustomTarget[];
  updatedAt: string;
};

type DeviceSkillsInstallsV1 = {
  v: 1;
  installs: RuntimeSkillsInstallRecord[];
  updatedAt: string;
};

type RuntimeMessageCustomization = RuntimeViewCustomization["messages"];
type RuntimeRenderCustomization = RuntimeViewCustomization["render"];
type RuntimeHumanRender = NonNullable<RuntimeRenderCustomization>["human"];
type RuntimeAgentRender = NonNullable<RuntimeRenderCustomization>["agent"];
type RuntimeConfigOverrides = {
  baseUrl?: string | null;
  viewCustomization?: RuntimeViewCustomization | null;
  skills?: RuntimeSkillsConfig | null;
  daemon?: RuntimeDaemonConfig | null;
  openMeldToolsMaintenance?: RuntimeOpenMeldToolsMaintenanceConfig | null;
  deviceRuntimeState?: RuntimeDeviceRuntimeState | null;
  onboarding?: RuntimeOnboardingConfig | null;
};
const CUSTOM_TARGET_ID_PREFIX = "custom-";
const CUSTOM_TARGET_ID_LENGTH = 12;
const RUNTIME_CONFIG_LOCK_PROFILE = "__system__";
const RUNTIME_CONFIG_LOCK_KEY = "runtime-config";
const RUNTIME_CONFIG_LOCK_MAX_ATTEMPTS = 40;
const RUNTIME_CONFIG_LOCK_RETRY_DELAY_MS = 25;
const WINDOWS_DRIVE_ONLY_RE = /^[a-zA-Z]:$/;
const WINDOWS_DRIVE_PREFIX_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_RE = /^[/\\]{2}[^/\\]+[/\\]+[^/\\]+/;
const WINDOWS_DRIVE_ANY_RE = /^[a-zA-Z]:/;
const TRAILING_PATH_SEPARATORS_RE = /[\\/]+$/;

export function resolveRuntimeSkillsCustomTargetId(input: {
  dir: string;
  id?: string;
}): string {
  const existingId =
    typeof input.id === "string" && input.id.trim().length > 0
      ? input.id.trim()
      : "";
  if (existingId) {
    return existingId;
  }
  const normalizedDir = normalizeCustomTargetDir(input.dir);
  const digest = createHash("sha256").update(normalizedDir).digest("hex");
  return `${CUSTOM_TARGET_ID_PREFIX}${digest.slice(0, CUSTOM_TARGET_ID_LENGTH)}`;
}

export function resolveDefaultAgentContextSourceField(
  _agentId: string
): string {
  return DEFAULT_RUNTIME_AGENT_CONTEXT_SOURCE_FIELD;
}

export function createDefaultRuntimeAgentControllerSettings(
  agentId: string
): RuntimeAgentControllerSettings {
  return {
    transportMode: DEFAULT_RUNTIME_AGENT_TRANSPORT_MODE,
    streamingMode: resolveDefaultRuntimeAgentStreamingMode(),
    timeoutMs: DEFAULT_LOCAL_ADAPTER_TIMEOUT_MS,
    retry: DEFAULT_RUNTIME_AGENT_RETRY,
    contextIdMappingSpec: {
      sourceField: resolveDefaultAgentContextSourceField(agentId),
      mappingVersion: DEFAULT_RUNTIME_AGENT_CONTEXT_MAPPING_VERSION,
    },
  };
}

const resolveDefaultRuntimeAgentStreamingMode =
  (): RuntimeAgentStreamingMode => {
    const preset = resolveOpenMeldEnvPreset();
    if (preset === "dev-local" || preset === "canary") {
      return "stream";
    }
    return DEFAULT_RUNTIME_AGENT_STREAMING_MODE;
  };

export async function getConfiguredBaseUrl(): Promise<string | null> {
  const config = await readRuntimeConfig("preferences");
  if (!config?.baseUrl) {
    return null;
  }
  return normalizeGatewayBaseUrl(config.baseUrl);
}

export async function getConfiguredViewCustomization(): Promise<RuntimeViewCustomization | null> {
  const config = await readRuntimeConfig("preferences");
  return config?.viewCustomization ?? null;
}

export async function getConfiguredSkillsConfig(): Promise<RuntimeSkillsConfig | null> {
  const config = await readRuntimeConfig("skills");
  return config?.skills ?? null;
}

export async function getConfiguredDeviceRuntimeState(): Promise<RuntimeDeviceRuntimeState | null> {
  const config = await readRuntimeConfig("runtime");
  return config?.deviceRuntimeState ?? null;
}

export async function getConfiguredDaemonDispatchLimits(): Promise<RuntimeDaemonDispatchLimits> {
  const config = await readRuntimeConfig("preferences");
  return resolveRuntimeDaemonDispatchLimits(config?.daemon?.dispatch);
}

export async function getConfiguredOpenMeldToolsMaintenance(): Promise<RuntimeOpenMeldToolsMaintenanceConfig> {
  let preferencesFile = await readOptionalJsonFile(devicePreferencesPath());
  if (!preferencesFile.found) {
    preferencesFile = await readOptionalJsonFile(legacyRuntimeConfigPath());
  }
  if (
    preferencesFile.error ||
    (preferencesFile.found && !isSupportedConfigFile(preferencesFile.value))
  ) {
    throw new Error("OpenMeld update setting is invalid.");
  }
  if (
    preferencesFile.found &&
    preferencesFile.value &&
    typeof preferencesFile.value === "object" &&
    "openMeldToolsMaintenance" in preferencesFile.value &&
    !parseRuntimeOpenMeldToolsMaintenanceConfig(
      (preferencesFile.value as { openMeldToolsMaintenance?: unknown })
        .openMeldToolsMaintenance
    )
  ) {
    throw new Error("OpenMeld update setting is invalid.");
  }
  return (
    parseRuntimeOpenMeldToolsMaintenanceConfig(
      (preferencesFile.value as { openMeldToolsMaintenance?: unknown } | null)
        ?.openMeldToolsMaintenance
    ) ?? {
      automaticUpdatesEnabled: true,
    }
  );
}

export async function getConfiguredOnboardingConfig(): Promise<RuntimeOnboardingConfig | null> {
  const config = await readRuntimeConfig("preferences");
  return config?.onboarding ?? null;
}

export async function getConfiguredOnboardingDisclaimerAcceptedAt(): Promise<
  string | null
> {
  const onboarding = await getConfiguredOnboardingConfig();
  return onboarding?.disclaimerAcceptedAt ?? null;
}

export async function getConfiguredStartV1OnboardingState(): Promise<RuntimeStartV1OnboardingState | null> {
  const onboarding = await getConfiguredOnboardingConfig();
  return onboarding?.startV1 ?? null;
}

export async function getRuntimeConfigReadHealth(): Promise<RuntimeConfigReadHealth> {
  const result = await readRuntimeConfigDetailed();
  return result.health;
}

export async function alignRuntimeConfigStorage(): Promise<{
  migratedLegacyConfig: boolean;
  removedLegacyConfig: boolean;
}> {
  return await withRuntimeConfigLock(migrateLegacyRuntimeConfig);
}

export async function setConfiguredBaseUrl(baseUrl: string): Promise<void> {
  await withRuntimeConfigLock(async () => {
    const normalized = normalizeGatewayBaseUrl(baseUrl);
    const previous = await readRuntimeConfigForMutation("preferences");
    const next = buildNextConfig(previous, { baseUrl: normalized });

    await writeRuntimeConfigFields(next, ["baseUrl"]);
  });
}

export async function setConfiguredOpenMeldToolsMaintenance(
  maintenance: RuntimeOpenMeldToolsMaintenanceConfig
): Promise<void> {
  await withRuntimeConfigLock(async () => {
    const previous = await readRuntimeConfigForMutation("preferences");
    const next = buildNextConfig(previous, {
      openMeldToolsMaintenance: maintenance,
    });

    await writeRuntimeConfigFields(next, ["openMeldToolsMaintenance"]);
  });
}

export async function setConfiguredSkillsConfig(
  skills: RuntimeSkillsConfig
): Promise<void> {
  await withRuntimeConfigLock(async () => {
    const previous = await readRuntimeConfigForMutation("skills");
    const next = buildNextConfig(previous, { skills });

    await writeRuntimeConfigFields(next, ["skills"]);
  });
}

export async function updateConfiguredSkillsConfig(
  updater: (current: RuntimeSkillsConfig | null) => RuntimeSkillsConfig | null
): Promise<void> {
  await withRuntimeConfigLock(async () => {
    const previous = await readRuntimeConfigForMutation("skills");
    const previousSkills = previous?.skills ?? null;
    const nextSkills = updater(previousSkills);

    const previousComparable = JSON.stringify(previousSkills);
    const nextComparable = JSON.stringify(nextSkills);
    if (previousComparable === nextComparable) {
      return;
    }

    const next = buildNextConfig(previous, { skills: nextSkills });

    await writeRuntimeConfigFields(next, ["skills"]);
  });
}

export async function setConfiguredDeviceRuntimeState(
  deviceRuntimeState: RuntimeDeviceRuntimeState
): Promise<void> {
  await withRuntimeConfigLock(async () => {
    const previous = await readRuntimeConfigForMutation("runtime");
    const next = buildNextConfig(previous, { deviceRuntimeState });

    await writeRuntimeConfigFields(next, ["deviceRuntimeState"]);
  });
}

export async function updateConfiguredDeviceRuntimeState(
  updater: (
    current: RuntimeDeviceRuntimeState | null
  ) => RuntimeDeviceRuntimeState | null
): Promise<void> {
  await withRuntimeConfigLock(async () => {
    const previous = await readRuntimeConfigForMutation("runtime");
    const previousDeviceRuntimeState = previous?.deviceRuntimeState ?? null;
    const nextDeviceRuntimeState = updater(previousDeviceRuntimeState);

    const previousComparable = JSON.stringify(previousDeviceRuntimeState);
    const nextComparable = JSON.stringify(nextDeviceRuntimeState);
    if (previousComparable === nextComparable) {
      return;
    }

    const next = buildNextConfig(previous, {
      deviceRuntimeState: nextDeviceRuntimeState,
    });

    await writeRuntimeConfigFields(next, ["deviceRuntimeState"]);
  });
}

export async function updateConfiguredStartV1OnboardingState(
  updater: (
    current: RuntimeStartV1OnboardingState | null
  ) => RuntimeStartV1OnboardingState | null
): Promise<void> {
  await withRuntimeConfigLock(async () => {
    const previous = await readRuntimeConfigForMutation("preferences");
    const previousOnboarding = previous?.onboarding ?? null;
    const previousStartV1 = previousOnboarding?.startV1 ?? null;
    const nextStartV1 = updater(previousStartV1);

    const previousComparable = JSON.stringify(previousStartV1);
    const nextComparable = JSON.stringify(nextStartV1);
    if (previousComparable === nextComparable) {
      return;
    }

    const nextOnboarding =
      nextStartV1 || previousOnboarding?.disclaimerAcceptedAt
        ? {
            ...(previousOnboarding?.disclaimerAcceptedAt
              ? {
                  disclaimerAcceptedAt: previousOnboarding.disclaimerAcceptedAt,
                }
              : {}),
            ...(nextStartV1 ? { startV1: nextStartV1 } : {}),
          }
        : null;
    const next = buildNextConfig(previous, {
      onboarding: nextOnboarding,
    });

    await writeRuntimeConfigFields(next, ["onboarding"]);
  });
}

export async function updateConfiguredOnboardingConfig(
  updater: (
    current: RuntimeOnboardingConfig | null
  ) => RuntimeOnboardingConfig | null
): Promise<void> {
  await withRuntimeConfigLock(async () => {
    const previous = await readRuntimeConfigForMutation("preferences");
    const previousOnboarding = previous?.onboarding ?? null;
    const nextOnboarding = updater(previousOnboarding);

    const previousComparable = JSON.stringify(previousOnboarding);
    const nextComparable = JSON.stringify(nextOnboarding);
    if (previousComparable === nextComparable) {
      return;
    }

    const next = buildNextConfig(previous, {
      onboarding: nextOnboarding,
    });

    await writeRuntimeConfigFields(next, ["onboarding"]);
  });
}

function buildNextConfig(
  previous: RuntimeConfigV1 | null,
  overrides: RuntimeConfigOverrides
): RuntimeConfigV1 {
  const baseUrl = resolveBaseUrlOverride(previous?.baseUrl, overrides);
  const viewCustomization = resolveConfigOverride(
    "viewCustomization",
    previous?.viewCustomization,
    overrides
  );
  const skills = resolveConfigOverride("skills", previous?.skills, overrides);
  const daemon = resolveConfigOverride("daemon", previous?.daemon, overrides);
  const openMeldToolsMaintenance = resolveConfigOverride(
    "openMeldToolsMaintenance",
    previous?.openMeldToolsMaintenance,
    overrides
  );
  const deviceRuntimeState = resolveConfigOverride(
    "deviceRuntimeState",
    previous?.deviceRuntimeState,
    overrides
  );
  const onboarding = resolveConfigOverride(
    "onboarding",
    previous?.onboarding,
    overrides
  );

  return {
    v: 1,
    ...(baseUrl ? { baseUrl } : {}),
    ...(viewCustomization ? { viewCustomization } : {}),
    ...(skills ? { skills } : {}),
    ...(daemon ? { daemon } : {}),
    ...(openMeldToolsMaintenance ? { openMeldToolsMaintenance } : {}),
    ...(deviceRuntimeState ? { deviceRuntimeState } : {}),
    ...(onboarding ? { onboarding } : {}),
    updatedAt: new Date().toISOString(),
  };
}

function resolveBaseUrlOverride(
  previous: string | undefined,
  overrides: RuntimeConfigOverrides
): string | undefined {
  if (!("baseUrl" in overrides)) {
    return previous;
  }
  if (typeof overrides.baseUrl !== "string" || overrides.baseUrl.length === 0) {
    return undefined;
  }
  return overrides.baseUrl;
}

function resolveConfigOverride<T>(
  key:
    | "viewCustomization"
    | "skills"
    | "daemon"
    | "openMeldToolsMaintenance"
    | "deviceRuntimeState"
    | "onboarding",
  previous: T | undefined,
  overrides: RuntimeConfigOverrides
): T | undefined {
  if (!(key in overrides)) {
    return previous;
  }
  const value = overrides[key] as T | null | undefined;
  return value ?? undefined;
}

async function acquireRuntimeConfigLock(): Promise<OpenMeldLock> {
  for (
    let attempt = 0;
    attempt < RUNTIME_CONFIG_LOCK_MAX_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await acquireLock({
        openMeldProfileId: RUNTIME_CONFIG_LOCK_PROFILE,
        key: RUNTIME_CONFIG_LOCK_KEY,
      });
    } catch (error) {
      if (
        !isOpenMeldLockError(error) ||
        isOpenMeldOrphanedLockError(error) ||
        attempt === RUNTIME_CONFIG_LOCK_MAX_ATTEMPTS - 1
      ) {
        throw error;
      }
      await delay(RUNTIME_CONFIG_LOCK_RETRY_DELAY_MS);
    }
  }

  throw new Error("runtime config lock retries exhausted");
}

async function withRuntimeConfigLock<T>(run: () => Promise<T>): Promise<T> {
  const lock = await acquireRuntimeConfigLock();
  return await runWithHeldLock({
    lock,
    run,
    releaseContext: {
      component: "runtime_config",
      lockKey: RUNTIME_CONFIG_LOCK_KEY,
      openMeldProfileId: RUNTIME_CONFIG_LOCK_PROFILE,
    },
  });
}

type RuntimeConfigDomain = "preferences" | "runtime" | "skills";

async function readRuntimeConfig(
  domain: RuntimeConfigDomain
): Promise<RuntimeConfigV1 | null> {
  const result = await readRuntimeConfigDetailed(domain);
  return result.config;
}

async function readRuntimeConfigDetailed(
  domain?: RuntimeConfigDomain
): Promise<{
  config: RuntimeConfigV1 | null;
  health: RuntimeConfigReadHealth;
}> {
  const split = await readSplitRuntimeConfigDetailed(domain);
  if (split.hasFiles) {
    return {
      config: split.config,
      health: split.health,
    };
  }
  return await readLegacyRuntimeConfigDetailed();
}

function parseConfiguredBaseUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    return normalizeGatewayBaseUrl(value);
  } catch {
    return undefined;
  }
}

function parseRuntimeViewCustomization(
  value: unknown
): RuntimeViewCustomization | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const obj = value as {
    messages?: unknown;
    render?: unknown;
  };

  const messages = parseMessageCustomization(obj.messages);
  const render = parseRenderCustomization(obj.render);

  if (!(messages || render)) {
    return undefined;
  }

  return {
    ...(messages ? { messages } : {}),
    ...(render ? { render } : {}),
  };
}

function parseRuntimeSkillsConfig(
  value: unknown
): RuntimeSkillsConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const obj = value as {
    storeDir?: unknown;
    agents?: unknown;
    customTargets?: unknown;
    installs?: unknown;
  };

  const storeDir =
    typeof obj.storeDir === "string" && obj.storeDir.trim().length > 0
      ? obj.storeDir.trim()
      : undefined;
  const agents = parseRuntimeSkillsAgents(obj.agents);
  const installs = parseRuntimeSkillsInstallRecords(obj.installs);
  const customTargets = parseRuntimeSkillsCustomTargets(
    obj.customTargets,
    buildLegacyCustomTargetIdByDir(installs)
  );

  if (!(storeDir || agents || customTargets || installs)) {
    return undefined;
  }

  return {
    ...(storeDir ? { storeDir } : {}),
    ...(agents ? { agents } : {}),
    ...(customTargets ? { customTargets } : {}),
    ...(installs ? { installs } : {}),
  };
}

function parseRuntimeDaemonConfig(
  value: unknown
): RuntimeDaemonConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const obj = value as {
    dispatch?: unknown;
  };
  const dispatch = parseRuntimeDaemonDispatchConfig(obj.dispatch);
  if (!dispatch) {
    return undefined;
  }
  return { dispatch };
}

function parseRuntimeOpenMeldToolsMaintenanceConfig(
  value: unknown
): RuntimeOpenMeldToolsMaintenanceConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const automaticUpdatesEnabled = (
    value as { automaticUpdatesEnabled?: unknown }
  ).automaticUpdatesEnabled;
  if (typeof automaticUpdatesEnabled !== "boolean") {
    return undefined;
  }
  return { automaticUpdatesEnabled };
}

function parseRuntimeDaemonDispatchConfig(
  value: unknown
): RuntimeDaemonDispatchConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const obj = value as {
    globalConcurrency?: unknown;
    queueMax?: unknown;
  };
  const globalConcurrency = parsePositiveInteger(obj.globalConcurrency);
  const queueMax = parsePositiveInteger(obj.queueMax);
  if (globalConcurrency === undefined && queueMax === undefined) {
    return undefined;
  }
  return {
    ...(globalConcurrency === undefined ? {} : { globalConcurrency }),
    ...(queueMax === undefined ? {} : { queueMax }),
  };
}

function parseRuntimeDeviceRuntimeState(
  value: unknown
): RuntimeDeviceRuntimeState | undefined {
  const fromDeviceRuntimeState = parseRuntimeDeviceRuntimeStateObject(value);
  return fromDeviceRuntimeState;
}

function parseRuntimeDeviceRuntimeStateObject(
  value: unknown
): RuntimeDeviceRuntimeState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const obj = value as {
    controllers?: unknown;
  };
  const controllers = parseRuntimeAgentControllerStates(obj.controllers);
  if (!controllers) {
    return undefined;
  }

  return {
    controllers,
  };
}

function parseRuntimeOnboardingConfig(
  value: unknown
): RuntimeOnboardingConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const obj = value as {
    disclaimerAcceptedAt?: unknown;
    startV1?: unknown;
  };
  const disclaimerAcceptedAt = toTrimmedStringOrUndefined(
    obj.disclaimerAcceptedAt
  );
  const startV1 = parseRuntimeStartV1OnboardingState(obj.startV1);
  if (!(disclaimerAcceptedAt || startV1)) {
    return undefined;
  }
  return {
    ...(disclaimerAcceptedAt ? { disclaimerAcceptedAt } : {}),
    ...(startV1 ? { startV1 } : {}),
  };
}

function parseRuntimeStartV1OnboardingState(
  value: unknown
): RuntimeStartV1OnboardingState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const obj = value as {
    disclaimerAcceptedVersion?: unknown;
    lastCompletedAt?: unknown;
    localAgentsSetupCompletedAt?: unknown;
  };
  const disclaimerAcceptedVersion = toTrimmedStringOrUndefined(
    obj.disclaimerAcceptedVersion
  );
  const lastCompletedAt = toTrimmedStringOrUndefined(obj.lastCompletedAt);
  const localAgentsSetupCompletedAt = toTrimmedStringOrUndefined(
    obj.localAgentsSetupCompletedAt
  );
  if (
    !(
      disclaimerAcceptedVersion ||
      lastCompletedAt ||
      localAgentsSetupCompletedAt
    )
  ) {
    return undefined;
  }
  return {
    ...(disclaimerAcceptedVersion ? { disclaimerAcceptedVersion } : {}),
    ...(lastCompletedAt ? { lastCompletedAt } : {}),
    ...(localAgentsSetupCompletedAt ? { localAgentsSetupCompletedAt } : {}),
  };
}

function runtimeConfigFiles(next: RuntimeConfigV1) {
  const updatedAt = new Date().toISOString();
  return [
    {
      path: devicePreferencesPath(),
      domain: "preferences",
      keys: [
        "baseUrl",
        "viewCustomization",
        "daemon",
        "openMeldToolsMaintenance",
        "onboarding",
      ],
      value: buildDevicePreferencesState(next, updatedAt),
    },
    {
      path: deviceAgentRuntimePath(),
      domain: "runtime",
      keys: ["deviceRuntimeState"],
      value: buildDeviceAgentRuntimeState(next, updatedAt),
    },
    {
      path: deviceSkillsStorePath(),
      domain: "skills",
      keys: ["storeDir", "agents"],
      value: buildDeviceSkillsStoreState(next, updatedAt),
    },
    {
      path: deviceSkillsCustomTargetsPath(),
      domain: "skills",
      keys: ["customTargets"],
      value: buildDeviceSkillsCustomTargetsState(next, updatedAt),
    },
    {
      path: deviceSkillsInstallsPath(),
      domain: "skills",
      keys: ["installs"],
      value: buildDeviceSkillsInstallsState(next, updatedAt),
    },
  ] as const;
}

function isSupportedConfigFile(
  value: unknown
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "v" in value &&
    value.v === 1
  );
}

async function migrateLegacyRuntimeConfig(): Promise<{
  migratedLegacyConfig: boolean;
  removedLegacyConfig: boolean;
}> {
  if (!(await pathExists(legacyRuntimeConfigPath()))) {
    return { migratedLegacyConfig: false, removedLegacyConfig: false };
  }
  const legacy = await readLegacyRuntimeConfigDetailed();
  if (legacy.health.parseFallback) {
    throw new Error(
      "OpenMeld could not migrate the saved configuration. The original file has been preserved."
    );
  }
  const files = runtimeConfigFiles(
    legacy.config ?? { v: 1, updatedAt: new Date().toISOString() }
  );
  let migratedLegacyConfig = false;
  let canRemoveLegacy = true;
  for (const file of files) {
    const existing = await readOptionalJsonFile(file.path);
    if (existing.found) {
      // A partially completed migration never replaces an already-owned file.
      canRemoveLegacy &&=
        !existing.error && isSupportedConfigFile(existing.value);
      continue;
    }
    await writeRuntimeConfigFile(
      file.path,
      file.value ?? { v: 1, updatedAt: new Date().toISOString() }
    );
    migratedLegacyConfig = true;
  }
  if (canRemoveLegacy) {
    await rm(legacyRuntimeConfigPath(), { force: true });
  }
  return { migratedLegacyConfig, removedLegacyConfig: canRemoveLegacy };
}

async function readRuntimeConfigForMutation(
  domain: RuntimeConfigDomain
): Promise<RuntimeConfigV1 | null> {
  await migrateLegacyRuntimeConfig();
  const files = runtimeConfigFiles({ v: 1, updatedAt: "" }).filter(
    (file) => file.domain === domain
  );
  for (const file of files) {
    const existing = await readOptionalJsonFile(file.path);
    if (
      existing.found &&
      (existing.error || !isSupportedConfigFile(existing.value))
    ) {
      throw new Error(
        `OpenMeld cannot safely update ${file.path}. Its existing contents have been preserved.`
      );
    }
  }
  return await readRuntimeConfig(domain);
}

async function writeRuntimeConfigFields(
  next: RuntimeConfigV1,
  fields: (keyof RuntimeConfigOverrides)[]
): Promise<void> {
  const files = runtimeConfigFiles(next).filter((file) =>
    file.domain === "skills"
      ? fields.includes("skills")
      : file.keys.some((key) =>
          fields.includes(key as keyof RuntimeConfigOverrides)
        )
  );
  for (const file of files) {
    const existing = await readOptionalJsonFile(file.path);
    if (
      existing.found &&
      (existing.error || !isSupportedConfigFile(existing.value))
    ) {
      throw new Error(
        `OpenMeld cannot safely update ${file.path}. Its existing contents have been preserved.`
      );
    }
    const value = {
      ...(existing.value as Record<string, unknown> | null),
      v: 1,
    } as Record<string, unknown>;
    const incoming = file.value as Record<string, unknown> | null;
    for (const key of file.keys) {
      if (
        file.domain === "preferences" &&
        !fields.includes(key as keyof RuntimeConfigOverrides)
      ) {
        continue;
      }
      delete value[key];
      if (incoming && key in incoming) {
        value[key] = incoming[key];
      }
    }
    value.updatedAt = new Date().toISOString();
    // Keep empty owned files: absence must not resurrect legacy values after a crash.
    await writeRuntimeConfigFile(file.path, value);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseMessageCustomization(
  value: unknown
): RuntimeMessageCustomization | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const obj = value as {
    human?: unknown;
    agent?: unknown;
  };

  const human = toStringMap(obj.human);
  const agent = toStringMap(obj.agent);

  if (!(human || agent)) {
    return undefined;
  }

  return {
    ...(human ? { human } : {}),
    ...(agent ? { agent } : {}),
  };
}

function parseRenderCustomization(
  value: unknown
): RuntimeRenderCustomization | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const obj = value as {
    human?: unknown;
    agent?: unknown;
  };

  const humanRaw = obj.human as { dataMode?: unknown } | undefined;
  const agentRaw = obj.agent as { envelopeMode?: unknown } | undefined;

  const human: RuntimeHumanRender | undefined =
    humanRaw?.dataMode === "payload" || humanRaw?.dataMode === "envelope"
      ? { dataMode: humanRaw.dataMode }
      : undefined;

  const agent: RuntimeAgentRender | undefined =
    agentRaw?.envelopeMode === "verbose" || agentRaw?.envelopeMode === "compact"
      ? { envelopeMode: agentRaw.envelopeMode }
      : undefined;

  if (!(human || agent)) {
    return undefined;
  }

  return {
    ...(human ? { human } : {}),
    ...(agent ? { agent } : {}),
  };
}

function parseRuntimeSkillsAgents(
  value: unknown
): Record<string, RuntimeSkillsAgentConfig> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const entries = Object.entries(value).flatMap(([agentName, agentValue]) => {
    if (!agentValue || typeof agentValue !== "object") {
      return [];
    }
    const agentObj = agentValue as {
      skillsDir?: unknown;
      globalSkillsDir?: unknown;
    };
    const skillsDir =
      typeof agentObj.skillsDir === "string" &&
      agentObj.skillsDir.trim().length > 0
        ? agentObj.skillsDir.trim()
        : undefined;
    const globalSkillsDir =
      typeof agentObj.globalSkillsDir === "string" &&
      agentObj.globalSkillsDir.trim().length > 0
        ? agentObj.globalSkillsDir.trim()
        : undefined;
    if (!(skillsDir || globalSkillsDir)) {
      return [];
    }
    return [
      [
        agentName,
        {
          ...(skillsDir ? { skillsDir } : {}),
          ...(globalSkillsDir ? { globalSkillsDir } : {}),
        },
      ] as [string, RuntimeSkillsAgentConfig],
    ];
  });

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function parseRuntimeSkillsCustomTargets(
  value: unknown,
  legacyCustomTargetIdByDir?: Map<string, string>
): RuntimeSkillsCustomTarget[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const targets = value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const obj = item as { id?: unknown; name?: unknown; dir?: unknown };
    const name =
      typeof obj.name === "string" && obj.name.trim().length > 0
        ? obj.name.trim()
        : "";
    const dir =
      typeof obj.dir === "string" && obj.dir.trim().length > 0
        ? normalizeCustomTargetDir(obj.dir)
        : "";
    if (!(name && dir)) {
      return [];
    }
    const explicitId = toTrimmedStringOrUndefined(obj.id);
    const fallbackLegacyId = legacyCustomTargetIdByDir?.get(dir);
    const id = resolveRuntimeSkillsCustomTargetId({
      dir,
      ...(explicitId ? { id: explicitId } : {}),
      ...(!explicitId && fallbackLegacyId ? { id: fallbackLegacyId } : {}),
    });
    return [{ id, name, dir }];
  });

  if (targets.length === 0) {
    return undefined;
  }

  return targets;
}

function parseRuntimeSkillsInstallRecords(
  value: unknown
): RuntimeSkillsInstallRecord[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const records = value
    .map((item) => parseRuntimeSkillsInstallRecord(item))
    .filter((record): record is RuntimeSkillsInstallRecord => record !== null);

  if (records.length === 0) {
    return undefined;
  }

  return records;
}

function buildLegacyCustomTargetIdByDir(
  installs: RuntimeSkillsInstallRecord[] | undefined
): Map<string, string> {
  const byDir = new Map<string, string>();
  for (const install of installs ?? []) {
    if (!install.targetId.startsWith(CUSTOM_TARGET_ID_PREFIX)) {
      continue;
    }
    const normalizedTargetDir = normalizeCustomTargetDir(install.targetDir);
    if (!normalizedTargetDir) {
      continue;
    }
    byDir.set(normalizedTargetDir, install.targetId);
  }
  return byDir;
}

function parseRuntimeSkillsInstallRecord(
  value: unknown
): RuntimeSkillsInstallRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const obj = value as {
    targetId?: unknown;
    targetDir?: unknown;
    mode?: unknown;
    status?: unknown;
    skillIds?: unknown;
    reason?: unknown;
    updatedAt?: unknown;
  };
  const targetId = toTrimmedStringOrEmpty(obj.targetId);
  const rawTargetDir = toTrimmedStringOrEmpty(obj.targetDir);
  const targetDir = rawTargetDir;
  const mode = parseSkillsInstallMode(obj.mode);
  const status = parseSkillsInstallStatus(obj.status);
  const skillIds = Array.isArray(obj.skillIds)
    ? obj.skillIds
        .map((skill) => (typeof skill === "string" ? skill.trim() : ""))
        .filter((skill): skill is string => skill.length > 0)
    : [];
  const updatedAt = toTrimmedStringOrEmpty(obj.updatedAt);
  const reason = toTrimmedStringOrUndefined(obj.reason);

  if (!(targetId && targetDir && mode && status && updatedAt)) {
    return null;
  }

  return {
    targetId,
    targetDir,
    mode,
    status,
    skillIds,
    ...(reason ? { reason } : {}),
    updatedAt,
  };
}

function parseRuntimeAgentControllerStates(
  value: unknown
): RuntimeAgentControllerState[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed = value
    .map((entry) => parseRuntimeAgentControllerState(entry))
    .filter((entry): entry is RuntimeAgentControllerState => entry !== null);

  if (parsed.length === 0) {
    return undefined;
  }

  const deduped = new Map<string, RuntimeAgentControllerState>();
  for (const entry of parsed) {
    deduped.set(entry.agentId, entry);
  }

  return [...deduped.values()].sort((a, b) =>
    a.agentId.localeCompare(b.agentId)
  );
}

function parseRuntimeAgentControllerState(
  value: unknown
): RuntimeAgentControllerState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const obj = value as {
    agentId?: unknown;
    displayName?: unknown;
    enabled?: unknown;
    launchContract?: unknown;
    transportMode?: unknown;
    streamingMode?: unknown;
    timeoutMs?: unknown;
    retry?: unknown;
    contextIdMappingSpec?: unknown;
    registeredAt?: unknown;
    updatedAt?: unknown;
  };
  const agentId = toTrimmedStringOrEmpty(obj.agentId);
  const displayName = toTrimmedStringOrEmpty(obj.displayName);
  const enabled = typeof obj.enabled === "boolean" ? obj.enabled : null;
  const launchContract = parseRuntimeAgentControllerLaunchContract(
    obj.launchContract
  );
  const defaults = createDefaultRuntimeAgentControllerSettings(agentId);
  const controllerSettings = parseRuntimeAgentControllerSettings(
    {
      transportMode: obj.transportMode,
      streamingMode: obj.streamingMode,
      timeoutMs: obj.timeoutMs,
      retry: obj.retry,
      contextIdMappingSpec: obj.contextIdMappingSpec,
    },
    defaults
  );
  const registeredAt = toTrimmedStringOrEmpty(obj.registeredAt);
  const updatedAt = toTrimmedStringOrEmpty(obj.updatedAt);

  if (
    !(
      agentId &&
      displayName &&
      enabled !== null &&
      controllerSettings &&
      registeredAt &&
      updatedAt
    )
  ) {
    return null;
  }

  return {
    agentId,
    displayName,
    enabled,
    ...(launchContract ? { launchContract } : {}),
    transportMode: controllerSettings.transportMode,
    streamingMode: controllerSettings.streamingMode,
    timeoutMs: controllerSettings.timeoutMs,
    retry: controllerSettings.retry,
    contextIdMappingSpec: controllerSettings.contextIdMappingSpec,
    registeredAt,
    updatedAt,
  };
}

function parseRuntimeAgentControllerLaunchContract(
  value: unknown
): RuntimeAgentControllerLaunchContract | undefined {
  if (!(value && typeof value === "object")) {
    return undefined;
  }
  const parsed = runtimeAgentControllerLaunchContractSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseRuntimeAgentControllerSettings(
  raw: {
    transportMode: unknown;
    streamingMode: unknown;
    timeoutMs: unknown;
    retry: unknown;
    contextIdMappingSpec: unknown;
  },
  defaults: RuntimeAgentControllerSettings
): RuntimeAgentControllerSettings | null {
  const normalizedStreamingMode = normalizeRuntimeStreamingMode(
    raw.streamingMode
  );
  const parsed = runtimeAgentControllerSettingsSchema.safeParse({
    transport_mode: raw.transportMode ?? defaults.transportMode,
    streaming_mode: normalizedStreamingMode ?? defaults.streamingMode,
    timeout_ms:
      raw.timeoutMs === undefined ? defaults.timeoutMs : raw.timeoutMs,
    retry: raw.retry ?? defaults.retry,
    context_id_mapping_spec:
      raw.contextIdMappingSpec ?? defaults.contextIdMappingSpec,
  });
  if (!parsed.success) {
    return null;
  }

  return {
    transportMode: parsed.data.transport_mode,
    streamingMode: parsed.data.streaming_mode,
    timeoutMs: normalizeRuntimeAgentTimeoutMs({
      defaults,
      timeoutMs: parsed.data.timeout_ms,
    }),
    retry: parsed.data.retry,
    contextIdMappingSpec:
      normalizeRuntimeAgentControllerConversationIdMappingSpec({
        contextIdMappingSpec: parsed.data.context_id_mapping_spec,
        defaults,
      }),
  };
}

function normalizeRuntimeAgentTimeoutMs(input: {
  defaults: RuntimeAgentControllerSettings;
  timeoutMs: number | null;
}): number | null {
  // 120s was an old persisted default. Normal Agent execution must not inherit
  // it as a fixed wall-clock cutoff.
  if (input.timeoutMs === 120_000) {
    return input.defaults.timeoutMs;
  }
  return input.timeoutMs;
}

function normalizeRuntimeAgentControllerConversationIdMappingSpec(input: {
  contextIdMappingSpec: RuntimeAgentControllerConversationIdMappingSpec;
  defaults: RuntimeAgentControllerSettings;
}): RuntimeAgentControllerConversationIdMappingSpec {
  if (
    input.contextIdMappingSpec.sourceField !==
    DEFAULT_RUNTIME_AGENT_CONTEXT_SOURCE_FIELD
  ) {
    return input.defaults.contextIdMappingSpec;
  }
  return input.contextIdMappingSpec;
}

function resolveRuntimeDaemonDispatchLimits(
  config?: RuntimeDaemonDispatchConfig
): RuntimeDaemonDispatchLimits {
  return {
    globalConcurrency:
      parsePositiveInteger(config?.globalConcurrency) ??
      DEFAULT_RUNTIME_DAEMON_GLOBAL_CONCURRENCY,
    queueMax:
      parsePositiveInteger(config?.queueMax) ??
      DEFAULT_RUNTIME_DAEMON_QUEUE_MAX,
  };
}

function normalizeRuntimeStreamingMode(
  value: unknown
): RuntimeAgentStreamingMode | null {
  if (value === "final" || value === "stream") {
    return value;
  }
  return null;
}

function parseSkillsInstallMode(
  value: unknown
): RuntimeSkillsInstallRecord["mode"] | null {
  if (value === "symlink" || value === "copy") {
    return value;
  }
  return null;
}

function parseSkillsInstallStatus(
  value: unknown
): RuntimeSkillsInstallRecord["status"] | null {
  if (value === "installed" || value === "skipped" || value === "failed") {
    return value;
  }
  return null;
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (!Number.isInteger(value)) {
    return undefined;
  }
  const numericValue = Number(value);
  if (numericValue <= 0) {
    return undefined;
  }
  return numericValue;
}

function toTrimmedStringOrEmpty(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function toTrimmedStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCustomTargetDir(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (WINDOWS_DRIVE_ONLY_RE.test(trimmed)) {
    return `${trimmed[0]?.toUpperCase() ?? ""}:`;
  }
  const windowsLike =
    WINDOWS_DRIVE_PREFIX_RE.test(trimmed) || WINDOWS_UNC_RE.test(trimmed);
  const normalizedPath = windowsLike
    ? (() => {
        const normalizedWindowsPath = win32.normalize(trimmed);
        if (WINDOWS_DRIVE_ANY_RE.test(normalizedWindowsPath)) {
          return `${normalizedWindowsPath[0]?.toUpperCase() ?? ""}${normalizedWindowsPath.slice(1)}`;
        }
        return normalizedWindowsPath;
      })()
    : normalize(trimmed);
  const isPosixRoot = normalizedPath === posix.parse(normalizedPath).root;
  const isWindowsRoot = normalizedPath === win32.parse(normalizedPath).root;
  if (isPosixRoot || isWindowsRoot) {
    return normalizedPath;
  }
  return normalizedPath.replace(TRAILING_PATH_SEPARATORS_RE, "");
}

function toStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  );
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

async function readSplitRuntimeConfigDetailed(
  domain?: RuntimeConfigDomain
): Promise<{
  config: RuntimeConfigV1 | null;
  hasFiles: boolean;
  health: RuntimeConfigReadHealth;
}> {
  const [
    preferencesFile,
    agentRuntimeFile,
    skillsStoreFile,
    customTargetsFile,
    installsFile,
  ] = await Promise.all([
    readDomainFile("preferences", devicePreferencesPath()),
    readDomainFile("runtime", deviceAgentRuntimePath()),
    readDomainFile("skills", deviceSkillsStorePath()),
    readDomainFile("skills", deviceSkillsCustomTargetsPath()),
    readDomainFile("skills", deviceSkillsInstallsPath()),
  ]);

  function readDomainFile(owner: RuntimeConfigDomain, path: string) {
    return !domain || domain === owner
      ? readOptionalJsonFile(path)
      : Promise.resolve({ found: false, value: null, error: undefined });
  }

  const files = [
    preferencesFile,
    agentRuntimeFile,
    skillsStoreFile,
    customTargetsFile,
    installsFile,
  ];
  const hasFiles = files.some((file) => file.found);
  if (!hasFiles) {
    return {
      config: null,
      hasFiles: false,
      health: {
        parseFallback: false,
      },
    };
  }

  const invalidFile = files.find((file) => file.error);
  const preferences = parseDevicePreferencesConfig(preferencesFile.value);
  const agentRuntime = parseDeviceAgentRuntimeConfig(agentRuntimeFile.value);
  const skillsStore = parseDeviceSkillsStoreConfig(skillsStoreFile.value);
  const customTargets = parseDeviceSkillsCustomTargetsConfig(
    customTargetsFile.value
  );
  const installs = parseDeviceSkillsInstallsConfig(installsFile.value);

  const skills = mergeRuntimeSkillsConfig({
    store: skillsStore,
    customTargets,
    installs,
  });
  const config = buildRuntimeConfigFromParts({
    baseUrl: preferences.baseUrl,
    viewCustomization: preferences.viewCustomization,
    daemon: preferences.daemon,
    openMeldToolsMaintenance: preferences.openMeldToolsMaintenance,
    onboarding: preferences.onboarding,
    deviceRuntimeState: agentRuntime,
    skills,
  });

  return {
    config,
    hasFiles: true,
    health: invalidFile
      ? {
          parseFallback: true,
          reason: invalidFile.error ?? "invalid_json",
        }
      : {
          parseFallback: false,
        },
  };
}

async function readLegacyRuntimeConfigDetailed(): Promise<{
  config: RuntimeConfigV1 | null;
  health: RuntimeConfigReadHealth;
}> {
  let raw: string;
  try {
    raw = await readFile(legacyRuntimeConfigPath(), "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {
        config: null,
        health: {
          parseFallback: false,
        },
      };
    }
    throw error;
  }

  if (raw.trim().length === 0) {
    return {
      config: null,
      health: {
        parseFallback: false,
      },
    };
  }

  let parsed: Partial<RuntimeConfigV1> & {
    agents?: unknown;
    daemon?: unknown;
    onboarding?: unknown;
    openMeldToolsMaintenance?: unknown;
  };
  try {
    parsed = JSON.parse(raw) as Partial<RuntimeConfigV1> & {
      agents?: unknown;
      daemon?: unknown;
      onboarding?: unknown;
    };
  } catch {
    return {
      config: null,
      health: {
        parseFallback: true,
        reason: "invalid_json",
      },
    };
  }

  if (parsed.v !== 1) {
    return {
      config: null,
      health: {
        parseFallback: true,
        reason: "invalid_version",
      },
    };
  }

  if (parsed.agents !== undefined) {
    throw new Error(
      "runtime.config.legacy_agents_unsupported: key 'agents.registrations' is no longer supported. Use 'deviceRuntimeState.controllers' or run 'openmeld reset --yes'."
    );
  }

  return {
    config: buildRuntimeConfigFromParts({
      baseUrl: parseConfiguredBaseUrl(parsed.baseUrl),
      viewCustomization: parseRuntimeViewCustomization(
        parsed.viewCustomization
      ),
      skills: parseRuntimeSkillsConfig(parsed.skills),
      daemon: parseRuntimeDaemonConfig(parsed.daemon),
      openMeldToolsMaintenance: parseRuntimeOpenMeldToolsMaintenanceConfig(
        parsed.openMeldToolsMaintenance
      ),
      deviceRuntimeState: parseRuntimeDeviceRuntimeState(
        parsed.deviceRuntimeState
      ),
      onboarding: parseRuntimeOnboardingConfig(parsed.onboarding),
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString(),
    }),
    health: {
      parseFallback: false,
    },
  };
}

function buildRuntimeConfigFromParts(input: {
  baseUrl?: string;
  viewCustomization?: RuntimeViewCustomization;
  skills?: RuntimeSkillsConfig;
  daemon?: RuntimeDaemonConfig;
  openMeldToolsMaintenance?: RuntimeOpenMeldToolsMaintenanceConfig;
  deviceRuntimeState?: RuntimeDeviceRuntimeState;
  onboarding?: RuntimeOnboardingConfig;
  updatedAt?: string;
}): RuntimeConfigV1 | null {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  if (
    !(
      input.baseUrl ||
      input.viewCustomization ||
      input.skills ||
      input.daemon ||
      input.openMeldToolsMaintenance ||
      input.deviceRuntimeState ||
      input.onboarding
    )
  ) {
    return null;
  }

  return {
    v: 1,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    ...(input.viewCustomization
      ? { viewCustomization: input.viewCustomization }
      : {}),
    ...(input.skills ? { skills: input.skills } : {}),
    ...(input.daemon ? { daemon: input.daemon } : {}),
    ...(input.openMeldToolsMaintenance
      ? { openMeldToolsMaintenance: input.openMeldToolsMaintenance }
      : {}),
    ...(input.deviceRuntimeState
      ? { deviceRuntimeState: input.deviceRuntimeState }
      : {}),
    ...(input.onboarding ? { onboarding: input.onboarding } : {}),
    updatedAt,
  };
}

function parseDevicePreferencesConfig(
  value: unknown
): Pick<
  RuntimeConfigV1,
  | "baseUrl"
  | "viewCustomization"
  | "daemon"
  | "openMeldToolsMaintenance"
  | "onboarding"
> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const parsed = value as Partial<DevicePreferencesV1>;
  if (parsed.v !== 1) {
    return {};
  }
  return {
    ...(parseConfiguredBaseUrl(parsed.baseUrl)
      ? { baseUrl: parseConfiguredBaseUrl(parsed.baseUrl) }
      : {}),
    ...(parseRuntimeViewCustomization(parsed.viewCustomization)
      ? {
          viewCustomization: parseRuntimeViewCustomization(
            parsed.viewCustomization
          ),
        }
      : {}),
    ...(parseRuntimeDaemonConfig(parsed.daemon)
      ? { daemon: parseRuntimeDaemonConfig(parsed.daemon) }
      : {}),
    ...(parseRuntimeOpenMeldToolsMaintenanceConfig(
      parsed.openMeldToolsMaintenance
    )
      ? {
          openMeldToolsMaintenance: parseRuntimeOpenMeldToolsMaintenanceConfig(
            parsed.openMeldToolsMaintenance
          ),
        }
      : {}),
    ...(parseRuntimeOnboardingConfig(parsed.onboarding)
      ? { onboarding: parseRuntimeOnboardingConfig(parsed.onboarding) }
      : {}),
  };
}

function parseDeviceAgentRuntimeConfig(
  value: unknown
): RuntimeDeviceRuntimeState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const parsed = value as Partial<DeviceAgentRuntimeV1>;
  if (parsed.v !== 1) {
    return undefined;
  }
  return parseRuntimeDeviceRuntimeState(parsed.deviceRuntimeState);
}

function parseDeviceSkillsStoreConfig(
  value: unknown
): Pick<RuntimeSkillsConfig, "storeDir" | "agents"> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const parsed = value as Partial<DeviceSkillsStoreV1>;
  if (parsed.v !== 1) {
    return undefined;
  }
  const storeDir =
    typeof parsed.storeDir === "string" && parsed.storeDir.trim().length > 0
      ? parsed.storeDir.trim()
      : undefined;
  const agents = parseRuntimeSkillsAgents(parsed.agents);
  if (!(storeDir || agents)) {
    return undefined;
  }
  return {
    ...(storeDir ? { storeDir } : {}),
    ...(agents ? { agents } : {}),
  };
}

function parseDeviceSkillsCustomTargetsConfig(
  value: unknown
): RuntimeSkillsCustomTarget[] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const parsed = value as Partial<DeviceSkillsCustomTargetsV1>;
  if (parsed.v !== 1) {
    return undefined;
  }
  return parseRuntimeSkillsCustomTargets(parsed.customTargets, undefined);
}

function parseDeviceSkillsInstallsConfig(
  value: unknown
): RuntimeSkillsInstallRecord[] | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const parsed = value as Partial<DeviceSkillsInstallsV1>;
  if (parsed.v !== 1) {
    return undefined;
  }
  return parseRuntimeSkillsInstallRecords(parsed.installs);
}

function mergeRuntimeSkillsConfig(input: {
  store?: Pick<RuntimeSkillsConfig, "storeDir" | "agents">;
  customTargets?: RuntimeSkillsCustomTarget[];
  installs?: RuntimeSkillsInstallRecord[];
}): RuntimeSkillsConfig | undefined {
  if (!(input.store || input.customTargets || input.installs)) {
    return undefined;
  }
  return {
    ...(input.store?.storeDir ? { storeDir: input.store.storeDir } : {}),
    ...(input.store?.agents ? { agents: input.store.agents } : {}),
    ...(input.customTargets ? { customTargets: input.customTargets } : {}),
    ...(input.installs ? { installs: input.installs } : {}),
  };
}

function buildDevicePreferencesState(
  next: RuntimeConfigV1,
  updatedAt: string
): DevicePreferencesV1 | null {
  if (
    !(
      next.baseUrl ||
      next.viewCustomization ||
      next.daemon ||
      next.openMeldToolsMaintenance ||
      next.onboarding
    )
  ) {
    return null;
  }
  return {
    v: 1,
    ...(next.baseUrl ? { baseUrl: next.baseUrl } : {}),
    ...(next.viewCustomization
      ? { viewCustomization: next.viewCustomization }
      : {}),
    ...(next.daemon ? { daemon: next.daemon } : {}),
    ...(next.openMeldToolsMaintenance
      ? { openMeldToolsMaintenance: next.openMeldToolsMaintenance }
      : {}),
    ...(next.onboarding ? { onboarding: next.onboarding } : {}),
    updatedAt,
  };
}

function buildDeviceAgentRuntimeState(
  next: RuntimeConfigV1,
  updatedAt: string
): DeviceAgentRuntimeV1 | null {
  if (!next.deviceRuntimeState) {
    return null;
  }
  return {
    v: 1,
    deviceRuntimeState: next.deviceRuntimeState,
    updatedAt,
  };
}

function buildDeviceSkillsStoreState(
  next: RuntimeConfigV1,
  updatedAt: string
): DeviceSkillsStoreV1 | null {
  if (!(next.skills?.storeDir || next.skills?.agents)) {
    return null;
  }
  return {
    v: 1,
    ...(next.skills?.storeDir ? { storeDir: next.skills.storeDir } : {}),
    ...(next.skills?.agents ? { agents: next.skills.agents } : {}),
    updatedAt,
  };
}

function buildDeviceSkillsCustomTargetsState(
  next: RuntimeConfigV1,
  updatedAt: string
): DeviceSkillsCustomTargetsV1 | null {
  if (!(next.skills?.customTargets && next.skills.customTargets.length > 0)) {
    return null;
  }
  return {
    v: 1,
    customTargets: next.skills.customTargets,
    updatedAt,
  };
}

function buildDeviceSkillsInstallsState(
  next: RuntimeConfigV1,
  updatedAt: string
): DeviceSkillsInstallsV1 | null {
  if (!(next.skills?.installs && next.skills.installs.length > 0)) {
    return null;
  }
  return {
    v: 1,
    installs: next.skills.installs,
    updatedAt,
  };
}

async function writeRuntimeConfigFile(
  path: string,
  payload: object
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readOptionalJsonFile(path: string): Promise<{
  found: boolean;
  value: unknown;
  error?: RuntimeConfigFallbackReason;
}> {
  const raw = await readFile(path, "utf8").catch((error) => {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return {
      found: false,
      value: null,
    };
  }
  if (raw.trim().length === 0) {
    return {
      found: true,
      value: null,
    };
  }
  try {
    return {
      found: true,
      value: JSON.parse(raw),
    };
  } catch {
    return {
      found: true,
      value: null,
      error: "invalid_json",
    };
  }
}

async function pathExists(path: string): Promise<boolean> {
  return await readFile(path, "utf8")
    .then(() => true)
    .catch((error) => {
      if (isFileNotFoundError(error)) {
        return false;
      }
      throw error;
    });
}
