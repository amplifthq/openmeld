import {
  AGENT_PROFILE_WORK_MAX_WAITING,
  AGENT_PROFILE_WORK_READABLE_RESERVATION_LIMIT,
  supportsExecutionContextSelection,
} from "@openmeld/agent-runtime";
import {
  buildRuntimeCoordinatorExecutionId,
  projectTargetWakeLifecycleIdentity,
  RISK_WINDOW_EXECUTION_LIMIT,
  type RiskWindowExecutionsResponse,
  runtimeCoordinatorExecutionTokenAuthorityRecordSchema,
} from "@openmeld/schemas";
import type {
  RuntimeCoordinatorExecutionTokenAuthorityRecord,
  RuntimeTransportAgentProfileExecutionStateResponse,
  RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse,
  RuntimeTransportAgentProfileExecutionTargetMutationReleaseResponse,
  RuntimeTransportAgentProfileOperationalContextsResponse,
  RuntimeTransportAgentProfileWorkContinuationAuthorizeResponse,
  RuntimeTransportAgentProfileWorkRecoveryReadResponse,
} from "@openmeld/schemas/types";
import { EXECUTION_TARGET_MUTATION_LEASE_MS } from "../../strategy-constants";
import {
  type AgentProfileContextMigration,
  isAgentProfileContextMigration,
  type LegacyContextAssociation,
} from "./agent-profile-context-migration";
import {
  type AgentProfileWorkCoordinator,
  type AgentProfileWorkCoordinatorItem,
  type AgentProfileWorkHandoffStatus,
  type AgentProfileWorkRecoveryGate,
  type AgentProfileWorkSettleOutcome,
  acceptAgentProfileWork,
  approveAgentProfileWorkQueue,
  authorizeAgentProfileWorkContinuation,
  createAgentProfileWorkCoordinator,
  dropRetiredAgentProfileWork,
  handOffOccupiedAgentProfileWork,
  isAgentProfileWorkRecoveryGateProfileWide,
  markAgentProfileWorkContinuationNeedsAttention,
  markAgentProfileWorkControllerConversationOccupancy,
  markAgentProfileWorkUsageAvailable,
  refillAgentProfileWork,
  removeAgentProfileWork,
  reservedAgentProfileWork,
  settleAgentProfileWork,
  skipAgentProfileInterruptedWork,
  summarizeAgentProfileWorkCoordinator,
} from "./agent-profile-work-coordinator";
import {
  buildPendingAgentProfileWorkPromotion,
  buildPendingAgentProfileWorkPromotionStorageKey,
  locatePendingAgentProfileWorkPromotion,
  type PendingAgentProfileWorkPromotion,
  parsePendingAgentProfileWorkPromotion,
} from "./agent-profile-work-promotion";
import type { AgentProfileWorkRecoveryInboxStage } from "./agent-profile-work-recovery-inbox-producer";
import {
  type AgentProfileWorkRecoveryInboxProjectionIntent,
  buildAgentProfileWorkRecoveryInboxProjectionIntent,
  deleteAgentProfileWorkRecoveryInboxProjectionIntent,
  parseAgentProfileWorkRecoveryInboxProjectionIntent,
  resolveAgentProfileWorkRecoveryInboxProjectionStorageKey,
  sameAgentProfileWorkRecoveryInboxProjectionIntent,
  writeAgentProfileWorkRecoveryInboxProjectionIntent,
} from "./agent-profile-work-recovery-inbox-projection";
import {
  attachLegacyAssociationToExecutionContext,
  claimLegacyExecutionContext,
  ExecutionContextSelectionError,
  hasRetainedExecutionContexts,
  prepareExecutionContextAssignment,
  retireRecoveredContextSourceAssociation,
} from "./execution-context-authority";
import {
  buildRuntimeCoordinatorAcceptedDispatchPayloadFingerprintStorageKey,
  buildRuntimeCoordinatorHeadLifecycleStorageKey,
  buildRuntimeCoordinatorRunCommandStateStorageKey,
  buildRuntimeCoordinatorTokenAuthorityStorageKey,
  hasRuntimeCoordinatorDurableLocalProgress,
  isRuntimeCoordinatorAcceptedDispatchPayloadFingerprintRecord,
  isRuntimeCoordinatorHeadLifecycleRecord,
  isRuntimeCoordinatorLocalAttemptWithdrawn,
  isRuntimeCoordinatorRunCommandState,
  RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_FINGERPRINT_MODEL_VERSION,
  RUNTIME_COORDINATOR_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE,
  RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY,
  RUNTIME_COORDINATOR_HEAD_LIFECYCLE_STORAGE_KEY_PREFIX,
  RUNTIME_COORDINATOR_MAX_HEAD_DUPLICATE_OBSERVATIONS,
  RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY,
  RUNTIME_COORDINATOR_RUN_COMMAND_STATE_STORAGE_KEY_PREFIX,
  type RuntimeCoordinatorAcceptedDispatchPayloadFingerprintRecord,
  type RuntimeCoordinatorHeadLifecycleRecord,
  type RuntimeCoordinatorRunCommandState,
} from "./runtime-coordinator-authority";
import {
  syncRuntimeCoordinatorWatchdogSchedule,
  writeRuntimeCoordinatorWatchdogSchedule,
} from "./runtime-coordinator-watchdog-storage";

const EXECUTION_ADMISSION_MODEL_VERSION =
  "openmeld.runtime_coordinator.agent_profile_work_coordinator.v3" as const;
const PREVIOUS_EXECUTION_ADMISSION_MODEL_VERSION =
  "openmeld.runtime_coordinator.agent_profile_work_coordinator.v2";
const ORIGINAL_WORK_COORDINATOR_MODEL_VERSION =
  "openmeld.runtime_coordinator.agent_profile_work_coordinator.v1";
const LEGACY_EXECUTION_ADMISSION_MODEL_VERSION =
  "openmeld.runtime_coordinator.agent_profile_execution_admission.v1" as const;
const EXECUTION_INDEX_MODEL_VERSION =
  "openmeld.runtime_coordinator.agent_profile_execution_index.v1" as const;
const EXECUTION_ACTIVE_PROFILE_INDEX_MODEL_VERSION =
  "openmeld.runtime_coordinator.agent_profile_active_index.v1" as const;
const EXECUTION_ADMISSION_STORAGE_KEY_PREFIX =
  "runtime-coordinator:agent-profile-execution-admission:v1:";
const EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY =
  "runtime-coordinator:agent-profile-active-index:v1";
const EXECUTION_INDEX_STORAGE_KEY =
  "runtime-coordinator:agent-profile-execution-index:v1";
const EXECUTION_INDEX_REPAIR_PAGE_SIZE = 128;
const EXECUTION_INDEX_INLINE_REPAIR_STEPS = 3;
const EXECUTION_INDEX_REPAIR_RETRY_BASE_MS = 5000;
const EXECUTION_INDEX_REPAIR_RETRY_MAX_MS = 5 * 60_000;
const DURABLE_OBJECT_STORAGE_GET_MAX_KEYS = 128;
const DURABLE_OBJECT_STORAGE_GET_MAX_CONCURRENCY = 4;
const MAX_EXECUTION_ADMISSION_REFERENCES_PER_KIND = 128;
const EXECUTION_STATE_UNAVAILABLE_REASON =
  "runtime_coordinator.execution_state_unavailable";
const EXECUTION_INDEX_REBUILDING_REASON =
  "runtime_coordinator.execution_state_rebuilding";
const EXECUTION_INDEX_REPAIR_FAILED_REASON =
  "runtime_coordinator.execution_state_repair_failed";
const EXECUTION_TARGET_MUTATION_IN_PROGRESS_REASON =
  "runtime_coordinator.execution_target_mutation_in_progress";
export const RUNTIME_COORDINATOR_WAKE_STOP_REASON_CODE_PREFIX =
  "runtime_coordinator.wake_stop_";

type ExecutionAdmissionStorage = Pick<
  DurableObjectStorage,
  "delete" | "get" | "list" | "put" | "transaction"
>;

type ExecutionTargetMutationLease = {
  expiresAtMs: number;
  operationId: string;
  startedAtMs: number;
};

type AgentProfileExecutionAdmissionRecord = {
  contextMigration?: AgentProfileContextMigration;
  admissionMode?: "parallel" | "serial";
  activeExecutionIds: string[];
  activeHeadLifecycleIds: string[];
  executionTargetMutation: ExecutionTargetMutationLease | null;
  generation: number;
  modelVersion: typeof EXECUTION_ADMISSION_MODEL_VERSION;
  referencesOverflowed: boolean;
  recoveryGate: AgentProfileWorkRecoveryGate | null;
  revision: number;
  targetProfileId: string;
  updatedAtMs: number;
  workItems: AgentProfileWorkCoordinatorItem[];
};

type AgentProfileActiveIndexRecord = {
  generation: number;
  modelVersion: typeof EXECUTION_ACTIVE_PROFILE_INDEX_MODEL_VERSION;
  targetProfileIds: string[];
};

type AgentProfileExecutionIndexRepairPhase =
  | "head_lifecycles"
  | "run_command_states"
  | "admissions";

type AgentProfileExecutionIndexState =
  | {
      generation: number;
      modelVersion: typeof EXECUTION_INDEX_MODEL_VERSION;
      ownerUserId: string;
      status: "ready";
      updatedAtMs: number;
    }
  | {
      cursor: string | null;
      failureCount: number;
      generation: number;
      modelVersion: typeof EXECUTION_INDEX_MODEL_VERSION;
      ownerUserId: string;
      phase: AgentProfileExecutionIndexRepairPhase;
      repairRequested: boolean;
      status: "rebuilding";
      updatedAtMs: number;
    }
  | {
      cursor: string | null;
      failureCount: number;
      generation: number;
      modelVersion: typeof EXECUTION_INDEX_MODEL_VERSION;
      ownerUserId: string;
      phase: AgentProfileExecutionIndexRepairPhase;
      reasonCode: string;
      repairRequested: boolean;
      retryAtMs: number;
      status: "failed";
      updatedAtMs: number;
    };

type ActiveObservationsByProfile = Map<
  string,
  { executionIds: Set<string>; headLifecycleIds: Set<string> }
>;

export async function readOrUpdateAgentProfileExecutionMode(input: {
  ownerUserId: string;
  targetProfileId: string;
  mode?: "parallel" | "serial";
  nowMs: number;
  storage: ExecutionAdmissionStorage;
}): Promise<
  import("@openmeld/schemas/types").AgentProfileExecutionModeResponse
> {
  const index = await ensureExecutionIndexReady(input);
  if (index.status !== "ready") {
    throw new Error(EXECUTION_INDEX_REBUILDING_REASON);
  }
  return await input.storage.transaction(async (transaction) => {
    const currentIndex = parseExecutionIndexState(
      await transaction.get(EXECUTION_INDEX_STORAGE_KEY)
    );
    if (
      currentIndex?.status !== "ready" ||
      currentIndex.ownerUserId !== input.ownerUserId ||
      currentIndex.generation !== index.generation
    ) {
      throw new Error(EXECUTION_INDEX_REBUILDING_REASON);
    }
    const key = buildExecutionAdmissionStorageKey(input.targetProfileId);
    const raw = await transaction.get<unknown>(key);
    const parsed = parseExecutionAdmissionRecord(raw);
    if (raw !== undefined && !parsed) {
      throw new Error(EXECUTION_STATE_UNAVAILABLE_REASON);
    }
    let admission = carryExecutionAdmissionIntoGeneration({
      admission: parsed,
      generation: index.generation,
      nowMs: input.nowMs,
      targetProfileId: input.targetProfileId,
    });
    // Carrying within a ready generation must retain live reference ownership.
    if (parsed?.generation === index.generation) {
      admission = parsed;
    }
    if (input.mode && input.mode !== (admission.admissionMode ?? "parallel")) {
      const before = projectAgentProfileWorkCoordinator(admission);
      admission = {
        ...admission,
        admissionMode: input.mode,
        revision: admission.revision + 1,
        updatedAtMs: input.nowMs,
      };
      const refill = refillAgentProfileWork({
        coordinator: projectAgentProfileWorkCoordinator(admission),
        previouslyReserved: reservedAgentProfileWork(before),
      });
      admission = { ...admission, workItems: refill.coordinator.workItems };
      for (const item of refill.promotedItems) {
        admission = (
          await promoteAgentProfileWorkItem({
            admission,
            item,
            nowMs: input.nowMs,
            transaction,
          })
        ).admission;
      }
      await transaction.put(key, admission);
    }
    return {
      agentProfileId: input.targetProfileId,
      mode: admission.admissionMode ?? "parallel",
      migration: admission.contextMigration?.status ?? "legacy",
      revision: admission.revision,
    };
  });
}

export async function listDrainingAgentProfileContextMigrations(
  storage: Pick<DurableObjectStorage, "get">
): Promise<Array<{ ownerUserId: string; targetProfileId: string }>> {
  const index = parseExecutionIndexState(
    await storage.get(EXECUTION_INDEX_STORAGE_KEY)
  );
  if (index?.status !== "ready") {
    return [];
  }
  const active = parseActiveProfileIndexRecord(
    await storage.get(EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY),
    index.generation
  );
  const result: Array<{ ownerUserId: string; targetProfileId: string }> = [];
  for (const targetProfileId of active?.targetProfileIds ?? []) {
    const admission = parseExecutionAdmissionRecord(
      await storage.get(buildExecutionAdmissionStorageKey(targetProfileId))
    );
    if (admission?.contextMigration?.status === "draining") {
      result.push({ ownerUserId: index.ownerUserId, targetProfileId });
    }
  }
  return result;
}

export async function resolveNextAgentProfileContextMigrationAlarmAtMs(input: {
  storage: ExecutionAdmissionStorage;
  nowMs: number;
}): Promise<number | null> {
  let next: number | null = null;
  for (const profile of await listDrainingAgentProfileContextMigrations(
    input.storage
  )) {
    const admission = parseExecutionAdmissionRecord(
      await input.storage.get(
        buildExecutionAdmissionStorageKey(profile.targetProfileId)
      )
    );
    if (
      !admission ||
      (await hasUnresolvedLegacyWork(admission, input.storage))
    ) {
      continue;
    }
    const leaseExpiry = admission.executionTargetMutation?.expiresAtMs ?? 0;
    const failure = parseContextMigrationFailure(
      await input.storage.get(
        buildContextMigrationFailureStorageKey(profile.targetProfileId)
      )
    );
    const retryAt = Math.max(
      leaseExpiry > input.nowMs
        ? leaseExpiry
        : input.nowMs + CONTEXT_MIGRATION_RETRY_BASE_MS,
      failure?.nextAttemptAtMs ?? 0
    );
    next = next === null ? retryAt : Math.min(next, retryAt);
  }
  return next;
}

const CONTEXT_MIGRATION_FAILURE_STORAGE_PREFIX =
  "runtime-coordinator:agent-profile-context-migration-failure:v1:";
const CONTEXT_MIGRATION_RETRY_BASE_MS = 5000;
const CONTEXT_MIGRATION_RETRY_MAX_MS = 10 * 60_000;
const CONTEXT_MIGRATION_FAILURE_REASON_MAX_LENGTH = 160;

type AgentProfileContextMigrationFailure = {
  attempts: number;
  nextAttemptAtMs: number;
  reasonCode: string;
};

function buildContextMigrationFailureStorageKey(
  targetProfileId: string
): string {
  return `${CONTEXT_MIGRATION_FAILURE_STORAGE_PREFIX}${encodeURIComponent(targetProfileId)}`;
}

function parseContextMigrationFailure(
  value: unknown
): AgentProfileContextMigrationFailure | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<AgentProfileContextMigrationFailure>;
  return isPositiveInteger(record.attempts) &&
    isNonnegativeInteger(record.nextAttemptAtMs) &&
    typeof record.reasonCode === "string"
    ? {
        attempts: record.attempts,
        nextAttemptAtMs: record.nextAttemptAtMs,
        reasonCode: record.reasonCode,
      }
    : null;
}

/** Records a failed activation attempt for one Profile and backs off its retry. */
export async function recordAgentProfileContextMigrationFailure(input: {
  nowMs: number;
  reasonCode: string;
  storage: Pick<DurableObjectStorage, "get" | "put">;
  targetProfileId: string;
}): Promise<AgentProfileContextMigrationFailure> {
  const key = buildContextMigrationFailureStorageKey(input.targetProfileId);
  const attempts =
    (parseContextMigrationFailure(await input.storage.get(key))?.attempts ??
      0) + 1;
  const failure = {
    attempts,
    nextAttemptAtMs:
      input.nowMs +
      Math.min(
        CONTEXT_MIGRATION_RETRY_BASE_MS * 2 ** (attempts - 1),
        CONTEXT_MIGRATION_RETRY_MAX_MS
      ),
    reasonCode: input.reasonCode.slice(
      0,
      CONTEXT_MIGRATION_FAILURE_REASON_MAX_LENGTH
    ),
  };
  await input.storage.put(key, failure);
  return failure;
}

export async function isAgentProfileContextMigrationRetryDue(input: {
  nowMs: number;
  storage: Pick<DurableObjectStorage, "get">;
  targetProfileId: string;
}): Promise<boolean> {
  const failure = parseContextMigrationFailure(
    await input.storage.get(
      buildContextMigrationFailureStorageKey(input.targetProfileId)
    )
  );
  return !failure || failure.nextAttemptAtMs <= input.nowMs;
}

async function hasUnresolvedLegacyWork(
  admission: AgentProfileExecutionAdmissionRecord,
  storage: Pick<DurableObjectTransaction, "get">
): Promise<boolean> {
  if (
    admission.workItems.some((item) => !item.executionContextId) ||
    admission.recoveryGate
  ) {
    return true;
  }
  for (const id of admission.activeHeadLifecycleIds) {
    const head = await storage.get(
      buildRuntimeCoordinatorHeadLifecycleStorageKey(id)
    );
    if (!isRuntimeCoordinatorHeadLifecycleRecord(head)) {
      throw new Error(EXECUTION_STATE_UNAVAILABLE_REASON);
    }
    if (
      !(
        head.acceptedDispatchSnapshot?.executionContext ||
        isTerminalHeadLifecycleStatus(head.status)
      )
    ) {
      return true;
    }
  }
  for (const id of admission.activeExecutionIds) {
    const state = await storage.get(
      buildRuntimeCoordinatorRunCommandStateStorageKey(id)
    );
    if (!isRuntimeCoordinatorRunCommandState(state)) {
      throw new Error(EXECUTION_STATE_UNAVAILABLE_REASON);
    }
    if (!state.sanitizedDeliveryRequest.payload.executionContext) {
      return true;
    }
  }
  return false;
}

async function freezeLegacyWakeIds(
  admission: AgentProfileExecutionAdmissionRecord,
  storage: Pick<DurableObjectTransaction, "get">
): Promise<string[]> {
  const ids = new Set(
    admission.workItems
      .filter((item) => !item.executionContextId)
      .map((item) => item.targetWakeLifecycleId)
  );
  for (const id of admission.activeHeadLifecycleIds) {
    const head = await storage.get(
      buildRuntimeCoordinatorHeadLifecycleStorageKey(id)
    );
    if (!isRuntimeCoordinatorHeadLifecycleRecord(head)) {
      throw new Error(EXECUTION_STATE_UNAVAILABLE_REASON);
    }
    if (!head.acceptedDispatchSnapshot?.executionContext) {
      ids.add(id);
    }
  }
  for (const item of admission.recoveryGate
    ? [
        admission.recoveryGate.interruptedWork,
        ...(admission.recoveryGate.additionalInterruptedWork ?? []),
      ]
    : []) {
    if (!item.executionContextId) {
      ids.add(item.targetWakeLifecycleId);
    }
  }
  return [...ids];
}

export async function acquireAgentProfileContextMigration(input: {
  ownerUserId: string;
  targetProfileId: string;
  nowMs: number;
  operationId: string;
  storage: ExecutionAdmissionStorage;
}): Promise<boolean> {
  if ((await ensureExecutionIndexReady(input)).status !== "ready") {
    return false;
  }
  return await input.storage.transaction(async (transaction) => {
    const index = parseExecutionIndexState(
      await transaction.get(EXECUTION_INDEX_STORAGE_KEY)
    );
    if (index?.status !== "ready" || index.ownerUserId !== input.ownerUserId) {
      return false;
    }
    const key = buildExecutionAdmissionStorageKey(input.targetProfileId);
    const admission = parseExecutionAdmissionRecord(await transaction.get(key));
    if (
      !admission ||
      admission.contextMigration?.status !== "draining" ||
      (admission.executionTargetMutation &&
        admission.executionTargetMutation.expiresAtMs > input.nowMs) ||
      (await hasUnresolvedLegacyWork(admission, transaction))
    ) {
      return false;
    }
    await transaction.put(key, {
      ...admission,
      executionTargetMutation: {
        operationId: input.operationId,
        startedAtMs: input.nowMs,
        expiresAtMs: input.nowMs + EXECUTION_TARGET_MUTATION_LEASE_MS,
      },
    });
    return true;
  });
}

export async function activateAgentProfileContextMigration(input: {
  ownerUserId: string;
  targetProfileId: string;
  nowMs: number;
  operationId: string;
  association: LegacyContextAssociation;
  storage: ExecutionAdmissionStorage;
}): Promise<boolean> {
  return await input.storage.transaction(async (transaction) => {
    const key = buildExecutionAdmissionStorageKey(input.targetProfileId);
    const index = parseExecutionIndexState(
      await transaction.get(EXECUTION_INDEX_STORAGE_KEY)
    );
    const admission = parseExecutionAdmissionRecord(await transaction.get(key));
    if (
      index?.status !== "ready" ||
      index.ownerUserId !== input.ownerUserId ||
      !admission ||
      admission.contextMigration?.status !== "draining" ||
      admission.executionTargetMutation?.operationId !== input.operationId ||
      admission.executionTargetMutation.expiresAtMs <= input.nowMs ||
      (await hasUnresolvedLegacyWork(admission, transaction))
    ) {
      return false;
    }
    // Work accepted for an earlier Binding keeps its place but is not attached
    // to this Binding's legacy association; promotion rechecks the current
    // Binding and settles it with a visible no-execution outcome.
    const currentBindingContextIds = new Set<string>();
    for (const item of admission.workItems) {
      const head = await transaction.get(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          item.targetWakeLifecycleId
        )
      );
      if (!isRuntimeCoordinatorHeadLifecycleRecord(head)) {
        throw new Error(EXECUTION_STATE_UNAVAILABLE_REASON);
      }
      if (
        item.executionContextId &&
        head.acceptedDispatchSnapshot?.controllerSnapshot.bindingId ===
          input.association.bindingId &&
        head.acceptedDispatchSnapshot.controllerSnapshot.agentControllerRef ===
          input.association.agentControllerRef &&
        head.acceptedDispatchSnapshot.openMeldServiceRuntimeId ===
          input.association.openMeldServiceRuntimeId
      ) {
        currentBindingContextIds.add(item.executionContextId);
      }
    }
    await claimLegacyExecutionContext({
      association: input.association,
      storage: transaction,
    });
    await transaction.delete(
      buildContextMigrationFailureStorageKey(input.targetProfileId)
    );
    for (const contextId of currentBindingContextIds) {
      await attachLegacyAssociationToExecutionContext({
        contextId,
        association: input.association,
        storage: transaction,
      });
    }
    let next: AgentProfileExecutionAdmissionRecord = {
      ...admission,
      contextMigration: {
        ...admission.contextMigration,
        status: "contexts",
        legacyAssociation: input.association,
      },
      executionTargetMutation: null,
      revision: admission.revision + 1,
      updatedAtMs: input.nowMs,
    };
    const refill = refillAgentProfileWork({
      coordinator: projectAgentProfileWorkCoordinator(next),
      previouslyReserved: reservedAgentProfileWork(
        projectAgentProfileWorkCoordinator(admission)
      ),
    });
    next = { ...next, workItems: refill.coordinator.workItems };
    for (const item of refill.promotedItems) {
      next = (
        await promoteAgentProfileWorkItem({
          admission: next,
          item,
          nowMs: input.nowMs,
          transaction,
        })
      ).admission;
    }
    await transaction.put(key, next);
    return true;
  });
}

