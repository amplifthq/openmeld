import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import { resolveProjectionReconcileDecision } from "@openmeld/local-service";
import type { LocalRuntimeExpectedRoute } from "@openmeld/schemas/types";
import { resolveLocalRegistryAgentIdFromAgentControllerRef } from "../../agents/controller-identity";
import { repairBuiltinControllerInstall } from "../../agents/local-controller-install";
import {
  createAgentRegistration,
  sortAgentRegistrations,
} from "../../agents/model";
import {
  listAgentCustomTargets,
  listAgentTargetStates,
} from "../../agents/registry";
import { isRegistryRuntimeAgentControllerRefSupported } from "../../agents/registry-source";
import { getAuthSessionState } from "../../config/auth-session";
import type { OpenMeldProfile } from "../../config/openmeld-profiles-api";
import { listOpenMeldProfiles } from "../../config/openmeld-profiles-api";
import {
  createDefaultRuntimeAgentControllerSettings,
  getConfiguredDeviceRuntimeState,
  type RuntimeAgentControllerState,
  updateConfiguredDeviceRuntimeState,
} from "../../config/runtime-config";
import { resolveAgentProfilePrimaryAgentControllerReport } from "../../system/agent-profile-primary-binding";
import {
  createExpectedRoutesReadSession,
  type ExpectedRoutesReadSession,
} from "../../system/expected-routes-read-session";
import {
  createPrimaryBindingReadSession,
  type PrimaryBindingReadSession,
} from "../../system/primary-binding-read-session";
import {
  emitDriftDetectedEvidence,
  emitReconcileCompletedEvidence,
  emitReconcileFailedEvidence,
  emitReconcileSkippedEvidence,
  emitReconcileStartedEvidence,
} from "../diagnostics/service-evidence-trace";

export type DeviceRuntimeStateSyncMode = "check" | "repair";

export type DeviceRuntimeStateSyncStatus = "ok" | "degraded" | "skipped";

export type DeviceRuntimeStateSyncResult = {
  status: DeviceRuntimeStateSyncStatus;
  mode: DeviceRuntimeStateSyncMode;
  projectedControllerIds: string[];
  missingControllerIds: string[];
  disabledControllerIds: string[];
  repairRequiredControllerIds?: string[];
  repairedControllerIds: string[];
  reason: string;
};

export const NO_LOCAL_AGENTS_NEED_OPENMELD_SERVICE_REASON =
  "No local agents on this device need OpenMeld Service right now";

type ProjectionGap = {
  missingControllerIds: string[];
  disabledControllerIds: string[];
  repairRequiredControllerIds: string[];
};

