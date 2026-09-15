import {
  buildRuntimeCoordinatorExecutionId,
  runtimeCoordinatorExecutionTokenAuthorityRecordSchema,
} from "@openmeld/schemas";
import type {
  RuntimeCoordinatorExecutionTokenAuthorityRecord,
  RuntimeTransportAgentProfileExecutionStateResponse,
  RuntimeTransportAgentProfileExecutionTargetMutationAcquireResponse,
  RuntimeTransportAgentProfileExecutionTargetMutationReleaseResponse,
  RuntimeTransportAgentProfileOperationalContextsResponse,
  RuntimeTransportAgentProfileWorkRecoveryReadResponse,
} from "@openmeld/schemas/types";
import {
  type AgentProfileWorkCoordinator,
  type AgentProfileWorkCoordinatorItem,
  type AgentProfileWorkRecoveryGate,
  acceptAgentProfileWork,
  approveAgentProfileWorkQueue,
  authorizeAgentProfileWorkContinuation,
  createAgentProfileWorkCoordinator,
  markAgentProfileWorkContinuationNeedsAttention,
  markAgentProfileWorkControllerConversationOccupancy,
  markAgentProfileWorkUsageAvailable,
  removeAgentProfileWork,
  settleAgentProfileWork,
  skipAgentProfileInterruptedWork,
  summarizeAgentProfileWorkCoordinator,
} from "./agent-profile-work-coordinator";
import {
  buildPendingAgentProfileWorkPromotion,
  buildPendingAgentProfileWorkPromotionStorageKey,
  type PendingAgentProfileWorkPromotion,
  parsePendingAgentProfileWorkPromotion,
} from "./agent-profile-work-promotion";
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
  buildRuntimeCoordinatorAcceptedDispatchPayloadFingerprintStorageKey,
  buildRuntimeCoordinatorHeadLifecycleStorageKey,
  buildRuntimeCoordinatorRunCommandStateStorageKey,
  buildRuntimeCoordinatorTokenAuthorityStorageKey,
  hasRuntimeCoordinatorDurableLocalProgress,
  isRuntimeCoordinatorAcceptedDispatchPayloadFingerprintRecord,
  isRuntimeCoordinatorHeadLifecycleRecord,
  isRuntimeCoordinatorRunCommandState,
  RUNTIME_COORDINATOR_ACCEPTED_DISPATCH_PAYLOAD_FINGERPRINT_MODEL_VERSION,
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
  "openmeld.runtime_coordinator.agent_profile_work_coordinator.v1" as const;
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
const EXECUTION_TARGET_MUTATION_LEASE_MS = 5 * 60_000;
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
        admission.workItems.map((item) =>
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
  const action = gate
    ? resolveAgentProfileWorkRecoveryAction(gate.status)
    : null;
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
    action,
    authorizedContinuationClientMessageId:
      gate.status === "continuation_authorized"
        ? gate.continuationClientMessageId
        : null,
    interruptedClientMessageId:
      head.targetWakeLifecycleIdentity.clientMessageId,
    interruptedDispatchId: head.primaryDispatchId,
    interruptedSourceSignalId: head.targetWakeLifecycleIdentity.sourceSignalId,
    interruptedTargetWakeLifecycleId: head.targetWakeLifecycleId,
    spaceId: head.targetWakeLifecycleIdentity.spaceId,
    status: "available",
  };
}

type AgentProfileOperationalContext =
  RuntimeTransportAgentProfileOperationalContextsResponse["contexts"][number]["operationalContext"];

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
  if (workSummary.status === "paused") {
    const recoveryAction = resolveAgentProfileWorkRecoveryAction(
      input.admission.recoveryGate?.status ?? null
    );
    return {
      operationalContext: {
        queuedWorkReferences: references as {
          sourceSignalId: string;
          spaceId: string;
        }[],
        ...(recoveryAction && input.admission.recoveryGate
          ? {
              recoveryAction,
              recoveryTargetWakeLifecycleId:
                input.admission.recoveryGate.interruptedWork
                  .targetWakeLifecycleId,
            }
          : {}),
        status: "paused",
        waitingCount: references.length,
      },
      repairRequired: false,
    };
  }
  const [currentWorkReference, ...queuedWorkReferences] = references;
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