export async function readRuntimeCoordinatorAgentProfileExecutionStateFromAdmission(input: {
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileExecutionStateResponse> {
  const index = await ensureExecutionIndexReady({
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    storage: input.storage,
  });
  if (index.status !== "ready") {
    return unavailableExecutionState(
      index.status === "rebuilding"
        ? EXECUTION_INDEX_REBUILDING_REASON
        : EXECUTION_INDEX_REPAIR_FAILED_REASON
    );
  }

  const rawAdmission = await input.storage.get<unknown>(
    buildExecutionAdmissionStorageKey(input.targetProfileId)
  );
  const activeProfileIndex = parseActiveProfileIndexRecord(
    await input.storage.get<unknown>(
      EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY
    ),
    index.generation
  );
  if (!activeProfileIndex) {
    await requestFreshExecutionIndexRepair({
      expectedGeneration: index.generation,
      nowMs: input.nowMs,
      ownerUserId: input.ownerUserId,
      storage: input.storage,
    });
    return unavailableExecutionState(EXECUTION_INDEX_REBUILDING_REASON);
  }
  if (rawAdmission === undefined || rawAdmission === null) {
    if (!activeProfileIndex.targetProfileIds.includes(input.targetProfileId)) {
      return { status: "inactive" };
    }
    await requestFreshExecutionIndexRepair({
      expectedGeneration: index.generation,
      nowMs: input.nowMs,
      ownerUserId: input.ownerUserId,
      storage: input.storage,
    });
    return unavailableExecutionState(EXECUTION_INDEX_REBUILDING_REASON);
  }
  const admission = parseExecutionAdmissionRecord(rawAdmission);
  if (!admission || admission.targetProfileId !== input.targetProfileId) {
    await requestFreshExecutionIndexRepair({
      expectedGeneration: index.generation,
      nowMs: input.nowMs,
      ownerUserId: input.ownerUserId,
      storage: input.storage,
    });
    return unavailableExecutionState(EXECUTION_INDEX_REBUILDING_REASON);
  }
  if (admission.generation !== index.generation) {
    if (!activeProfileIndex.targetProfileIds.includes(input.targetProfileId)) {
      return admission.executionTargetMutation &&
        admission.executionTargetMutation.expiresAtMs > input.nowMs
        ? unavailableExecutionState(
            EXECUTION_TARGET_MUTATION_IN_PROGRESS_REASON
          )
        : { status: "inactive" };
    }
    await requestFreshExecutionIndexRepair({
      expectedGeneration: index.generation,
      nowMs: input.nowMs,
      ownerUserId: input.ownerUserId,
      storage: input.storage,
    });
    return unavailableExecutionState(EXECUTION_INDEX_REBUILDING_REASON);
  }

  const executionState = await resolveAdmissionExecutionState({
    admission,
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    storage: input.storage,
  });
  if (
    executionState.status !== "unavailable" ||
    executionState.reasonCode === EXECUTION_TARGET_MUTATION_IN_PROGRESS_REASON
  ) {
    return executionState;
  }
  await requestFreshExecutionIndexRepair({
    expectedGeneration: index.generation,
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    storage: input.storage,
  });
  return unavailableExecutionState(EXECUTION_INDEX_REBUILDING_REASON);
}

/**
 * The owner's running tasks with their chain roots, for the CLI-credential
 * risk window (design-plans/member-agent-program-reviews/5-credentials.md,
 * decision 5a0). A task runs from the moment RuntimeCoordinator creates its
 * execution until the execution is terminal: an accepted or waiting Wake has
 * no process on any computer yet. Any record this read cannot vouch for
 * makes it unavailable, and the caller treats the window as open.
 */
export async function readRuntimeCoordinatorRiskWindowExecutions(input: {
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
}): Promise<RiskWindowExecutionsResponse> {
  const unavailable = (reasonCode: string): RiskWindowExecutionsResponse => ({
    reasonCode,
    status: "unavailable",
  });
  const index = await ensureExecutionIndexReady(input);
  if (index.status !== "ready") {
    return unavailable(
      index.status === "rebuilding"
        ? EXECUTION_INDEX_REBUILDING_REASON
        : EXECUTION_INDEX_REPAIR_FAILED_REASON
    );
  }
  const activeProfileIndex = parseActiveProfileIndexRecord(
    await input.storage.get<unknown>(
      EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY
    ),
    index.generation
  );
  if (!activeProfileIndex) {
    return unavailable(EXECUTION_INDEX_REBUILDING_REASON);
  }
  const executionIds = await readRiskWindowExecutionIds({
    storage: input.storage,
    targetProfileIds: activeProfileIndex.targetProfileIds,
  });
  if (!executionIds || executionIds.length > RISK_WINDOW_EXECUTION_LIMIT) {
    return unavailable(EXECUTION_STATE_UNAVAILABLE_REASON);
  }
  const executions: RiskWindowExecution[] = [];
  for (const ids of chunkStorageKeys(executionIds)) {
    const chunk = await readRiskWindowExecutionChunk({
      executionIds: ids,
      ownerUserId: input.ownerUserId,
      storage: input.storage,
    });
    if (!chunk) {
      return unavailable(EXECUTION_STATE_UNAVAILABLE_REASON);
    }
    executions.push(...chunk);
  }
  return { executions, status: "ready" };
}

type RiskWindowExecution = Extract<
  RiskWindowExecutionsResponse,
  { status: "ready" }
>["executions"][number];

/** Executions the admission records hold, or null if a record is unreadable. */
async function readRiskWindowExecutionIds(input: {
  storage: ExecutionAdmissionStorage;
  targetProfileIds: readonly string[];
}): Promise<string[] | null> {
  const executionIds: string[] = [];
  for (const profileIds of chunkStorageKeys(input.targetProfileIds)) {
    const admissions = await input.storage.get<unknown>(
      profileIds.map(buildExecutionAdmissionStorageKey)
    );
    for (const targetProfileId of profileIds) {
      const admission = parseExecutionAdmissionRecord(
        admissions.get(buildExecutionAdmissionStorageKey(targetProfileId))
      );
      if (
        !admission ||
        admission.targetProfileId !== targetProfileId ||
        admission.referencesOverflowed
      ) {
        return null;
      }
      executionIds.push(...admission.activeExecutionIds);
    }
  }
  return uniqueSorted(executionIds);
}

/**
 * The running executions among `executionIds` (token authority not terminal)
 * with the chain root of their Wake. A running execution whose Wake head is
 * gone keeps a null root, which the caller treats as another requester.
 */
async function readRiskWindowExecutionChunk(input: {
  executionIds: readonly string[];
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
}): Promise<RiskWindowExecution[] | null> {
  const authorities = await input.storage.get<unknown>(
    input.executionIds.map(buildRuntimeCoordinatorTokenAuthorityStorageKey)
  );
  const commandStates = await input.storage.get<unknown>(
    input.executionIds.map(buildRuntimeCoordinatorRunCommandStateStorageKey)
  );
  const running: Array<{
    authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
    headId: string | null;
  }> = [];
  for (const executionId of input.executionIds) {
    const authority =
      runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
        authorities.get(
          buildRuntimeCoordinatorTokenAuthorityStorageKey(executionId)
        )
      );
    if (!authority.success) {
      return null;
    }
    if (authority.data.terminalOutcome === null) {
      running.push({
        authority: authority.data,
        headId: resolveRunCommandHeadId(
          commandStates.get(
            buildRuntimeCoordinatorRunCommandStateStorageKey(executionId)
          ),
          input.ownerUserId
        ),
      });
    }
  }
  const headIds = running.flatMap((entry) =>
    entry.headId ? [entry.headId] : []
  );
  const heads =
    headIds.length > 0
      ? await input.storage.get<unknown>(
          headIds.map(buildRuntimeCoordinatorHeadLifecycleStorageKey)
        )
      : new Map<string, unknown>();
  return running.map((entry) => {
    const head = entry.headId
      ? heads.get(buildRuntimeCoordinatorHeadLifecycleStorageKey(entry.headId))
      : undefined;
    const snapshot =
      isRuntimeCoordinatorHeadLifecycleRecord(head) &&
      head.ownerUserId === input.ownerUserId
        ? head.acceptedDispatchSnapshot
        : undefined;
    const root = (snapshot?.executionContext?.requestChain ??
      snapshot?.contextRequest?.requestChain)?.[0];
    return {
      openMeldServiceRuntimeId:
        entry.authority.authorityScope.openMeldServiceRuntimeId,
      rootProfileId: root?.kind === "human" ? root.profileId : null,
      targetProfileId: entry.authority.executionScope.targetProfileId,
    };
  });
}

function resolveRunCommandHeadId(
  value: unknown,
  ownerUserId: string
): string | null {
  if (!isRuntimeCoordinatorRunCommandState(value)) {
    return null;
  }
  if (value.ownerUserId !== ownerUserId) {
    return null;
  }
  const payload = value.sanitizedDeliveryRequest.payload;
  return projectTargetWakeLifecycleIdentity({
    clientMessageId: value.sourceClientMessageId,
    dispatchId: value.dispatchId,
    sourceSignalId: payload.sourceEventId,
    spaceId: payload.spaceId,
    targetProfileId: value.targetProfileId,
  }).targetWakeLifecycleId;
}

function chunkStorageKeys(values: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (
    let offset = 0;
    offset < values.length;
    offset += DURABLE_OBJECT_STORAGE_GET_MAX_KEYS
  ) {
    chunks.push(
      values.slice(offset, offset + DURABLE_OBJECT_STORAGE_GET_MAX_KEYS)
    );
  }
  return chunks;
}

export async function readRuntimeCoordinatorAgentProfileOperationalContextsFromAdmission(input: {
  includeWorkReferences: boolean;
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileIds: readonly string[];
}): Promise<RuntimeTransportAgentProfileOperationalContextsResponse> {
  const targetProfileIds = [...new Set(input.targetProfileIds)];
  const checkingContexts = (reasonCode: string) => ({
    contexts: targetProfileIds.map((targetProfileId) => ({
      operationalContext: { reasonCode, status: "checking" as const },
      targetProfileId,
    })),
  });
  const index = await ensureExecutionIndexReady({
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    storage: input.storage,
  });
  if (index.status !== "ready") {
    return checkingContexts(
      index.status === "rebuilding"
        ? EXECUTION_INDEX_REBUILDING_REASON
        : EXECUTION_INDEX_REPAIR_FAILED_REASON
    );
  }

  const activeProfileIndex = parseActiveProfileIndexRecord(
    await input.storage.get<unknown>(
      EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY
    ),
    index.generation
  );
  if (!activeProfileIndex) {
    await requestFreshExecutionIndexRepair({
      expectedGeneration: index.generation,
      nowMs: input.nowMs,
      ownerUserId: input.ownerUserId,
      storage: input.storage,
    });
    return checkingContexts(EXECUTION_INDEX_REBUILDING_REASON);
  }

  const activeProfileIds = new Set(activeProfileIndex.targetProfileIds);
  const admissionStorageKeys = targetProfileIds.map(
    buildExecutionAdmissionStorageKey
  );
  const rawAdmissions = await readStorageValuesInBatches(
    input.storage,
    admissionStorageKeys
  );
  const admissionsByProfileId = new Map<
    string,
    AgentProfileExecutionAdmissionRecord
  >();
  const contextsByProfileId = new Map<
    string,
    RuntimeTransportAgentProfileOperationalContextsResponse["contexts"][number]["operationalContext"]
  >();
  let repairRequired = false;

  for (const targetProfileId of targetProfileIds) {
    const projection = projectAgentProfileOperationalContextFromAdmission({
      activeProfileIds,
      generation: index.generation,
      rawAdmission: rawAdmissions.get(
        buildExecutionAdmissionStorageKey(targetProfileId)
      ),
      targetProfileId,
    });
    repairRequired ||= projection.repairRequired;
    contextsByProfileId.set(targetProfileId, projection.operationalContext);
    if (projection.admission) {
      admissionsByProfileId.set(targetProfileId, projection.admission);
    }
  }

  if (input.includeWorkReferences && admissionsByProfileId.size > 0) {
    const headStorageKeys = [...admissionsByProfileId.values()].flatMap(
      (admission) =>
        [
          ...admission.workItems,
          ...(admission.recoveryGate
            ? [admission.recoveryGate.interruptedWork]
            : []),
        ].map((item) =>
          buildRuntimeCoordinatorHeadLifecycleStorageKey(
            item.targetWakeLifecycleId
          )
        )
    );
    const rawHeads = await readStorageValuesInBatches(
      input.storage,
      headStorageKeys
    );
    for (const [targetProfileId, admission] of admissionsByProfileId) {
      const projection = projectAgentProfileWorkReferences({
        admission,
        rawHeads,
        targetProfileId,
      });
      repairRequired ||= projection.repairRequired;
      contextsByProfileId.set(targetProfileId, projection.operationalContext);
    }
  }

  if (repairRequired) {
    await requestFreshExecutionIndexRepair({
      expectedGeneration: index.generation,
      nowMs: input.nowMs,
      ownerUserId: input.ownerUserId,
      storage: input.storage,
    });
  }
  return {
    contexts: targetProfileIds.map((targetProfileId) => ({
      operationalContext:
        contextsByProfileId.get(targetProfileId) ??
        ({
          reasonCode: EXECUTION_STATE_UNAVAILABLE_REASON,
          status: "checking",
        } as const),
      targetProfileId,
    })),
  };
}

export async function readRuntimeCoordinatorAgentProfileWorkRecoveryFromAdmission(input: {
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileWorkRecoveryReadResponse> {
  const index = await ensureExecutionIndexReady({
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    storage: input.storage,
  });
  if (index.status !== "ready") {
    return { status: "unavailable" };
  }
  const admission = parseExecutionAdmissionRecord(
    await input.storage.get<unknown>(
      buildExecutionAdmissionStorageKey(input.targetProfileId)
    )
  );
  if (
    !admission ||
    admission.generation !== index.generation ||
    admission.targetProfileId !== input.targetProfileId
  ) {
    return { status: "not_pending" };
  }
  const gate = admission.recoveryGate;
  const action = gate ? resolveAgentProfileWorkRecoveryAction(gate) : null;
  if (!(gate && action)) {
    return { status: "not_pending" };
  }
  const head = await input.storage.get<unknown>(
    buildRuntimeCoordinatorHeadLifecycleStorageKey(
      gate.interruptedWork.targetWakeLifecycleId
    )
  );
  if (
    !isRuntimeCoordinatorHeadLifecycleRecord(head) ||
    head.ownerUserId !== input.ownerUserId ||
    head.primaryDispatchId !== gate.interruptedWork.dispatchId ||
    head.targetWakeLifecycleId !== gate.interruptedWork.targetWakeLifecycleId ||
    head.targetWakeLifecycleIdentity.targetProfileId !==
      input.targetProfileId ||
    !head.targetWakeLifecycleIdentity.clientMessageId
  ) {
    await requestFreshExecutionIndexRepair({
      expectedGeneration: index.generation,
      nowMs: input.nowMs,
      ownerUserId: input.ownerUserId,
      storage: input.storage,
    });
    return { status: "unavailable" };
  }
  return {
    action: resolveAvailableWorkRecoveryAction(action, head),
    requesterRecoveryScope: resolveRequesterRecoveryScope(admission, head),
    automaticForkEligible: await canAutomaticallyForkOccupiedWork({
      gate,
      head,
      storage: input.storage,
    }),
    authorizedContinuationClientMessageId:
      gate.status === "continuation_authorized"
        ? gate.continuationClientMessageId
        : null,
    ...(gate.forkInterruptedConversation
      ? { forkInterruptedConversation: true }
      : {}),
    interruptedClientMessageId:
      head.targetWakeLifecycleIdentity.clientMessageId,
    interruptedDispatchId: head.primaryDispatchId,
    interruptedLocalAttempt: await resolveInterruptedLocalAttemptState({
      head,
      storage: input.storage,
    }),
    interruptedSourceSignalId: head.targetWakeLifecycleIdentity.sourceSignalId,
    interruptedTargetWakeLifecycleId: head.targetWakeLifecycleId,
    spaceId: head.targetWakeLifecycleIdentity.spaceId,
    status: "available",
  };
}

/** A requester may only resolve their own context, never release another context's held work. */
function resolveRequesterRecoveryScope(
  admission: AgentProfileExecutionAdmissionRecord,
  head: RuntimeCoordinatorHeadLifecycleRecord
) {
  const context = head.acceptedDispatchSnapshot?.executionContext;
  if (
    !context ||
    admission.recoveryGate?.additionalInterruptedWork?.length ||
    admission.workItems.some((item) => item.executionContextId !== context.id)
  ) {
    return undefined;
  }
  return {
    profileId: context.scope.requesterProfileId,
    spaceId: context.scope.spaceId,
    canFork: context.access !== "workspace" && !context.permissionSource,
  };
}

async function canRequesterRecoverWork(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  storage: Pick<DurableObjectTransaction, "get">;
  requesterProfileId?: string;
  expectedInterruptedTargetWakeLifecycleId: string;
  fork?: boolean;
}): Promise<boolean> {
  if (!input.requesterProfileId) {
    return true;
  }
  const head = await input.storage.get<unknown>(
    buildRuntimeCoordinatorHeadLifecycleStorageKey(
      input.expectedInterruptedTargetWakeLifecycleId
    )
  );
  const scope = isRuntimeCoordinatorHeadLifecycleRecord(head)
    ? resolveRequesterRecoveryScope(input.admission, head)
    : undefined;
  return (
    scope?.profileId === input.requesterProfileId &&
    (input.fork === undefined || (input.fork && scope.canFork))
  );
}

/**
 * Answers whether the attempt a continuation would replace is out of the way.
 *
 * Core's own terminal decision is not the answer. A stale-evidence terminal is
 * a decision made from missing evidence, so the local Agent can still be queued
 * on the conversation this work was waiting for; letting a replacement start on
 * that basis is what allows two attempts at the same instruction. A head that
 * never linked an execution never reached the computer at all, which is the one
 * case where nothing has to be withdrawn.
 */
async function resolveInterruptedLocalAttemptState(input: {
  head: RuntimeCoordinatorHeadLifecycleRecord;
  storage: Pick<DurableObjectStorage, "get">;
}): Promise<"awaiting_withdrawal" | "not_started" | "withdrawn"> {
  const executionId = input.head.runtimeCoordinatorExecutionId;
  if (!executionId) {
    return "not_started";
  }
  const rawCommandState = await input.storage.get<unknown>(
    buildRuntimeCoordinatorRunCommandStateStorageKey(executionId)
  );
  if (rawCommandState === undefined) {
    // The delivery record is how an attempt is known at all. Without it Core
    // cannot say the computer ever accepted one, and it must not invent proof.
    return "awaiting_withdrawal";
  }
  if (!isRuntimeCoordinatorRunCommandState(rawCommandState)) {
    return "awaiting_withdrawal";
  }
  return isRuntimeCoordinatorLocalAttemptWithdrawn(rawCommandState)
    ? "withdrawn"
    : "awaiting_withdrawal";
}

async function readAutomaticForkEligibility(input: {
  gate: AgentProfileWorkRecoveryGate;
  storage: Pick<DurableObjectStorage, "get">;
}): Promise<boolean> {
  const head = await input.storage.get<unknown>(
    buildRuntimeCoordinatorHeadLifecycleStorageKey(
      input.gate.interruptedWork.targetWakeLifecycleId
    )
  );
  return (
    isRuntimeCoordinatorHeadLifecycleRecord(head) &&
    (await canAutomaticallyForkOccupiedWork({ ...input, head }))
  );
}

/** A native writer refusal proves admission failed, not that shared files are idle. */
async function canAutomaticallyForkOccupiedWork(input: {
  gate: AgentProfileWorkRecoveryGate;
  head: RuntimeCoordinatorHeadLifecycleRecord;
  storage: Pick<DurableObjectStorage, "get">;
}): Promise<boolean> {
  const snapshot = input.head.acceptedDispatchSnapshot;
  const context = snapshot?.executionContext;
  if (
    !(
      input.gate.status === "awaiting_occupancy_decision" ||
      (input.gate.status === "continuation_authorized" &&
        input.gate.forkInterruptedConversation)
    ) ||
    snapshot?.controllerSnapshot.agentControllerRef !== "builtin:codex" ||
    snapshot.contextRequest?.selection.mode !== "auto" ||
    !context ||
    context.forkSource ||
    context.permissionSource ||
    context.access === "workspace" ||
    !input.head.runtimeCoordinatorExecutionId
  ) {
    return false;
  }
  const command = await input.storage.get<unknown>(
    buildRuntimeCoordinatorRunCommandStateStorageKey(
      input.head.runtimeCoordinatorExecutionId
    )
  );
  return (
    isRuntimeCoordinatorRunCommandState(command) &&
    command.dispatchId === input.head.primaryDispatchId &&
    command.ownerUserId === input.head.ownerUserId &&
    command.runtimeCoordinatorExecutionId ===
      input.head.runtimeCoordinatorExecutionId &&
    command.localProgress.runningAtMs === null &&
    command.localProgress.completedLocalAtMs === null
  );
}

type AgentProfileOperationalContext =
  RuntimeTransportAgentProfileOperationalContextsResponse["contexts"][number]["operationalContext"];

function resolveAvailableWorkRecoveryAction(
  action: NonNullable<ReturnType<typeof resolveAgentProfileWorkRecoveryAction>>,
  head: RuntimeCoordinatorHeadLifecycleRecord
): NonNullable<ReturnType<typeof resolveAgentProfileWorkRecoveryAction>> {
  // Legacy Binding conversations have no per-Wake context to fork safely.
  // Keep an actionable exit instead of promising a branch with no source.
  return action === "fork_interrupted_work" &&
    !head.acceptedDispatchSnapshot?.executionContext
    ? "skip_interrupted_work"
    : action;
}

function checkingAgentProfileOperationalContext(): AgentProfileOperationalContext {
  return {
    reasonCode: EXECUTION_INDEX_REBUILDING_REASON,
    status: "checking",
  };
}

function idleAgentProfileOperationalContext(): AgentProfileOperationalContext {
  return { status: "idle", waitingCount: 0 };
}

function projectAgentProfileOperationalContextFromAdmission(input: {
  activeProfileIds: ReadonlySet<string>;
  generation: number;
  rawAdmission: unknown;
  targetProfileId: string;
}): {
  admission?: AgentProfileExecutionAdmissionRecord;
  operationalContext: AgentProfileOperationalContext;
  repairRequired: boolean;
} {
  const active = input.activeProfileIds.has(input.targetProfileId);
  if (input.rawAdmission === undefined || input.rawAdmission === null) {
    return active
      ? {
          operationalContext: checkingAgentProfileOperationalContext(),
          repairRequired: true,
        }
      : {
          operationalContext: idleAgentProfileOperationalContext(),
          repairRequired: false,
        };
  }
  const admission = parseExecutionAdmissionRecord(input.rawAdmission);
  if (!admission || admission.targetProfileId !== input.targetProfileId) {
    return {
      operationalContext: checkingAgentProfileOperationalContext(),
      repairRequired: true,
    };
  }
  if (admission.generation !== input.generation) {
    return active
      ? {
          operationalContext: checkingAgentProfileOperationalContext(),
          repairRequired: true,
        }
      : {
          operationalContext: idleAgentProfileOperationalContext(),
          repairRequired: false,
        };
  }
  const workSummary = summarizeAgentProfileWorkCoordinator(
    projectAgentProfileWorkCoordinator(admission)
  );
  if (workSummary.status === "idle") {
    const inconsistent =
      admission.activeExecutionIds.length > 0 ||
      admission.activeHeadLifecycleIds.length > 0 ||
      admission.referencesOverflowed;
    return inconsistent
      ? {
          operationalContext: checkingAgentProfileOperationalContext(),
          // Legacy executions can have active references without FIFO metadata.
          // Rebuilding the active-reference index cannot create that metadata;
          // repeatedly requesting it would block unrelated Profile mutations.
          // Repair only an actual mismatch in the active-profile index.
          repairRequired: !active,
        }
      : {
          operationalContext: idleAgentProfileOperationalContext(),
          repairRequired: false,
        };
  }
  return {
    admission,
    operationalContext: {
      status: workSummary.status,
      waitingCount: workSummary.waitingCount,
    },
    repairRequired: !active,
  };
}

function projectAgentProfileWorkReferences(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  rawHeads: ReadonlyMap<string, unknown>;
  targetProfileId: string;
}): {
  operationalContext: AgentProfileOperationalContext;
  repairRequired: boolean;
} {
  const references = input.admission.workItems.map((item) => {
    const rawHead = input.rawHeads.get(
      buildRuntimeCoordinatorHeadLifecycleStorageKey(item.targetWakeLifecycleId)
    );
    if (
      !isRuntimeCoordinatorHeadLifecycleRecord(rawHead) ||
      rawHead.targetWakeLifecycleId !== item.targetWakeLifecycleId ||
      rawHead.targetWakeLifecycleIdentity.targetProfileId !==
        input.targetProfileId
    ) {
      return null;
    }
    return {
      sourceSignalId: rawHead.targetWakeLifecycleIdentity.sourceSignalId,
      spaceId: rawHead.targetWakeLifecycleIdentity.spaceId,
    };
  });
  if (references.some((reference) => reference === null)) {
    return {
      operationalContext: checkingAgentProfileOperationalContext(),
      repairRequired: true,
    };
  }
  const workSummary = summarizeAgentProfileWorkCoordinator(
    projectAgentProfileWorkCoordinator(input.admission)
  );
  const activeIds = new Set(
    workSummary.currentWorks.map((item) => item.targetWakeLifecycleId)
  );
  const currentWorkReferences = references.filter((_, index) =>
    activeIds.has(input.admission.workItems[index]?.targetWakeLifecycleId ?? "")
  ) as { sourceSignalId: string; spaceId: string }[];
  const queuedWorkReferences = references.filter(
    (_, index) =>
      !activeIds.has(
        input.admission.workItems[index]?.targetWakeLifecycleId ?? ""
      )
  ) as { sourceSignalId: string; spaceId: string }[];
  if (workSummary.status === "paused") {
    const recoveryAction = resolveAgentProfileWorkRecoveryAction(
      input.admission.recoveryGate
    );
    const interrupted = input.admission.recoveryGate?.interruptedWork;
    const interruptedHead = interrupted
      ? input.rawHeads.get(
          buildRuntimeCoordinatorHeadLifecycleStorageKey(
            interrupted.targetWakeLifecycleId
          )
        )
      : null;
    if (
      recoveryAction &&
      (!isRuntimeCoordinatorHeadLifecycleRecord(interruptedHead) ||
        interruptedHead.targetWakeLifecycleId !==
          interrupted?.targetWakeLifecycleId ||
        interruptedHead.targetWakeLifecycleIdentity.targetProfileId !==
          input.targetProfileId)
    ) {
      return {
        operationalContext: checkingAgentProfileOperationalContext(),
        repairRequired: true,
      };
    }
    return {
      operationalContext: {
        currentWorkReference:
          recoveryAction &&
          isRuntimeCoordinatorHeadLifecycleRecord(interruptedHead)
            ? {
                sourceSignalId:
                  interruptedHead.targetWakeLifecycleIdentity.sourceSignalId,
                spaceId: interruptedHead.targetWakeLifecycleIdentity.spaceId,
              }
            : currentWorkReferences[0],
        queuedWorkReferences,
        ...(recoveryAction && input.admission.recoveryGate
          ? {
              recoveryAction: isRuntimeCoordinatorHeadLifecycleRecord(
                interruptedHead
              )
                ? resolveAvailableWorkRecoveryAction(
                    recoveryAction,
                    interruptedHead
                  )
                : recoveryAction,
              recoveryTargetWakeLifecycleId:
                input.admission.recoveryGate.interruptedWork
                  .targetWakeLifecycleId,
            }
          : {}),
        status: "paused",
        waitingCount: queuedWorkReferences.length,
      },
      repairRequired: false,
    };
  }
  const currentWorkReference = currentWorkReferences[0];
  if (!currentWorkReference) {
    return {
      operationalContext: checkingAgentProfileOperationalContext(),
      repairRequired: true,
    };
  }
  return {
    operationalContext: {
      currentWorkReference,
      queuedWorkReferences: queuedWorkReferences as {
        sourceSignalId: string;
        spaceId: string;
      }[],
      status: "working",
      waitingCount: queuedWorkReferences.length,
    },
    repairRequired: false,
  };
}

/**
 * Stages the next inbox item has to close as it opens.
 *
 * An occupancy decision is announced under its own stage, so a gate that leaves
 * it has to close that item by name: the source key digests the stage, and only
 * one projection intent exists per profile.
 */
function resolveSupersededAgentProfileWorkRecoveryInboxStages(
  status: AgentProfileWorkRecoveryGate["status"]
): AgentProfileWorkRecoveryInboxStage[] {
  return status === "awaiting_occupancy_decision"
    ? ["resolve_occupied_conversation"]
    : [];
}

/**
 * Closes the occupancy decision the owner has just answered.
 *
 * Nothing downstream knows which stage announced the gate, so taking the
 * decision is what has to close its inbox item.
 */
async function closeAgentProfileWorkOccupancyDecisionInboxItem(input: {
  nowMs: number;
  recoveryGate: AgentProfileWorkRecoveryGate;
  storage: Pick<DurableObjectStorage, "delete" | "get" | "put" | "setAlarm">;
  targetProfileId: string;
}): Promise<void> {
  if (input.recoveryGate.status !== "awaiting_occupancy_decision") {
    return;
  }
  await Promise.all([
    writeAgentProfileWorkRecoveryInboxProjectionIntent({
      intent: buildAgentProfileWorkRecoveryInboxProjectionIntent({
        desiredStatus: "resolved",
        occurredAtMs: input.recoveryGate.updatedAtMs,
        stage: "resolve_occupied_conversation",
        targetProfileId: input.targetProfileId,
        targetWakeLifecycleId:
          input.recoveryGate.interruptedWork.targetWakeLifecycleId,
        updatedAtMs: input.nowMs,
      }),
      storage: input.storage,
    }),
    input.storage.setAlarm(input.nowMs),
  ]);
}

function resolveAgentProfileWorkRecoveryInboxStage(
  status: AgentProfileWorkRecoveryGate["status"]
): AgentProfileWorkRecoveryInboxStage {
  if (status === "awaiting_occupancy_decision") {
    return "resolve_occupied_conversation";
  }
  return status === "awaiting_owner_approval"
    ? "approve_queued_work"
    : "review_interrupted_work";
}

function resolveAgentProfileWorkRecoveryAction(
  gateOrStatus:
    | AgentProfileWorkRecoveryGate
    | AgentProfileWorkRecoveryGate["status"]
    | null
):
  | "continue_interrupted_work"
  | "approve_queued_work"
  | "fork_interrupted_work"
  | "skip_interrupted_work"
  | null {
  if (!gateOrStatus) {
    return null;
  }
  const status =
    typeof gateOrStatus === "string" ? gateOrStatus : gateOrStatus.status;
  const isFork =
    typeof gateOrStatus === "object" &&
    Boolean(gateOrStatus.forkInterruptedConversation);
  switch (status) {
    case "awaiting_occupancy_decision":
      return "fork_interrupted_work";
    case "continuation_pending":
    case "continuation_authorized":
      return isFork ? "fork_interrupted_work" : "continue_interrupted_work";
    case "awaiting_owner_approval":
      return "approve_queued_work";
    case "continuation_needs_attention":
      return "skip_interrupted_work";
    case "awaiting_usage":
    case "continuation_running":
      return null;
    default:
      return assertNeverRecoveryGateStatus(status);
  }
}

function assertNeverRecoveryGateStatus(value: never): never {
  throw new Error(
    `Unsupported Agent Profile work recovery gate status: ${String(value)}`
  );
}

export async function acquireRuntimeCoordinatorAgentProfileExecutionTargetMutation(input: {
  nowMs: number;
  operationId: string;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse> {
  return await acquireRuntimeCoordinatorAgentProfileMutation({
    ...input,
    mutationKind: "execution_target",
  });
}

export async function acquireRuntimeCoordinatorAgentProfileFutureWorkSettingsMutation(input: {
  nowMs: number;
  operationId: string;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse> {
  return await acquireRuntimeCoordinatorAgentProfileMutation({
    ...input,
    mutationKind: "future_work_settings",
  });
}

export async function acquireRuntimeCoordinatorAgentProfileLegacyConversationMutation(input: {
  agentControllerRef?: string;
  nowMs: number;
  operationId: string;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse> {
  const { agentControllerRef, ...mutationInput } = input;
  return await acquireRuntimeCoordinatorAgentProfileMutation({
    ...mutationInput,
    // The frozen association belongs to a Context-capable harness. A harness
    // without Context support keeps writing its own Binding conversation.
    legacyAssociationFrozen:
      agentControllerRef === undefined ||
      supportsExecutionContextSelection(agentControllerRef),
    mutationKind: "legacy_conversation",
  });
}

function mutationLeaseHeldByOther(
  lease: ExecutionTargetMutationLease | null,
  operationId: string,
  nowMs: number
): boolean {
  return Boolean(
    lease && lease.expiresAtMs > nowMs && lease.operationId !== operationId
  );
}

function prepareMutationRecovery(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  preserveRecovery: boolean;
  nowMs: number;
}) {
  const coordinator = projectAgentProfileWorkCoordinator(input.admission);
  return input.preserveRecovery
    ? { changed: false, coordinator }
    : markAgentProfileWorkContinuationNeedsAttention({
        coordinator,
        nowMs: input.nowMs,
      });
}

async function acquireRuntimeCoordinatorAgentProfileMutation(input: {
  legacyAssociationFrozen?: boolean;
  mutationKind:
    | "execution_target"
    | "future_work_settings"
    | "legacy_conversation";
  nowMs: number;
  operationId: string;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse> {
  const index = await ensureExecutionIndexReady({
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    storage: input.storage,
  });
  if (index.status !== "ready") {
    return {
      reasonCode:
        index.status === "rebuilding"
          ? EXECUTION_INDEX_REBUILDING_REASON
          : EXECUTION_INDEX_REPAIR_FAILED_REASON,
      status: "unavailable",
    };
  }

  const storageKey = buildExecutionAdmissionStorageKey(input.targetProfileId);
  const existingRaw = await input.storage.get<unknown>(storageKey);
  const existing = parseExecutionAdmissionRecord(existingRaw);
  if (
    existing?.generation === index.generation &&
    existing.targetProfileId === input.targetProfileId &&
    existing.executionTargetMutation?.operationId === input.operationId &&
    existing.executionTargetMutation.expiresAtMs > input.nowMs
  ) {
    return {
      expiresAtMs: existing.executionTargetMutation.expiresAtMs,
      operationId: input.operationId,
      status: "acquired",
    };
  }

  const executionState =
    await readRuntimeCoordinatorAgentProfileExecutionStateFromAdmission(input);
  if (
    input.mutationKind === "execution_target" &&
    executionState.status === "active" &&
    (!existing || admissionBlocksExecutionTargetMutation(existing))
  ) {
    return {
      reasonCode: "runtime_coordinator.agent_profile_execution_active",
      status: "blocked",
    };
  }
  if (executionState.status === "unavailable") {
    return {
      reasonCode: executionState.reasonCode,
      status: "unavailable",
    };
  }

  return await input.storage.transaction(async (transaction) => {
    const currentIndex = parseExecutionIndexState(
      await transaction.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
    );
    if (
      currentIndex?.status !== "ready" ||
      currentIndex.generation !== index.generation ||
      currentIndex.ownerUserId !== input.ownerUserId
    ) {
      return {
        reasonCode: EXECUTION_INDEX_REBUILDING_REASON,
        status: "unavailable" as const,
      };
    }
    const prepared = await prepareMutationAdmissionTransaction({
      currentIndex,
      nowMs: input.nowMs,
      storageKey,
      targetProfileId: input.targetProfileId,
      transaction,
    });
    if (prepared.status === "unavailable") {
      return prepared.response;
    }
    const admission = prepared.admission;
    if (
      input.mutationKind === "legacy_conversation" &&
      input.legacyAssociationFrozen !== false &&
      admission.contextMigration?.status === "contexts"
    ) {
      return {
        status: "blocked" as const,
        reasonCode: "execution_context.legacy_association_frozen",
      };
    }
    if (
      input.mutationKind === "execution_target" &&
      admissionBlocksExecutionTargetMutation(admission)
    ) {
      return {
        reasonCode: "runtime_coordinator.agent_profile_execution_active",
        status: "blocked" as const,
      };
    }
    const currentMutation = admission.executionTargetMutation;
    if (
      mutationLeaseHeldByOther(currentMutation, input.operationId, input.nowMs)
    ) {
      return {
        reasonCode: EXECUTION_TARGET_MUTATION_IN_PROGRESS_REASON,
        status: "unavailable" as const,
      };
    }

    const expiresAtMs = input.nowMs + EXECUTION_TARGET_MUTATION_LEASE_MS;
    const marked = prepareMutationRecovery({
      admission,
      preserveRecovery: input.mutationKind === "legacy_conversation",
      nowMs: input.nowMs,
    });
    const nextRecoveryGate = marked.changed
      ? marked.coordinator.recoveryGate
      : admission.recoveryGate;
    const nextAdmission = {
      ...admission,
      executionTargetMutation: {
        expiresAtMs,
        operationId: input.operationId,
        startedAtMs: input.nowMs,
      },
      recoveryGate: nextRecoveryGate,
      revision: marked.changed
        ? marked.coordinator.revision
        : admission.revision + 1,
      updatedAtMs: input.nowMs,
    } satisfies AgentProfileExecutionAdmissionRecord;
    await transaction.put(storageKey, nextAdmission);
    if (marked.changed && nextRecoveryGate) {
      await Promise.all([
        writeAgentProfileWorkRecoveryInboxProjectionIntent({
          intent: buildAgentProfileWorkRecoveryInboxProjectionIntent({
            desiredStatus: "open",
            occurredAtMs: input.nowMs,
            stage: "review_interrupted_work",
            targetProfileId: input.targetProfileId,
            targetWakeLifecycleId:
              nextRecoveryGate.interruptedWork.targetWakeLifecycleId,
            updatedAtMs: input.nowMs,
          }),
          storage: transaction,
        }),
        transaction.setAlarm(input.nowMs),
      ]);
    }
    return {
      expiresAtMs,
      operationId: input.operationId,
      status: "acquired" as const,
    };
  });
}

async function prepareMutationAdmissionTransaction(input: {
  currentIndex: Extract<AgentProfileExecutionIndexState, { status: "ready" }>;
  nowMs: number;
  storageKey: string;
  targetProfileId: string;
  transaction: Pick<DurableObjectTransaction, "get" | "put">;
}): Promise<
  | { admission: AgentProfileExecutionAdmissionRecord; status: "ready" }
  | {
      response: {
        reasonCode: typeof EXECUTION_INDEX_REBUILDING_REASON;
        status: "unavailable";
      };
      status: "unavailable";
    }
> {
  const activeProfileIndex = parseActiveProfileIndexRecord(
    await input.transaction.get<unknown>(
      EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY
    ),
    input.currentIndex.generation
  );
  if (!activeProfileIndex) {
    await writeFreshExecutionIndexRepairState(input);
    return rebuildingMutationAdmissionResult();
  }

  const currentRaw = await input.transaction.get<unknown>(input.storageKey);
  const current = parseExecutionAdmissionRecord(currentRaw);
  if (currentRaw !== undefined && !current) {
    await writeFreshExecutionIndexRepairState(input);
    return rebuildingMutationAdmissionResult();
  }
  if (
    (!current || current.generation !== input.currentIndex.generation) &&
    activeProfileIndex.targetProfileIds.includes(input.targetProfileId)
  ) {
    await writeFreshExecutionIndexRepairState(input);
    return rebuildingMutationAdmissionResult();
  }
  const admission =
    current?.generation === input.currentIndex.generation
      ? current
      : carryExecutionAdmissionIntoGeneration({
          admission: current,
          generation: input.currentIndex.generation,
          nowMs: input.nowMs,
          targetProfileId: input.targetProfileId,
        });
  return { admission, status: "ready" };
}

function rebuildingMutationAdmissionResult(): {
  response: {
    reasonCode: typeof EXECUTION_INDEX_REBUILDING_REASON;
    status: "unavailable";
  };
  status: "unavailable";
} {
  return {
    response: {
      reasonCode: EXECUTION_INDEX_REBUILDING_REASON,
      status: "unavailable",
    },
    status: "unavailable",
  };
}

export async function releaseRuntimeCoordinatorAgentProfileExecutionTargetMutation(input: {
  nowMs: number;
  operationId: string;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileExecutionTargetMutationReleaseResponse> {
  const storageKey = buildExecutionAdmissionStorageKey(input.targetProfileId);
  return await input.storage.transaction(async (transaction) => {
    const index = parseExecutionIndexState(
      await transaction.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
    );
    if (!index || index.ownerUserId !== input.ownerUserId) {
      return { status: "not_owner" as const };
    }
    const admission = parseExecutionAdmissionRecord(
      await transaction.get<unknown>(storageKey)
    );
    if (
      !admission ||
      admission.executionTargetMutation?.operationId !== input.operationId
    ) {
      return { status: "not_owner" as const };
    }
    const nextAdmission = {
      ...admission,
      executionTargetMutation: null,
      revision: admission.revision + 1,
      updatedAtMs: input.nowMs,
    } satisfies AgentProfileExecutionAdmissionRecord;
    if (shouldDeleteInactiveAdmission(nextAdmission, input.nowMs)) {
      await transaction.delete(storageKey);
    } else {
      await transaction.put(storageKey, nextAdmission);
    }
    return { status: "released" as const };
  });
}

export async function completeRuntimeCoordinatorAgentProfileWorkRecoveryInboxProjection(input: {
  intent: AgentProfileWorkRecoveryInboxProjectionIntent;
  nowMs: number;
  record: RuntimeCoordinatorHeadLifecycleRecord;
  storage: ExecutionAdmissionStorage;
}): Promise<boolean> {
  const targetProfileId =
    input.record.targetWakeLifecycleIdentity.targetProfileId;
  const headStorageKey = buildRuntimeCoordinatorHeadLifecycleStorageKey(
    input.record.targetWakeLifecycleId
  );
  const admissionStorageKey =
    buildExecutionAdmissionStorageKey(targetProfileId);
  return await input.storage.transaction(async (transaction) => {
    const [rawHead, rawAdmission, rawPromotion, rawRecoveryProjection] =
      await Promise.all([
        transaction.get<unknown>(headStorageKey),
        transaction.get<unknown>(admissionStorageKey),
        transaction.get<unknown>(
          buildPendingAgentProfileWorkPromotionStorageKey(targetProfileId)
        ),
        transaction.get<unknown>(
          resolveAgentProfileWorkRecoveryInboxProjectionStorageKey(input.intent)
        ),
      ]);
    const recoveryProjection =
      parseAgentProfileWorkRecoveryInboxProjectionIntent(rawRecoveryProjection);
    if (
      !(
        recoveryProjection &&
        sameAgentProfileWorkRecoveryInboxProjectionIntent(
          recoveryProjection,
          input.intent
        ) &&
        isRuntimeCoordinatorHeadLifecycleRecord(rawHead)
      ) ||
      rawHead.ownerUserId !== input.record.ownerUserId ||
      rawHead.targetWakeLifecycleId !== input.record.targetWakeLifecycleId ||
      rawHead.targetWakeLifecycleIdentity.targetProfileId !== targetProfileId
    ) {
      return false;
    }
    if (input.intent.desiredStatus === "open") {
      await deleteAgentProfileWorkRecoveryInboxProjectionIntent({
        intent: input.intent,
        storage: transaction,
      });
      return true;
    }
    const admission = parseExecutionAdmissionRecord(rawAdmission);
    if (
      (rawAdmission !== undefined && !admission) ||
      (admission &&
        admissionRetainsHeadLifecycle(
          admission,
          input.record.targetWakeLifecycleId
        )) ||
      currentStateReferenceRetainsHead(
        rawPromotion,
        input.record.targetWakeLifecycleId
      )
    ) {
      return false;
    }

    const rawLegacyIds = await transaction.get<unknown>(
      RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY
    );
    const writes: Promise<unknown>[] = [
      transaction.delete(headStorageKey),
      transaction.put(
        RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY,
        normalizeLegacyIndex(rawLegacyIds).filter(
          (targetWakeLifecycleId) =>
            targetWakeLifecycleId !== input.record.targetWakeLifecycleId
        )
      ),
    ];
    await deleteAgentProfileWorkRecoveryInboxProjectionIntent({
      intent: input.intent,
      storage: transaction,
    });
    if (admission && shouldDeleteInactiveAdmission(admission, input.nowMs)) {
      const activeProfileIndex = parseActiveProfileIndexRecord(
        await transaction.get<unknown>(
          EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY
        ),
        admission.generation
      );
      if (activeProfileIndex) {
        writes.push(
          transaction.delete(admissionStorageKey),
          transaction.put(
            EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY,
            createActiveProfileIndexRecord(
              admission.generation,
              updateActiveProfileIds({
                active: false,
                activeProfileIds: activeProfileIndex.targetProfileIds,
                targetProfileId,
              })
            )
          )
        );
      }
    }
    await Promise.all(writes);
    return true;
  });
}

export async function retireRuntimeCoordinatorAgentProfileHeadHistoryReference(input: {
  record: RuntimeCoordinatorHeadLifecycleRecord;
  storage: ExecutionAdmissionStorage;
}): Promise<boolean> {
  const headStorageKey = buildRuntimeCoordinatorHeadLifecycleStorageKey(
    input.record.targetWakeLifecycleId
  );
  return await input.storage.transaction(async (transaction) => {
    const currentHead = await transaction.get<unknown>(headStorageKey);
    if (
      !isRuntimeCoordinatorHeadLifecycleRecord(currentHead) ||
      currentHead.ownerUserId !== input.record.ownerUserId ||
      currentHead.targetWakeLifecycleId !== input.record.targetWakeLifecycleId
    ) {
      return false;
    }
    const rawLegacyIds = await transaction.get<unknown>(
      RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY
    );
    await transaction.put(
      RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY,
      normalizeLegacyIndex(rawLegacyIds).filter(
        (targetWakeLifecycleId) =>
          targetWakeLifecycleId !== input.record.targetWakeLifecycleId
      )
    );
    return true;
  });
}

type AgentProfileWorkCoordinatorHeadWriteBaseResult =
  | { status: "context_rejected"; reasonCode: string }
  | {
      effectiveRecord: RuntimeCoordinatorHeadLifecycleRecord;
      queuePosition: number;
      status: "queued" | "started";
      waitingCount: number;
    }
  | { status: "execution_target_mutation_in_progress" }
  | { status: "continuation_needs_attention" }
  | {
      compatibilityDiagnosticReasonCode?: "runtime_coordinator.terminal_replay_fingerprint_unavailable";
      effectiveRecord: RuntimeCoordinatorHeadLifecycleRecord;
      status: "existing";
    }
  | {
      conflictKind: "accepted_dispatch_payload" | "head_lifecycle_authority";
      effectiveRecord: RuntimeCoordinatorHeadLifecycleRecord;
      status: "conflict";
    }
  | {
      effectiveRecord: RuntimeCoordinatorHeadLifecycleRecord;
      reasonCode:
        | "runtime_coordinator.accepted_dispatch_snapshot_required"
        | "runtime_coordinator.legacy_head_snapshot_upgrade_unsafe";
      status: "snapshot_compatibility_retry";
    }
  | { status: "legacy_execution_active" }
  | { status: "queue_full"; waitingCount: number }
  | {
      effectiveRecord: RuntimeCoordinatorHeadLifecycleRecord;
      status: "written";
    };

export type AgentProfileWorkCoordinatorHeadWriteResult =
  AgentProfileWorkCoordinatorHeadWriteBaseResult & {
    pendingPromotion?: PendingAgentProfileWorkPromotion;
  };

export async function markRuntimeCoordinatorAgentProfileWorkControllerConversationOccupancy(input: {
  dispatchId: string;
  nowMs: number;
  state: "available" | "occupied";
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<{ changed: boolean }> {
  const storageKey = buildExecutionAdmissionStorageKey(input.targetProfileId);
  return await input.storage.transaction(async (transaction) => {
    const admission = parseExecutionAdmissionRecord(
      await transaction.get<unknown>(storageKey)
    );
    if (!admission || admission.targetProfileId !== input.targetProfileId) {
      return { changed: false };
    }
    const result = markAgentProfileWorkControllerConversationOccupancy({
      coordinator: projectAgentProfileWorkCoordinator(admission),
      dispatchId: input.dispatchId,
      nowMs: input.nowMs,
      state: input.state,
    });
    if (!result.changed) {
      return { changed: false };
    }
    await transaction.put(storageKey, {
      ...admission,
      revision: result.coordinator.revision,
      updatedAtMs: result.coordinator.updatedAtMs,
      workItems: result.coordinator.workItems,
    } satisfies AgentProfileExecutionAdmissionRecord);
    return { changed: true };
  });
}

/**
 * Answers whether Core still sees this dispatch blocked on a native
 * conversation another app owns.
 *
 * Occupied keepalives prove liveness but do not advance the progress baseline.
 * The occupancy flag the adapter reported distinguishes that blocked wait from
 * an ordinary execution stall, and it
 * lives in the admission record in Durable Object storage, which is the only
 * authority on in-flight execution.
 */
export async function readRuntimeCoordinatorAgentProfileWorkControllerConversationOccupied(input: {
  dispatchId: string;
  storage: Pick<ExecutionAdmissionStorage, "get">;
  targetProfileId: string;
}): Promise<boolean> {
  const admission = parseExecutionAdmissionRecord(
    await input.storage.get<unknown>(
      buildExecutionAdmissionStorageKey(input.targetProfileId)
    )
  );
  if (!admission || admission.targetProfileId !== input.targetProfileId) {
    return false;
  }
  return admission.workItems.some(
    (item) =>
      item.dispatchId === input.dispatchId &&
      item.waitReason === "controller_conversation_occupied"
  );
}

export async function markRuntimeCoordinatorAgentProfileWorkUsageAvailable(input: {
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileIds: readonly string[];
}): Promise<
  | {
      changedProfileIds: string[];
      continuationProfileIds: string[];
      status: "updated";
    }
  | {
      changedProfileIds: [];
      continuationProfileIds: [];
      status: "unavailable";
    }
> {
  const targetProfileIds = uniqueSorted(input.targetProfileIds);
  const readyIndex = await ensureExecutionIndexReady({
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    storage: input.storage,
  });
  if (readyIndex.status !== "ready") {
    return {
      changedProfileIds: [],
      continuationProfileIds: [],
      status: "unavailable",
    };
  }
  return await input.storage.transaction(async (transaction) => {
    const index = parseExecutionIndexState(
      await transaction.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
    );
    if (
      index?.status !== "ready" ||
      index.generation !== readyIndex.generation ||
      index.ownerUserId !== input.ownerUserId
    ) {
      return {
        changedProfileIds: [] as [],
        continuationProfileIds: [] as [],
        status: "unavailable" as const,
      };
    }
    const changedProfileIds: string[] = [];
    const continuationProfileIds: string[] = [];
    for (const targetProfileId of targetProfileIds) {
      const storageKey = buildExecutionAdmissionStorageKey(targetProfileId);
      const rawAdmission = await transaction.get<unknown>(storageKey);
      if (rawAdmission === undefined) {
        continue;
      }
      const admission = parseExecutionAdmissionRecord(rawAdmission);
      if (!admission || admission.targetProfileId !== targetProfileId) {
        throw new Error("runtime_coordinator.execution_admission_invalid");
      }
      const result = markAgentProfileWorkUsageAvailable({
        coordinator: projectAgentProfileWorkCoordinator(admission),
        nowMs: input.nowMs,
      });
      if (result.changed) {
        await transaction.put(storageKey, {
          ...admission,
          recoveryGate: result.coordinator.recoveryGate,
          revision: result.coordinator.revision,
          updatedAtMs: result.coordinator.updatedAtMs,
        } satisfies AgentProfileExecutionAdmissionRecord);
        changedProfileIds.push(targetProfileId);
      }
      if (
        result.coordinator.recoveryGate?.status ===
          "awaiting_occupancy_decision" ||
        result.coordinator.recoveryGate?.status === "continuation_pending" ||
        result.coordinator.recoveryGate?.status === "continuation_authorized"
      ) {
        continuationProfileIds.push(targetProfileId);
      }
    }
    return {
      changedProfileIds,
      continuationProfileIds,
      status: "updated" as const,
    };
  });
}

/**
 * What authorizing a continuation tells its caller.
 *
 * `interruptedExecution` is the Coordinator's own stop target for the work the
 * continuation replaces. It is internal control state, so the caller must act
 * on it and then answer the public RPC with the contract's fields alone; the
 * shared authorize response is a strict object that carries only `status`.
 */
export type RuntimeCoordinatorAgentProfileWorkContinuationAuthorization = {
  interruptedExecution?: {
    dispatchId: string;
    runtimeCoordinatorExecutionId: string;
  } | null;
  status: RuntimeTransportAgentProfileWorkContinuationAuthorizeResponse["status"];
};

export async function authorizeRuntimeCoordinatorAgentProfileWorkContinuation(input: {
  requesterProfileId?: string;
  continuationClientMessageId: string;
  currentAgentControllerRef: string;
  currentBindingId: string;
  currentConfigurationRevision: number;
  currentDefaultProjectId?: string | null;
  expectedInterruptedTargetWakeLifecycleId: string;
  forkInterruptedConversation?: boolean;
  requireAutomaticForkEligibility?: true;
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<RuntimeCoordinatorAgentProfileWorkContinuationAuthorization> {
  const storageKey = buildExecutionAdmissionStorageKey(input.targetProfileId);
  const readyIndex = await ensureExecutionIndexReady({
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    storage: input.storage,
  });
  if (readyIndex.status !== "ready") {
    return { status: "unavailable" };
  }
  return await input.storage.transaction(async (transaction) => {
    const index = parseExecutionIndexState(
      await transaction.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
    );
    if (
      index?.status !== "ready" ||
      index.generation !== readyIndex.generation ||
      index.ownerUserId !== input.ownerUserId
    ) {
      return { status: "unavailable" as const };
    }
    const rawAdmission = await transaction.get<unknown>(storageKey);
    const admission = parseExecutionAdmissionRecord(rawAdmission);
    if (
      !admission ||
      admission.targetProfileId !== input.targetProfileId ||
      admission.recoveryGate?.interruptedWork.targetWakeLifecycleId !==
        input.expectedInterruptedTargetWakeLifecycleId
    ) {
      return { status: "not_pending" as const };
    }
    if (
      admission.executionTargetMutation &&
      admission.executionTargetMutation.expiresAtMs > input.nowMs
    ) {
      return { status: "unavailable" as const };
    }
    if (admission.recoveryGate.status === "continuation_needs_attention") {
      return { status: "needs_attention" as const };
    }
    if (
      !(await canRequesterRecoverWork({
        ...input,
        admission,
        storage: transaction,
        fork: input.forkInterruptedConversation === true,
      }))
    ) {
      return { status: "not_pending" as const };
    }
    if (
      input.requireAutomaticForkEligibility &&
      !(await readAutomaticForkEligibility({
        gate: admission.recoveryGate,
        storage: transaction,
      }))
    ) {
      return { status: "not_pending" as const };
    }
    const acceptedExecutionTargetMatches =
      await acceptedRecoveryExecutionTargetMatchesCurrent({
        admission,
        currentAgentControllerRef: input.currentAgentControllerRef,
        currentBindingId: input.currentBindingId,
        currentConfigurationRevision: input.currentConfigurationRevision,
        currentDefaultProjectId: input.currentDefaultProjectId,
        ownerUserId: input.ownerUserId,
        storage: transaction,
      });
    if (!acceptedExecutionTargetMatches) {
      return await recordContinuationTargetMismatchNeedsAttention({
        admission,
        nowMs: input.nowMs,
        recoveryGate: admission.recoveryGate,
        storageKey,
        targetProfileId: input.targetProfileId,
        transaction,
      });
    }
    const result = authorizeAgentProfileWorkContinuation({
      continuationClientMessageId: input.continuationClientMessageId,
      coordinator: projectAgentProfileWorkCoordinator(admission),
      forkInterruptedConversation: input.forkInterruptedConversation,
      nowMs: input.nowMs,
    });
    if (!result.changed) {
      return { status: "not_pending" as const };
    }
    await transaction.put(storageKey, {
      ...admission,
      recoveryGate: result.coordinator.recoveryGate,
      revision: result.coordinator.revision,
      updatedAtMs: result.coordinator.updatedAtMs,
    } satisfies AgentProfileExecutionAdmissionRecord);
    await closeAgentProfileWorkOccupancyDecisionInboxItem({
      nowMs: input.nowMs,
      recoveryGate: admission.recoveryGate,
      storage: transaction,
      targetProfileId: input.targetProfileId,
    });
    const interruptedExecution =
      await readInterruptedExecutionFromHeadLifecycle({
        dispatchId: admission.recoveryGate.interruptedWork.dispatchId,
        targetWakeLifecycleId:
          admission.recoveryGate.interruptedWork.targetWakeLifecycleId,
        transaction,
      });
    return {
      interruptedExecution,
      status: "authorized" as const,
    };
  });
}

async function recordContinuationTargetMismatchNeedsAttention(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  nowMs: number;
  recoveryGate: AgentProfileWorkRecoveryGate;
  storageKey: string;
  targetProfileId: string;
  transaction: DurableObjectTransaction;
}): Promise<{ status: "needs_attention" | "not_pending" }> {
  const marked = markAgentProfileWorkContinuationNeedsAttention({
    coordinator: projectAgentProfileWorkCoordinator(input.admission),
    nowMs: input.nowMs,
  });
  if (!(marked.changed && marked.coordinator.recoveryGate)) {
    return { status: "not_pending" as const };
  }
  await Promise.all([
    input.transaction.put(input.storageKey, {
      ...input.admission,
      recoveryGate: marked.coordinator.recoveryGate,
      revision: marked.coordinator.revision,
      updatedAtMs: marked.coordinator.updatedAtMs,
    } satisfies AgentProfileExecutionAdmissionRecord),
    writeAgentProfileWorkRecoveryInboxProjectionIntent({
      intent: buildAgentProfileWorkRecoveryInboxProjectionIntent({
        desiredStatus: "open",
        occurredAtMs: input.nowMs,
        stage: "review_interrupted_work",
        supersededStages: resolveSupersededAgentProfileWorkRecoveryInboxStages(
          input.recoveryGate.status
        ),
        targetProfileId: input.targetProfileId,
        targetWakeLifecycleId:
          marked.coordinator.recoveryGate.interruptedWork.targetWakeLifecycleId,
        updatedAtMs: input.nowMs,
      }),
      storage: input.transaction,
    }),
    input.transaction.setAlarm(input.nowMs),
  ]);
  return { status: "needs_attention" as const };
}

async function readInterruptedExecutionFromHeadLifecycle(input: {
  dispatchId: string;
  targetWakeLifecycleId: string;
  transaction: DurableObjectTransaction;
}): Promise<{
  dispatchId: string;
  runtimeCoordinatorExecutionId: string;
} | null> {
  const head = await input.transaction.get<unknown>(
    buildRuntimeCoordinatorHeadLifecycleStorageKey(input.targetWakeLifecycleId)
  );
  return isRuntimeCoordinatorHeadLifecycleRecord(head) &&
    head.runtimeCoordinatorExecutionId
    ? {
        dispatchId: input.dispatchId,
        runtimeCoordinatorExecutionId: head.runtimeCoordinatorExecutionId,
      }
    : null;
}

async function acceptedRecoveryExecutionTargetMatchesCurrent(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  currentAgentControllerRef: string;
  currentBindingId: string;
  currentConfigurationRevision: number;
  currentDefaultProjectId?: string | null;
  ownerUserId: string;
  storage: Pick<DurableObjectStorage, "get">;
}): Promise<boolean> {
  const recoveryGate = input.admission.recoveryGate;
  if (!recoveryGate) {
    return false;
  }
  const head = await input.storage.get<unknown>(
    buildRuntimeCoordinatorHeadLifecycleStorageKey(
      recoveryGate.interruptedWork.targetWakeLifecycleId
    )
  );
  if (
    !isRuntimeCoordinatorHeadLifecycleRecord(head) ||
    head.targetWakeLifecycleId !==
      recoveryGate.interruptedWork.targetWakeLifecycleId ||
    head.ownerUserId !== input.ownerUserId ||
    head.primaryDispatchId !== recoveryGate.interruptedWork.dispatchId ||
    head.targetWakeLifecycleIdentity.targetProfileId !==
      input.admission.targetProfileId ||
    !head.runtimeCoordinatorExecutionId
  ) {
    return false;
  }
  const commandState = await input.storage.get<unknown>(
    buildRuntimeCoordinatorRunCommandStateStorageKey(
      head.runtimeCoordinatorExecutionId
    )
  );
  if (
    !isRuntimeCoordinatorRunCommandState(commandState) ||
    commandState.runtimeCoordinatorExecutionId !==
      head.runtimeCoordinatorExecutionId ||
    commandState.dispatchId !== recoveryGate.interruptedWork.dispatchId ||
    commandState.ownerUserId !== input.ownerUserId ||
    commandState.profileId !== input.admission.targetProfileId
  ) {
    return false;
  }
  const payload = commandState.sanitizedDeliveryRequest.payload;
  const acceptedExecutionIdentity = payload.executionIdentity.core;
  const acceptedControllerSnapshot = payload.controllerSnapshot;
  return (
    input.currentDefaultProjectId !== undefined &&
    (payload.defaultProjectId ?? null) === input.currentDefaultProjectId &&
    acceptedExecutionIdentity.bindingId === input.currentBindingId &&
    acceptedExecutionIdentity.agentControllerRef ===
      input.currentAgentControllerRef &&
    acceptedControllerSnapshot.bindingId === input.currentBindingId &&
    acceptedControllerSnapshot.agentControllerRef ===
      input.currentAgentControllerRef &&
    acceptedControllerSnapshot.configurationRevision ===
      input.currentConfigurationRevision
  );
}

/**
 * Verifies that both sides of a handoff are work this owner really has on this
 * Profile, then moves the occupied reservation to the successor in place.
 *
 * The head lifecycle records are the authorization boundary: a caller can only
 * name a successor whose Wake already exists under the same owner, Profile and
 * dispatch, so this entry point can never mint a reservation for foreign work.
 * `activeHeadLifecycleIds` is deliberately untouched — it follows head
 * lifecycle status transitions, not coordinator membership, and the successor's
 * own lifecycle write is what admits it there.
 */
export async function handOffRuntimeCoordinatorOccupiedAgentProfileWork(input: {
  nowMs: number;
  ownerUserId: string;
  sourceDispatchId: string;
  sourceTargetWakeLifecycleId: string;
  storage: ExecutionAdmissionStorage;
  successorDispatchId: string;
  successorExecutionContextId?: string;
  successorTargetWakeLifecycleId: string;
  targetProfileId: string;
}): Promise<{ status: AgentProfileWorkHandoffStatus | "unavailable" }> {
  const storageKey = buildExecutionAdmissionStorageKey(input.targetProfileId);
  const readyIndex = await ensureExecutionIndexReady({
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    storage: input.storage,
  });
  if (readyIndex.status !== "ready") {
    return { status: "unavailable" };
  }
  return await input.storage.transaction(async (transaction) => {
    const index = parseExecutionIndexState(
      await transaction.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
    );
    if (
      index?.status !== "ready" ||
      index.generation !== readyIndex.generation ||
      index.ownerUserId !== input.ownerUserId
    ) {
      return { status: "unavailable" as const };
    }
    const admission = parseExecutionAdmissionRecord(
      await transaction.get<unknown>(storageKey)
    );
    if (!admission || admission.targetProfileId !== input.targetProfileId) {
      return { status: "source_not_occupied" as const };
    }
    if (
      !(await handoffHeadLifecycleMatches({
        dispatchId: input.successorDispatchId,
        ownerUserId: input.ownerUserId,
        targetProfileId: input.targetProfileId,
        targetWakeLifecycleId: input.successorTargetWakeLifecycleId,
        transaction,
      }))
    ) {
      // An unverifiable successor cannot take the slot, which is the same
      // outcome the pure transition reports for a successor it must refuse.
      return { status: "successor_conflict" as const };
    }
    const source = admission.workItems.find(
      (item) => item.targetWakeLifecycleId === input.sourceTargetWakeLifecycleId
    );
    if (
      source &&
      !(await handoffHeadLifecycleMatches({
        dispatchId: input.sourceDispatchId,
        ownerUserId: input.ownerUserId,
        targetProfileId: input.targetProfileId,
        targetWakeLifecycleId: input.sourceTargetWakeLifecycleId,
        transaction,
      }))
    ) {
      return { status: "source_not_occupied" as const };
    }
    const handoff = handOffOccupiedAgentProfileWork({
      coordinator: projectAgentProfileWorkCoordinator(admission),
      nowMs: input.nowMs,
      sourceTargetWakeLifecycleId: input.sourceTargetWakeLifecycleId,
      successor: {
        dispatchId: input.successorDispatchId,
        // The successor continues the same queue entry, so it inherits the
        // source's enqueue time rather than moving to the back of the line.
        enqueuedAtMs: source?.enqueuedAtMs ?? input.nowMs,
        targetWakeLifecycleId: input.successorTargetWakeLifecycleId,
        ...(input.successorExecutionContextId === undefined
          ? {}
          : { executionContextId: input.successorExecutionContextId }),
      },
    });
    if (handoff.status !== "handed_off") {
      return { status: handoff.status };
    }
    await transaction.put(storageKey, {
      ...admission,
      revision: handoff.coordinator.revision,
      updatedAtMs: handoff.coordinator.updatedAtMs,
      workItems: handoff.coordinator.workItems,
    } satisfies AgentProfileExecutionAdmissionRecord);
    return { status: handoff.status };
  });
}

async function handoffHeadLifecycleMatches(input: {
  dispatchId: string;
  ownerUserId: string;
  targetProfileId: string;
  targetWakeLifecycleId: string;
  transaction: Pick<DurableObjectTransaction, "get">;
}): Promise<boolean> {
  const head = await input.transaction.get<unknown>(
    buildRuntimeCoordinatorHeadLifecycleStorageKey(input.targetWakeLifecycleId)
  );
  return (
    isRuntimeCoordinatorHeadLifecycleRecord(head) &&
    head.targetWakeLifecycleId === input.targetWakeLifecycleId &&
    head.ownerUserId === input.ownerUserId &&
    head.primaryDispatchId === input.dispatchId &&
    head.targetWakeLifecycleIdentity.targetProfileId === input.targetProfileId
  );
}

export async function markRuntimeCoordinatorAgentProfileWorkContinuationNeedsAttention(input: {
  expectedInterruptedTargetWakeLifecycleId: string;
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<{ status: "marked" | "not_pending" | "unavailable" }> {
  const storageKey = buildExecutionAdmissionStorageKey(input.targetProfileId);
  const readyIndex = await ensureExecutionIndexReady({
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    storage: input.storage,
  });
  if (readyIndex.status !== "ready") {
    return { status: "unavailable" };
  }
  return await input.storage.transaction(async (transaction) => {
    const index = parseExecutionIndexState(
      await transaction.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
    );
    if (
      index?.status !== "ready" ||
      index.generation !== readyIndex.generation ||
      index.ownerUserId !== input.ownerUserId
    ) {
      return { status: "unavailable" as const };
    }
    const admission = parseExecutionAdmissionRecord(
      await transaction.get<unknown>(storageKey)
    );
    if (
      !admission ||
      admission.targetProfileId !== input.targetProfileId ||
      admission.recoveryGate?.interruptedWork.targetWakeLifecycleId !==
        input.expectedInterruptedTargetWakeLifecycleId
    ) {
      return { status: "not_pending" as const };
    }
    const marked = markAgentProfileWorkContinuationNeedsAttention({
      coordinator: projectAgentProfileWorkCoordinator(admission),
      nowMs: input.nowMs,
    });
    if (!(marked.changed && marked.coordinator.recoveryGate)) {
      return { status: "not_pending" as const };
    }
    await Promise.all([
      transaction.put(storageKey, {
        ...admission,
        recoveryGate: marked.coordinator.recoveryGate,
        revision: marked.coordinator.revision,
        updatedAtMs: marked.coordinator.updatedAtMs,
      } satisfies AgentProfileExecutionAdmissionRecord),
      writeAgentProfileWorkRecoveryInboxProjectionIntent({
        intent: buildAgentProfileWorkRecoveryInboxProjectionIntent({
          desiredStatus: "open",
          occurredAtMs: input.nowMs,
          stage: "review_interrupted_work",
          supersededStages:
            resolveSupersededAgentProfileWorkRecoveryInboxStages(
              admission.recoveryGate.status
            ),
          targetProfileId: input.targetProfileId,
          targetWakeLifecycleId:
            marked.coordinator.recoveryGate.interruptedWork
              .targetWakeLifecycleId,
          updatedAtMs: input.nowMs,
        }),
        storage: transaction,
      }),
      transaction.setAlarm(input.nowMs),
    ]);
    return { status: "marked" as const };
  });
}

export async function approveRuntimeCoordinatorAgentProfileWorkQueue(input: {
  expectedInterruptedTargetWakeLifecycleId: string;
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<{
  pendingPromotion: PendingAgentProfileWorkPromotion | null;
  status: "approved" | "not_pending" | "unavailable";
}> {
  const storageKey = buildExecutionAdmissionStorageKey(input.targetProfileId);
  const readyIndex = await ensureExecutionIndexReady({
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    storage: input.storage,
  });
  if (readyIndex.status !== "ready") {
    return { pendingPromotion: null, status: "unavailable" };
  }
  return await input.storage.transaction(async (transaction) => {
    const index = parseExecutionIndexState(
      await transaction.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
    );
    if (
      index?.status !== "ready" ||
      index.generation !== readyIndex.generation ||
      index.ownerUserId !== input.ownerUserId
    ) {
      return { pendingPromotion: null, status: "unavailable" as const };
    }
    const admission = parseExecutionAdmissionRecord(
      await transaction.get<unknown>(storageKey)
    );
    if (!admission || admission.targetProfileId !== input.targetProfileId) {
      return { pendingPromotion: null, status: "not_pending" as const };
    }
    if (
      admission.recoveryGate?.status !== "awaiting_owner_approval" ||
      admission.recoveryGate.interruptedWork.targetWakeLifecycleId !==
        input.expectedInterruptedTargetWakeLifecycleId
    ) {
      return { pendingPromotion: null, status: "not_pending" as const };
    }
    const approvedRecoveryGate = admission.recoveryGate;
    const approval = approveAgentProfileWorkQueue({
      coordinator: projectAgentProfileWorkCoordinator(admission),
      nowMs: input.nowMs,
    });
    let nextAdmission = {
      ...admission,
      recoveryGate: approval.coordinator.recoveryGate,
      revision: approval.coordinator.revision,
      updatedAtMs: approval.coordinator.updatedAtMs,
      workItems: approval.coordinator.workItems,
    } satisfies AgentProfileExecutionAdmissionRecord;
    let pendingPromotion: PendingAgentProfileWorkPromotion | null = null;
    for (const item of approval.promotedItems) {
      const promotion = await promoteAgentProfileWorkItem({
        admission: nextAdmission,
        item,
        nowMs: input.nowMs,
        transaction,
      });
      nextAdmission = promotion.admission;
      pendingPromotion ??= promotion.pendingPromotion;
    }
    const activeProfileIndex = resolveActiveProfileIndexForWrite({
      generation: index.generation,
      indexReady: true,
      raw: await transaction.get<unknown>(
        EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY
      ),
    });
    if (!activeProfileIndex) {
      throw new Error("runtime_coordinator.active_profile_index_invalid");
    }
    await Promise.all([
      transaction.put(storageKey, nextAdmission),
      transaction.put(
        EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY,
        createActiveProfileIndexRecord(
          index.generation,
          updateActiveProfileIds({
            active: admissionHasActiveReferences(nextAdmission),
            activeProfileIds: activeProfileIndex.targetProfileIds,
            targetProfileId: input.targetProfileId,
          })
        )
      ),
      writeAgentProfileWorkRecoveryInboxProjectionIntent({
        intent: buildAgentProfileWorkRecoveryInboxProjectionIntent({
          desiredStatus: "resolved",
          occurredAtMs: approvedRecoveryGate.updatedAtMs,
          stage: "approve_queued_work",
          targetProfileId: input.targetProfileId,
          targetWakeLifecycleId:
            approvedRecoveryGate.interruptedWork.targetWakeLifecycleId,
          updatedAtMs: input.nowMs,
        }),
        storage: transaction,
      }),
      transaction.setAlarm(input.nowMs),
    ]);
    return { pendingPromotion, status: "approved" as const };
  });
}

export async function skipRuntimeCoordinatorAgentProfileInterruptedWork(input: {
  requesterProfileId?: string;
  expectedInterruptedTargetWakeLifecycleId: string;
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<{
  pendingPromotion: PendingAgentProfileWorkPromotion | null;
  status: "skipped" | "not_pending" | "unavailable";
}> {
  const storageKey = buildExecutionAdmissionStorageKey(input.targetProfileId);
  const readyIndex = await ensureExecutionIndexReady({
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    storage: input.storage,
  });
  if (readyIndex.status !== "ready") {
    return { pendingPromotion: null, status: "unavailable" };
  }
  return await input.storage.transaction(async (transaction) => {
    const index = parseExecutionIndexState(
      await transaction.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
    );
    if (
      index?.status !== "ready" ||
      index.generation !== readyIndex.generation ||
      index.ownerUserId !== input.ownerUserId
    ) {
      return { pendingPromotion: null, status: "unavailable" as const };
    }
    const admission = parseExecutionAdmissionRecord(
      await transaction.get<unknown>(storageKey)
    );
    const gate = admission?.recoveryGate;
    const interruptedHead =
      gate?.status === "continuation_authorized" &&
      gate.forkInterruptedConversation
        ? await transaction.get<unknown>(
            buildRuntimeCoordinatorHeadLifecycleStorageKey(
              gate.interruptedWork.targetWakeLifecycleId
            )
          )
        : null;
    const unavailableLegacyFork =
      isRuntimeCoordinatorHeadLifecycleRecord(interruptedHead) &&
      interruptedHead.ownerUserId === input.ownerUserId &&
      interruptedHead.targetWakeLifecycleIdentity.targetProfileId ===
        input.targetProfileId &&
      !interruptedHead.acceptedDispatchSnapshot?.executionContext;
    if (
      !admission ||
      admission.targetProfileId !== input.targetProfileId ||
      !admission.recoveryGate ||
      !(
        admission.recoveryGate?.status === "continuation_needs_attention" ||
        admission.recoveryGate?.status === "awaiting_occupancy_decision" ||
        unavailableLegacyFork
      ) ||
      admission.recoveryGate.interruptedWork.targetWakeLifecycleId !==
        input.expectedInterruptedTargetWakeLifecycleId
    ) {
      return { pendingPromotion: null, status: "not_pending" as const };
    }
    const skippedRecoveryGate = admission.recoveryGate;
    if (
      !(await canRequesterRecoverWork({
        ...input,
        admission,
        storage: transaction,
      }))
    ) {
      return { pendingPromotion: null, status: "not_pending" as const };
    }
    const coordinator = projectAgentProfileWorkCoordinator(admission);
    const skipped = skipAgentProfileInterruptedWork({
      coordinator: unavailableLegacyFork
        ? markAgentProfileWorkContinuationNeedsAttention({
            coordinator,
            nowMs: input.nowMs,
          }).coordinator
        : coordinator,
      nowMs: input.nowMs,
    });
    let nextAdmission = {
      ...admission,
      recoveryGate: skipped.coordinator.recoveryGate,
      revision: skipped.coordinator.revision,
      updatedAtMs: skipped.coordinator.updatedAtMs,
      workItems: skipped.coordinator.workItems,
    } satisfies AgentProfileExecutionAdmissionRecord;
    let pendingPromotion: PendingAgentProfileWorkPromotion | null = null;
    for (const item of skipped.promotedItems) {
      const promotion = await promoteAgentProfileWorkItem({
        admission: nextAdmission,
        item,
        nowMs: input.nowMs,
        transaction,
      });
      nextAdmission = promotion.admission;
      pendingPromotion ??= promotion.pendingPromotion;
    }
    const activeProfileIndex = resolveActiveProfileIndexForWrite({
      generation: index.generation,
      indexReady: true,
      raw: await transaction.get<unknown>(
        EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY
      ),
    });
    if (!activeProfileIndex) {
      throw new Error("runtime_coordinator.active_profile_index_invalid");
    }
    await Promise.all([
      transaction.put(storageKey, nextAdmission),
      transaction.put(
        EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY,
        createActiveProfileIndexRecord(
          index.generation,
          updateActiveProfileIds({
            active: admissionHasActiveReferences(nextAdmission),
            activeProfileIds: activeProfileIndex.targetProfileIds,
            targetProfileId: input.targetProfileId,
          })
        )
      ),
      writeAgentProfileWorkRecoveryInboxProjectionIntent({
        intent: buildAgentProfileWorkRecoveryInboxProjectionIntent({
          desiredStatus: "resolved",
          occurredAtMs: skippedRecoveryGate.updatedAtMs,
          // The source key digests the stage, so the resolve has to name the
          // stage the open item was written under or it leaves it open.
          stage: resolveAgentProfileWorkRecoveryInboxStage(
            skippedRecoveryGate.status
          ),
          targetProfileId: input.targetProfileId,
          targetWakeLifecycleId:
            skippedRecoveryGate.interruptedWork.targetWakeLifecycleId,
          updatedAtMs: input.nowMs,
        }),
        storage: transaction,
      }),
      transaction.setAlarm(input.nowMs),
    ]);
    return { pendingPromotion, status: "skipped" as const };
  });
}

export async function writeRuntimeCoordinatorHeadLifecycleWithAdmission(input: {
  resolveContextMigrationCapability?: (
    record: RuntimeCoordinatorHeadLifecycleRecord
  ) => string | null;
  blockForExecutionTargetMutation: boolean;
  nowMs: number;
  record: RuntimeCoordinatorHeadLifecycleRecord;
  storage: ExecutionAdmissionStorage;
}): Promise<AgentProfileWorkCoordinatorHeadWriteResult> {
  return await input.storage.transaction((transaction) =>
    writeRuntimeCoordinatorHeadLifecycleWithAdmissionInTransaction({
      ...input,
      transaction,
    })
  );
}

function rejectsNewLegacyAdmission(input: {
  isNewAdmission: boolean;
  contextModeActive: boolean;
  admission: AgentProfileExecutionAdmissionRecord;
  record: RuntimeCoordinatorHeadLifecycleRecord;
}): boolean {
  const snapshot = input.record.acceptedDispatchSnapshot;
  // A harness without Execution Context support keeps ordinary serial Binding
  // work, even after an earlier harness of this Profile activated Contexts.
  const harnessRunsOnlyLegacyWork = Boolean(
    snapshot &&
      !supportsExecutionContextSelection(
        snapshot.controllerSnapshot.agentControllerRef
      )
  );
  return Boolean(
    input.isNewAdmission &&
      input.contextModeActive &&
      !harnessRunsOnlyLegacyWork &&
      !snapshot?.executionContext &&
      input.admission.recoveryGate?.continuationClientMessageId !==
        input.record.targetWakeLifecycleIdentity.clientMessageId
  );
}

async function beginContextMigrationForAcceptedWork(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  isNewAdmission: boolean;
  record: RuntimeCoordinatorHeadLifecycleRecord;
  nowMs: number;
  transaction: DurableObjectTransaction;
}): Promise<AgentProfileExecutionAdmissionRecord> {
  if (
    !(
      input.isNewAdmission &&
      input.record.acceptedDispatchSnapshot?.executionContext
    ) ||
    input.admission.contextMigration
  ) {
    return input.admission;
  }
  return {
    ...input.admission,
    contextMigration: {
      status: "draining",
      boundaryAtMs: input.nowMs,
      legacyWakeIds: await freezeLegacyWakeIds(
        input.admission,
        input.transaction
      ),
      legacyAssociation: null,
    },
  };
}

function resolveContextMigrationAdmission(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  contextModeActive: boolean;
  isNewAdmission: boolean;
  plan: Awaited<ReturnType<typeof prepareExecutionContextAssignment>>;
  record: RuntimeCoordinatorHeadLifecycleRecord;
  resolveCapability?: (
    record: RuntimeCoordinatorHeadLifecycleRecord
  ) => string | null;
}): {
  plan: Awaited<ReturnType<typeof prepareExecutionContextAssignment>>;
  reasonCode: string | null;
} {
  if (
    !input.isNewAdmission ||
    input.admission.contextMigration ||
    !input.plan.record.acceptedDispatchSnapshot?.executionContext
  ) {
    return { plan: input.plan, reasonCode: null };
  }
  const reasonCode = input.resolveCapability
    ? input.resolveCapability(input.plan.record)
    : "execution_context.service_capability_unavailable";
  const request = input.record.acceptedDispatchSnapshot?.contextRequest;
  if (
    reasonCode === "service.update_required" &&
    !input.contextModeActive &&
    request?.required === false &&
    request.selection.mode === "auto"
  ) {
    return { plan: { record: input.record, writes: {} }, reasonCode: null };
  }
  return { plan: input.plan, reasonCode };
}

function collectOutstandingExecutionContextIds(
  admission: AgentProfileExecutionAdmissionRecord
): Set<string> {
  const gate = admission.recoveryGate;
  return new Set(
    [
      ...admission.workItems,
      ...(gate ? [gate.interruptedWork] : []),
      ...(gate?.additionalInterruptedWork ?? []),
    ].flatMap((item) =>
      item.executionContextId ? [item.executionContextId] : []
    )
  );
}

function shouldStartIndependentClaudeContext(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  record: RuntimeCoordinatorHeadLifecycleRecord;
}): boolean {
  return (
    (input.admission.admissionMode ?? "parallel") === "parallel" &&
    input.record.acceptedDispatchSnapshot?.controllerSnapshot
      .agentControllerRef === "builtin:claude-code"
  );
}

async function writeRuntimeCoordinatorHeadLifecycleWithAdmissionInTransaction(input: {
  resolveContextMigrationCapability?: (
    record: RuntimeCoordinatorHeadLifecycleRecord
  ) => string | null;
  blockForExecutionTargetMutation: boolean;
  nowMs: number;
  record: RuntimeCoordinatorHeadLifecycleRecord;
  transaction: DurableObjectTransaction;
}): Promise<AgentProfileWorkCoordinatorHeadWriteResult> {
  const prepared = await prepareHeadLifecycleAdmissionWrite({
    nowMs: input.nowMs,
    record: input.record,
    transaction: input.transaction,
  });
  const { admission } = prepared;
  const headLifecycleStorageKey =
    buildRuntimeCoordinatorHeadLifecycleStorageKey(
      input.record.targetWakeLifecycleId
    );
  const existingResult = await resolveExistingHeadLifecycleWrite({
    admission,
    blockForExecutionTargetMutation: input.blockForExecutionTargetMutation,
    headLifecycleStorageKey,
    nowMs: input.nowMs,
    proposedRecord: input.record,
    transaction: input.transaction,
  });
  if (existingResult) {
    return existingResult;
  }
  if (
    input.blockForExecutionTargetMutation &&
    admission.executionTargetMutation &&
    admission.executionTargetMutation.expiresAtMs > input.nowMs
  ) {
    return { status: "execution_target_mutation_in_progress" as const };
  }

  const continuationFence = resolveContinuationHeadFence({
    admission,
    record: input.record,
  });
  if (continuationFence) {
    return continuationFence;
  }

  let contextPlan: Awaited<
    ReturnType<typeof prepareExecutionContextAssignment>
  >;
  const contextModeActive =
    admission.contextMigration !== undefined ||
    (await hasRetainedExecutionContexts({
      targetProfileId: admission.targetProfileId,
      storage: input.transaction,
    }));
  try {
    contextPlan = await prepareExecutionContextAssignment({
      contextModeActive,
      outstandingExecutionContextIds:
        collectOutstandingExecutionContextIds(admission),
      startIndependentClaudeContext: shouldStartIndependentClaudeContext({
        admission,
        record: input.record,
      }),
      legacyAssociation:
        admission.contextMigration?.legacyAssociation ?? undefined,
      authorizedContinuationSourceWakeId:
        admission.recoveryGate?.status === "continuation_authorized" &&
        !admission.recoveryGate.forkInterruptedConversation &&
        admission.recoveryGate.continuationClientMessageId ===
          input.record.targetWakeLifecycleIdentity.clientMessageId
          ? admission.recoveryGate.interruptedWork.targetWakeLifecycleId
          : undefined,
      record: input.record,
      storage: input.transaction,
    });
  } catch (error) {
    if (error instanceof ExecutionContextSelectionError) {
      return { status: "context_rejected", reasonCode: error.reasonCode };
    }
    throw error;
  }
  if (
    rejectsNewLegacyAdmission({
      isNewAdmission: input.blockForExecutionTargetMutation,
      contextModeActive,
      admission,
      record: contextPlan.record,
    })
  ) {
    return {
      status: "context_rejected",
      reasonCode: "execution_context.legacy_acceptance_closed",
    };
  }
  const capabilityAdmission = resolveContextMigrationAdmission({
    admission,
    contextModeActive,
    isNewAdmission: input.blockForExecutionTargetMutation,
    plan: contextPlan,
    record: input.record,
    resolveCapability: input.resolveContextMigrationCapability,
  });
  if (capabilityAdmission.reasonCode) {
    return {
      status: "context_rejected",
      reasonCode: capabilityAdmission.reasonCode,
    };
  }
  contextPlan = capabilityAdmission.plan;
  // A new Wake must never be queued behind work whose Wake is already gone or
  // settled, so admission reconciles the queue before it takes a position.
  const reconciliation = await resolveAgentProfileWorkReconciliation({
    admission,
    isNewAdmission: input.blockForExecutionTargetMutation,
    nowMs: input.nowMs,
    transaction: input.transaction,
  });
  const contextAdmission = await beginContextMigrationForAcceptedWork({
    admission: reconciliation.admission,
    isNewAdmission: input.blockForExecutionTargetMutation,
    record: contextPlan.record,
    nowMs: input.nowMs,
    transaction: input.transaction,
  });
  const workPlan = planAgentProfileWorkAcceptance({
    admission: contextAdmission,
    blockForExecutionTargetMutation: input.blockForExecutionTargetMutation,
    nowMs: input.nowMs,
    proposedRecord: contextPlan.record,
  });
  if ("result" in workPlan) {
    return workPlan.result;
  }
  const { admissionWithWork, effectiveRecord, workAcceptance } = workPlan;
  if (Object.keys(contextPlan.writes).length > 0) {
    await input.transaction.put(contextPlan.writes);
  }
  if (contextAdmission.contextMigration?.status === "draining") {
    await input.transaction.setAlarm(input.nowMs);
  }

  const reconciledPromotions =
    await applyAgentProfileWorkReconciliationPromotions({
      admission: admissionWithWork,
      nowMs: input.nowMs,
      promotedItems: reconciliation.promotedItems,
      transaction: input.transaction,
    });

  const currentMutation =
    reconciledPromotions.admission.executionTargetMutation;
  const admissionAfterHeadWrite = applyHeadLifecycleToAdmission({
    admission: {
      ...reconciledPromotions.admission,
      executionTargetMutation:
        currentMutation && currentMutation.expiresAtMs > input.nowMs
          ? currentMutation
          : null,
    },
    nowMs: input.nowMs,
    record: effectiveRecord,
  });
  const terminalTransition = await resolveHeadTerminalWorkTransition({
    admission: admissionAfterHeadWrite,
    nowMs: input.nowMs,
    record: effectiveRecord,
    transaction: input.transaction,
  });
  await persistHeadLifecycleAdmissionTransition({
    admissionAfterHeadWrite,
    effectiveRecord,
    headLifecycleStorageKey,
    nextAdmission: terminalTransition.admission,
    nowMs: input.nowMs,
    preparation: prepared,
    transaction: input.transaction,
  });
  return resolveHeadLifecycleAdmissionWriteResult({
    effectiveRecord,
    pendingPromotion:
      terminalTransition.pendingPromotion ??
      reconciledPromotions.pendingPromotion,
    workAcceptance,
  });
}

function resolveHeadLifecycleAdmissionWriteResult(input: {
  effectiveRecord: RuntimeCoordinatorHeadLifecycleRecord;
  pendingPromotion: PendingAgentProfileWorkPromotion | null;
  workAcceptance:
    | {
        queuePosition: number;
        status: "queued" | "started";
        waitingCount: number;
      }
    | undefined;
}): AgentProfileWorkCoordinatorHeadWriteResult {
  const result: AgentProfileWorkCoordinatorHeadWriteBaseResult =
    input.workAcceptance
      ? { effectiveRecord: input.effectiveRecord, ...input.workAcceptance }
      : { effectiveRecord: input.effectiveRecord, status: "written" as const };
  return input.pendingPromotion
    ? { ...result, pendingPromotion: input.pendingPromotion }
    : result;
}

const parseOptionalAcceptedDispatchPayloadFingerprintRecord = (
  value: unknown
): RuntimeCoordinatorAcceptedDispatchPayloadFingerprintRecord | null => {
  if (value === undefined) {
    return null;
  }
  if (!isRuntimeCoordinatorAcceptedDispatchPayloadFingerprintRecord(value)) {
    throw new Error(
      "runtime_coordinator.accepted_dispatch_payload_fingerprint_invalid"
    );
  }
  return value;
};

const acceptedDispatchPayloadFingerprintMatchesHead = (input: {
  executionId: string;
  head: RuntimeCoordinatorHeadLifecycleRecord;
  record: RuntimeCoordinatorAcceptedDispatchPayloadFingerprintRecord | null;
}): boolean =>
  input.record === null ||
  (input.record.runtimeCoordinatorExecutionId === input.executionId &&
    input.head.acceptedDispatchSnapshot !== undefined &&
    input.record.acceptedDispatchPayloadFingerprint ===
      input.head.acceptedDispatchSnapshot.payloadFingerprint);

const writeAcceptedDispatchPayloadFingerprintInTransaction = (input: {
  executionId: string;
  head: RuntimeCoordinatorHeadLifecycleRecord;
  storageKey: string;
  transaction: Pick<DurableObjectTransaction, "put">;
}): Promise<unknown> =>
  input.head.acceptedDispatchSnapshot
    ? input.transaction.put(input.storageKey, {
        acceptedDispatchPayloadFingerprint:
          input.head.acceptedDispatchSnapshot.payloadFingerprint,
        modelVersion:
          RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_FINGERPRINT_MODEL_VERSION,
        runtimeCoordinatorExecutionId: input.executionId,
      } satisfies RuntimeCoordinatorAcceptedDispatchPayloadFingerprintRecord)
    : Promise.resolve();

export async function prepareRuntimeCoordinatorAcceptedDeliveryWithAdmission(input: {
  alarmAtMs: number;
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  commandState: RuntimeCoordinatorRunCommandState;
  nowMs: number;
  storage: ExecutionAdmissionStorage;
  targetWakeLifecycleId: string;
}): Promise<
  | { ok: true }
  | {
      ok: false;
      reasonCode:
        | "runtime_coordinator.head_execution_link_mismatch"
        | "runtime_coordinator.head_lifecycle_not_found"
        | "runtime_coordinator.head_link_scope_mismatch"
        | "runtime_coordinator.head_publication_intent_already_ready"
        | "runtime_coordinator.pre_agent_stop_requested"
        | "wake.device_wait.expired";
    }
> {
  return await input.storage.transaction(async (transaction) => {
    const executionId = input.authority.runtimeCoordinatorExecutionId;
    const headLifecycleStorageKey =
      buildRuntimeCoordinatorHeadLifecycleStorageKey(
        input.targetWakeLifecycleId
      );
    const runCommandStateStorageKey =
      buildRuntimeCoordinatorRunCommandStateStorageKey(executionId);
    const tokenAuthorityStorageKey =
      buildRuntimeCoordinatorTokenAuthorityStorageKey(executionId);
    const acceptedPayloadFingerprintStorageKey =
      buildRuntimeCoordinatorAcceptedDispatchPayloadFingerprintStorageKey(
        executionId
      );
    const [
      rawHead,
      rawExistingCommandState,
      rawExistingAuthority,
      rawAcceptedPayloadFingerprint,
    ] = await Promise.all([
      transaction.get<unknown>(headLifecycleStorageKey),
      transaction.get<unknown>(runCommandStateStorageKey),
      transaction.get<unknown>(tokenAuthorityStorageKey),
      transaction.get<unknown>(acceptedPayloadFingerprintStorageKey),
    ]);
    if (rawHead === undefined) {
      return {
        ok: false,
        reasonCode: "runtime_coordinator.head_lifecycle_not_found" as const,
      };
    }
    if (!isRuntimeCoordinatorHeadLifecycleRecord(rawHead)) {
      throw new Error("runtime_coordinator.head_lifecycle_record_invalid");
    }
    const existingAcceptedPayloadFingerprint =
      parseOptionalAcceptedDispatchPayloadFingerprintRecord(
        rawAcceptedPayloadFingerprint
      );

    const targetProfileId = input.authority.executionScope.targetProfileId;
    const deliveryRequest = input.commandState.sanitizedDeliveryRequest;
    const deliveryPayload = deliveryRequest.payload;
    const deliveryIdentity = deliveryPayload.executionIdentity.core;
    const expectedExecutionId = buildRuntimeCoordinatorExecutionId({
      dispatchId: rawHead.primaryDispatchId,
      spaceId: rawHead.targetWakeLifecycleIdentity.spaceId,
      targetProfileId: rawHead.targetWakeLifecycleIdentity.targetProfileId,
    });
    if (
      rawHead.primaryDispatchId !== input.authority.executionScope.dispatchId ||
      rawHead.ownerUserId !== input.commandState.ownerUserId ||
      rawHead.ownerUserId !== deliveryRequest.ownerUserId ||
      rawHead.targetWakeLifecycleId !== input.targetWakeLifecycleId ||
      rawHead.targetWakeLifecycleIdentity.spaceId !==
        input.authority.executionScope.spaceId ||
      rawHead.targetWakeLifecycleIdentity.targetProfileId !== targetProfileId ||
      executionId !== expectedExecutionId ||
      input.authority.executionScope.runtimeCoordinatorExecutionId !==
        executionId ||
      input.authority.executionScope.sourceClientMessageId !==
        input.commandState.sourceClientMessageId ||
      input.commandState.dispatchId !==
        input.authority.executionScope.dispatchId ||
      input.commandState.dispatchId !== deliveryRequest.dispatchId ||
      deliveryRequest.dispatchId !== deliveryPayload.dispatchId ||
      input.commandState.attemptId !== deliveryRequest.attemptId ||
      deliveryRequest.attemptId !== deliveryPayload.attemptId ||
      input.commandState.profileId !== targetProfileId ||
      deliveryRequest.profileId !== targetProfileId ||
      input.commandState.runtimeCoordinatorExecutionId !== executionId ||
      deliveryPayload.runtimeCoordinatorExecutionId !== executionId ||
      input.commandState.targetProfileId !== targetProfileId ||
      deliveryPayload.targetProfileId !== targetProfileId ||
      deliveryPayload.spaceId !== input.authority.executionScope.spaceId ||
      (deliveryPayload.sourceClientMessageId ?? null) !==
        input.authority.executionScope.sourceClientMessageId ||
      deliveryIdentity.dispatchId !==
        input.authority.executionScope.dispatchId ||
      deliveryIdentity.spaceId !== input.authority.executionScope.spaceId ||
      deliveryIdentity.targetProfileId !== targetProfileId ||
      input.commandState.lastDeliveryProvenance.daemonSessionId !==
        deliveryRequest.daemonSessionId ||
      input.commandState.lastDeliveryProvenance.connectionGeneration !==
        deliveryRequest.connectionGeneration ||
      input.commandState.lastDeliveryProvenance.leaseEpoch !==
        deliveryRequest.leaseEpoch ||
      !acceptedDispatchPayloadFingerprintMatchesHead({
        executionId,
        head: rawHead,
        record: existingAcceptedPayloadFingerprint,
      })
    ) {
      return {
        ok: false,
        reasonCode: "runtime_coordinator.head_link_scope_mismatch" as const,
      };
    }
    if (
      !rawHead.runtimeCoordinatorExecutionId &&
      rawHead.executionLinkedAtMs === null &&
      rawExistingAuthority === undefined &&
      rawExistingCommandState === undefined &&
      rawHead.acceptedDispatchSnapshot?.deviceWait &&
      rawHead.acceptedDispatchSnapshot.deviceWait.deadlineAtMs <= input.nowMs
    ) {
      return { ok: false, reasonCode: "wake.device_wait.expired" as const };
    }

    const deliveryFence =
      resolveRuntimeCoordinatorAcceptedDeliveryHeadFence({
        executionId,
        head: rawHead,
      }) ??
      resolveRuntimeCoordinatorAcceptedDeliveryExistingStateFence({
        authority: input.authority,
        rawExistingAuthority,
        rawExistingCommandState,
      });
    if (deliveryFence) {
      return {
        ok: false,
        reasonCode: deliveryFence,
      };
    }

    const linkedHead = {
      ...rawHead,
      executionLinkedAtMs: rawHead.executionLinkedAtMs ?? input.nowMs,
      runtimeCoordinatorExecutionId: executionId,
      status: "execution_linked",
      updatedAtMs: input.nowMs,
      waitingBoundary: undefined,
    } satisfies RuntimeCoordinatorHeadLifecycleRecord;
    const headWrite =
      await writeRuntimeCoordinatorHeadLifecycleWithAdmissionInTransaction({
        blockForExecutionTargetMutation: false,
        nowMs: input.nowMs,
        record: linkedHead,
        transaction,
      });
    if (!("effectiveRecord" in headWrite)) {
      throw new Error("runtime_coordinator.head_execution_link_unavailable");
    }

    const rawRunCommandStateIndex = await transaction.get<unknown>(
      RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY
    );
    const runCommandStateIds = Array.isArray(rawRunCommandStateIndex)
      ? rawRunCommandStateIndex.filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0
        )
      : [];
    const nextRunCommandStateIds = [
      ...new Set([...runCommandStateIds, executionId]),
    ].sort();
    const writes: Promise<unknown>[] = [
      transaction.put(tokenAuthorityStorageKey, input.authority),
      transaction.put(runCommandStateStorageKey, input.commandState),
      transaction.put(
        RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY,
        nextRunCommandStateIds
      ),
      transaction.setAlarm(input.alarmAtMs),
      writeAcceptedDispatchPayloadFingerprintInTransaction({
        executionId,
        head: rawHead,
        storageKey: acceptedPayloadFingerprintStorageKey,
        transaction,
      }),
    ];
    await Promise.all(writes);
    await syncRuntimeCoordinatorWatchdogSchedule(transaction, executionId);
    return { ok: true };
  });
}

function resolveRuntimeCoordinatorAcceptedDeliveryHeadFence(input: {
  executionId: string;
  head: RuntimeCoordinatorHeadLifecycleRecord;
}):
  | "runtime_coordinator.head_execution_link_mismatch"
  | "runtime_coordinator.head_publication_intent_already_ready"
  | "runtime_coordinator.pre_agent_stop_requested"
  | null {
  if (input.head.status === "stopped_before_execution") {
    return "runtime_coordinator.pre_agent_stop_requested";
  }
  if (input.head.status === "publication_intent_ready") {
    return "runtime_coordinator.head_publication_intent_already_ready";
  }
  if (
    input.head.runtimeCoordinatorExecutionId &&
    input.head.runtimeCoordinatorExecutionId !== input.executionId
  ) {
    return "runtime_coordinator.head_execution_link_mismatch";
  }
  return null;
}

function resolveRuntimeCoordinatorAcceptedDeliveryExistingStateFence(input: {
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord;
  rawExistingAuthority: unknown;
  rawExistingCommandState: unknown;
}):
  | "runtime_coordinator.head_execution_link_mismatch"
  | "runtime_coordinator.pre_agent_stop_requested"
  | null {
  const existingCommandState = isRuntimeCoordinatorRunCommandState(
    input.rawExistingCommandState
  )
    ? input.rawExistingCommandState
    : null;
  if (
    existingCommandState?.lastCommandReasonCode?.startsWith(
      RUNTIME_COORDINATOR_WAKE_STOP_REASON_CODE_PREFIX
    )
  ) {
    return "runtime_coordinator.pre_agent_stop_requested";
  }
  if (input.rawExistingAuthority === undefined) {
    return null;
  }
  const existingAuthorityParse =
    runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
      input.rawExistingAuthority
    );
  if (!existingAuthorityParse.success) {
    throw new Error("runtime_coordinator.execution_token_authority_invalid");
  }
  const existingAuthority = existingAuthorityParse.data;
  const nextRun = input.authority.currentRunId
    ? input.authority.runsById[input.authority.currentRunId]
    : null;
  const expectedPreviousRunId = nextRun?.supersedesRunId ?? null;
  if (
    existingAuthority.runtimeCoordinatorExecutionId !==
      input.authority.runtimeCoordinatorExecutionId ||
    existingAuthority.terminalOutcome !== null ||
    (existingAuthority.currentRunId !== input.authority.currentRunId &&
      existingAuthority.currentRunId !== expectedPreviousRunId)
  ) {
    return "runtime_coordinator.head_execution_link_mismatch";
  }
  return null;
}

export async function rollbackRuntimeCoordinatorUnsentDeliveryWithAdmission(input: {
  attemptId: string;
  dispatchId: string;
  nowMs: number;
  runtimeCoordinatorExecutionId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
  targetWakeLifecycleId: string;
}): Promise<"not_eligible" | "rolled_back"> {
  return await input.storage.transaction(async (transaction) => {
    const headLifecycleStorageKey =
      buildRuntimeCoordinatorHeadLifecycleStorageKey(
        input.targetWakeLifecycleId
      );
    const runCommandStateStorageKey =
      buildRuntimeCoordinatorRunCommandStateStorageKey(
        input.runtimeCoordinatorExecutionId
      );
    const tokenAuthorityStorageKey =
      buildRuntimeCoordinatorTokenAuthorityStorageKey(
        input.runtimeCoordinatorExecutionId
      );
    const [rawHead, rawCommandState, rawTokenAuthority] = await Promise.all([
      transaction.get<unknown>(headLifecycleStorageKey),
      transaction.get<unknown>(runCommandStateStorageKey),
      transaction.get<unknown>(tokenAuthorityStorageKey),
    ]);
    const parsedTokenAuthority =
      rawTokenAuthority === undefined
        ? null
        : runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
            rawTokenAuthority
          );
    const tokenAuthority = parsedTokenAuthority?.success
      ? parsedTokenAuthority.data
      : null;
    const activeTokenRun = tokenAuthority?.currentRunId
      ? tokenAuthority.runsById[tokenAuthority.currentRunId]
      : null;
    if (
      !(
        isRuntimeCoordinatorHeadLifecycleRecord(rawHead) &&
        isRuntimeCoordinatorRunCommandState(rawCommandState)
      ) ||
      rawHead.status !== "execution_linked" ||
      rawHead.primaryDispatchId !== input.dispatchId ||
      rawHead.runtimeCoordinatorExecutionId !==
        input.runtimeCoordinatorExecutionId ||
      rawHead.targetWakeLifecycleIdentity.targetProfileId !==
        input.targetProfileId ||
      rawCommandState.attemptId !== input.attemptId ||
      rawCommandState.dispatchId !== input.dispatchId ||
      rawCommandState.runtimeCoordinatorExecutionId !==
        input.runtimeCoordinatorExecutionId ||
      rawCommandState.targetProfileId !== input.targetProfileId ||
      rawCommandState.ownerUserId !== rawHead.ownerUserId ||
      hasRuntimeCoordinatorDurableLocalProgress(
        rawCommandState.localProgress
      ) ||
      rawCommandState.lastCommandReasonCode?.startsWith(
        RUNTIME_COORDINATOR_WAKE_STOP_REASON_CODE_PREFIX
      ) === true ||
      (rawTokenAuthority !== undefined &&
        (!tokenAuthority ||
          tokenAuthority.runtimeCoordinatorExecutionId !==
            input.runtimeCoordinatorExecutionId ||
          tokenAuthority.executionScope.runtimeCoordinatorExecutionId !==
            input.runtimeCoordinatorExecutionId ||
          tokenAuthority.executionScope.dispatchId !== input.dispatchId ||
          tokenAuthority.executionScope.targetProfileId !==
            input.targetProfileId ||
          tokenAuthority.terminalOutcome !== null ||
          !activeTokenRun ||
          activeTokenRun.tokenStatus !== "active"))
    ) {
      return "not_eligible";
    }

    const restoredHead = {
      ...rawHead,
      executionLinkedAtMs: null,
      runtimeCoordinatorExecutionId: null,
      status: "accepted",
      updatedAtMs: input.nowMs,
    } satisfies RuntimeCoordinatorHeadLifecycleRecord;
    const prepared = await prepareHeadLifecycleAdmissionWrite({
      nowMs: input.nowMs,
      record: restoredHead,
      transaction,
    });
    const headReferences = appendBoundedReferences(
      prepared.admission.activeHeadLifecycleIds,
      [input.targetWakeLifecycleId]
    );
    const nextAdmission = {
      ...prepared.admission,
      activeExecutionIds: prepared.admission.activeExecutionIds.filter(
        (executionId) => executionId !== input.runtimeCoordinatorExecutionId
      ),
      activeHeadLifecycleIds: headReferences.ids,
      referencesOverflowed:
        prepared.admission.referencesOverflowed || headReferences.overflowed,
      revision: prepared.admission.revision + 1,
      updatedAtMs: input.nowMs,
    } satisfies AgentProfileExecutionAdmissionRecord;
    await persistHeadLifecycleAdmissionTransition({
      admissionAfterHeadWrite: nextAdmission,
      effectiveRecord: restoredHead,
      headLifecycleStorageKey,
      nextAdmission,
      nowMs: input.nowMs,
      preparation: prepared,
      transaction,
    });

    const rawRunCommandStateIndex = await transaction.get<unknown>(
      RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY
    );
    const runCommandStateIds = Array.isArray(rawRunCommandStateIndex)
      ? rawRunCommandStateIndex.filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0
        )
      : [];
    await Promise.all([
      transaction.delete(runCommandStateStorageKey),
      transaction.put(
        RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY,
        runCommandStateIds.filter(
          (executionId) => executionId !== input.runtimeCoordinatorExecutionId
        )
      ),
    ]);
    await writeRuntimeCoordinatorWatchdogSchedule(
      transaction,
      input.runtimeCoordinatorExecutionId,
      null
    );
    return "rolled_back";
  });
}

function resolveContinuationHeadFence(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  record: RuntimeCoordinatorHeadLifecycleRecord;
}): { status: "continuation_needs_attention" } | null {
  const recoveryGate = input.admission.recoveryGate;
  if (
    recoveryGate?.status === "continuation_needs_attention" &&
    recoveryGate.continuationClientMessageId ===
      input.record.targetWakeLifecycleIdentity.clientMessageId
  ) {
    return { status: "continuation_needs_attention" };
  }
  return null;
}

async function persistHeadLifecycleAdmissionTransition(input: {
  admissionAfterHeadWrite: AgentProfileExecutionAdmissionRecord;
  effectiveRecord: RuntimeCoordinatorHeadLifecycleRecord;
  headLifecycleStorageKey: string;
  nextAdmission: AgentProfileExecutionAdmissionRecord;
  nowMs: number;
  preparation: Awaited<ReturnType<typeof prepareHeadLifecycleAdmissionWrite>>;
  transaction: DurableObjectTransaction;
}): Promise<void> {
  const { admissionAfterHeadWrite, effectiveRecord, nextAdmission } = input;
  const { admissionKey, index, parsedIndex } = input.preparation;
  const shouldRetireEffectiveHead =
    admissionAfterHeadWrite.recoveryGate?.status === "continuation_running" &&
    nextAdmission.recoveryGate === null &&
    admissionAfterHeadWrite.recoveryGate.interruptedWork
      .targetWakeLifecycleId === effectiveRecord.targetWakeLifecycleId;
  const [rawActiveProfileIds, rawLegacyIndex] = await Promise.all([
    input.transaction.get<unknown>(EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY),
    input.transaction.get<unknown>(
      RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY
    ),
  ]);
  const activeProfileIndex = resolveActiveProfileIndexForWrite({
    generation: index.generation,
    indexReady: index.status === "ready",
    raw: rawActiveProfileIds,
  });
  if (!activeProfileIndex) {
    throw new Error("runtime_coordinator.active_profile_index_invalid");
  }
  const nextActiveProfileIds = updateActiveProfileIds({
    active: admissionHasActiveReferences(nextAdmission),
    activeProfileIds: activeProfileIndex.targetProfileIds,
    targetProfileId:
      effectiveRecord.targetWakeLifecycleIdentity.targetProfileId,
  });
  const legacyIds = normalizeLegacyIndex(rawLegacyIndex);
  const nextLegacyIds = shouldRetireEffectiveHead
    ? legacyIds.filter(
        (targetWakeLifecycleId) =>
          targetWakeLifecycleId !== effectiveRecord.targetWakeLifecycleId
      )
    : resolveHeadLifecycleIndexIds({
        legacyIds,
        record: effectiveRecord,
      });
  const writes: Promise<unknown>[] = [
    shouldRetireEffectiveHead
      ? input.transaction.delete(input.headLifecycleStorageKey)
      : input.transaction.put(input.headLifecycleStorageKey, effectiveRecord),
    input.transaction.put(
      RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY,
      nextLegacyIds
    ),
    shouldDeleteInactiveAdmission(nextAdmission, input.nowMs)
      ? input.transaction.delete(admissionKey)
      : input.transaction.put(admissionKey, nextAdmission),
    input.transaction.put(
      EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY,
      createActiveProfileIndexRecord(index.generation, nextActiveProfileIds)
    ),
  ];
  if (!parsedIndex) {
    writes.push(input.transaction.put(EXECUTION_INDEX_STORAGE_KEY, index));
  }
  await Promise.all(writes);
}

async function resolveExistingHeadLifecycleWrite(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  blockForExecutionTargetMutation: boolean;
  headLifecycleStorageKey: string;
  nowMs: number;
  proposedRecord: RuntimeCoordinatorHeadLifecycleRecord;
  transaction: Pick<DurableObjectTransaction, "delete" | "get" | "put">;
}): Promise<AgentProfileWorkCoordinatorHeadWriteResult | null> {
  const runtimeCoordinatorExecutionId = buildRuntimeCoordinatorExecutionId({
    dispatchId: input.proposedRecord.primaryDispatchId,
    spaceId: input.proposedRecord.targetWakeLifecycleIdentity.spaceId,
    targetProfileId:
      input.proposedRecord.targetWakeLifecycleIdentity.targetProfileId,
  });
  const tokenAuthorityStorageKey =
    buildRuntimeCoordinatorTokenAuthorityStorageKey(
      runtimeCoordinatorExecutionId
    );
  const acceptedPayloadFingerprintStorageKey =
    buildRuntimeCoordinatorAcceptedDispatchPayloadFingerprintStorageKey(
      runtimeCoordinatorExecutionId
    );
  const pendingPromotionStorageKey =
    await locatePendingAgentProfileWorkPromotion(input.transaction, {
      targetProfileId:
        input.proposedRecord.targetWakeLifecycleIdentity.targetProfileId,
      targetWakeLifecycleId: input.proposedRecord.targetWakeLifecycleId,
    });
  const storedCurrentState = await input.transaction.get<unknown>([
    input.headLifecycleStorageKey,
    tokenAuthorityStorageKey,
    acceptedPayloadFingerprintStorageKey,
    pendingPromotionStorageKey,
  ]);
  const rawExistingHead = storedCurrentState.get(input.headLifecycleStorageKey);
  const rawTokenAuthority = storedCurrentState.get(tokenAuthorityStorageKey);
  const pendingPromotion = parsePendingAgentProfileWorkPromotion(
    storedCurrentState.get(pendingPromotionStorageKey)
  );
  if (rawExistingHead === undefined) {
    return resolveTerminalExecutionHeadReplay({
      proposedRecord: input.proposedRecord,
      rawAcceptedPayloadFingerprint: storedCurrentState.get(
        acceptedPayloadFingerprintStorageKey
      ),
      rawAuthority: rawTokenAuthority,
      runtimeCoordinatorExecutionId,
    });
  }
  if (!isRuntimeCoordinatorHeadLifecycleRecord(rawExistingHead)) {
    throw new Error("runtime_coordinator.head_lifecycle_record_invalid");
  }
  if (!input.blockForExecutionTargetMutation) {
    if (
      isSettledDeviceWaitTransitionConflict(
        rawExistingHead,
        input.proposedRecord
      )
    ) {
      return { effectiveRecord: rawExistingHead, status: "existing" };
    }
    return null;
  }
  if (
    !sameRuntimeCoordinatorHeadLifecycleAuthority(
      rawExistingHead,
      input.proposedRecord
    )
  ) {
    return {
      conflictKind: "head_lifecycle_authority",
      effectiveRecord: rawExistingHead,
      status: "conflict",
    };
  }
  let effectiveExistingHead = rawExistingHead;
  if (
    rawExistingHead.acceptedDispatchSnapshot &&
    !input.proposedRecord.acceptedDispatchSnapshot
  ) {
    return {
      effectiveRecord: rawExistingHead,
      reasonCode: "runtime_coordinator.accepted_dispatch_snapshot_required",
      status: "snapshot_compatibility_retry",
    };
  }
  if (
    !rawExistingHead.acceptedDispatchSnapshot &&
    input.proposedRecord.acceptedDispatchSnapshot
  ) {
    const upgradeKind = resolveLegacyHeadSnapshotUpgradeKind({
      existingHead: rawExistingHead,
      pendingPromotion,
      proposedRecord: input.proposedRecord,
      rawTokenAuthority,
    });
    if (!upgradeKind) {
      return {
        effectiveRecord: rawExistingHead,
        reasonCode: "runtime_coordinator.legacy_head_snapshot_upgrade_unsafe",
        status: "snapshot_compatibility_retry",
      };
    }
    effectiveExistingHead = {
      ...rawExistingHead,
      acceptedDispatchSnapshot: input.proposedRecord.acceptedDispatchSnapshot,
      updatedAtMs: input.nowMs,
    };
    await input.transaction.put(
      input.headLifecycleStorageKey,
      effectiveExistingHead
    );
    if (upgradeKind === "promoted") {
      await input.transaction.delete(pendingPromotionStorageKey);
    }
  }
  if (
    !sameRuntimeCoordinatorHeadAuthority(
      effectiveExistingHead,
      input.proposedRecord
    )
  ) {
    return {
      conflictKind: "accepted_dispatch_payload",
      effectiveRecord: effectiveExistingHead,
      status: "conflict",
    };
  }
  if (
    effectiveExistingHead.primaryDispatchId !==
    input.proposedRecord.primaryDispatchId
  ) {
    const withDuplicate = appendHeadLifecycleDuplicate({
      existing: effectiveExistingHead,
      nowMs: input.nowMs,
      proposed: input.proposedRecord,
    });
    await input.transaction.put(input.headLifecycleStorageKey, withDuplicate);
    return { effectiveRecord: withDuplicate, status: "existing" };
  }
  if (effectiveExistingHead.status !== "queued") {
    return { effectiveRecord: effectiveExistingHead, status: "existing" };
  }
  const workIndex = input.admission.workItems.findIndex(
    (item) =>
      item.targetWakeLifecycleId === rawExistingHead.targetWakeLifecycleId
  );
  const queuePosition =
    workIndex + (input.admission.recoveryGate === null ? 0 : 1);
  if (queuePosition <= 0) {
    throw new Error("agent_profile_work_coordinator.queue_state_invalid");
  }
  return {
    effectiveRecord: effectiveExistingHead,
    queuePosition,
    status: "queued",
    waitingCount: Math.max(0, input.admission.workItems.length - 1),
  };
}

function isSettledDeviceWaitTransitionConflict(
  existing: RuntimeCoordinatorHeadLifecycleRecord,
  proposed: RuntimeCoordinatorHeadLifecycleRecord
): boolean {
  return (
    Boolean(existing.acceptedDispatchSnapshot?.deviceWait) &&
    (existing.status === "stopped_before_execution" ||
      existing.status === "publication_intent_ready" ||
      existing.status === "execution_linked") &&
    (existing.status !== proposed.status ||
      existing.publicationIntent?.reasonCode !==
        proposed.publicationIntent?.reasonCode)
  );
}

function resolveLegacyHeadSnapshotUpgradeKind(input: {
  existingHead: RuntimeCoordinatorHeadLifecycleRecord;
  pendingPromotion: PendingAgentProfileWorkPromotion | null;
  proposedRecord: RuntimeCoordinatorHeadLifecycleRecord;
  rawTokenAuthority: unknown;
}): "promoted" | "queued" | null {
  const hasNoExecutionAuthority =
    input.existingHead.primaryDispatchId ===
      input.proposedRecord.primaryDispatchId &&
    input.existingHead.executionLinkedAtMs === null &&
    input.existingHead.runtimeCoordinatorExecutionId === null &&
    input.rawTokenAuthority === undefined;
  if (!hasNoExecutionAuthority) {
    return null;
  }
  if (input.existingHead.status === "queued") {
    return "queued";
  }
  const hasExactPendingPromotion =
    input.pendingPromotion?.dispatchId ===
      input.existingHead.primaryDispatchId &&
    input.pendingPromotion.targetProfileId ===
      input.existingHead.targetWakeLifecycleIdentity.targetProfileId &&
    input.pendingPromotion.targetWakeLifecycleId ===
      input.existingHead.targetWakeLifecycleId;
  return input.existingHead.status === "accepted" && hasExactPendingPromotion
    ? "promoted"
    : null;
}

function resolveTerminalExecutionHeadReplay(input: {
  proposedRecord: RuntimeCoordinatorHeadLifecycleRecord;
  rawAcceptedPayloadFingerprint: unknown;
  rawAuthority: unknown;
  runtimeCoordinatorExecutionId: string;
}): AgentProfileWorkCoordinatorHeadWriteResult | null {
  if (input.rawAuthority === undefined) {
    return null;
  }
  const parsedAuthority =
    runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
      input.rawAuthority
    );
  if (!parsedAuthority.success) {
    throw new Error("runtime_coordinator.execution_token_authority_invalid");
  }
  const authority = parsedAuthority.data;
  if (!authority.terminalOutcome) {
    return null;
  }
  const identity = input.proposedRecord.targetWakeLifecycleIdentity;
  if (
    authority.runtimeCoordinatorExecutionId !==
      input.runtimeCoordinatorExecutionId ||
    authority.executionScope.runtimeCoordinatorExecutionId !==
      input.runtimeCoordinatorExecutionId ||
    authority.executionScope.dispatchId !==
      input.proposedRecord.primaryDispatchId ||
    authority.executionScope.spaceId !== identity.spaceId ||
    authority.executionScope.targetProfileId !== identity.targetProfileId
  ) {
    throw new Error("runtime_coordinator.execution_token_scope_mismatch");
  }
  const effectiveRecord = {
    ...input.proposedRecord,
    executionLinkedAtMs: authority.terminalOutcome.finalizedAtMs,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    status: "execution_linked",
    updatedAtMs: authority.terminalOutcome.finalizedAtMs,
  } satisfies RuntimeCoordinatorHeadLifecycleRecord;
  if (
    authority.executionScope.sourceClientMessageId !== identity.clientMessageId
  ) {
    return {
      conflictKind: "head_lifecycle_authority",
      effectiveRecord,
      status: "conflict",
    };
  }
  const acceptedPayloadFingerprintRecord =
    isRuntimeCoordinatorAcceptedDispatchPayloadFingerprintRecord(
      input.rawAcceptedPayloadFingerprint
    ) &&
    input.rawAcceptedPayloadFingerprint.runtimeCoordinatorExecutionId ===
      input.runtimeCoordinatorExecutionId
      ? input.rawAcceptedPayloadFingerprint
      : null;
  const acceptedPayloadFingerprint =
    acceptedPayloadFingerprintRecord?.acceptedDispatchPayloadFingerprint;
  const proposedPayloadFingerprint =
    input.proposedRecord.acceptedDispatchSnapshot?.payloadFingerprint;
  if (
    acceptedPayloadFingerprint !== undefined &&
    proposedPayloadFingerprint !== undefined &&
    acceptedPayloadFingerprint !== proposedPayloadFingerprint
  ) {
    return {
      conflictKind: "accepted_dispatch_payload",
      effectiveRecord,
      status: "conflict",
    };
  }
  if (
    acceptedPayloadFingerprint === undefined ||
    proposedPayloadFingerprint === undefined
  ) {
    return {
      compatibilityDiagnosticReasonCode:
        "runtime_coordinator.terminal_replay_fingerprint_unavailable",
      effectiveRecord,
      status: "existing",
    };
  }
  return { effectiveRecord, status: "existing" };
}

function appendHeadLifecycleDuplicate(input: {
  existing: RuntimeCoordinatorHeadLifecycleRecord;
  nowMs: number;
  proposed: RuntimeCoordinatorHeadLifecycleRecord;
}): RuntimeCoordinatorHeadLifecycleRecord {
  const duplicate = {
    dispatchId: input.proposed.primaryDispatchId,
    idempotencyKey: input.proposed.primaryIdempotencyKey,
    observedAtMs: input.nowMs,
    reasonCode:
      input.existing.status === "queued"
        ? "agent_profile_work_coordinator.duplicate_while_queued"
        : "runtime_coordinator.head_duplicate_dispatch_ignored",
  };
  return {
    ...input.existing,
    duplicateDispatches: [
      ...input.existing.duplicateDispatches.filter(
        (entry) =>
          entry.dispatchId !== duplicate.dispatchId ||
          entry.idempotencyKey !== duplicate.idempotencyKey
      ),
      duplicate,
    ].slice(-RUNTIME_COORDINATOR_MAX_HEAD_DUPLICATE_OBSERVATIONS),
    updatedAtMs: input.nowMs,
  };
}

function planAgentProfileWorkAcceptance(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  blockForExecutionTargetMutation: boolean;
  nowMs: number;
  proposedRecord: RuntimeCoordinatorHeadLifecycleRecord;
}):
  | {
      admissionWithWork: AgentProfileExecutionAdmissionRecord;
      effectiveRecord: RuntimeCoordinatorHeadLifecycleRecord;
      workAcceptance:
        | {
            queuePosition: number;
            status: "queued" | "started";
            waitingCount: number;
          }
        | undefined;
    }
  | {
      result:
        | { status: "legacy_execution_active" }
        | { status: "queue_full"; waitingCount: number };
    } {
  if (!input.blockForExecutionTargetMutation) {
    return {
      admissionWithWork: input.admission,
      effectiveRecord: input.proposedRecord,
      workAcceptance: undefined,
    };
  }
  if (
    input.admission.workItems.length === 0 &&
    (input.admission.referencesOverflowed ||
      input.admission.activeExecutionIds.length > 0 ||
      input.admission.activeHeadLifecycleIds.length > 0)
  ) {
    return { result: { status: "legacy_execution_active" } };
  }
  const accepted = acceptAgentProfileWork({
    continuationClientMessageId:
      input.proposedRecord.targetWakeLifecycleIdentity.clientMessageId ??
      undefined,
    coordinator: projectAgentProfileWorkCoordinator(input.admission),
    item: {
      ...(input.proposedRecord.acceptedDispatchSnapshot?.executionContext
        ? {
            executionContextId:
              input.proposedRecord.acceptedDispatchSnapshot.executionContext.id,
          }
        : {}),
      dispatchId: input.proposedRecord.primaryDispatchId,
      enqueuedAtMs: input.proposedRecord.createdAtMs,
      targetWakeLifecycleId: input.proposedRecord.targetWakeLifecycleId,
    },
    nowMs: input.nowMs,
  });
  if (accepted.status === "queue_full") {
    return {
      result: {
        status: "queue_full",
        waitingCount: accepted.waitingCount,
      },
    };
  }
  const queuePosition = accepted.queuePosition ?? 0;
  const queued = queuePosition > 0;
  return {
    admissionWithWork: {
      ...input.admission,
      recoveryGate: accepted.coordinator.recoveryGate,
      revision: accepted.coordinator.revision,
      updatedAtMs: accepted.coordinator.updatedAtMs,
      workItems: accepted.coordinator.workItems,
    },
    effectiveRecord: queued
      ? { ...input.proposedRecord, status: "queued" }
      : input.proposedRecord,
    workAcceptance: {
      queuePosition,
      status: queued ? "queued" : "started",
      waitingCount: accepted.waitingCount,
    },
  };
}

function sameRuntimeCoordinatorHeadAuthority(
  existing: RuntimeCoordinatorHeadLifecycleRecord,
  proposed: RuntimeCoordinatorHeadLifecycleRecord
): boolean {
  const acceptedSnapshotsMatch =
    !(existing.acceptedDispatchSnapshot || proposed.acceptedDispatchSnapshot) ||
    (existing.acceptedDispatchSnapshot !== undefined &&
      proposed.acceptedDispatchSnapshot !== undefined &&
      existing.acceptedDispatchSnapshot.payloadFingerprint ===
        proposed.acceptedDispatchSnapshot.payloadFingerprint);
  return (
    sameRuntimeCoordinatorHeadLifecycleAuthority(existing, proposed) &&
    acceptedSnapshotsMatch
  );
}

function sameRuntimeCoordinatorHeadLifecycleAuthority(
  existing: RuntimeCoordinatorHeadLifecycleRecord,
  proposed: RuntimeCoordinatorHeadLifecycleRecord
): boolean {
  return (
    existing.ownerUserId === proposed.ownerUserId &&
    existing.targetWakeLifecycleId === proposed.targetWakeLifecycleId &&
    existing.targetWakeLifecycleIdentity.spaceId ===
      proposed.targetWakeLifecycleIdentity.spaceId &&
    existing.targetWakeLifecycleIdentity.sourceSignalId ===
      proposed.targetWakeLifecycleIdentity.sourceSignalId &&
    existing.targetWakeLifecycleIdentity.targetProfileId ===
      proposed.targetWakeLifecycleIdentity.targetProfileId
  );
}

function projectAgentProfileWorkCoordinator(
  admission: AgentProfileExecutionAdmissionRecord
): AgentProfileWorkCoordinator {
  return {
    admissionMode:
      admission.contextMigration?.status === "draining"
        ? "draining"
        : admission.admissionMode,
    recoveryGate: admission.recoveryGate,
    revision: admission.revision,
    targetProfileId: admission.targetProfileId,
    updatedAtMs: admission.updatedAtMs,
    workItems: admission.workItems,
  };
}

async function prepareHeadLifecycleAdmissionWrite(input: {
  nowMs: number;
  record: RuntimeCoordinatorHeadLifecycleRecord;
  transaction: Pick<DurableObjectTransaction, "get">;
}): Promise<{
  admission: AgentProfileExecutionAdmissionRecord;
  admissionKey: string;
  index: AgentProfileExecutionIndexState;
  parsedIndex: AgentProfileExecutionIndexState | null;
}> {
  const rawIndex = await input.transaction.get<unknown>(
    EXECUTION_INDEX_STORAGE_KEY
  );
  const parsedIndex = parseExecutionIndexState(rawIndex);
  const index =
    parsedIndex ??
    rebuildingExecutionIndexState({
      generation: nextExecutionIndexGeneration(rawIndex),
      nowMs: input.nowMs,
      ownerUserId: input.record.ownerUserId,
      repairRequested: false,
    });
  if (index.ownerUserId !== input.record.ownerUserId) {
    throw new Error("runtime_coordinator.execution_index_owner_mismatch");
  }

  const targetProfileId =
    input.record.targetWakeLifecycleIdentity.targetProfileId;
  const admissionKey = buildExecutionAdmissionStorageKey(targetProfileId);
  const rawAdmission = await input.transaction.get<unknown>(admissionKey);
  const parsedAdmission = parseExecutionAdmissionRecord(rawAdmission);
  if (rawAdmission !== undefined && !parsedAdmission) {
    throw new Error("runtime_coordinator.execution_admission_invalid");
  }
  const admission =
    parsedAdmission?.generation === index.generation
      ? parsedAdmission
      : carryExecutionAdmissionIntoGeneration({
          admission: parsedAdmission,
          generation: index.generation,
          nowMs: input.nowMs,
          targetProfileId,
        });
  return { admission, admissionKey, index, parsedIndex };
}

export async function writeRuntimeCoordinatorTokenAuthorityWithAdmission(input: {
  authority: import("@openmeld/schemas/types").RuntimeCoordinatorExecutionTokenAuthorityRecord;
  nowMs: number;
  storage: ExecutionAdmissionStorage;
}): Promise<PendingAgentProfileWorkPromotion | null> {
  return await input.storage.transaction((transaction) =>
    writeRuntimeCoordinatorTokenAuthorityWithAdmissionInTransaction({
      authority: input.authority,
      nowMs: input.nowMs,
      transaction,
    })
  );
}

export async function writeRuntimeCoordinatorTokenAuthorityWithAdmissionInTransaction(input: {
  authority: import("@openmeld/schemas/types").RuntimeCoordinatorExecutionTokenAuthorityRecord;
  nowMs: number;
  transaction: DurableObjectTransaction;
}): Promise<PendingAgentProfileWorkPromotion | null> {
  const { transaction } = input;
  const index = parseExecutionIndexState(
    await transaction.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
  );
  const generation = index?.generation ?? 1;
  const targetProfileId = input.authority.executionScope.targetProfileId;
  const admissionKey = buildExecutionAdmissionStorageKey(targetProfileId);
  const rawAdmission = await transaction.get<unknown>(admissionKey);
  const parsedAdmission = parseExecutionAdmissionRecord(rawAdmission);
  if (rawAdmission !== undefined && !parsedAdmission) {
    throw new Error("runtime_coordinator.execution_admission_invalid");
  }
  const admission =
    parsedAdmission?.generation === generation
      ? parsedAdmission
      : carryExecutionAdmissionIntoGeneration({
          admission: parsedAdmission,
          generation,
          nowMs: input.nowMs,
          targetProfileId,
        });
  const executionId = input.authority.runtimeCoordinatorExecutionId;
  const boundedExecutionReferences = input.authority.terminalOutcome
    ? {
        ids: admission.activeExecutionIds.filter((id) => id !== executionId),
        overflowed: admission.referencesOverflowed,
      }
    : appendBoundedReferences(admission.activeExecutionIds, [executionId]);
  const admissionAfterAuthorityWrite = {
    ...admission,
    activeExecutionIds: boundedExecutionReferences.ids,
    referencesOverflowed:
      admission.referencesOverflowed || boundedExecutionReferences.overflowed,
    revision: admission.revision + 1,
    updatedAtMs: input.nowMs,
  } satisfies AgentProfileExecutionAdmissionRecord;
  const terminalHeadLifecycleId = input.authority.terminalOutcome
    ? (admissionAfterAuthorityWrite.workItems.find(
        (item) => item.dispatchId === input.authority.executionScope.dispatchId
      )?.targetWakeLifecycleId ?? null)
    : null;
  const terminalTransition = input.authority.terminalOutcome
    ? await removeTerminalExecutionAgentProfileWorkAndPromoteSuccessor({
        admission: admissionAfterAuthorityWrite,
        dispatchId: input.authority.executionScope.dispatchId,
        nowMs: input.nowMs,
        outcome: resolveAgentProfileWorkTerminalOutcome(
          input.authority.terminalOutcome
        ),
        runtimeCoordinatorExecutionId: executionId,
        transaction,
      })
    : { admission: admissionAfterAuthorityWrite, pendingPromotion: null };
  const nextAdmission = terminalHeadLifecycleId
    ? removeRetiredHeadReference(
        terminalTransition.admission,
        terminalHeadLifecycleId
      )
    : terminalTransition.admission;
  const rawActiveProfileIds = await transaction.get<unknown>(
    EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY
  );
  const activeProfileIndex = resolveActiveProfileIndexForWrite({
    generation,
    indexReady: index?.status === "ready",
    raw: rawActiveProfileIds,
  });
  if (!activeProfileIndex) {
    throw new Error("runtime_coordinator.active_profile_index_invalid");
  }
  const writes: Promise<unknown>[] = [
    transaction.put(
      buildRuntimeCoordinatorTokenAuthorityStorageKey(executionId),
      input.authority
    ),
    shouldDeleteInactiveAdmission(nextAdmission, input.nowMs)
      ? transaction.delete(admissionKey)
      : transaction.put(admissionKey, nextAdmission),
    transaction.put(
      EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY,
      createActiveProfileIndexRecord(
        generation,
        updateActiveProfileIds({
          active: admissionHasActiveReferences(nextAdmission),
          activeProfileIds: activeProfileIndex.targetProfileIds,
          targetProfileId,
        })
      )
    ),
    retireTerminalHeadCurrentStateInTransaction({
      authority: input.authority,
      nextAdmission,
      targetWakeLifecycleId: terminalHeadLifecycleId,
      transaction,
    }),
  ];
  await Promise.all(writes);
  await syncRuntimeCoordinatorWatchdogSchedule(transaction, executionId);
  return terminalTransition.pendingPromotion;
}

function resolveAgentProfileWorkTerminalOutcome(
  terminalOutcome: NonNullable<
    import("@openmeld/schemas/types").RuntimeCoordinatorExecutionTokenAuthorityRecord["terminalOutcome"]
  >
): AgentProfileWorkSettleOutcome {
  if (terminalOutcome.reasonCode === "usage_exhausted") {
    return "usage_exhausted";
  }
  if (
    terminalOutcome.reasonCode ===
    RUNTIME_COORDINATOR_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE
  ) {
    return "controller_conversation_occupied";
  }
  if (terminalOutcome.status === "cancelled") {
    return "stopped";
  }
  return terminalOutcome.status === "reply_published" ? "succeeded" : "failed";
}

function terminalOutcomeHasVisiblePublication(
  terminalOutcome: import("@openmeld/schemas/types").RuntimeCoordinatorExecutionTokenAuthorityRecord["terminalOutcome"]
): boolean {
  return Boolean(
    terminalOutcome &&
      (terminalOutcome.status === "reply_published" ||
        terminalOutcome.replySignalId)
  );
}

async function retireTerminalHeadCurrentStateInTransaction(input: {
  authority: import("@openmeld/schemas/types").RuntimeCoordinatorExecutionTokenAuthorityRecord;
  nextAdmission: AgentProfileExecutionAdmissionRecord;
  targetWakeLifecycleId: string | null;
  transaction: DurableObjectTransaction;
}): Promise<void> {
  if (
    !(
      input.targetWakeLifecycleId &&
      terminalOutcomeHasVisiblePublication(input.authority.terminalOutcome)
    ) ||
    admissionRetainsHeadLifecycle(
      input.nextAdmission,
      input.targetWakeLifecycleId
    )
  ) {
    return;
  }
  const rawLegacyHeadIds = await input.transaction.get<unknown>(
    RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY
  );
  await Promise.all([
    input.transaction.delete(
      buildRuntimeCoordinatorHeadLifecycleStorageKey(
        input.targetWakeLifecycleId
      )
    ),
    input.transaction.put(
      RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY,
      normalizeLegacyIndex(rawLegacyHeadIds).filter(
        (targetWakeLifecycleId) =>
          targetWakeLifecycleId !== input.targetWakeLifecycleId
      )
    ),
  ]);
}

export async function advanceRuntimeCoordinatorAgentProfileExecutionIndexRepair(input: {
  nowMs: number;
  storage: ExecutionAdmissionStorage;
}): Promise<"failed" | "idle" | "ready" | "rebuilding"> {
  let state = parseExecutionIndexState(
    await input.storage.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
  );
  if (!state) {
    return "idle";
  }
  if (state.status === "ready") {
    return state.status;
  }
  if (!state.repairRequested) {
    return "idle";
  }
  if (state.status === "failed") {
    if (state.retryAtMs > input.nowMs) {
      return "failed";
    }
    state = {
      cursor: state.cursor,
      failureCount: state.failureCount,
      generation: state.generation,
      modelVersion: EXECUTION_INDEX_MODEL_VERSION,
      ownerUserId: state.ownerUserId,
      phase: state.phase,
      repairRequested: state.repairRequested,
      status: "rebuilding",
      updatedAtMs: input.nowMs,
    };
    await input.storage.put(EXECUTION_INDEX_STORAGE_KEY, state);
  }

  const repairingState = state as Extract<
    AgentProfileExecutionIndexState,
    { status: "rebuilding" }
  >;
  try {
    const prefix = resolveExecutionIndexRepairStoragePrefix(
      repairingState.phase
    );
    const page = await input.storage.list<unknown>({
      limit: EXECUTION_INDEX_REPAIR_PAGE_SIZE,
      prefix,
      ...(repairingState.cursor ? { startAfter: repairingState.cursor } : {}),
    });
    const observations: ActiveObservationsByProfile =
      repairingState.phase === "admissions"
        ? new Map()
        : await collectExecutionIndexRepairObservations({
            ownerUserId: repairingState.ownerUserId,
            page,
            phase: repairingState.phase,
            storage: input.storage,
          });
    const nextState = resolveNextExecutionIndexRepairState({
      lastKey: [...page.keys()].at(-1) ?? null,
      nowMs: input.nowMs,
      pageComplete: page.size < EXECUTION_INDEX_REPAIR_PAGE_SIZE,
      state: repairingState,
    });

    await input.storage.transaction(async (transaction) => {
      const activeProfileIndex = parseActiveProfileIndexRecord(
        await transaction.get<unknown>(
          EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY
        ),
        repairingState.generation
      );
      if (!activeProfileIndex) {
        throw new Error("runtime_coordinator.active_profile_index_invalid");
      }
      const activeProfileIds =
        repairingState.phase === "admissions"
          ? await carryAdmissionRepairPageIntoGeneration({
              activeProfileIds: activeProfileIndex.targetProfileIds,
              generation: repairingState.generation,
              nowMs: input.nowMs,
              page,
              transaction,
            })
          : await applyExecutionReferenceRepairObservations({
              activeProfileIds: activeProfileIndex.targetProfileIds,
              generation: repairingState.generation,
              nowMs: input.nowMs,
              observations,
              transaction,
            });
      await transaction.put(
        EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY,
        createActiveProfileIndexRecord(
          repairingState.generation,
          activeProfileIds
        )
      );
      await transaction.put(EXECUTION_INDEX_STORAGE_KEY, nextState);
    });
    return nextState.status;
  } catch (error) {
    await persistExecutionIndexRepairFailure({
      error,
      nowMs: input.nowMs,
      state: repairingState,
      storage: input.storage,
    });
    return "failed";
  }
}

async function carryAdmissionRepairPageIntoGeneration(input: {
  activeProfileIds: readonly string[];
  generation: number;
  nowMs: number;
  page: ReadonlyMap<string, unknown>;
  transaction: DurableObjectTransaction;
}): Promise<string[]> {
  let activeProfileIds = [...input.activeProfileIds];
  for (const admissionKey of input.page.keys()) {
    const targetProfileId = parseExecutionAdmissionStorageKey(admissionKey);
    const current = parseExecutionAdmissionRecord(
      await input.transaction.get<unknown>(admissionKey)
    );
    if (!(targetProfileId && current)) {
      throw new Error("runtime_coordinator.execution_admission_invalid");
    }
    if (current.targetProfileId !== targetProfileId) {
      throw new Error(
        "runtime_coordinator.execution_admission_profile_mismatch"
      );
    }
    const nextAdmission =
      current.generation === input.generation
        ? current
        : carryExecutionAdmissionIntoGeneration({
            admission: current,
            generation: input.generation,
            nowMs: input.nowMs,
            targetProfileId,
          });
    if (shouldDeleteInactiveAdmission(nextAdmission, input.nowMs)) {
      await input.transaction.delete(admissionKey);
    } else {
      await input.transaction.put(admissionKey, nextAdmission);
    }
    activeProfileIds = updateActiveProfileIds({
      active: admissionHasActiveReferences(nextAdmission),
      activeProfileIds,
      targetProfileId,
    });
  }
  return activeProfileIds;
}

async function applyExecutionReferenceRepairObservations(input: {
  activeProfileIds: readonly string[];
  generation: number;
  nowMs: number;
  observations: ActiveObservationsByProfile;
  transaction: DurableObjectTransaction;
}): Promise<string[]> {
  let activeProfileIds = [...input.activeProfileIds];
  for (const [targetProfileId, observed] of input.observations) {
    const admissionKey = buildExecutionAdmissionStorageKey(targetProfileId);
    const current = parseExecutionAdmissionRecord(
      await input.transaction.get<unknown>(admissionKey)
    );
    const admission =
      current?.generation === input.generation
        ? current
        : carryExecutionAdmissionIntoGeneration({
            admission: current,
            generation: input.generation,
            nowMs: input.nowMs,
            targetProfileId,
          });
    const executionReferences = appendBoundedReferences(
      admission.activeExecutionIds,
      [...observed.executionIds]
    );
    const headReferences = appendBoundedReferences(
      admission.activeHeadLifecycleIds,
      [...observed.headLifecycleIds]
    );
    const nextAdmission = {
      ...admission,
      activeExecutionIds: executionReferences.ids,
      activeHeadLifecycleIds: headReferences.ids,
      referencesOverflowed:
        admission.referencesOverflowed ||
        executionReferences.overflowed ||
        headReferences.overflowed,
      revision: admission.revision + 1,
      updatedAtMs: input.nowMs,
    } satisfies AgentProfileExecutionAdmissionRecord;
    await input.transaction.put(admissionKey, nextAdmission);
    activeProfileIds = updateActiveProfileIds({
      active: admissionHasActiveReferences(nextAdmission),
      activeProfileIds,
      targetProfileId,
    });
  }
  return activeProfileIds;
}

async function collectExecutionIndexRepairObservations(input: {
  ownerUserId: string;
  page: Map<string, unknown>;
  phase: Exclude<AgentProfileExecutionIndexRepairPhase, "admissions">;
  storage: ExecutionAdmissionStorage;
}): Promise<ActiveObservationsByProfile> {
  const observations: ActiveObservationsByProfile = new Map();
  const executionReferences: Array<{
    executionId: string;
    targetProfileId: string;
  }> = [];
  for (const [key, raw] of input.page) {
    if (isLegacyExecutionIndexKey(key)) {
      continue;
    }
    if (input.phase === "head_lifecycles") {
      collectHeadLifecycleRepairObservation({
        executionReferences,
        observations,
        ownerUserId: input.ownerUserId,
        raw,
      });
      continue;
    }
    collectRunCommandRepairObservation({
      executionReferences,
      ownerUserId: input.ownerUserId,
      raw,
    });
  }
  await collectActiveExecutionRepairObservations({
    executionReferences,
    observations,
    storage: input.storage,
  });
  return observations;
}

function collectHeadLifecycleRepairObservation(input: {
  executionReferences: Array<{
    executionId: string;
    targetProfileId: string;
  }>;
  observations: ActiveObservationsByProfile;
  ownerUserId: string;
  raw: unknown;
}): void {
  if (!isRuntimeCoordinatorHeadLifecycleRecord(input.raw)) {
    throw new Error("runtime_coordinator.head_lifecycle_record_invalid");
  }
  if (input.raw.ownerUserId !== input.ownerUserId) {
    return;
  }
  const targetProfileId = input.raw.targetWakeLifecycleIdentity.targetProfileId;
  if (input.raw.status === "queued") {
    readOrCreateProfileObservations(input.observations, targetProfileId);
    return;
  }
  if (input.raw.status === "accepted" || input.raw.status === "waiting") {
    observeActiveHead(
      input.observations,
      targetProfileId,
      input.raw.targetWakeLifecycleId
    );
    return;
  }
  if (input.raw.status !== "execution_linked") {
    return;
  }
  const executionId = input.raw.runtimeCoordinatorExecutionId;
  if (!executionId) {
    throw new Error("runtime_coordinator.head_execution_authority_missing");
  }
  input.executionReferences.push({ executionId, targetProfileId });
}

function collectRunCommandRepairObservation(input: {
  executionReferences: Array<{
    executionId: string;
    targetProfileId: string;
  }>;
  ownerUserId: string;
  raw: unknown;
}): void {
  if (!isRuntimeCoordinatorRunCommandState(input.raw)) {
    throw new Error("runtime_coordinator.run_command_state_invalid");
  }
  if (input.raw.ownerUserId !== input.ownerUserId) {
    return;
  }
  input.executionReferences.push({
    executionId: input.raw.runtimeCoordinatorExecutionId,
    targetProfileId: input.raw.targetProfileId,
  });
}

async function collectActiveExecutionRepairObservations(input: {
  executionReferences: Array<{
    executionId: string;
    targetProfileId: string;
  }>;
  observations: ActiveObservationsByProfile;
  storage: ExecutionAdmissionStorage;
}): Promise<void> {
  const activity = await readExecutionAuthorityActivityBatch({
    executionIds: input.executionReferences.map(
      (reference) => reference.executionId
    ),
    storage: input.storage,
  });
  if (!activity) {
    throw new Error(
      "runtime_coordinator.execution_token_authority_unavailable"
    );
  }
  for (const reference of input.executionReferences) {
    if (activity.get(reference.executionId)) {
      observeActiveExecution(
        input.observations,
        reference.targetProfileId,
        reference.executionId
      );
    }
  }
}

function resolveNextExecutionIndexRepairState(input: {
  lastKey: string | null;
  nowMs: number;
  pageComplete: boolean;
  state: Extract<AgentProfileExecutionIndexState, { status: "rebuilding" }>;
}): AgentProfileExecutionIndexState {
  if (!input.pageComplete) {
    return {
      ...input.state,
      cursor: input.lastKey,
      failureCount: 0,
      updatedAtMs: input.nowMs,
    };
  }
  if (input.state.phase === "head_lifecycles") {
    return {
      cursor: null,
      failureCount: 0,
      generation: input.state.generation,
      modelVersion: EXECUTION_INDEX_MODEL_VERSION,
      ownerUserId: input.state.ownerUserId,
      phase: "run_command_states",
      repairRequested: input.state.repairRequested,
      status: "rebuilding",
      updatedAtMs: input.nowMs,
    };
  }
  if (input.state.phase === "run_command_states") {
    return {
      cursor: null,
      failureCount: 0,
      generation: input.state.generation,
      modelVersion: EXECUTION_INDEX_MODEL_VERSION,
      ownerUserId: input.state.ownerUserId,
      phase: "admissions",
      repairRequested: input.state.repairRequested,
      status: "rebuilding",
      updatedAtMs: input.nowMs,
    };
  }
  return {
    generation: input.state.generation,
    modelVersion: EXECUTION_INDEX_MODEL_VERSION,
    ownerUserId: input.state.ownerUserId,
    status: "ready",
    updatedAtMs: input.nowMs,
  };
}

function resolveExecutionIndexRepairStoragePrefix(
  phase: AgentProfileExecutionIndexRepairPhase
): string {
  switch (phase) {
    case "head_lifecycles":
      return RUNTIME_COORDINATOR_HEAD_LIFECYCLE_STORAGE_KEY_PREFIX;
    case "run_command_states":
      return RUNTIME_COORDINATOR_RUN_COMMAND_STATE_STORAGE_KEY_PREFIX;
    case "admissions":
      return EXECUTION_ADMISSION_STORAGE_KEY_PREFIX;
    default:
      return assertNeverExecutionIndexRepairPhase(phase);
  }
}

function assertNeverExecutionIndexRepairPhase(value: never): never {
  throw new Error(`Unsupported execution-index repair phase: ${String(value)}`);
}

function isLegacyExecutionIndexKey(key: string): boolean {
  return (
    key === RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY ||
    key === RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY
  );
}

export async function readRuntimeCoordinatorAgentProfileExecutionIndexRepairAlarmAtMs(
  storage: ExecutionAdmissionStorage,
  nowMs: number
): Promise<number | null> {
  const state = parseExecutionIndexState(
    await storage.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
  );
  if (state?.status === "rebuilding" && state.repairRequested) {
    return nowMs;
  }
  return state?.status === "failed" && state.repairRequested
    ? state.retryAtMs
    : null;
}

async function ensureExecutionIndexReady(input: {
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
}): Promise<AgentProfileExecutionIndexState> {
  let state = parseExecutionIndexState(
    await input.storage.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
  );
  if (!state) {
    state = await input.storage.transaction(async (transaction) => {
      const raw = await transaction.get<unknown>(EXECUTION_INDEX_STORAGE_KEY);
      const current = parseExecutionIndexState(raw);
      if (current) {
        return current;
      }
      const rebuilding = rebuildingExecutionIndexState({
        generation: nextExecutionIndexGeneration(raw),
        nowMs: input.nowMs,
        ownerUserId: input.ownerUserId,
        repairRequested: true,
      });
      await Promise.all([
        transaction.put(EXECUTION_INDEX_STORAGE_KEY, rebuilding),
        transaction.put(
          EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY,
          createActiveProfileIndexRecord(rebuilding.generation, [])
        ),
      ]);
      return rebuilding;
    });
  }
  if (state.ownerUserId !== input.ownerUserId) {
    return {
      cursor: null,
      failureCount: 0,
      generation: state.generation,
      modelVersion: EXECUTION_INDEX_MODEL_VERSION,
      ownerUserId: input.ownerUserId,
      phase: "head_lifecycles",
      reasonCode: "runtime_coordinator.execution_index_owner_mismatch",
      repairRequested: false,
      retryAtMs: input.nowMs + EXECUTION_INDEX_REPAIR_RETRY_MAX_MS,
      status: "failed",
      updatedAtMs: input.nowMs,
    };
  }
  if (state.status === "rebuilding" && !state.repairRequested) {
    state = {
      ...state,
      repairRequested: true,
      updatedAtMs: input.nowMs,
    };
    await input.storage.put(EXECUTION_INDEX_STORAGE_KEY, state);
  }
  if (state.status === "failed" && state.retryAtMs <= input.nowMs) {
    await advanceRuntimeCoordinatorAgentProfileExecutionIndexRepair({
      nowMs: input.nowMs,
      storage: input.storage,
    });
    state =
      parseExecutionIndexState(
        await input.storage.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
      ) ?? state;
  }
  for (
    let step = 0;
    step < EXECUTION_INDEX_INLINE_REPAIR_STEPS && state.status === "rebuilding";
    step += 1
  ) {
    await advanceRuntimeCoordinatorAgentProfileExecutionIndexRepair({
      nowMs: input.nowMs,
      storage: input.storage,
    });
    state =
      parseExecutionIndexState(
        await input.storage.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
      ) ?? state;
  }
  return state;
}

async function requestFreshExecutionIndexRepair(input: {
  expectedGeneration: number;
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
}): Promise<void> {
  await input.storage.transaction(async (transaction) => {
    const currentIndex = parseExecutionIndexState(
      await transaction.get<unknown>(EXECUTION_INDEX_STORAGE_KEY)
    );
    if (
      currentIndex?.status !== "ready" ||
      currentIndex.generation !== input.expectedGeneration ||
      currentIndex.ownerUserId !== input.ownerUserId
    ) {
      return;
    }
    await writeFreshExecutionIndexRepairState({
      currentIndex,
      nowMs: input.nowMs,
      transaction,
    });
  });
}

async function writeFreshExecutionIndexRepairState(input: {
  currentIndex: Extract<AgentProfileExecutionIndexState, { status: "ready" }>;
  nowMs: number;
  transaction: Pick<DurableObjectTransaction, "put">;
}): Promise<void> {
  const rebuilding = rebuildingExecutionIndexState({
    generation: input.currentIndex.generation + 1,
    nowMs: input.nowMs,
    ownerUserId: input.currentIndex.ownerUserId,
    repairRequested: true,
  });
  await Promise.all([
    input.transaction.put(EXECUTION_INDEX_STORAGE_KEY, rebuilding),
    input.transaction.put(
      EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY,
      createActiveProfileIndexRecord(rebuilding.generation, [])
    ),
  ]);
}

async function persistExecutionIndexRepairFailure(input: {
  error: unknown;
  nowMs: number;
  state: Extract<AgentProfileExecutionIndexState, { status: "rebuilding" }>;
  storage: ExecutionAdmissionStorage;
}): Promise<void> {
  const failureCount = input.state.failureCount + 1;
  const failed: AgentProfileExecutionIndexState = {
    cursor: input.state.cursor,
    failureCount,
    generation: input.state.generation,
    modelVersion: EXECUTION_INDEX_MODEL_VERSION,
    ownerUserId: input.state.ownerUserId,
    phase: input.state.phase,
    reasonCode:
      input.error instanceof Error
        ? input.error.message
        : EXECUTION_STATE_UNAVAILABLE_REASON,
    repairRequested: input.state.repairRequested,
    retryAtMs:
      input.nowMs + resolveExecutionIndexRepairRetryDelayMs(failureCount),
    status: "failed",
    updatedAtMs: input.nowMs,
  };
  await input.storage.put(EXECUTION_INDEX_STORAGE_KEY, failed);
  console.warn("[runtime_coordinator.execution_index_repair_failed]", {
    error: failed.reasonCode,
    generation: failed.generation,
    ownerUserId: failed.ownerUserId,
    phase: failed.phase,
    retryAtMs: failed.retryAtMs,
  });
}

async function resolveAdmissionExecutionState(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
}): Promise<RuntimeTransportAgentProfileExecutionStateResponse> {
  if (input.admission.referencesOverflowed) {
    return unavailableExecutionState();
  }
  const headState = await readActiveHeadLifecycleReferences(input);
  if (headState.status !== "inactive") {
    return headState.status === "active"
      ? { status: "active" }
      : unavailableExecutionState();
  }
  const executionState = await readActiveExecutionReferences(input);
  if (executionState.status !== "inactive") {
    return executionState.status === "active"
      ? { status: "active" }
      : unavailableExecutionState();
  }
  return await pruneInactiveAdmissionReferences({
    ...input,
    staleExecutionIds: executionState.staleIds,
    staleHeadIds: headState.staleIds,
  });
}

type AdmissionReferenceState =
  | { status: "active" | "unavailable" }
  | { staleIds: Set<string>; status: "inactive" };

async function readActiveHeadLifecycleReferences(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
}): Promise<AdmissionReferenceState> {
  const staleIds = new Set<string>();
  const storageKeys = input.admission.activeHeadLifecycleIds.map(
    buildRuntimeCoordinatorHeadLifecycleStorageKey
  );
  const storedHeads =
    storageKeys.length > 0
      ? await input.storage.get<unknown>(storageKeys)
      : new Map<string, unknown>();
  const linkedExecutions: Array<{
    executionId: string;
    targetWakeLifecycleId: string;
  }> = [];
  for (const targetWakeLifecycleId of input.admission.activeHeadLifecycleIds) {
    const raw = storedHeads.get(
      buildRuntimeCoordinatorHeadLifecycleStorageKey(targetWakeLifecycleId)
    );
    if (!isRuntimeCoordinatorHeadLifecycleRecord(raw)) {
      return { status: "unavailable" };
    }
    if (
      raw.ownerUserId !== input.ownerUserId ||
      raw.targetWakeLifecycleIdentity.targetProfileId !==
        input.admission.targetProfileId
    ) {
      return { status: "unavailable" };
    }
    if (raw.status === "accepted" || raw.status === "waiting") {
      return { status: "active" };
    }
    if (raw.status === "execution_linked") {
      if (!raw.runtimeCoordinatorExecutionId) {
        return { status: "unavailable" };
      }
      linkedExecutions.push({
        executionId: raw.runtimeCoordinatorExecutionId,
        targetWakeLifecycleId,
      });
      continue;
    }
    staleIds.add(targetWakeLifecycleId);
  }
  const activity = await readExecutionAuthorityActivityBatch({
    executionIds: linkedExecutions.map((reference) => reference.executionId),
    storage: input.storage,
  });
  if (!activity) {
    return { status: "unavailable" };
  }
  for (const reference of linkedExecutions) {
    if (activity.get(reference.executionId)) {
      return { status: "active" };
    }
    staleIds.add(reference.targetWakeLifecycleId);
  }
  return { staleIds, status: "inactive" };
}

async function readActiveExecutionReferences(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  storage: ExecutionAdmissionStorage;
}): Promise<AdmissionReferenceState> {
  const activity = await readExecutionAuthorityActivityBatch({
    executionIds: input.admission.activeExecutionIds,
    storage: input.storage,
  });
  if (!activity) {
    return { status: "unavailable" };
  }
  const staleIds = new Set(
    input.admission.activeExecutionIds.filter(
      (executionId) => !activity.get(executionId)
    )
  );
  if (staleIds.size !== input.admission.activeExecutionIds.length) {
    return { status: "active" };
  }
  return { staleIds, status: "inactive" };
}

async function pruneInactiveAdmissionReferences(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  nowMs: number;
  staleExecutionIds: Set<string>;
  staleHeadIds: Set<string>;
  storage: ExecutionAdmissionStorage;
}): Promise<RuntimeTransportAgentProfileExecutionStateResponse> {
  const storageKey = buildExecutionAdmissionStorageKey(
    input.admission.targetProfileId
  );
  return await input.storage.transaction(async (transaction) => {
    const current = parseExecutionAdmissionRecord(
      await transaction.get<unknown>(storageKey)
    );
    if (!current || current.generation !== input.admission.generation) {
      return unavailableExecutionState();
    }
    const activeProfileIndex = parseActiveProfileIndexRecord(
      await transaction.get<unknown>(
        EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY
      ),
      current.generation
    );
    if (!activeProfileIndex) {
      return unavailableExecutionState();
    }
    const currentMutation = current.executionTargetMutation;
    const next = {
      ...current,
      activeExecutionIds: current.activeExecutionIds.filter(
        (id) => !input.staleExecutionIds.has(id)
      ),
      activeHeadLifecycleIds: current.activeHeadLifecycleIds.filter(
        (id) => !input.staleHeadIds.has(id)
      ),
      executionTargetMutation:
        currentMutation && currentMutation.expiresAtMs > input.nowMs
          ? currentMutation
          : null,
      revision: current.revision + 1,
      updatedAtMs: input.nowMs,
    } satisfies AgentProfileExecutionAdmissionRecord;
    const active = admissionHasActiveReferences(next);
    await Promise.all([
      shouldDeleteInactiveAdmission(next, input.nowMs)
        ? transaction.delete(storageKey)
        : transaction.put(storageKey, next),
      transaction.put(
        EXECUTION_ACTIVE_PROFILE_INDEX_STORAGE_KEY,
        createActiveProfileIndexRecord(
          current.generation,
          updateActiveProfileIds({
            active,
            activeProfileIds: activeProfileIndex.targetProfileIds,
            targetProfileId: next.targetProfileId,
          })
        )
      ),
    ]);
    if (active) {
      return { status: "active" as const };
    }
    return next.executionTargetMutation
      ? unavailableExecutionState(EXECUTION_TARGET_MUTATION_IN_PROGRESS_REASON)
      : { status: "inactive" as const };
  });
}

async function readExecutionAuthorityActivityBatch(input: {
  executionIds: readonly string[];
  storage: ExecutionAdmissionStorage;
}): Promise<Map<string, boolean> | null> {
  const executionIds = uniqueSorted(input.executionIds);
  if (executionIds.length === 0) {
    return new Map();
  }
  const storageKeys = executionIds.map(
    buildRuntimeCoordinatorTokenAuthorityStorageKey
  );
  const storedAuthorities = await input.storage.get<unknown>(storageKeys);
  const activity = new Map<string, boolean>();
  for (const executionId of executionIds) {
    const parsed =
      runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
        storedAuthorities.get(
          buildRuntimeCoordinatorTokenAuthorityStorageKey(executionId)
        )
      );
    if (!parsed.success) {
      return null;
    }
    activity.set(executionId, parsed.data.terminalOutcome === null);
  }
  return activity;
}

async function removeTerminalExecutionAgentProfileWorkAndPromoteSuccessor(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  dispatchId: string;
  nowMs: number;
  outcome: AgentProfileWorkSettleOutcome;
  runtimeCoordinatorExecutionId: string;
  transaction: DurableObjectTransaction;
}): Promise<{
  admission: AgentProfileExecutionAdmissionRecord;
  pendingPromotion: PendingAgentProfileWorkPromotion | null;
}> {
  const currentItem = input.admission.workItems.find(
    (item) => item.dispatchId === input.dispatchId
  );
  if (!currentItem) {
    return { admission: input.admission, pendingPromotion: null };
  }
  const rawHead = await input.transaction.get<unknown>(
    buildRuntimeCoordinatorHeadLifecycleStorageKey(
      currentItem.targetWakeLifecycleId
    )
  );
  if (
    !isRuntimeCoordinatorHeadLifecycleRecord(rawHead) ||
    rawHead.status !== "execution_linked" ||
    rawHead.runtimeCoordinatorExecutionId !==
      input.runtimeCoordinatorExecutionId ||
    rawHead.primaryDispatchId !== input.dispatchId ||
    rawHead.targetWakeLifecycleIdentity.targetProfileId !==
      input.admission.targetProfileId
  ) {
    throw new Error("agent_profile_work_coordinator.running_authority_invalid");
  }
  return await removeTerminalAgentProfileWorkAndPromoteSuccessor({
    admission: input.admission,
    dispatchId: input.dispatchId,
    nowMs: input.nowMs,
    outcome: input.outcome,
    targetWakeLifecycleId: currentItem.targetWakeLifecycleId,
    transaction: input.transaction,
  });
}

/**
 * Reconciles this Profile's ordered work against canonical Wake truth.
 *
 * The head lifecycle record and its execution token authority own what
 * happened to one Wake; `workItems` only claims a place in this Profile's
 * queue for it. When a head is missing or already terminal, its claim can
 * never move again: promotion requires a `queued` head, and the terminal
 * transition that would settle it has already run. The claim then holds its
 * reservation permanently, and because a `queued` head carries no deadline of
 * its own, every later Wake accumulates behind it at a growing position and
 * never dispatches. Active-reference repair cannot correct that — it rebuilds
 * references from canonical storage and cannot reconstruct queue metadata — so
 * admission reconciles the claims itself.
 *
 * Planning stays read-only: the caller applies the promotions once it knows
 * the surrounding admission transition will be persisted.
 *
 * A Coordinator paused Profile-wide is left untouched. Its recovery gate already
 * holds the reservation for a decision only the owner can make, and answering
 * that decision belongs to the recovery path. A gate limited to one occupied
 * context still lets the other contexts reconcile.
 */
async function resolveAgentProfileWorkReconciliation(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  isNewAdmission: boolean;
  nowMs: number;
  transaction: Pick<DurableObjectTransaction, "get">;
}): Promise<{
  admission: AgentProfileExecutionAdmissionRecord;
  promotedItems: AgentProfileWorkCoordinatorItem[];
}> {
  if (
    !input.isNewAdmission ||
    input.admission.workItems.length === 0 ||
    isAgentProfileWorkRecoveryGateProfileWide(input.admission.recoveryGate)
  ) {
    return { admission: input.admission, promotedItems: [] };
  }
  const retired = await resolveRetiredAgentProfileWork(input);
  if (retired.targetWakeLifecycleIds.size === 0) {
    return { admission: input.admission, promotedItems: [] };
  }
  const dropped = dropRetiredAgentProfileWork({
    coordinator: projectAgentProfileWorkCoordinator(input.admission),
    nowMs: input.nowMs,
    retiredTargetWakeLifecycleIds: retired.targetWakeLifecycleIds,
  });
  console.warn("[runtime_coordinator.agent_profile_retired_work_dropped]", {
    promotedTargetWakeLifecycleIds: dropped.promotedItems.map(
      (item) => item.targetWakeLifecycleId
    ),
    retiredTargetWakeLifecycleIds: dropped.removedItems.map(
      (item) => item.targetWakeLifecycleId
    ),
    targetProfileId: input.admission.targetProfileId,
  });
  return {
    admission: {
      ...input.admission,
      activeExecutionIds: input.admission.activeExecutionIds.filter(
        (executionId) => !retired.executionIds.has(executionId)
      ),
      activeHeadLifecycleIds: input.admission.activeHeadLifecycleIds.filter(
        (targetWakeLifecycleId) =>
          !retired.targetWakeLifecycleIds.has(targetWakeLifecycleId)
      ),
      revision: dropped.coordinator.revision,
      updatedAtMs: dropped.coordinator.updatedAtMs,
      workItems: dropped.coordinator.workItems,
    },
    promotedItems: dropped.promotedItems,
  };
}