export async function syncDeviceRuntimeStateProjection(input?: {
  bindingReads?: PrimaryBindingReadSession;
  expectedRoutesRead?: ExpectedRoutesReadSession;
  mode?: DeviceRuntimeStateSyncMode;
  skipWhenLocalProjectionExists?: boolean;
}): Promise<DeviceRuntimeStateSyncResult> {
  const mode = input?.mode ?? "check";
  const currentControllers = await readCurrentControllers();
  if (
    shouldSkipSyncByLocalProjection({
      skipWhenLocalProjectionExists: input?.skipWhenLocalProjectionExists,
      currentControllers,
    })
  ) {
    return emitProjectionEvidence({
      status: "skipped",
      mode,
      projectedControllerIds: [],
      missingControllerIds: [],
      disabledControllerIds: [],
      repairedControllerIds: [],
      reason: "local projection already exists",
    });
  }

  const hasValidAuth = await hasValidAuthSession();
  if (!hasValidAuth) {
    return emitProjectionEvidence({
      status: "skipped",
      mode,
      projectedControllerIds: [],
      missingControllerIds: [],
      disabledControllerIds: [],
      repairedControllerIds: [],
      reason: "authentication is not valid",
    });
  }

  const projectedControllers = await loadProjectedControllers({
    bindingReads: input?.bindingReads,
    expectedRoutesRead: input?.expectedRoutesRead,
  });
  const registeredCustomTargetIds = await loadRegisteredCustomTargetIds();
  const targetStates = await listAgentTargetStates().catch((error) => {
    throw new Error(
      `failed to load OpenMeld agent target states: ${toErrorMessage(error)}`
    );
  });
  const targetStateById = new Map(
    targetStates.map((state) => [state.agentId, state] as const)
  );
  const projectedControllerIds = [...projectedControllers.keys()].sort();
  if (projectedControllerIds.length === 0) {
    return emitProjectionEvidence({
      status: "ok",
      mode,
      projectedControllerIds,
      missingControllerIds: [],
      disabledControllerIds: [],
      repairRequiredControllerIds: [],
      repairedControllerIds: [],
      reason: NO_LOCAL_AGENTS_NEED_OPENMELD_SERVICE_REASON,
    });
  }

  const gap = resolveProjectionGap({
    currentControllers,
    projectedControllerIds,
    registeredCustomTargetIds,
    targetStateById,
  });

  if (mode === "check") {
    return emitProjectionEvidence({
      status: isGapDegraded(gap) ? "degraded" : "ok",
      mode,
      projectedControllerIds,
      missingControllerIds: gap.missingControllerIds,
      disabledControllerIds: gap.disabledControllerIds,
      repairRequiredControllerIds: gap.repairRequiredControllerIds,
      repairedControllerIds: [],
      reason: resolveCheckReason(gap),
    });
  }

  const repairedControllerIds = await repairProjection({
    projectedControllers,
    registeredCustomTargetIds,
    targetStateById,
  });
  const finalMissingControllerIds = gap.missingControllerIds.filter(
    (controllerId) => !repairedControllerIds.includes(controllerId)
  );
  const finalDisabledControllerIds = gap.disabledControllerIds.filter(
    (controllerId) => !repairedControllerIds.includes(controllerId)
  );
  const finalRepairRequiredControllerIds =
    gap.repairRequiredControllerIds.filter(
      (controllerId) => !repairedControllerIds.includes(controllerId)
    );
  const finalGap: ProjectionGap = {
    missingControllerIds: finalMissingControllerIds,
    disabledControllerIds: finalDisabledControllerIds,
    repairRequiredControllerIds: finalRepairRequiredControllerIds,
  };
  const sortedRepairedControllerIds = [...repairedControllerIds].sort();

  return emitProjectionEvidence({
    status: isGapDegraded(finalGap) ? "degraded" : "ok",
    mode,
    projectedControllerIds,
    missingControllerIds: finalMissingControllerIds,
    disabledControllerIds: finalDisabledControllerIds,
    repairRequiredControllerIds: finalRepairRequiredControllerIds,
    repairedControllerIds: sortedRepairedControllerIds,
    reason: resolveRepairReason({
      degraded: isGapDegraded(finalGap),
      finalGap,
      repairedCount: sortedRepairedControllerIds.length,
    }),
  });
}

async function readCurrentControllers(): Promise<
  RuntimeAgentControllerState[]
> {
  const localProjection = await getConfiguredDeviceRuntimeState().catch(
    () => null
  );
  return sortAgentRegistrations(localProjection?.controllers ?? []);
}

function shouldSkipSyncByLocalProjection(input: {
  skipWhenLocalProjectionExists?: boolean;
  currentControllers: RuntimeAgentControllerState[];
}): boolean {
  if (!input.skipWhenLocalProjectionExists) {
    return false;
  }
  return input.currentControllers.some(
    (controller) => controller.agentId.trim().length > 0
  );
}

async function hasValidAuthSession(): Promise<boolean> {
  const authState = await getAuthSessionState({
    validateRemote: false,
  }).catch(() => ({
    state: "missing",
    session: null,
  }));
  return authState.state === "valid";
}

async function loadProjectedControllers(input: {
  bindingReads?: PrimaryBindingReadSession;
  expectedRoutesRead?: ExpectedRoutesReadSession;
}): Promise<Map<string, { displayName: string }>> {
  // Prefer the expected-routes projection: the server already scoped it to
  // this owner + runtime, so the projected controllers fall out of one read.
  // Only an explicit legacy-endpoint response may use the per-profile path.
  // Any other read failure rejects so callers preserve the current projection.
  const expectedRoutesRead =
    input.expectedRoutesRead ?? createExpectedRoutesReadSession();
  const expectedRoutesResult = await expectedRoutesRead.read();
  if (expectedRoutesResult.status === "resolved") {
    return collectProjectedControllersFromExpectedRoutes(
      expectedRoutesResult.response.expectedRoutes
    );
  }

  const profiles = await listOpenMeldProfiles().catch((error) => {
    throw new Error(
      `failed to list OpenMeld profiles: ${toErrorMessage(error)}`
    );
  });
  return await collectProjectedControllers({
    bindingReads: input.bindingReads,
    profiles,
  });
}