function resolveAgentProfileWorkRecoveryAction(
  status: AgentProfileWorkRecoveryGate["status"] | null
):
  | "continue_interrupted_work"
  | "approve_queued_work"
  | "skip_interrupted_work"
  | null {
  switch (status) {
    case "continuation_pending":
    case "continuation_authorized":
      return "continue_interrupted_work";
    case "awaiting_owner_approval":
      return "approve_queued_work";
    case "continuation_needs_attention":
      return "skip_interrupted_work";
    case "awaiting_usage":
    case "continuation_running":
    case null:
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

async function acquireRuntimeCoordinatorAgentProfileMutation(input: {
  mutationKind: "execution_target" | "future_work_settings";
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
      currentMutation &&
      currentMutation.expiresAtMs > input.nowMs &&
      currentMutation.operationId !== input.operationId
    ) {
      return {
        reasonCode: EXECUTION_TARGET_MUTATION_IN_PROGRESS_REASON,
        status: "unavailable" as const,
      };
    }

    const expiresAtMs = input.nowMs + EXECUTION_TARGET_MUTATION_LEASE_MS;
    const marked = markAgentProfileWorkContinuationNeedsAttention({
      coordinator: projectAgentProfileWorkCoordinator(admission),
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

export async function authorizeRuntimeCoordinatorAgentProfileWorkContinuation(input: {
  continuationClientMessageId: string;
  currentAgentControllerRef: string;
  currentBindingId: string;
  currentConfigurationRevision: number;
  currentDefaultProjectId?: string | null;
  expectedInterruptedTargetWakeLifecycleId: string;
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<{
  status: "authorized" | "needs_attention" | "not_pending" | "unavailable";
}> {
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
      return { status: "needs_attention" as const };
    }
    const result = authorizeAgentProfileWorkContinuation({
      continuationClientMessageId: input.continuationClientMessageId,
      coordinator: projectAgentProfileWorkCoordinator(admission),
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
    return { status: "authorized" as const };
  });
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
    if (admission.recoveryGate?.status !== "awaiting_owner_approval") {
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
    } satisfies AgentProfileExecutionAdmissionRecord;
    let pendingPromotion: PendingAgentProfileWorkPromotion | null = null;
    if (approval.promotedItem) {
      const promotion = await promoteAgentProfileWorkItem({
        admission: nextAdmission,
        item: approval.promotedItem,
        nowMs: input.nowMs,
        transaction,
      });
      nextAdmission = promotion.admission;
      pendingPromotion = promotion.pendingPromotion;
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
    if (
      !admission ||
      admission.targetProfileId !== input.targetProfileId ||
      admission.recoveryGate?.status !== "continuation_needs_attention" ||
      admission.recoveryGate.interruptedWork.targetWakeLifecycleId !==
        input.expectedInterruptedTargetWakeLifecycleId
    ) {
      return { pendingPromotion: null, status: "not_pending" as const };
    }
    const skippedRecoveryGate = admission.recoveryGate;
    const skipped = skipAgentProfileInterruptedWork({
      coordinator: projectAgentProfileWorkCoordinator(admission),
      nowMs: input.nowMs,
    });
    let nextAdmission = {
      ...admission,
      recoveryGate: skipped.coordinator.recoveryGate,
      revision: skipped.coordinator.revision,
      updatedAtMs: skipped.coordinator.updatedAtMs,
    } satisfies AgentProfileExecutionAdmissionRecord;
    let pendingPromotion: PendingAgentProfileWorkPromotion | null = null;
    if (skipped.promotedItem) {
      const promotion = await promoteAgentProfileWorkItem({
        admission: nextAdmission,
        item: skipped.promotedItem,
        nowMs: input.nowMs,
        transaction,
      });
      nextAdmission = promotion.admission;
      pendingPromotion = promotion.pendingPromotion;
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
          stage: "review_interrupted_work",
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

async function writeRuntimeCoordinatorHeadLifecycleWithAdmissionInTransaction(input: {
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

  const workPlan = planAgentProfileWorkAcceptance({
    admission,
    blockForExecutionTargetMutation: input.blockForExecutionTargetMutation,
    nowMs: input.nowMs,
    proposedRecord: input.record,
  });
  if ("result" in workPlan) {
    return workPlan.result;
  }
  const { admissionWithWork, effectiveRecord, workAcceptance } = workPlan;

  const currentMutation = admissionWithWork.executionTargetMutation;
  const admissionAfterHeadWrite = applyHeadLifecycleToAdmission({
    admission: {
      ...admissionWithWork,
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
  const result: AgentProfileWorkCoordinatorHeadWriteBaseResult = workAcceptance
    ? {
        effectiveRecord,
        ...workAcceptance,
      }
    : { effectiveRecord, status: "written" as const };
  return terminalTransition.pendingPromotion
    ? { ...result, pendingPromotion: terminalTransition.pendingPromotion }
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
    buildPendingAgentProfileWorkPromotionStorageKey(
      input.proposedRecord.targetWakeLifecycleIdentity.targetProfileId
    );
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
    admissionHasActiveReferences(input.admission)
  ) {
    return { result: { status: "legacy_execution_active" } };
  }
  const accepted = acceptAgentProfileWork({
    continuationClientMessageId:
      input.proposedRecord.targetWakeLifecycleIdentity.clientMessageId ??
      undefined,
    coordinator: projectAgentProfileWorkCoordinator(input.admission),
    item: {
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
): "failed" | "stopped" | "succeeded" | "usage_exhausted" {
  if (terminalOutcome.reasonCode === "usage_exhausted") {
    return "usage_exhausted";
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
  outcome: "failed" | "stopped" | "succeeded" | "usage_exhausted";
  runtimeCoordinatorExecutionId: string;
  transaction: DurableObjectTransaction;
}): Promise<{
  admission: AgentProfileExecutionAdmissionRecord;
  pendingPromotion: PendingAgentProfileWorkPromotion | null;
}> {
  const currentItem = input.admission.workItems[0];
  if (!currentItem || currentItem.dispatchId !== input.dispatchId) {
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
  outcome?: "failed" | "stopped" | "succeeded" | "usage_exhausted";
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
  if (!removal.promotedItem) {
    return { admission: nextAdmission, pendingPromotion: null };
  }

  return await promoteAgentProfileWorkItem({
    admission: nextAdmission,
    item: removal.promotedItem,
    nowMs: input.nowMs,
    transaction: input.transaction,
  });
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
        pendingPromotion.targetProfileId
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
  const recoveryGate = parseAgentProfileWorkRecoveryGateOrLegacy(
    record.recoveryGate
  );
  if (
    (record.modelVersion !== EXECUTION_ADMISSION_MODEL_VERSION &&
      record.modelVersion !== LEGACY_EXECUTION_ADMISSION_MODEL_VERSION) ||
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
    isNonnegativeInteger(gate.updatedAtMs) &&
    (status === "continuation_authorized"
      ? typeof gate.continuationClientMessageId === "string"
      : status === "continuation_needs_attention" ||
        gate.continuationClientMessageId === null)
  ) {
    return {
      continuationClientMessageId: gate.continuationClientMessageId ?? null,
      interruptedWork: gate.interruptedWork as AgentProfileWorkCoordinatorItem,
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
  if (!Array.isArray(value) || value.length > 51) {
    return false;
  }
  const lifecycleIds = new Set<string>();
  const dispatchIds = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return false;
    }
    const candidate = item as Partial<AgentProfileWorkCoordinatorItem>;
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
  return true;
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
      targetWakeLifecycleId
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
      targetWakeLifecycleId
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