async function applyAgentProfileWorkReconciliationPromotions(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  nowMs: number;
  promotedItems: readonly AgentProfileWorkCoordinatorItem[];
  transaction: DurableObjectTransaction;
}): Promise<{
  admission: AgentProfileExecutionAdmissionRecord;
  pendingPromotion: PendingAgentProfileWorkPromotion | null;
}> {
  let admission = input.admission;
  let pendingPromotion: PendingAgentProfileWorkPromotion | null = null;
  for (const item of input.promotedItems) {
    const promotion = await promoteAgentProfileWorkItem({
      admission,
      item,
      nowMs: input.nowMs,
      transaction: input.transaction,
    });
    admission = promotion.admission;
    pendingPromotion ??= promotion.pendingPromotion;
  }
  return { admission, pendingPromotion };
}

/**
 * Names the work whose Wake can no longer reach this queue.
 *
 * Only proven-retired work is named. Missing or unreadable execution authority
 * keeps its claim, because a live execution must never lose its reservation to
 * a storage read this transaction cannot interpret.
 */
async function resolveRetiredAgentProfileWork(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  transaction: Pick<DurableObjectTransaction, "get">;
}): Promise<{
  executionIds: Set<string>;
  targetWakeLifecycleIds: Set<string>;
}> {
  const storedHeads = await input.transaction.get<unknown>(
    input.admission.workItems.map((item) =>
      buildRuntimeCoordinatorHeadLifecycleStorageKey(item.targetWakeLifecycleId)
    )
  );
  const executionIds = new Set<string>();
  const targetWakeLifecycleIds = new Set<string>();
  const linkedExecutions: Array<{
    executionId: string;
    targetWakeLifecycleId: string;
  }> = [];
  for (const item of input.admission.workItems) {
    const rawHead = storedHeads.get(
      buildRuntimeCoordinatorHeadLifecycleStorageKey(item.targetWakeLifecycleId)
    );
    if (
      !isRuntimeCoordinatorHeadLifecycleRecord(rawHead) ||
      rawHead.targetWakeLifecycleId !== item.targetWakeLifecycleId ||
      rawHead.targetWakeLifecycleIdentity.targetProfileId !==
        input.admission.targetProfileId ||
      isTerminalHeadLifecycleStatus(rawHead.status)
    ) {
      targetWakeLifecycleIds.add(item.targetWakeLifecycleId);
      continue;
    }
    if (
      rawHead.status === "execution_linked" &&
      rawHead.runtimeCoordinatorExecutionId
    ) {
      linkedExecutions.push({
        executionId: rawHead.runtimeCoordinatorExecutionId,
        targetWakeLifecycleId: item.targetWakeLifecycleId,
      });
    }
  }
  if (linkedExecutions.length === 0) {
    return { executionIds, targetWakeLifecycleIds };
  }
  const storedAuthorities = await input.transaction.get<unknown>(
    linkedExecutions.map((reference) =>
      buildRuntimeCoordinatorTokenAuthorityStorageKey(reference.executionId)
    )
  );
  for (const reference of linkedExecutions) {
    const parsed =
      runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
        storedAuthorities.get(
          buildRuntimeCoordinatorTokenAuthorityStorageKey(reference.executionId)
        )
      );
    if (parsed.success && parsed.data.terminalOutcome) {
      executionIds.add(reference.executionId);
      targetWakeLifecycleIds.add(reference.targetWakeLifecycleId);
    }
  }
  return { executionIds, targetWakeLifecycleIds };
}