function collectProjectedControllersFromExpectedRoutes(
  expectedRoutes: readonly LocalRuntimeExpectedRoute[]
): Map<string, { displayName: string }> {
  const projected = new Map<string, { displayName: string }>();
  for (const expectedRoute of expectedRoutes) {
    const parsedRef = parseAgentControllerRef(
      expectedRoute.executionTarget.agentControllerRef
    );
    const controllerId = parsedRef
      ? resolveLocalRegistryAgentIdFromAgentControllerRef({
          agentControllerRef: parsedRef.ref,
        })
      : null;
    if (!controllerId) {
      continue;
    }
    if (!isRegistryRuntimeAgentControllerRefSupported(controllerId)) {
      continue;
    }
    if (projected.has(controllerId)) {
      continue;
    }
    projected.set(controllerId, {
      displayName: toControllerDisplayName(controllerId),
    });
  }
  return projected;
}

async function loadRegisteredCustomTargetIds(): Promise<Set<string>> {
  const customTargets = await listAgentCustomTargets().catch((error) => {
    throw new Error(
      `failed to list OpenMeld custom targets: ${toErrorMessage(error)}`
    );
  });
  return new Set(customTargets.map((target) => target.id));
}

function resolveProjectionGap(input: {
  currentControllers: RuntimeAgentControllerState[];
  projectedControllerIds: string[];
  registeredCustomTargetIds: Set<string>;
  targetStateById: Map<
    string,
    Awaited<ReturnType<typeof listAgentTargetStates>>[number]
  >;
}): ProjectionGap {
  const projectedControllerIdSet = new Set(input.projectedControllerIds);
  const currentByAgentId = new Map<string, RuntimeAgentControllerState>();
  for (const controller of input.currentControllers) {
    const canonicalProjectedAgentId =
      resolveProjectedControllerAliasTarget({
        agentId: controller.agentId,
        projectedControllerIdSet,
        registeredCustomTargetIds: input.registeredCustomTargetIds,
      }) ?? controller.agentId;
    if (currentByAgentId.has(canonicalProjectedAgentId)) {
      continue;
    }
    currentByAgentId.set(canonicalProjectedAgentId, controller);
  }
  const missingControllerIds: string[] = [];
  const disabledControllerIds: string[] = [];
  const repairRequiredControllerIds: string[] = [];

  for (const controllerId of input.projectedControllerIds) {
    const current = currentByAgentId.get(controllerId);
    if (!current) {
      missingControllerIds.push(controllerId);
      continue;
    }
    if (current.enabled !== true) {
      disabledControllerIds.push(controllerId);
      continue;
    }
    if (
      input.targetStateById.get(controllerId)?.targetKind === "builtin" &&
      input.targetStateById.get(controllerId)?.launchStatus === "needs_repair"
    ) {
      repairRequiredControllerIds.push(controllerId);
    }
  }

  return {
    missingControllerIds,
    disabledControllerIds,
    repairRequiredControllerIds,
  };
}

function isGapDegraded(gap: ProjectionGap): boolean {
  return (
    gap.missingControllerIds.length > 0 ||
    gap.disabledControllerIds.length > 0 ||
    gap.repairRequiredControllerIds.length > 0
  );
}

function resolveCheckReason(gap: ProjectionGap): string {
  if (gap.repairRequiredControllerIds.length > 0) {
    return "one or more projected controllers need launch repair on this device";
  }
  if (
    gap.missingControllerIds.length > 0 &&
    gap.disabledControllerIds.length > 0
  ) {
    return "local projection is missing or disabled for one or more bound controllers";
  }
  if (gap.missingControllerIds.length > 0) {
    return "local projection is missing for one or more bound controllers";
  }
  if (gap.disabledControllerIds.length > 0) {
    return "one or more projected controllers are disabled locally";
  }
  return "local projection is healthy";
}

