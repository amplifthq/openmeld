import { isAbsolute } from "node:path";
import { buildAgentControllerRef } from "@openmeld/agent-runtime";
import { compareAgentControllerRefsForDisplay } from "@openmeld/schemas";
import type {
  AgentControllerInterfaceSnapshot,
  LocalAgentInstallationOption,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/schemas/types";
import {
  createDefaultRuntimeAgentControllerSettings,
  getConfiguredDeviceRuntimeState,
  getConfiguredSkillsConfig,
  getRuntimeConfigReadHealth,
  type RuntimeAgentControllerConversationIdMappingSpec,
  type RuntimeAgentControllerState,
  type RuntimeAgentStreamingMode,
  type RuntimeAgentTransportMode,
  type RuntimeConfigReadHealth,
  type RuntimeSkillsConfig,
  type RuntimeSkillsCustomTarget,
  resolveRuntimeSkillsCustomTargetId,
  updateConfiguredDeviceRuntimeState,
  updateConfiguredSkillsConfig,
} from "../config/runtime-config";
import { mapWithConcurrency } from "../lib/map-with-concurrency";
import { notifyDaemonRouteCatalogChanged } from "../local-service/state/route-catalog-sync-notifier";
import {
  detectInstalledRuntimeAgents,
  resolveSkillsAgentRegistry,
  type SkillsAgentRegistryEntry,
  type SkillsAgentTransportMode,
} from "../skills/agents";
import {
  type LocalControllerInstallChoice,
  type LocalControllerInstallStatus,
  listBuiltinControllerInstalledCandidates,
  refreshBuiltinControllerPersistedLaunchContract,
  resolveBuiltinControllerInstallResolution,
} from "./local-controller-install";
import {
  createAgentRegistration,
  normalizeAgentId,
  sortAgentRegistrations,
} from "./model";

const AGENTS_ERROR_CODE_PREFIX_RE = /^agents\.[a-z0-9_.-]+:/;

export type AgentTargetKind = "builtin" | "custom";
export type AgentLifecycleStatus = SkillsAgentRegistryEntry["lifecycleStatus"];

export type AgentTargetSelectableReason =
  | "not_detected"
  | "not_supported_yet"
  | "needs_repair"
  | "custom_coming_soon";

export type AgentTargetDescriptor = {
  agentId: string;
  displayName: string;
  targetKind: AgentTargetKind;
  detected: boolean;
  lifecycleStatus: AgentLifecycleStatus;
  runtimeSupported: boolean;
  transportModes: SkillsAgentTransportMode[];
  defaultTransportMode?: RuntimeAgentTransportMode;
  defaultStreamingMode?: RuntimeAgentStreamingMode;
  contextIdMappingSpec: RuntimeAgentControllerConversationIdMappingSpec;
  customDir?: string;
};

export type AgentCatalog = {
  detectedBuiltins: AgentTargetDescriptor[];
  builtinsById: Map<string, AgentTargetDescriptor>;
  customById: Map<string, AgentTargetDescriptor>;
};

export type AgentTargetState = AgentTargetDescriptor & {
  selectable: boolean;
  selectableReason: AgentTargetSelectableReason | null;
  installChoices: LocalControllerInstallChoice[];
  launchStatus: LocalControllerInstallStatus;
  launchStatusDetail: string | null;
  launchFailureReason?: AgentControllerInterfaceSnapshot["launch"]["failureReason"];
  launchContract: RuntimeAgentControllerState["launchContract"] | null;
  registered: boolean;
  enabled: boolean;
  registration: RuntimeAgentControllerState | null;
};

export type AgentCustomTarget = {
  id: string;
  name: string;
  dir: string;
};

export type SetAgentRegistrationEnabledResult = {
  agentControllerRef: string;
  agentId: string;
  changed: boolean;
  displayName: string;
  enabled: boolean;
  status: "updated" | "unchanged";
};

export type ManageAgentRegistrationInstallationResult = {
  agentControllerRef: string;
  agentId: string;
  changed: boolean;
  displayName: string;
  installations: LocalAgentInstallationOption[];
  selectedInstallationId: string | null;
  status: "listed" | "updated" | "unchanged";
};

export type SetupLocalAgentRegistrationReconciliation = {
  registeredAgentIds: string[];
  preservedDisabledAgentIds: string[];
  preservedEnabledAgentIds: string[];
};

export async function loadAgentCatalog(
  input: { agentIds?: readonly string[] } = {}
): Promise<AgentCatalog> {
  const skillsConfig = await getConfiguredSkillsConfig().catch((error) => {
    throw wrapConfigError(error, "agents.config_read_failed");
  });
  const requested = input.agentIds ? new Set(input.agentIds) : null;
  const builtins = Object.fromEntries(
    Object.entries(resolveSkillsAgentRegistry(skillsConfig)).filter(
      ([id]) => !requested || requested.has(id)
    )
  );
  const detectedIds = new Set(await detectInstalledRuntimeAgents(builtins));
  const builtinsById = new Map<string, AgentTargetDescriptor>();
  for (const [agentId, entry] of Object.entries(builtins)) {
    builtinsById.set(agentId, {
      agentId,
      displayName: entry.displayName,
      targetKind: "builtin",
      detected: detectedIds.has(agentId),
      lifecycleStatus: entry.lifecycleStatus,
      runtimeSupported: entry.runtimeSupported,
      transportModes: entry.transportModes,
      ...(entry.defaultTransportMode
        ? { defaultTransportMode: entry.defaultTransportMode }
        : {}),
      ...(entry.defaultStreamingMode
        ? { defaultStreamingMode: entry.defaultStreamingMode }
        : {}),
      contextIdMappingSpec: resolveDefaultContextIdMappingSpec(agentId),
    });
  }

  const customById = new Map<string, AgentTargetDescriptor>();
  const customTargets = skillsConfig?.customTargets ?? [];
  for (const target of customTargets) {
    const resolvedId = resolveRuntimeSkillsCustomTargetId({
      dir: target.dir,
      ...(target.id ? { id: target.id } : {}),
    });
    if (requested && !requested.has(resolvedId)) {
      continue;
    }
    customById.set(resolvedId, {
      agentId: resolvedId,
      displayName: target.name,
      targetKind: "custom",
      detected: false,
      lifecycleStatus: "active",
      runtimeSupported: false,
      transportModes: [],
      contextIdMappingSpec: resolveDefaultContextIdMappingSpec(resolvedId),
      customDir: target.dir,
    });
  }

  const detectedBuiltins = [...builtinsById.values()]
    .filter((entry) => {
      if (!entry.detected) {
        return false;
      }
      return resolveTargetSelectability(entry).selectable;
    })
    .sort((left, right) =>
      compareAgentControllerRefsForDisplay(left.agentId, right.agentId)
    );

  return {
    detectedBuiltins,
    builtinsById,
    customById,
  };
}

export async function listAgentRegistrations(): Promise<
  RuntimeAgentControllerState[]
> {
  const [configured, skillsConfig] = await Promise.all([
    getConfiguredDeviceRuntimeState(),
    getConfiguredSkillsConfig(),
  ]).catch((error) => {
    throw wrapConfigError(error, "agents.config_read_failed");
  });
  const registrations = sortAgentRegistrations(configured?.controllers ?? []);
  if (registrations.length === 0) {
    return registrations;
  }
  const registry = resolveSkillsAgentRegistry(skillsConfig);
  const knownAgentIds = resolveKnownAgentIds(skillsConfig);
  const runtimeSupportedAgentIds = new Set(
    Object.entries(registry)
      .filter((entry) => entry[1].runtimeSupported)
      .map((entry) => entry[0])
  );
  const hasUnknownRegistrations = registrations.some(
    (registration) => !knownAgentIds.has(registration.agentId)
  );
  const hasUnsupportedRegistrations = registrations.some(
    (registration) => !runtimeSupportedAgentIds.has(registration.agentId)
  );
  const reconciliationTimestamp = new Date().toISOString();
  const launchContractRefreshes = await resolveLaunchContractRefreshes({
    registrations,
    timestamp: reconciliationTimestamp,
  });
  const registrationsWithRefreshedLaunchContracts =
    applyLaunchContractRefreshes({
      refreshes: launchContractRefreshes,
      registrations,
    });
  const reconciled = reconcileAgentRegistrationsForCurrentRegistry({
    knownAgentIds,
    registrations: registrationsWithRefreshedLaunchContracts,
    registry,
    runtimeSupportedAgentIds,
    timestamp: reconciliationTimestamp,
  });
  if (
    !(
      hasUnknownRegistrations ||
      hasUnsupportedRegistrations ||
      launchContractRefreshes.size > 0 ||
      reconciled.changed
    )
  ) {
    return registrations;
  }
  return updateAgentRegistrations((current) => {
    const currentWithRefreshedLaunchContracts = applyLaunchContractRefreshes({
      refreshes: launchContractRefreshes,
      registrations: current,
    });
    return reconcileAgentRegistrationsForCurrentRegistry({
      knownAgentIds,
      registrations: currentWithRefreshedLaunchContracts,
      registry,
      runtimeSupportedAgentIds,
      timestamp: reconciliationTimestamp,
    }).registrations;
  });
}

type AgentLaunchContractRefresh = {
  expected: RuntimeAgentControllerLaunchContract;
  next: RuntimeAgentControllerLaunchContract;
  timestamp: string;
};

async function resolveLaunchContractRefreshes(input: {
  registrations: RuntimeAgentControllerState[];
  timestamp: string;
}): Promise<Map<string, AgentLaunchContractRefresh>> {
  const refreshes = new Map<string, AgentLaunchContractRefresh>();
  await Promise.all(
    input.registrations.map(async (registration) => {
      if (!registration.launchContract) {
        return;
      }
      const refreshed = await refreshBuiltinControllerPersistedLaunchContract({
        agentId: registration.agentId,
        launchContract: registration.launchContract,
      });
      if (launchContractsEqual(registration.launchContract, refreshed)) {
        return;
      }
      refreshes.set(registration.agentId, {
        expected: registration.launchContract,
        next: refreshed,
        timestamp: input.timestamp,
      });
    })
  );
  return refreshes;
}

function applyLaunchContractRefreshes(input: {
  refreshes: Map<string, AgentLaunchContractRefresh>;
  registrations: RuntimeAgentControllerState[];
}): RuntimeAgentControllerState[] {
  return input.registrations.map((registration) => {
    const refresh = input.refreshes.get(registration.agentId);
    if (
      !(
        refresh &&
        registration.launchContract &&
        launchContractsEqual(registration.launchContract, refresh.expected)
      )
    ) {
      return registration;
    }
    return {
      ...registration,
      launchContract: refresh.next,
      updatedAt: refresh.timestamp,
    };
  });
}

function launchContractsEqual(
  left: RuntimeAgentControllerLaunchContract,
  right: RuntimeAgentControllerLaunchContract
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  const leftArgs = left.argsPrefix ?? [];
  const rightArgs = right.argsPrefix ?? [];
  if (
    leftArgs.length !== rightArgs.length ||
    leftArgs.some((arg, index) => arg !== rightArgs[index])
  ) {
    return false;
  }
  if (left.kind === "executable" && right.kind === "executable") {
    return left.commandPath === right.commandPath;
  }
  return (
    left.kind === "node_script" &&
    right.kind === "node_script" &&
    left.nodePath === right.nodePath &&
    left.scriptPath === right.scriptPath
  );
}

function reconcileAgentRegistrationsForCurrentRegistry(input: {
  knownAgentIds: Set<string>;
  registrations: RuntimeAgentControllerState[];
  registry: Record<string, SkillsAgentRegistryEntry>;
  runtimeSupportedAgentIds: Set<string>;
  timestamp: string;
}): {
  changed: boolean;
  registrations: RuntimeAgentControllerState[];
} {
  let changed = false;
  const registrations: RuntimeAgentControllerState[] = [];
  for (const registration of input.registrations) {
    if (
      !(
        input.knownAgentIds.has(registration.agentId) &&
        input.runtimeSupportedAgentIds.has(registration.agentId)
      )
    ) {
      changed = true;
      continue;
    }
    const reconciled = reconcileAgentRegistrationRuntimeDefaults({
      registration,
      registryEntry: input.registry[registration.agentId],
      timestamp: input.timestamp,
    });
    if (reconciled !== registration) {
      changed = true;
    }
    registrations.push(reconciled);
  }
  return {
    changed,
    registrations: sortAgentRegistrations(registrations),
  };
}

function reconcileAgentRegistrationRuntimeDefaults(input: {
  registration: RuntimeAgentControllerState;
  registryEntry?: SkillsAgentRegistryEntry;
  timestamp: string;
}): RuntimeAgentControllerState {
  const supportedTransportModes =
    input.registryEntry?.transportModes.map(
      (transportMode) => transportMode.mode
    ) ?? [];
  const defaultTransportMode =
    input.registryEntry?.defaultTransportMode ??
    supportedTransportModes[0] ??
    null;
  const transportModeSupported = input.registration.transportMode
    ? supportedTransportModes.includes(input.registration.transportMode)
    : false;
  if (!defaultTransportMode || transportModeSupported) {
    return input.registration;
  }
  return {
    ...input.registration,
    transportMode: defaultTransportMode,
    updatedAt: input.timestamp,
  };
}

export async function listAgentTargetStates(
  input: {
    agentIds?: readonly string[];
    // Targets checked at once. Each check is independently time-bounded, so a
    // bounded pool keeps one slow installation from delaying every other one.
    concurrency?: number;
    onState?: (state: AgentTargetState) => Promise<void>;
    reconcileNewRegistrations?: boolean;
  } = {}
): Promise<AgentTargetState[]> {
  const [skillsConfig, registrations] = await Promise.all([
    getConfiguredSkillsConfig(),
    listAgentRegistrations(),
  ]);
  const registrationById = new Map(
    registrations.map((registration) => [registration.agentId, registration])
  );
  const agentIds = [
    ...new Set(
      input.agentIds ?? [
        ...Object.keys(resolveSkillsAgentRegistry(skillsConfig)),
        ...(skillsConfig?.customTargets ?? []).map((target) =>
          resolveRuntimeSkillsCustomTargetId({
            dir: target.dir,
            ...(target.id ? { id: target.id } : {}),
          })
        ),
      ]
    ),
  ].sort(compareAgentControllerRefsForDisplay);
  // Discover targets independently so a completed controller can be checked
  // and reported without waiting for another installation's slow discovery.
  const states = await mapWithConcurrency(
    agentIds,
    input.concurrency ?? 1,
    async (agentId) =>
      await resolveListedAgentTargetState({
        agentId,
        onState: input.onState,
        reconcileNewRegistrations: input.reconcileNewRegistrations,
        registrationById,
      })
  );
  return states.filter((state): state is AgentTargetState => state !== null);
}

async function resolveListedAgentTargetState(input: {
  agentId: string;
  onState?: (state: AgentTargetState) => Promise<void>;
  reconcileNewRegistrations?: boolean;
  registrationById: ReadonlyMap<string, RuntimeAgentControllerState>;
}): Promise<AgentTargetState | null> {
  const { agentId, registrationById } = input;
  const catalog = await loadAgentCatalog({ agentIds: [agentId] });
  const target =
    catalog.builtinsById.get(agentId) ?? catalog.customById.get(agentId);
  if (!target) {
    return null;
  }
  const registration = registrationById.get(target.agentId) ?? null;
  let state = await toAgentTargetState(target, registration);
  if (
    input.reconcileNewRegistrations &&
    !state.registered &&
    isRunnableBuiltinForAutomaticSetup(state)
  ) {
    await reconcileNewRunnableBuiltinAgentRegistrations({ states: [state] });
    // Use the committed registration, including a concurrent disabled choice.
    const current = (
      await getConfiguredDeviceRuntimeState()
    )?.controllers?.find((item) => item.agentId === agentId);
    if (current) {
      state =
        state.launchContract &&
        current.launchContract &&
        launchContractsEqual(state.launchContract, current.launchContract)
          ? {
              ...state,
              registered: true,
              enabled: current.enabled,
              registration: current,
              contextIdMappingSpec:
                current.contextIdMappingSpec ?? state.contextIdMappingSpec,
            }
          : await toAgentTargetState(target, current);
    }
  }
  await input.onState?.(state);
  return state;
}

export async function resolveAgentTargetState(
  rawAgentId: string,
  states?: AgentTargetState[]
): Promise<AgentTargetState | null> {
  const agentId = normalizeAgentId(rawAgentId);
  if (!agentId) {
    return null;
  }
  if (states) {
    return states.find((state) => state.agentId === agentId) ?? null;
  }

  const [catalog, registrations] = await Promise.all([
    loadAgentCatalog({ agentIds: [agentId] }),
    listAgentRegistrations(),
  ]);
  const registrationById = new Map(
    registrations.map((registration) => [registration.agentId, registration])
  );

  const builtIn = catalog.builtinsById.get(agentId);
  if (builtIn) {
    return await toAgentTargetState(
      builtIn,
      registrationById.get(builtIn.agentId) ?? null
    );
  }

  const custom = catalog.customById.get(agentId);
  if (custom) {
    return await toAgentTargetState(
      custom,
      registrationById.get(custom.agentId) ?? null
    );
  }

  return null;
}

export async function updateAgentRegistrations(
  updater: (
    current: RuntimeAgentControllerState[]
  ) => RuntimeAgentControllerState[],
  options: { notifyRouteCatalogChanged?: boolean } = {}
): Promise<RuntimeAgentControllerState[]> {
  let nextRegistrations: RuntimeAgentControllerState[] = [];
  try {
    await updateConfiguredDeviceRuntimeState((currentConfig) => {
      const current = sortAgentRegistrations(currentConfig?.controllers ?? []);
      nextRegistrations = sortAgentRegistrations(updater(current));
      return { controllers: nextRegistrations };
    });
  } catch (error) {
    throw wrapConfigError(error, "agents.config_write_failed");
  }
  if (options.notifyRouteCatalogChanged !== false) {
    await notifyDaemonRouteCatalogChanged({
      reason: "device_runtime_state_updated",
    }).catch(() => undefined);
  }
  return nextRegistrations;
}

export async function reconcileNewRunnableBuiltinAgentRegistrations(
  input: {
    notifyRouteCatalogChanged?: boolean;
    states?: readonly AgentTargetState[];
  } = {}
): Promise<SetupLocalAgentRegistrationReconciliation> {
  const states = input.states ?? (await listAgentTargetStates());
  const runnableBuiltins = states
    .filter(isRunnableBuiltinForAutomaticSetup)
    .sort((left, right) =>
      compareAgentControllerRefsForDisplay(left.agentId, right.agentId)
    );
  const result: SetupLocalAgentRegistrationReconciliation = {
    registeredAgentIds: [],
    preservedDisabledAgentIds: [],
    preservedEnabledAgentIds: [],
  };

  if (runnableBuiltins.length === 0) {
    return result;
  }
  if (runnableBuiltins.every((state) => state.registered)) {
    for (const state of runnableBuiltins) {
      const preservedIds = state.enabled
        ? result.preservedEnabledAgentIds
        : result.preservedDisabledAgentIds;
      preservedIds.push(state.agentId);
    }
    return result;
  }

  await updateAgentRegistrations(
    (current) => {
      const next = [...current];
      const currentById = new Map(
        next.map((registration) => [registration.agentId, registration])
      );

      for (const state of runnableBuiltins) {
        const currentRegistration = currentById.get(state.agentId);
        if (currentRegistration) {
          const preservedIds = currentRegistration.enabled
            ? result.preservedEnabledAgentIds
            : result.preservedDisabledAgentIds;
          preservedIds.push(state.agentId);
          continue;
        }

        const registration = createRegistrationFromCatalogTarget(state);
        next.push(registration);
        currentById.set(state.agentId, registration);
        result.registeredAgentIds.push(state.agentId);
      }

      return next;
    },
    {
      notifyRouteCatalogChanged: input.notifyRouteCatalogChanged,
    }
  );

  return result;
}

/**
 * Setup's local agent selection is the member's choice of which detected
 * built-in agents are on for this computer (design-plans/member-agent-program.md
 * §4.1). Each detected built-in agent the member did not select and that
 * has no registration yet is registered turned off, so the Service never
 * turns it on automatically. Returns the unselected agents that are still
 * on, which the caller turns off through the Service so Core sees the
 * change at once.
 */
export async function registerUnselectedBuiltinAgentsTurnedOff(input: {
  selectedAgentIds: readonly string[];
  states?: readonly AgentTargetState[];
  // Also turn existing, enabled unselected registrations off here (before
  // the Service starts) instead of leaving them for the Service.
  turnOffExisting?: boolean;
}): Promise<{
  registeredOffAgentIds: string[];
  turnedOffExistingAgentIds: string[];
  unselectedOnAgentIds: string[];
}> {
  const selected = new Set(input.selectedAgentIds.map(normalizeAgentId));
  const unselected = (input.states ?? (await listAgentTargetStates()))
    .filter(
      (state) =>
        state.targetKind === "builtin" &&
        state.detected &&
        !selected.has(state.agentId)
    )
    .sort((left, right) =>
      compareAgentControllerRefsForDisplay(left.agentId, right.agentId)
    );
  const registeredOffAgentIds: string[] = [];
  const turnedOffExistingAgentIds: string[] = [];
  const unselectedOnAgentIds: string[] = [];
  const toRegister = unselected.filter(
    (state) => !state.registered && isRunnableBuiltinForAutomaticSetup(state)
  );
  await updateAgentRegistrations(
    (current) => {
      const next = [...current];
      const currentById = new Map(
        next.map((registration) => [registration.agentId, registration])
      );
      for (const state of unselected) {
        const registration = currentById.get(state.agentId);
        if (registration) {
          // Registered meanwhile, for example by the Service's discovery.
          if (registration.enabled && input.turnOffExisting) {
            next[next.indexOf(registration)] = {
              ...registration,
              enabled: false,
            };
            turnedOffExistingAgentIds.push(state.agentId);
          } else if (registration.enabled) {
            unselectedOnAgentIds.push(state.agentId);
          }
          continue;
        }
        if (!toRegister.includes(state)) {
          continue;
        }
        next.push({
          ...createRegistrationFromCatalogTarget(state),
          enabled: false,
        });
        registeredOffAgentIds.push(state.agentId);
      }
      return next;
    },
    { notifyRouteCatalogChanged: false }
  );
  return {
    registeredOffAgentIds,
    turnedOffExistingAgentIds,
    unselectedOnAgentIds,
  };
}

export async function reconcileNewRunnableBuiltinAgentsForSetup(
  input: { states?: readonly AgentTargetState[] } = {}
): Promise<SetupLocalAgentRegistrationReconciliation> {
  return await reconcileNewRunnableBuiltinAgentRegistrations(input);
}

export async function listAgentCustomTargets(): Promise<AgentCustomTarget[]> {
  const skillsConfig = await getConfiguredSkillsConfig().catch((error) => {
    throw wrapConfigError(error, "agents.config_read_failed");
  });
  return normalizeCustomTargets(skillsConfig?.customTargets);
}

export async function addAgentCustomTarget(input: {
  name: string;
  dir: string;
  id?: string;
}): Promise<AgentCustomTarget> {
  const name = normalizeAgentCustomTargetField(input.name);
  const dir = normalizeAgentCustomTargetField(input.dir);
  if (!(name && dir)) {
    throw new Error(
      "agents.custom.invalid_argument: --name and --dir are required for add"
    );
  }
  if (!isAbsolute(dir)) {
    throw new Error(
      "agents.custom.invalid_argument: --dir must be an absolute path"
    );
  }
  const requestedId = normalizeOptionalAgentCustomTargetId(input.id);
  const targetId = resolveRuntimeSkillsCustomTargetId({
    dir,
    ...(requestedId ? { id: requestedId } : {}),
  });

  let created: AgentCustomTarget | null = null;
  try {
    await updateConfiguredSkillsConfig((currentSkillsConfig) => {
      const normalizedTargets = normalizeCustomTargets(
        currentSkillsConfig?.customTargets
      );
      if (normalizedTargets.some((target) => target.id === targetId)) {
        throw new Error(
          `agents.custom.conflict: id already exists: ${targetId}`
        );
      }
      if (normalizedTargets.some((target) => target.dir === dir)) {
        throw new Error(`agents.custom.conflict: dir already exists: ${dir}`);
      }
      created = {
        id: targetId,
        name,
        dir,
      };
      return buildSkillsConfigWithCustomTargets({
        currentSkillsConfig,
        targets: sortCustomTargets([...normalizedTargets, created]),
      });
    });
  } catch (error) {
    throw wrapConfigError(error, "agents.config_write_failed");
  }

  if (!created) {
    throw new Error("agents.config_write_failed: custom target add failed");
  }
  await notifyDaemonRouteCatalogChanged({
    reason: "custom_target_added",
  }).catch(() => undefined);
  return created;
}

export async function updateAgentCustomTarget(input: {
  id: string;
  name?: string;
  dir?: string;
}): Promise<{
  target: AgentCustomTarget;
  updatedFields: string[];
}> {
  const targetId = normalizeAgentId(input.id);
  if (!targetId) {
    throw new Error("agents.custom.invalid_argument: --id is required");
  }
  const normalizedName = normalizeOptionalAgentCustomTargetField(input.name);
  const normalizedDir = normalizeOptionalAgentCustomTargetField(input.dir);
  if (normalizedName === undefined && normalizedDir === undefined) {
    throw new Error(
      "agents.custom.invalid_argument: provide at least one option (--name/--dir)"
    );
  }
  if (normalizedDir && !isAbsolute(normalizedDir)) {
    throw new Error(
      "agents.custom.invalid_argument: --dir must be an absolute path"
    );
  }

  let nextTarget: AgentCustomTarget | null = null;
  const updatedFields: string[] = [];
  try {
    await updateConfiguredSkillsConfig((currentSkillsConfig) => {
      const normalizedTargets = normalizeCustomTargets(
        currentSkillsConfig?.customTargets
      );
      const index = normalizedTargets.findIndex(
        (target) => target.id === targetId
      );
      if (index < 0) {
        throw new Error(
          `agents.custom.not_found: target does not exist: ${targetId}`
        );
      }
      const selectedTarget = normalizedTargets[index];
      if (!selectedTarget) {
        throw new Error(
          "agents.config_write_failed: custom target index missing"
        );
      }

      const updatedTarget: AgentCustomTarget = {
        ...selectedTarget,
      };
      if (
        normalizedName !== undefined &&
        normalizedName.length > 0 &&
        normalizedName !== selectedTarget.name
      ) {
        updatedTarget.name = normalizedName;
        updatedFields.push("name");
      }

      if (
        normalizedDir !== undefined &&
        normalizedDir.length > 0 &&
        normalizedDir !== selectedTarget.dir
      ) {
        const dirConflict = normalizedTargets.some(
          (target) => target.id !== targetId && target.dir === normalizedDir
        );
        if (dirConflict) {
          throw new Error(
            `agents.custom.conflict: dir already exists: ${normalizedDir}`
          );
        }
        updatedTarget.dir = normalizedDir;
        updatedFields.push("dir");
      }

      const nextTargets = [...normalizedTargets];
      nextTargets[index] = updatedTarget;
      nextTarget = updatedTarget;
      return buildSkillsConfigWithCustomTargets({
        currentSkillsConfig,
        targets: sortCustomTargets(nextTargets),
      });
    });
  } catch (error) {
    throw wrapConfigError(error, "agents.config_write_failed");
  }

  if (!nextTarget) {
    throw new Error("agents.config_write_failed: custom target update failed");
  }
  await notifyDaemonRouteCatalogChanged({
    reason: "custom_target_updated",
  }).catch(() => undefined);
  return {
    target: nextTarget,
    updatedFields,
  };
}

export async function removeAgentCustomTarget(input: {
  id: string;
}): Promise<AgentCustomTarget> {
  const targetId = normalizeAgentId(input.id);
  if (!targetId) {
    throw new Error("agents.custom.invalid_argument: --id is required");
  }

  let removedTarget: AgentCustomTarget | null = null;
  try {
    await updateConfiguredSkillsConfig((currentSkillsConfig) => {
      const normalizedTargets = normalizeCustomTargets(
        currentSkillsConfig?.customTargets
      );
      const index = normalizedTargets.findIndex(
        (target) => target.id === targetId
      );
      if (index < 0) {
        throw new Error(
          `agents.custom.not_found: target does not exist: ${targetId}`
        );
      }
      const target = normalizedTargets[index];
      if (!target) {
        throw new Error(
          "agents.config_write_failed: custom target index missing"
        );
      }
      removedTarget = target;
      const nextTargets = normalizedTargets.filter(
        (item) => item.id !== targetId
      );
      return buildSkillsConfigWithCustomTargets({
        currentSkillsConfig,
        targets: sortCustomTargets(nextTargets),
      });
    });
  } catch (error) {
    throw wrapConfigError(error, "agents.config_write_failed");
  }

  if (!removedTarget) {
    throw new Error("agents.config_write_failed: custom target remove failed");
  }
  await notifyDaemonRouteCatalogChanged({
    reason: "custom_target_removed",
  }).catch(() => undefined);
  return removedTarget;
}

export async function readAgentRuntimeConfigHealth(): Promise<RuntimeConfigReadHealth> {
  try {
    return await getRuntimeConfigReadHealth();
  } catch (error) {
    throw wrapConfigError(error, "agents.config_read_failed");
  }
}

export function resolveCatalogTarget(
  catalog: AgentCatalog,
  rawAgentId: string
): AgentTargetDescriptor | null {
  const agentId = normalizeAgentId(rawAgentId);
  if (!agentId) {
    return null;
  }
  const builtin = catalog.builtinsById.get(agentId);
  if (builtin) {
    return builtin;
  }
  const custom = catalog.customById.get(agentId);
  if (custom) {
    return custom;
  }
  return null;
}

export function createRegistrationFromCatalogTarget(
  target: AgentTargetState
): RuntimeAgentControllerState {
  return createAgentRegistration({
    agentId: target.agentId,
    displayName: target.displayName,
    ...(target.launchContract ? { launchContract: target.launchContract } : {}),
    ...(target.defaultStreamingMode
      ? { streamingMode: target.defaultStreamingMode }
      : {}),
    ...(target.defaultTransportMode
      ? { transportMode: target.defaultTransportMode }
      : {}),
  });
}

export async function setAgentRegistrationEnabled(input: {
  agentId: string;
  enabled: boolean;
}): Promise<SetAgentRegistrationEnabledResult> {
  const agentId = normalizeAgentId(input.agentId);
  if (!agentId) {
    throw new Error(
      "agents.invalid_agent_id: provide a non-empty local agent id"
    );
  }

  const state = await resolveAgentTargetState(agentId);
  if (state?.targetKind !== "builtin") {
    throw new Error(`agents.invalid_agent_id: unknown local agent: ${agentId}`);
  }
  if (!state.registration) {
    throw new Error(
      `agents.not_registered: agent is not registered: ${agentId}`
    );
  }
  if (input.enabled && !state.selectable) {
    throw new Error(
      `agents.invalid_agent_id: ${resolveAgentEnableBlockedReason(state)}`
    );
  }

  const agentControllerRef = buildAgentControllerRef({
    kind: "builtin",
    id: state.agentId,
  });
  let result: SetAgentRegistrationEnabledResult | null = null;
  await updateAgentRegistrations((current) => {
    const index = current.findIndex((item) => item.agentId === state.agentId);
    if (index < 0) {
      throw new Error(
        `agents.not_registered: agent is not registered: ${state.agentId}`
      );
    }
    const existing = current[index];
    if (!existing) {
      throw new Error("agents.config_write_failed: registration index missing");
    }

    if (existing.enabled === input.enabled) {
      result = {
        agentControllerRef,
        agentId: state.agentId,
        changed: false,
        displayName: existing.displayName,
        enabled: existing.enabled,
        status: "unchanged",
      };
      return current;
    }

    const next = [...current];
    next[index] = {
      ...existing,
      enabled: input.enabled,
      updatedAt: new Date().toISOString(),
    };
    result = {
      agentControllerRef,
      agentId: state.agentId,
      changed: true,
      displayName: existing.displayName,
      enabled: input.enabled,
      status: "updated",
    };
    return sortAgentRegistrations(next);
  });

  if (!result) {
    throw new Error(
      "agents.config_write_failed: enabled update result missing"
    );
  }
  return result;
}

export async function manageAgentRegistrationInstallation(input: {
  agentId: string;
  installationId?: string;
  operation: "list" | "select";
}): Promise<ManageAgentRegistrationInstallationResult> {
  const agentId = normalizeAgentId(input.agentId);
  if (!agentId) {
    throw new Error(
      "agents.invalid_agent_id: provide a non-empty local agent id"
    );
  }

  const state = await resolveAgentTargetState(agentId);
  if (state?.targetKind !== "builtin") {
    throw new Error(`agents.invalid_agent_id: unknown local agent: ${agentId}`);
  }
  if (!state.registration) {
    throw new Error(
      `agents.not_registered: ${state.displayName} is not connected on this computer`
    );
  }

  const candidatesResult = await listBuiltinControllerInstalledCandidates({
    agentId: state.agentId,
    detected: state.detected,
    displayName: state.displayName,
    persistedLaunchContract: state.registration.launchContract ?? null,
    runtimeSupported: state.runtimeSupported,
  });
  if (!candidatesResult.ok) {
    throw new Error(
      `${candidatesResult.errorCode}: ${candidatesResult.errorMessage}`
    );
  }

  const requestedInstallation =
    input.operation === "select"
      ? (candidatesResult.candidates.find(
          (candidate) => candidate.installId === input.installationId
        ) ?? null)
      : null;
  if (input.operation === "select" && !requestedInstallation) {
    throw new Error(
      `agents.installation_not_found: the selected ${state.displayName} installation is no longer available`
    );
  }

  const currentLaunchContract = state.registration.launchContract ?? null;
  const nextLaunchContract =
    requestedInstallation?.launchContract ?? currentLaunchContract;
  const changed = Boolean(
    requestedInstallation &&
      !(
        currentLaunchContract &&
        launchContractsEqual(
          currentLaunchContract,
          requestedInstallation.launchContract
        )
      )
  );

  if (changed && nextLaunchContract) {
    await updateAgentRegistrations((current) =>
      current.map((registration) =>
        registration.agentId === state.agentId
          ? {
              ...registration,
              launchContract: nextLaunchContract,
              updatedAt: new Date().toISOString(),
            }
          : registration
      )
    );
  }

  const selectedLaunchContract = nextLaunchContract;
  const installations = candidatesResult.candidates.map((candidate) => ({
    details: candidate.detail,
    installationId: candidate.installId,
    name: candidate.label,
    selected: Boolean(
      selectedLaunchContract &&
        launchContractsEqual(selectedLaunchContract, candidate.launchContract)
    ),
  }));
  const selectedInstallationId =
    installations.find((installation) => installation.selected)
      ?.installationId ?? null;
  let status: ManageAgentRegistrationInstallationResult["status"] = "listed";
  if (input.operation === "select") {
    status = changed ? "updated" : "unchanged";
  }

  return {
    agentControllerRef: buildAgentControllerRef({
      kind: "builtin",
      id: state.agentId,
    }),
    agentId: state.agentId,
    changed,
    displayName: state.displayName,
    installations,
    selectedInstallationId,
    status,
  };
}

function resolveAgentEnableBlockedReason(state: AgentTargetState): string {
  if (!state.detected) {
    return `${state.displayName} is not installed on this computer`;
  }
  if (
    !state.runtimeSupported ||
    state.selectableReason === "not_supported_yet"
  ) {
    return `${state.displayName} is not supported by the local OpenMeld Service yet`;
  }
  if (state.launchStatus === "needs_choice") {
    return (
      state.launchStatusDetail ??
      `OpenMeld needs a local install choice before ${state.displayName} can be turned on`
    );
  }
  if (state.launchStatus === "needs_repair") {
    return (
      state.launchStatusDetail ??
      `OpenMeld needs to repair how ${state.displayName} starts on this computer`
    );
  }
  if (state.selectableReason) {
    return `${state.displayName} is not selectable: ${state.selectableReason}`;
  }
  return `${state.displayName} cannot be turned on from OpenMeld Web`;
}

async function toAgentTargetState(
  target: AgentTargetDescriptor,
  registration: RuntimeAgentControllerState | null
): Promise<AgentTargetState> {
  const launchResolution =
    target.targetKind === "builtin"
      ? await resolveBuiltinControllerInstallResolution({
          agentId: target.agentId,
          detected: target.detected,
          displayName: target.displayName,
          persistedLaunchContract: registration?.launchContract ?? null,
          runtimeSupported: target.runtimeSupported,
        })
      : {
          detail: null,
          installChoices: [],
          launchContract: null,
          status: "not_available" as const,
        };
  const normalizedLaunchResolution =
    normalizeBuiltinControllerInstallResolutionForRuntime({
      displayName: target.displayName,
      launchResolution,
      registration,
      targetKind: target.targetKind,
    });
  const effectiveDetected =
    target.detected ||
    Boolean(
      registration?.launchContract &&
        normalizedLaunchResolution.status !== "not_available"
    );
  const selectability = resolveTargetSelectability({
    detected: effectiveDetected,
    launchStatus: normalizedLaunchResolution.status,
    runtimeSupported: target.runtimeSupported,
    targetKind: target.targetKind,
  });
  return {
    ...target,
    detected: effectiveDetected,
    selectable: selectability.selectable,
    selectableReason: selectability.reason,
    installChoices: normalizedLaunchResolution.installChoices,
    launchStatus: normalizedLaunchResolution.status,
    launchStatusDetail: normalizedLaunchResolution.detail,
    ...(normalizedLaunchResolution.failureReason
      ? { launchFailureReason: normalizedLaunchResolution.failureReason }
      : {}),
    launchContract: normalizedLaunchResolution.launchContract,
    registered: Boolean(registration),
    enabled: registration?.enabled ?? false,
    contextIdMappingSpec:
      registration?.contextIdMappingSpec ?? target.contextIdMappingSpec,
    registration,
  };
}

function normalizeBuiltinControllerInstallResolutionForRuntime(input: {
  displayName: string;
  launchResolution: Awaited<
    ReturnType<typeof resolveBuiltinControllerInstallResolution>
  >;
  registration: RuntimeAgentControllerState | null;
  targetKind: AgentTargetKind;
}) {
  if (
    !(
      input.targetKind === "builtin" &&
      input.registration?.enabled === true &&
      !input.registration.launchContract
    )
  ) {
    return input.launchResolution;
  }

  return {
    detail: `${input.displayName} is connected, but OpenMeld needs to repair how it starts on this computer.`,
    installChoices: [],
    launchContract: null,
    status: "needs_repair" as const,
  };
}

export async function resolveAgentContextBinding(input: {
  agentId: string;
  states?: AgentTargetState[];
  env?: Record<string, string | undefined>;
}): Promise<{
  agentControllerConversationId: string | null;
  sourceField: string;
  mappingVersion: number;
} | null> {
  const state = await resolveAgentTargetState(input.agentId, input.states);
  if (!state) {
    return null;
  }

  const sourceField = state.contextIdMappingSpec.sourceField;
  const env = input.env ?? process.env;
  const rawValue = env[sourceField];
  const agentControllerConversationId =
    typeof rawValue === "string" && rawValue.trim().length > 0
      ? rawValue.trim()
      : null;

  return {
    agentControllerConversationId,
    sourceField,
    mappingVersion: state.contextIdMappingSpec.mappingVersion,
  };
}

function wrapConfigError(error: unknown, fallbackCode: string): Error {
  if (
    error instanceof Error &&
    AGENTS_ERROR_CODE_PREFIX_RE.test(error.message)
  ) {
    return error;
  }
  const reason =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : "unexpected runtime config failure";
  return new Error(`${fallbackCode}: ${reason}`);
}

function resolveDefaultContextIdMappingSpec(
  agentId: string
): RuntimeAgentControllerConversationIdMappingSpec {
  return createDefaultRuntimeAgentControllerSettings(agentId)
    .contextIdMappingSpec;
}

function isRunnableBuiltinForAutomaticSetup(state: AgentTargetState): boolean {
  return (
    state.targetKind === "builtin" &&
    state.detected &&
    state.lifecycleStatus === "active" &&
    state.runtimeSupported &&
    state.selectable &&
    state.launchStatus === "ready"
  );
}

function resolveKnownAgentIds(
  skillsConfig: RuntimeSkillsConfig | null
): Set<string> {
  const builtinRegistry = resolveSkillsAgentRegistry(skillsConfig);
  const knownAgentIds = new Set<string>(Object.keys(builtinRegistry));
  for (const target of normalizeCustomTargets(skillsConfig?.customTargets)) {
    knownAgentIds.add(target.id);
  }
  return knownAgentIds;
}

function resolveTargetSelectability(input: {
  targetKind: AgentTargetKind;
  detected: boolean;
  launchStatus?: LocalControllerInstallStatus;
  runtimeSupported: boolean;
}): { selectable: boolean; reason: AgentTargetSelectableReason | null } {
  if (input.targetKind === "custom") {
    return {
      selectable: false,
      reason: "custom_coming_soon",
    };
  }
  if (!input.detected) {
    return {
      selectable: false,
      reason: "not_detected",
    };
  }
  if (!input.runtimeSupported) {
    return {
      selectable: false,
      reason: "not_supported_yet",
    };
  }
  return {
    selectable: true,
    reason: null,
  };
}

function normalizeCustomTargets(
  targets: RuntimeSkillsCustomTarget[] | undefined
): AgentCustomTarget[] {
  const byId = new Map<string, AgentCustomTarget>();
  for (const target of targets ?? []) {
    const name = normalizeAgentCustomTargetField(target.name);
    const dir = normalizeAgentCustomTargetField(target.dir);
    if (!(name && dir)) {
      continue;
    }
    const id = resolveRuntimeSkillsCustomTargetId({
      dir,
      ...(target.id ? { id: target.id } : {}),
    });
    byId.set(id, {
      id,
      name,
      dir,
    });
  }
  return sortCustomTargets([...byId.values()]);
}

function sortCustomTargets(targets: AgentCustomTarget[]): AgentCustomTarget[] {
  return [...targets].sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeAgentCustomTargetField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalAgentCustomTargetId(
  value: unknown
): string | undefined {
  const normalized = normalizeAgentCustomTargetField(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalAgentCustomTargetField(
  value: unknown
): string | undefined {
  const normalized = normalizeAgentCustomTargetField(value);
  return normalized.length > 0 ? normalized : undefined;
}

function buildSkillsConfigWithCustomTargets(input: {
  currentSkillsConfig: RuntimeSkillsConfig | null;
  targets: AgentCustomTarget[];
}): RuntimeSkillsConfig | null {
  const nextTargets: RuntimeSkillsCustomTarget[] = input.targets.map(
    (target) => ({
      id: target.id,
      name: target.name,
      dir: target.dir,
    })
  );
  const current = input.currentSkillsConfig;
  if (!current && nextTargets.length === 0) {
    return null;
  }

  return {
    ...(current?.storeDir ? { storeDir: current.storeDir } : {}),
    ...(current?.agents ? { agents: current.agents } : {}),
    ...(nextTargets.length > 0 ? { customTargets: nextTargets } : {}),
    ...(current?.installs ? { installs: current.installs } : {}),
  };
}