async function resolveHeadTerminalWorkTransition(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  nowMs: number;
  record: RuntimeCoordinatorHeadLifecycleRecord;
  transaction: DurableObjectTransaction;
}): Promise<{
  admission: AgentProfileExecutionAdmissionRecord;
  pendingPromotion: PendingAgentProfileWorkPromotion | null;
}> {
  if (!isTerminalHeadLifecycleStatus(input.record.status)) {
    return { admission: input.admission, pendingPromotion: null };
  }
  return await removeTerminalAgentProfileWorkAndPromoteSuccessor({
    admission: input.admission,
    dispatchId: input.record.primaryDispatchId,
    nowMs: input.nowMs,
    ...(input.record.status === "stopped_before_execution"
      ? { outcome: "stopped" as const }
      : {}),
    targetWakeLifecycleId: input.record.targetWakeLifecycleId,
    transaction: input.transaction,
  });
}

async function removeTerminalAgentProfileWorkAndPromoteSuccessor(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  dispatchId: string;
  nowMs: number;
  outcome?: AgentProfileWorkSettleOutcome;
  targetWakeLifecycleId: string;
  transaction: DurableObjectTransaction;
}): Promise<{
  admission: AgentProfileExecutionAdmissionRecord;
  pendingPromotion: PendingAgentProfileWorkPromotion | null;
}> {
  const currentItem = input.admission.workItems.find(
    (item) => item.targetWakeLifecycleId === input.targetWakeLifecycleId
  );
  if (!currentItem) {
    return { admission: input.admission, pendingPromotion: null };
  }
  if (currentItem.dispatchId !== input.dispatchId) {
    throw new Error(
      "agent_profile_work_coordinator.dispatch_authority_invalid"
    );
  }
  const coordinator = projectAgentProfileWorkCoordinator(input.admission);
  if (
    input.outcome === "succeeded" &&
    coordinator.recoveryGate?.status === "continuation_running" &&
    coordinator.workItems[0]?.targetWakeLifecycleId ===
      input.targetWakeLifecycleId &&
    coordinator.recoveryGate.forkInterruptedConversation &&
    coordinator.recoveryGate.interruptedWork.executionContextId &&
    currentItem.executionContextId
  ) {
    await retireRecoveredContextSourceAssociation({
      storage: input.transaction,
      sourceContextId:
        coordinator.recoveryGate.interruptedWork.executionContextId,
      replacementContextId: currentItem.executionContextId,
    });
  }
  const removal = input.outcome
    ? settleAgentProfileWork({
        coordinator,
        nowMs: input.nowMs,
        outcome: input.outcome,
        targetWakeLifecycleId: input.targetWakeLifecycleId,
      })
    : removeAgentProfileWork({
        coordinator,
        nowMs: input.nowMs,
        targetWakeLifecycleId: input.targetWakeLifecycleId,
      });
  if (!removal.removed) {
    return { admission: input.admission, pendingPromotion: null };
  }

  let nextAdmission = {
    ...input.admission,
    recoveryGate: removal.coordinator.recoveryGate,
    revision: removal.coordinator.revision,
    updatedAtMs: removal.coordinator.updatedAtMs,
    workItems: removal.coordinator.workItems,
  } satisfies AgentProfileExecutionAdmissionRecord;
  if (
    coordinator.recoveryGate?.status === "continuation_running" &&
    removal.coordinator.recoveryGate === null
  ) {
    const retiredHeadId =
      coordinator.recoveryGate.interruptedWork.targetWakeLifecycleId;
    const rawLegacyIds = await input.transaction.get<unknown>(
      RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY
    );
    nextAdmission = removeRetiredHeadReference(nextAdmission, retiredHeadId);
    await Promise.all([
      input.transaction.delete(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(retiredHeadId)
      ),
      input.transaction.put(
        RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY,
        normalizeLegacyIndex(rawLegacyIds).filter(
          (targetWakeLifecycleId) => targetWakeLifecycleId !== retiredHeadId
        )
      ),
    ]);
  }
  if (
    coordinator.recoveryGate?.status === "continuation_running" &&
    (removal.coordinator.recoveryGate?.status === "awaiting_owner_approval" ||
      removal.coordinator.recoveryGate?.status ===
        "continuation_needs_attention")
  ) {
    await Promise.all([
      writeAgentProfileWorkRecoveryInboxProjectionIntent({
        intent: buildAgentProfileWorkRecoveryInboxProjectionIntent({
          desiredStatus: "open",
          occurredAtMs: removal.coordinator.recoveryGate.updatedAtMs,
          stage:
            removal.coordinator.recoveryGate.status ===
            "continuation_needs_attention"
              ? "review_interrupted_work"
              : "approve_queued_work",
          targetProfileId: input.admission.targetProfileId,
          targetWakeLifecycleId:
            removal.coordinator.recoveryGate.interruptedWork
              .targetWakeLifecycleId,
          updatedAtMs: input.nowMs,
        }),
        storage: input.transaction,
      }),
      input.transaction.setAlarm(input.nowMs),
    ]);
  }
  if (
    !coordinator.recoveryGate &&
    removal.coordinator.recoveryGate?.status === "awaiting_occupancy_decision"
  ) {
    await Promise.all([
      writeAgentProfileWorkRecoveryInboxProjectionIntent({
        intent: buildAgentProfileWorkRecoveryInboxProjectionIntent({
          desiredStatus: "open",
          occurredAtMs: removal.coordinator.recoveryGate.updatedAtMs,
          stage: "resolve_occupied_conversation",
          targetProfileId: input.admission.targetProfileId,
          targetWakeLifecycleId:
            removal.coordinator.recoveryGate.interruptedWork
              .targetWakeLifecycleId,
          updatedAtMs: input.nowMs,
        }),
        storage: input.transaction,
      }),
      input.transaction.setAlarm(input.nowMs),
    ]);
  }
  if (
    coordinator.recoveryGate?.status === "awaiting_owner_approval" &&
    removal.coordinator.recoveryGate === null
  ) {
    await Promise.all([
      writeAgentProfileWorkRecoveryInboxProjectionIntent({
        intent: buildAgentProfileWorkRecoveryInboxProjectionIntent({
          desiredStatus: "resolved",
          occurredAtMs: coordinator.recoveryGate.updatedAtMs,
          stage: "approve_queued_work",
          targetProfileId: input.admission.targetProfileId,
          targetWakeLifecycleId:
            coordinator.recoveryGate.interruptedWork.targetWakeLifecycleId,
          updatedAtMs: input.nowMs,
        }),
        storage: input.transaction,
      }),
      input.transaction.setAlarm(input.nowMs),
    ]);
  }
  let pendingPromotion: PendingAgentProfileWorkPromotion | null = null;
  if (nextAdmission.contextMigration?.status === "draining") {
    await input.transaction.setAlarm(input.nowMs);
  }
  for (const item of removal.promotedItems) {
    const promotion = await promoteAgentProfileWorkItem({
      admission: nextAdmission,
      item,
      nowMs: input.nowMs,
      transaction: input.transaction,
    });
    nextAdmission = promotion.admission;
    pendingPromotion ??= promotion.pendingPromotion;
  }
  return { admission: nextAdmission, pendingPromotion };
}