async function repairProjection(input: {
  projectedControllers: Map<string, { displayName: string }>;
  registeredCustomTargetIds: Set<string>;
  targetStateById: Map<
    string,
    Awaited<ReturnType<typeof listAgentTargetStates>>[number]
  >;
}): Promise<string[]> {
  const repairedControllerIds = new Set<string>();
  const projectedLaunchContracts = await resolveProjectedLaunchContracts({
    projectedControllers: input.projectedControllers,
    targetStateById: input.targetStateById,
  });
  await updateConfiguredDeviceRuntimeState((currentState) => {
    const nowIso = new Date().toISOString();
    const nextControllers = collectRepairedControllers({
      currentControllers: sortAgentRegistrations(
        currentState?.controllers ?? []
      ),
      nowIso,
      projectedControllers: input.projectedControllers,
      projectedLaunchContracts,
      repairedControllerIds,
      registeredCustomTargetIds: input.registeredCustomTargetIds,
    });
    addMissingProjectedControllers({
      nextControllers,
      nowIso,
      projectedLaunchContracts,
      projectedControllers: input.projectedControllers,
      repairedControllerIds,
    });

    return {
      controllers: sortAgentRegistrations([...nextControllers.values()]),
    };
  });
  return [...repairedControllerIds];
}

function collectRepairedControllers(input: {
  currentControllers: RuntimeAgentControllerState[];
  nowIso: string;
  projectedControllers: Map<string, { displayName: string }>;
  projectedLaunchContracts: Map<
    string,
    NonNullable<RuntimeAgentControllerState["launchContract"]>
  >;
  repairedControllerIds: Set<string>;
  registeredCustomTargetIds: Set<string>;
}): Map<string, RuntimeAgentControllerState> {
  const projectedControllerIdSet = new Set(input.projectedControllers.keys());
  const nextControllers = new Map<string, RuntimeAgentControllerState>();

  for (const existing of input.currentControllers) {
    const canonicalProjectedAgentId =
      resolveProjectedControllerAliasTarget({
        agentId: existing.agentId,
        projectedControllerIdSet,
        registeredCustomTargetIds: input.registeredCustomTargetIds,
      }) ?? existing.agentId;
    const projected =
      input.projectedControllers.get(canonicalProjectedAgentId) ?? null;
    if (!projected) {
      nextControllers.set(existing.agentId, existing);
      continue;
    }
    if (nextControllers.has(canonicalProjectedAgentId)) {
      input.repairedControllerIds.add(canonicalProjectedAgentId);
      continue;
    }
    const normalized = normalizeProjectedController({
      canonicalProjectedAgentId,
      existing,
      nowIso: input.nowIso,
      projectedDisplayName: projected.displayName,
    });
    const withLaunchContract =
      existing.enabled === true
        ? applyProjectedLaunchContract({
            controller: normalized.controller,
            launchContract:
              input.projectedLaunchContracts.get(canonicalProjectedAgentId) ??
              null,
            updatedAt: input.nowIso,
          })
        : {
            controller: normalized.controller,
            updated: false,
          };
    if (
      normalized.updated ||
      withLaunchContract.updated ||
      canonicalProjectedAgentId !== existing.agentId
    ) {
      input.repairedControllerIds.add(canonicalProjectedAgentId);
    }
    nextControllers.set(
      canonicalProjectedAgentId,
      withLaunchContract.controller
    );
  }

  return nextControllers;
}

function addMissingProjectedControllers(input: {
  nextControllers: Map<string, RuntimeAgentControllerState>;
  nowIso: string;
  projectedLaunchContracts: Map<
    string,
    NonNullable<RuntimeAgentControllerState["launchContract"]>
  >;
  projectedControllers: Map<string, { displayName: string }>;
  repairedControllerIds: Set<string>;
}): void {
  for (const [
    controllerId,
    projected,
  ] of input.projectedControllers.entries()) {
    if (input.nextControllers.has(controllerId)) {
      continue;
    }
    const launchContract = input.projectedLaunchContracts.get(controllerId);
    if (!launchContract) {
      continue;
    }
    const created = createAgentRegistration({
      agentId: controllerId,
      displayName: projected.displayName,
      launchContract,
      timestamp: input.nowIso,
    });
    input.repairedControllerIds.add(controllerId);
    input.nextControllers.set(controllerId, created);
  }
}

async function resolveProjectedLaunchContracts(input: {
  projectedControllers: Map<string, { displayName: string }>;
  targetStateById: Map<
    string,
    Awaited<ReturnType<typeof listAgentTargetStates>>[number]
  >;
}): Promise<
  Map<string, NonNullable<RuntimeAgentControllerState["launchContract"]>>