async function promoteAgentProfileWorkItem(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  item: AgentProfileWorkCoordinatorItem;
  nowMs: number;
  transaction: DurableObjectTransaction;
}): Promise<{
  admission: AgentProfileExecutionAdmissionRecord;
  pendingPromotion: PendingAgentProfileWorkPromotion;
}> {
  const promotedHeadStorageKey = buildRuntimeCoordinatorHeadLifecycleStorageKey(
    input.item.targetWakeLifecycleId
  );
  const rawPromotedHead = await input.transaction.get<unknown>(
    promotedHeadStorageKey
  );
  if (
    !isRuntimeCoordinatorHeadLifecycleRecord(rawPromotedHead) ||
    rawPromotedHead.status !== "queued" ||
    rawPromotedHead.primaryDispatchId !== input.item.dispatchId ||
    rawPromotedHead.targetWakeLifecycleIdentity.targetProfileId !==
      input.admission.targetProfileId
  ) {
    throw new Error("agent_profile_work_coordinator.queued_head_invalid");
  }
  const promotedHead = {
    ...rawPromotedHead,
    acceptedAtMs: input.nowMs,
    status: "accepted",
    updatedAtMs: input.nowMs,
  } satisfies RuntimeCoordinatorHeadLifecycleRecord;
  const headReferences = appendBoundedReferences(
    input.admission.activeHeadLifecycleIds,
    [promotedHead.targetWakeLifecycleId]
  );
  const nextAdmission = {
    ...input.admission,
    activeHeadLifecycleIds: headReferences.ids,
    referencesOverflowed:
      input.admission.referencesOverflowed || headReferences.overflowed,
  };
  const pendingPromotion = buildPendingAgentProfileWorkPromotion({
    dispatchId: promotedHead.primaryDispatchId,
    nowMs: input.nowMs,
    targetProfileId: input.admission.targetProfileId,
    targetWakeLifecycleId: promotedHead.targetWakeLifecycleId,
  });
  await Promise.all([
    input.transaction.put(promotedHeadStorageKey, promotedHead),
    input.transaction.put(
      buildPendingAgentProfileWorkPromotionStorageKey(
        pendingPromotion.targetProfileId,
        pendingPromotion.targetWakeLifecycleId
      ),
      pendingPromotion
    ),
    input.transaction.setAlarm(input.nowMs),
  ]);
  return { admission: nextAdmission, pendingPromotion };
}