> {
  const launchContracts = new Map<
    string,
    NonNullable<RuntimeAgentControllerState["launchContract"]>
  >();
  for (const [
    controllerId,
    projected,
  ] of input.projectedControllers.entries()) {
    const targetState = input.targetStateById.get(controllerId) ?? null;
    if (targetState?.targetKind !== "builtin" || !targetState.detected) {
      continue;
    }
    const repairResult = await repairBuiltinControllerInstall({
      agentId: targetState.agentId,
      detected: targetState.detected,
      displayName: projected.displayName,
      runtimeSupported: targetState.runtimeSupported,
    });
    if (!repairResult.ok) {
      continue;
    }
    launchContracts.set(controllerId, repairResult.launchContract);
  }
  return launchContracts;
}

function normalizeProjectedController(input: {
  canonicalProjectedAgentId: string;
  existing: RuntimeAgentControllerState;
  nowIso: string;
  projectedDisplayName: string;
}): {
  controller: RuntimeAgentControllerState;
  updated: boolean;
} {
  return normalizeControllerForProjection({
    current:
      input.canonicalProjectedAgentId === input.existing.agentId
        ? input.existing
        : {
            ...input.existing,
            agentId: input.canonicalProjectedAgentId,
          },
    projectedDisplayName: input.projectedDisplayName,
    updatedAt: input.nowIso,
  });
}

function resolveProjectedControllerAliasTarget(input: {
  agentId: string;
  projectedControllerIdSet: Set<string>;
  registeredCustomTargetIds: Set<string>;
}): string | null {
  const canonicalProjectedAgentId =
    resolveLocalRegistryAgentIdFromAgentControllerRef({
      agentControllerRef: input.agentId,
    });
  if (
    !canonicalProjectedAgentId ||
    canonicalProjectedAgentId === input.agentId ||
    input.registeredCustomTargetIds.has(input.agentId) ||
    !input.projectedControllerIdSet.has(canonicalProjectedAgentId)
  ) {
    return null;
  }
  return canonicalProjectedAgentId;
}

function resolveRepairReason(input: {
  degraded: boolean;
  finalGap: ProjectionGap;
  repairedCount: number;
}): string {
  if (input.degraded) {
    if (input.finalGap.repairRequiredControllerIds.length > 0) {
      return "projection exists but one or more controllers still need launch repair";
    }
    if (
      input.finalGap.missingControllerIds.length === 0 &&
      input.finalGap.disabledControllerIds.length > 0
    ) {
      return "projection exists but one or more controllers are disabled locally";
    }
    return "local projection repair is incomplete";
  }
  if (input.repairedCount > 0) {
    return "local projection repaired";
  }
  return "local projection already healthy";
}

function applyProjectedLaunchContract(input: {
  controller: RuntimeAgentControllerState;
  launchContract: RuntimeAgentControllerState["launchContract"] | null;
  updatedAt: string;
}): {
  controller: RuntimeAgentControllerState;
  updated: boolean;
} {
  if (!(input.launchContract || input.controller.launchContract)) {
    return {
      controller: input.controller,
      updated: false,
    };
  }
  if (
    sameLaunchContract(input.controller.launchContract, input.launchContract)
  ) {
    return {
      controller: input.controller,
      updated: false,
    };
  }
  return {
    controller: {
      ...input.controller,
      ...(input.launchContract ? { launchContract: input.launchContract } : {}),
      updatedAt: input.updatedAt,
    },
    updated: true,
  };
}

async function collectProjectedControllers(input: {
  bindingReads?: PrimaryBindingReadSession;
  profiles: OpenMeldProfile[];
}): Promise<Map<string, { displayName: string }>> {
  const bindingReads = input.bindingReads ?? createPrimaryBindingReadSession();
  const eligibleProfiles = input.profiles.filter(
    (profile) => profile.profileKind === "agent" && profile.status === "active"
  );
  // Reads run concurrently (HTTP concurrency is bounded by the read session);
  // the fold below keeps the original profile-order dedupe semantics.
  const executionTargets = await Promise.all(
    eligibleProfiles.map((profile) =>
      resolveAgentProfilePrimaryAgentControllerReport({
        bindingReads,
        profile,
      }).catch(() => null)
    )
  );

  const projected = new Map<string, { displayName: string }>();
  for (const executionTarget of executionTargets) {
    const controllerId = executionTarget?.localAgentId;
    if (
      !(
        controllerId &&
        executionTarget.bindingState === "enabled_primary" &&
        executionTarget.routable
      )
    ) {
      continue;
    }
    if (!isRegistryRuntimeAgentControllerRefSupported(controllerId)) {
      continue;
    }
    if (projected.has(controllerId)) {
      continue;
    }
    projected.set(controllerId, {
      displayName: toControllerDisplayName(controllerId),
    });
  }
  return projected;
}