function isTerminalHeadLifecycleStatus(
  status: RuntimeCoordinatorHeadLifecycleRecord["status"]
): boolean {
  return (
    status === "publication_intent_ready" ||
    status === "stopped_before_execution"
  );
}

function isHeadFinalPublicationVisible(
  record: RuntimeCoordinatorHeadLifecycleRecord
): boolean {
  return (
    record.status === "publication_intent_ready" &&
    (record.publicationOutcome?.status === "failure_published" ||
      record.publicationOutcome?.status === "already_final")
  );
}

function applyHeadLifecycleToAdmission(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  nowMs: number;
  record: RuntimeCoordinatorHeadLifecycleRecord;
}): AgentProfileExecutionAdmissionRecord {
  let activeHeadLifecycleIds = input.admission.activeHeadLifecycleIds;
  let activeExecutionIds = input.admission.activeExecutionIds;
  let referencesOverflowed = input.admission.referencesOverflowed;
  if (input.record.status === "accepted" || input.record.status === "waiting") {
    const appended = appendBoundedReferences(activeHeadLifecycleIds, [
      input.record.targetWakeLifecycleId,
    ]);
    activeHeadLifecycleIds = appended.ids;
    referencesOverflowed ||= appended.overflowed;
  } else {
    activeHeadLifecycleIds = activeHeadLifecycleIds.filter(
      (id) => id !== input.record.targetWakeLifecycleId
    );
  }
  if (input.record.status === "execution_linked") {
    if (!input.record.runtimeCoordinatorExecutionId) {
      throw new Error("runtime_coordinator.head_execution_authority_missing");
    }
    const appended = appendBoundedReferences(activeExecutionIds, [
      input.record.runtimeCoordinatorExecutionId,
    ]);
    activeExecutionIds = appended.ids;
    referencesOverflowed ||= appended.overflowed;
  }
  return {
    ...input.admission,
    activeExecutionIds,
    activeHeadLifecycleIds,
    referencesOverflowed,
    revision: input.admission.revision + 1,
    updatedAtMs: input.nowMs,
  };
}

function emptyExecutionAdmissionRecord(input: {
  executionTargetMutation?: ExecutionTargetMutationLease | null;
  generation: number;
  nowMs: number;
  targetProfileId: string;
}): AgentProfileExecutionAdmissionRecord {
  const coordinator = createAgentProfileWorkCoordinator({
    nowMs: input.nowMs,
    targetProfileId: input.targetProfileId,
  });
  return {
    activeExecutionIds: [],
    activeHeadLifecycleIds: [],
    executionTargetMutation: input.executionTargetMutation ?? null,
    generation: input.generation,
    modelVersion: EXECUTION_ADMISSION_MODEL_VERSION,
    referencesOverflowed: false,
    recoveryGate: coordinator.recoveryGate,
    revision: coordinator.revision,
    targetProfileId: input.targetProfileId,
    updatedAtMs: input.nowMs,
    workItems: coordinator.workItems,
  };
}

function carryExecutionAdmissionIntoGeneration(input: {
  admission: AgentProfileExecutionAdmissionRecord | null;
  generation: number;
  nowMs: number;
  targetProfileId: string;
}): AgentProfileExecutionAdmissionRecord {
  if (!input.admission) {
    return emptyExecutionAdmissionRecord(input);
  }
  if (input.admission.targetProfileId !== input.targetProfileId) {
    throw new Error("runtime_coordinator.execution_admission_profile_mismatch");
  }
  return {
    ...input.admission,
    activeExecutionIds: [],
    activeHeadLifecycleIds: [],
    generation: input.generation,
    referencesOverflowed: false,
    updatedAtMs: input.nowMs,
  };
}