function normalizeControllerForProjection(input: {
  current: RuntimeAgentControllerState;
  projectedDisplayName: string;
  updatedAt: string;
}): {
  controller: RuntimeAgentControllerState;
  updated: boolean;
} {
  const defaults = createDefaultRuntimeAgentControllerSettings(
    input.current.agentId
  );
  const resolvedDisplayName = normalizeText(input.current.displayName)
    ? input.current.displayName
    : input.projectedDisplayName;
  const resolvedController: RuntimeAgentControllerState = {
    ...input.current,
    displayName: resolvedDisplayName,
    enabled: input.current.enabled,
    transportMode: input.current.transportMode ?? defaults.transportMode,
    streamingMode: input.current.streamingMode ?? defaults.streamingMode,
    timeoutMs: input.current.timeoutMs ?? defaults.timeoutMs,
    retry: input.current.retry ?? defaults.retry,
    contextIdMappingSpec:
      input.current.contextIdMappingSpec ?? defaults.contextIdMappingSpec,
  };
  const unchanged =
    resolvedController.displayName === input.current.displayName &&
    resolvedController.enabled === input.current.enabled &&
    resolvedController.transportMode === input.current.transportMode &&
    resolvedController.streamingMode === input.current.streamingMode &&
    resolvedController.timeoutMs === input.current.timeoutMs &&
    resolvedController.retry === input.current.retry &&
    sameContextIdMappingSpec(
      resolvedController.contextIdMappingSpec,
      input.current.contextIdMappingSpec
    );
  if (unchanged) {
    return {
      controller: input.current,
      updated: false,
    };
  }
  return {
    controller: {
      ...resolvedController,
      updatedAt: input.updatedAt,
    },
    updated: true,
  };
}

function sameContextIdMappingSpec(
  left: RuntimeAgentControllerState["contextIdMappingSpec"] | null | undefined,
  right: RuntimeAgentControllerState["contextIdMappingSpec"] | null | undefined
): boolean {
  if (!(left || right)) {
    return true;
  }
  if (!(left && right)) {
    return false;
  }
  return (
    left.sourceField === right.sourceField &&
    left.mappingVersion === right.mappingVersion
  );
}

function sameLaunchContract(
  left: RuntimeAgentControllerState["launchContract"] | null | undefined,
  right: RuntimeAgentControllerState["launchContract"] | null | undefined
): boolean {
  if (!(left || right)) {
    return true;
  }
  if (!(left && right)) {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function toControllerDisplayName(controllerId: string): string {
  const normalized = normalizeText(controllerId);
  if (!normalized) {
    return "Agent";
  }
  return normalized
    .split(/[-_.\s]+/g)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function emitProjectionEvidence(
  result: DeviceRuntimeStateSyncResult
): DeviceRuntimeStateSyncResult {
  const decision = resolveProjectionReconcileDecision({
    result,
  });
  const payload = {
    action: decision.action,
    disabledControllerIds: result.disabledControllerIds,
    driftClass: decision.driftClass,
    foregroundActive: decision.foregroundActive,
    lifecycleLocked: decision.lifecycleLocked,
    missingControllerIds: result.missingControllerIds,
    mode: result.mode,
    owner: decision.owner,
    projectedControllerIds: result.projectedControllerIds,
    repairRequiredControllerIds: result.repairRequiredControllerIds,
    reason: result.reason,
    repairedControllerIds: result.repairedControllerIds,
    skipReason: decision.skipReason,
    status: result.status,
  };

  if (decision.driftDetected) {
    emitDriftDetectedEvidence(payload);
  }

  if (decision.skipReason) {
    emitReconcileSkippedEvidence(payload);
    return result;
  }

  if (result.mode === "repair") {
    emitReconcileStartedEvidence(payload);
    if (result.status === "degraded") {
      emitReconcileFailedEvidence(payload);
      return result;
    }
    emitReconcileCompletedEvidence(payload);
    return result;
  }

  return result;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