function rebuildingExecutionIndexState(input: {
  generation: number;
  nowMs: number;
  ownerUserId: string;
  repairRequested: boolean;
}): AgentProfileExecutionIndexState {
  return {
    cursor: null,
    failureCount: 0,
    generation: input.generation,
    modelVersion: EXECUTION_INDEX_MODEL_VERSION,
    ownerUserId: input.ownerUserId,
    phase: "head_lifecycles",
    repairRequested: input.repairRequested,
    status: "rebuilding",
    updatedAtMs: input.nowMs,
  };
}

function parseExecutionAdmissionRecord(
  value: unknown
): AgentProfileExecutionAdmissionRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<AgentProfileExecutionAdmissionRecord>;
  const modelVersion = (value as { modelVersion?: unknown }).modelVersion;
  const recoveryGate = parseAgentProfileWorkRecoveryGateOrLegacy(
    record.recoveryGate
  );
  if (
    (modelVersion !== EXECUTION_ADMISSION_MODEL_VERSION &&
      modelVersion !== PREVIOUS_EXECUTION_ADMISSION_MODEL_VERSION &&
      modelVersion !== ORIGINAL_WORK_COORDINATOR_MODEL_VERSION &&
      modelVersion !== LEGACY_EXECUTION_ADMISSION_MODEL_VERSION) ||
    !isPositiveInteger(record.generation) ||
    !isNonnegativeInteger(record.revision) ||
    typeof record.targetProfileId !== "string" ||
    !isNonnegativeInteger(record.updatedAtMs) ||
    !isStringArray(record.activeExecutionIds) ||
    record.activeExecutionIds.length >
      MAX_EXECUTION_ADMISSION_REFERENCES_PER_KIND ||
    !isStringArray(record.activeHeadLifecycleIds) ||
    record.activeHeadLifecycleIds.length >
      MAX_EXECUTION_ADMISSION_REFERENCES_PER_KIND ||
    typeof record.referencesOverflowed !== "boolean" ||
    !isExecutionTargetMutationLeaseOrNull(record.executionTargetMutation) ||
    recoveryGate === undefined ||
    !isAgentProfileContextMigration(record.contextMigration) ||
    (record.admissionMode !== undefined &&
      record.admissionMode !== "parallel" &&
      record.admissionMode !== "serial") ||
    !isAgentProfileWorkCoordinatorItemsOrLegacy(record.workItems)
  ) {
    return null;
  }
  return {
    ...(record as AgentProfileExecutionAdmissionRecord),
    modelVersion: EXECUTION_ADMISSION_MODEL_VERSION,
    recoveryGate,
    workItems: record.workItems ?? [],
  };
}

function parseAgentProfileWorkRecoveryGateOrLegacy(
  value: unknown
): AgentProfileWorkRecoveryGate | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const gate = value as Partial<AgentProfileWorkRecoveryGate>;
  const rawStatus = (value as { status?: unknown }).status;
  const status =
    rawStatus === "awaiting_owner_continuation"
      ? "continuation_pending"
      : rawStatus;
  const validStatus =
    status === "awaiting_occupancy_decision" ||
    status === "awaiting_usage" ||
    status === "continuation_pending" ||
    status === "continuation_authorized" ||
    status === "continuation_running" ||
    status === "continuation_needs_attention" ||
    status === "awaiting_owner_approval";
  const continuationClientMessageIdValid =
    gate.continuationClientMessageId === null ||
    (typeof gate.continuationClientMessageId === "string" &&
      gate.continuationClientMessageId.length > 0);
  const interruptedWorkValid = isAgentProfileWorkCoordinatorItemsOrLegacy([
    gate.interruptedWork,
  ]);
  if (
    validStatus &&
    continuationClientMessageIdValid &&
    interruptedWorkValid &&
    isAgentProfileWorkCoordinatorItemsOrLegacy(
      gate.additionalInterruptedWork
    ) &&
    isNonnegativeInteger(gate.updatedAtMs) &&
    (status === "continuation_authorized"
      ? typeof gate.continuationClientMessageId === "string"
      : status === "continuation_needs_attention" ||
        gate.continuationClientMessageId === null)
  ) {
    return {
      ...(gate.cause === "controller_conversation_occupied"
        ? { cause: gate.cause }
        : {}),
      continuationClientMessageId: gate.continuationClientMessageId ?? null,
      ...(gate.forkInterruptedConversation !== undefined
        ? {
            forkInterruptedConversation: Boolean(
              gate.forkInterruptedConversation
            ),
          }
        : {}),
      interruptedWork: gate.interruptedWork as AgentProfileWorkCoordinatorItem,
      ...(gate.additionalInterruptedWork
        ? { additionalInterruptedWork: gate.additionalInterruptedWork }
        : {}),
      status,
      updatedAtMs: gate.updatedAtMs as number,
    };
  }
  return undefined;
}

function isAgentProfileWorkCoordinatorItemsOrLegacy(
  value: unknown
): value is AgentProfileWorkCoordinatorItem[] | undefined {
  if (value === undefined) {
    return true;
  }
  if (
    !Array.isArray(value) ||
    value.length >
      AGENT_PROFILE_WORK_READABLE_RESERVATION_LIMIT +
        AGENT_PROFILE_WORK_MAX_WAITING
  ) {
    return false;
  }
  const lifecycleIds = new Set<string>();
  const dispatchIds = new Set<string>();
  const reservedContexts = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return false;
    }
    const candidate = item as Partial<AgentProfileWorkCoordinatorItem>;
    if (!isContextReservationValid(candidate)) {
      return false;
    }
    if (!collectDistinctContextReservation(candidate, reservedContexts)) {
      return false;
    }
    if (
      typeof candidate.dispatchId !== "string" ||
      candidate.dispatchId.length === 0 ||
      !isNonnegativeInteger(candidate.enqueuedAtMs) ||
      typeof candidate.targetWakeLifecycleId !== "string" ||
      candidate.targetWakeLifecycleId.length === 0 ||
      lifecycleIds.has(candidate.targetWakeLifecycleId) ||
      dispatchIds.has(candidate.dispatchId)
    ) {
      return false;
    }
    if (
      candidate.waitReason !== undefined &&
      candidate.waitReason !== "controller_conversation_occupied"
    ) {
      return false;
    }
    lifecycleIds.add(candidate.targetWakeLifecycleId);
    dispatchIds.add(candidate.dispatchId);
  }
  return (
    value.filter((item, index) =>
      item.executionContextId
        ? item.reservationState === "waiting"
        : index !== 0
    ).length <= AGENT_PROFILE_WORK_MAX_WAITING
  );
}

function collectDistinctContextReservation(
  item: Partial<AgentProfileWorkCoordinatorItem>,
  reserved: Set<string>
): boolean {
  if (item.reservationState !== "reserved" || !item.executionContextId) {
    return true;
  }
  if (
    reserved.has(item.executionContextId) ||
    reserved.size >= AGENT_PROFILE_WORK_READABLE_RESERVATION_LIMIT
  ) {
    return false;
  }
  reserved.add(item.executionContextId);
  return true;
}

function isContextReservationValid(
  item: Partial<AgentProfileWorkCoordinatorItem>
): boolean {
  if (item.executionContextId === undefined) {
    return item.reservationState === undefined;
  }
  return (
    typeof item.executionContextId === "string" &&
    item.executionContextId.trim().length > 0 &&
    (item.reservationState === "reserved" ||
      item.reservationState === "waiting")
  );
}

function parseExecutionIndexState(
  value: unknown
): AgentProfileExecutionIndexState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const state = value as Partial<AgentProfileExecutionIndexState>;
  if (
    state.modelVersion !== EXECUTION_INDEX_MODEL_VERSION ||
    !isPositiveInteger(state.generation) ||
    typeof state.ownerUserId !== "string" ||
    state.ownerUserId.length === 0 ||
    !isNonnegativeInteger(state.updatedAtMs)
  ) {
    return null;
  }
  if (state.status === "ready") {
    return state as AgentProfileExecutionIndexState;
  }
  if (
    state.status === "rebuilding" &&
    isNonnegativeInteger(state.failureCount) &&
    typeof state.repairRequested === "boolean" &&
    isExecutionIndexRepairPhase(state.phase) &&
    (state.cursor === null || typeof state.cursor === "string")
  ) {
    return state as AgentProfileExecutionIndexState;
  }
  if (
    state.status === "failed" &&
    isNonnegativeInteger(state.failureCount) &&
    isExecutionIndexRepairPhase(state.phase) &&
    (state.cursor === null || typeof state.cursor === "string") &&
    typeof state.reasonCode === "string" &&
    typeof state.repairRequested === "boolean" &&
    isNonnegativeInteger(state.retryAtMs)
  ) {
    return state as AgentProfileExecutionIndexState;
  }
  return null;
}

function isExecutionIndexRepairPhase(
  value: unknown
): value is AgentProfileExecutionIndexRepairPhase {
  return (
    value === "head_lifecycles" ||
    value === "run_command_states" ||
    value === "admissions"
  );
}

function buildExecutionAdmissionStorageKey(targetProfileId: string): string {
  return `${EXECUTION_ADMISSION_STORAGE_KEY_PREFIX}${encodeURIComponent(
    targetProfileId
  )}`;
}

function parseExecutionAdmissionStorageKey(key: string): string | null {
  if (!key.startsWith(EXECUTION_ADMISSION_STORAGE_KEY_PREFIX)) {
    return null;
  }
  try {
    const targetProfileId = decodeURIComponent(
      key.slice(EXECUTION_ADMISSION_STORAGE_KEY_PREFIX.length)
    );
    return targetProfileId &&
      buildExecutionAdmissionStorageKey(targetProfileId) === key
      ? targetProfileId
      : null;
  } catch {
    return null;
  }
}

function nextExecutionIndexGeneration(raw: unknown): number {
  if (raw && typeof raw === "object") {
    const generation = (raw as { generation?: unknown }).generation;
    if (isPositiveInteger(generation)) {
      return generation + 1;
    }
  }
  return 1;
}

function observeActiveHead(
  observations: ActiveObservationsByProfile,
  targetProfileId: string,
  targetWakeLifecycleId: string
): void {
  readOrCreateProfileObservations(
    observations,
    targetProfileId
  ).headLifecycleIds.add(targetWakeLifecycleId);
}

function observeActiveExecution(
  observations: ActiveObservationsByProfile,
  targetProfileId: string,
  executionId: string
): void {
  readOrCreateProfileObservations(
    observations,
    targetProfileId
  ).executionIds.add(executionId);
}

function readOrCreateProfileObservations(
  observations: ActiveObservationsByProfile,
  targetProfileId: string
): { executionIds: Set<string>; headLifecycleIds: Set<string> } {
  const existing = observations.get(targetProfileId);
  if (existing) {
    return existing;
  }
  const created = {
    executionIds: new Set<string>(),
    headLifecycleIds: new Set<string>(),
  };
  observations.set(targetProfileId, created);
  return created;
}

function normalizeLegacyIndex(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueSorted(
        value.filter(
          (entry): entry is string =>
            typeof entry === "string" && entry.length > 0
        )
      )
    : [];
}

function resolveHeadLifecycleIndexIds(input: {
  legacyIds: readonly string[];
  record: RuntimeCoordinatorHeadLifecycleRecord;
}): string[] {
  if (isHeadFinalPublicationVisible(input.record)) {
    return input.legacyIds.filter(
      (targetWakeLifecycleId) =>
        targetWakeLifecycleId !== input.record.targetWakeLifecycleId
    );
  }
  return input.legacyIds.includes(input.record.targetWakeLifecycleId)
    ? [...input.legacyIds]
    : [...input.legacyIds, input.record.targetWakeLifecycleId].sort();
}

function createActiveProfileIndexRecord(
  generation: number,
  targetProfileIds: readonly string[]
): AgentProfileActiveIndexRecord {
  return {
    generation,
    modelVersion: EXECUTION_ACTIVE_PROFILE_INDEX_MODEL_VERSION,
    targetProfileIds: uniqueSorted(targetProfileIds),
  };
}

function resolveActiveProfileIndexForWrite(input: {
  generation: number;
  indexReady: boolean;
  raw: unknown;
}): AgentProfileActiveIndexRecord | null {
  if (input.raw !== undefined) {
    return parseActiveProfileIndexRecord(input.raw, input.generation);
  }
  if (input.indexReady) {
    return null;
  }
  return createActiveProfileIndexRecord(input.generation, []);
}

function parseActiveProfileIndexRecord(
  value: unknown,
  expectedGeneration: number
): AgentProfileActiveIndexRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<AgentProfileActiveIndexRecord>;
  if (
    record.modelVersion !== EXECUTION_ACTIVE_PROFILE_INDEX_MODEL_VERSION ||
    record.generation !== expectedGeneration ||
    !isStringArray(record.targetProfileIds)
  ) {
    return null;
  }
  return createActiveProfileIndexRecord(
    expectedGeneration,
    record.targetProfileIds
  );
}

function updateActiveProfileIds(input: {
  active: boolean;
  activeProfileIds: readonly string[];
  targetProfileId: string;
}): string[] {
  return input.active
    ? uniqueSorted([...input.activeProfileIds, input.targetProfileId])
    : input.activeProfileIds.filter(
        (profileId) => profileId !== input.targetProfileId
      );
}

function admissionHasActiveReferences(
  admission: AgentProfileExecutionAdmissionRecord
): boolean {
  return (
    admission.referencesOverflowed ||
    admission.recoveryGate !== null ||
    admission.workItems.length > 0 ||
    admission.activeExecutionIds.length > 0 ||
    admission.activeHeadLifecycleIds.length > 0
  );
}

function admissionBlocksExecutionTargetMutation(
  admission: AgentProfileExecutionAdmissionRecord
): boolean {
  return (
    admission.referencesOverflowed ||
    admission.activeExecutionIds.length > 0 ||
    admission.activeHeadLifecycleIds.length > 0 ||
    admission.recoveryGate?.status === "continuation_running"
  );
}

function admissionRetainsHeadLifecycle(
  admission: AgentProfileExecutionAdmissionRecord,
  targetWakeLifecycleId: string
): boolean {
  return (
    admission.activeHeadLifecycleIds.includes(targetWakeLifecycleId) ||
    admission.workItems.some(
      (item) => item.targetWakeLifecycleId === targetWakeLifecycleId
    ) ||
    admission.recoveryGate?.interruptedWork.targetWakeLifecycleId ===
      targetWakeLifecycleId ||
    admission.recoveryGate?.additionalInterruptedWork?.some(
      (item) => item.targetWakeLifecycleId === targetWakeLifecycleId
    ) === true
  );
}

function removeRetiredHeadReference(
  admission: AgentProfileExecutionAdmissionRecord,
  targetWakeLifecycleId: string
): AgentProfileExecutionAdmissionRecord {
  if (
    admission.workItems.some(
      (item) => item.targetWakeLifecycleId === targetWakeLifecycleId
    ) ||
    admission.recoveryGate?.interruptedWork.targetWakeLifecycleId ===
      targetWakeLifecycleId ||
    admission.recoveryGate?.additionalInterruptedWork?.some(
      (item) => item.targetWakeLifecycleId === targetWakeLifecycleId
    ) === true
  ) {
    return admission;
  }
  return {
    ...admission,
    activeHeadLifecycleIds: admission.activeHeadLifecycleIds.filter(
      (id) => id !== targetWakeLifecycleId
    ),
  };
}

function currentStateReferenceRetainsHead(
  value: unknown,
  targetWakeLifecycleId: string
): boolean {
  return (
    value !== undefined &&
    (!value ||
      typeof value !== "object" ||
      typeof (value as { targetWakeLifecycleId?: unknown })
        .targetWakeLifecycleId !== "string" ||
      (value as { targetWakeLifecycleId: string }).targetWakeLifecycleId ===
        targetWakeLifecycleId)
  );
}

function shouldDeleteInactiveAdmission(
  admission: AgentProfileExecutionAdmissionRecord,
  nowMs: number
): boolean {
  return !(
    admission.contextMigration ||
    admission.admissionMode ||
    admissionHasActiveReferences(admission) ||
    (admission.executionTargetMutation &&
      admission.executionTargetMutation.expiresAtMs > nowMs)
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function appendBoundedReferences(
  currentIds: readonly string[],
  addedIds: readonly string[]
): { ids: string[]; overflowed: boolean } {
  const ids = uniqueSorted([...currentIds, ...addedIds]);
  return {
    ids: ids.slice(0, MAX_EXECUTION_ADMISSION_REFERENCES_PER_KIND),
    overflowed: ids.length > MAX_EXECUTION_ADMISSION_REFERENCES_PER_KIND,
  };
}

function resolveExecutionIndexRepairRetryDelayMs(failureCount: number): number {
  return Math.min(
    EXECUTION_INDEX_REPAIR_RETRY_MAX_MS,
    EXECUTION_INDEX_REPAIR_RETRY_BASE_MS *
      2 ** Math.min(Math.max(failureCount - 1, 0), 6)
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

function isExecutionTargetMutationLeaseOrNull(
  value: unknown
): value is ExecutionTargetMutationLease | null {
  if (value === null) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const lease = value as Partial<ExecutionTargetMutationLease>;
  return (
    isNonnegativeInteger(lease.expiresAtMs) &&
    typeof lease.operationId === "string" &&
    lease.operationId.length > 0 &&
    isNonnegativeInteger(lease.startedAtMs)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function unavailableExecutionState(
  reasonCode = EXECUTION_STATE_UNAVAILABLE_REASON
): RuntimeTransportAgentProfileExecutionStateResponse {
  return { reasonCode, status: "unavailable" };
}

async function readStorageValuesInBatches(
  storage: Pick<DurableObjectStorage, "get">,
  keys: readonly string[]
): Promise<Map<string, unknown>> {
  if (keys.length === 0) {
    return new Map();
  }
  const batches: string[][] = [];
  for (
    let offset = 0;
    offset < keys.length;
    offset += DURABLE_OBJECT_STORAGE_GET_MAX_KEYS
  ) {
    batches.push(
      keys.slice(offset, offset + DURABLE_OBJECT_STORAGE_GET_MAX_KEYS)
    );
  }
  const values = new Map<string, unknown>();
  for (
    let offset = 0;
    offset < batches.length;
    offset += DURABLE_OBJECT_STORAGE_GET_MAX_CONCURRENCY
  ) {
    const results = await Promise.all(
      batches
        .slice(offset, offset + DURABLE_OBJECT_STORAGE_GET_MAX_CONCURRENCY)
        .map((batch) => storage.get<unknown>(batch))
    );
    for (const result of results) {
      for (const [key, value] of result) {
        values.set(key, value);
      }
    }
  }
  return values;
}

// Kept exported for storage-level tests and compatibility repair diagnostics.
export const runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys = {
  admission: buildExecutionAdmissionStorageKey,
  index: EXECUTION_INDEX_STORAGE_KEY,
  pendingPromotion: buildPendingAgentProfileWorkPromotionStorageKey,
} as const;
