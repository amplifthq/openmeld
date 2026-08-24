import { runtimeCoordinatorExecutionTokenAuthorityRecordSchema } from "@openmeld/schemas";
import type {
  RuntimeTransportAgentProfileControllerMutationAcquireResponse,
  RuntimeTransportAgentProfileControllerMutationReleaseResponse,
  RuntimeTransportAgentProfileExecutionStateResponse,
} from "@openmeld/schemas/types";
import {
  buildRuntimeCoordinatorHeadLifecycleStorageKey,
  buildRuntimeCoordinatorTokenAuthorityStorageKey,
  isRuntimeCoordinatorHeadLifecycleRecord,
  isRuntimeCoordinatorRunCommandState,
  RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY,
  RUNTIME_COORDINATOR_HEAD_LIFECYCLE_STORAGE_KEY_PREFIX,
  RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY,
  RUNTIME_COORDINATOR_RUN_COMMAND_STATE_STORAGE_KEY_PREFIX,
  type RuntimeCoordinatorHeadLifecycleRecord,
} from "./runtime-coordinator-authority";

const EXECUTION_ADMISSION_MODEL_VERSION =
  "openmeld.runtime_coordinator.agent_profile_execution_admission.v1" as const;
const EXECUTION_INDEX_MODEL_VERSION =
  "openmeld.runtime_coordinator.agent_profile_execution_index.v1" as const;
const EXECUTION_ADMISSION_STORAGE_KEY_PREFIX =
  "runtime-coordinator:agent-profile-execution-admission:v1:";
const EXECUTION_INDEX_STORAGE_KEY =
  "runtime-coordinator:agent-profile-execution-index:v1";
const EXECUTION_INDEX_REPAIR_PAGE_SIZE = 128;
const EXECUTION_INDEX_INLINE_REPAIR_STEPS = 2;
const EXECUTION_INDEX_REPAIR_RETRY_BASE_MS = 5000;
const EXECUTION_INDEX_REPAIR_RETRY_MAX_MS = 5 * 60_000;
const CONTROLLER_MUTATION_LEASE_MS = 5 * 60_000;
const EXECUTION_STATE_UNAVAILABLE_REASON =
  "runtime_coordinator.execution_state_unavailable";
const EXECUTION_INDEX_REBUILDING_REASON =
  "runtime_coordinator.execution_state_rebuilding";
const EXECUTION_INDEX_REPAIR_FAILED_REASON =
  "runtime_coordinator.execution_state_repair_failed";
const CONTROLLER_MUTATION_IN_PROGRESS_REASON =
  "runtime_coordinator.controller_mutation_in_progress";

type ExecutionAdmissionStorage = Pick<
  DurableObjectStorage,
  "delete" | "get" | "list" | "put" | "transaction"
>;

type ControllerMutationLease = {
  expiresAtMs: number;
  operationId: string;
  startedAtMs: number;
};

type AgentProfileExecutionAdmissionRecord = {
  activeExecutionIds: string[];
  activeHeadLifecycleIds: string[];
  controllerMutation: ControllerMutationLease | null;
  generation: number;
  modelVersion: typeof EXECUTION_ADMISSION_MODEL_VERSION;
  revision: number;
  targetProfileId: string;
  updatedAtMs: number;
};

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
      phase: "head_lifecycles" | "run_command_states";
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
      phase: "head_lifecycles" | "run_command_states";
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
  if (rawAdmission === undefined || rawAdmission === null) {
    return { status: "inactive" };
  }
  const admission = parseExecutionAdmissionRecord(rawAdmission);
  if (
    !admission ||
    admission.generation !== index.generation ||
    admission.targetProfileId !== input.targetProfileId
  ) {
    return admission && admission.generation !== index.generation
      ? { status: "inactive" }
      : unavailableExecutionState();
  }

  return await resolveAdmissionExecutionState({
    admission,
    nowMs: input.nowMs,
    ownerUserId: input.ownerUserId,
    storage: input.storage,
  });
}

export async function acquireRuntimeCoordinatorAgentProfileControllerMutation(input: {
  nowMs: number;
  operationId: string;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileControllerMutationAcquireResponse> {
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
    existing.controllerMutation?.operationId === input.operationId &&
    existing.controllerMutation.expiresAtMs > input.nowMs
  ) {
    return {
      expiresAtMs: existing.controllerMutation.expiresAtMs,
      operationId: input.operationId,
      status: "acquired",
    };
  }

  const executionState =
    await readRuntimeCoordinatorAgentProfileExecutionStateFromAdmission(input);
  if (executionState.status === "active") {
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

    const currentRaw = await transaction.get<unknown>(storageKey);
    const current = parseExecutionAdmissionRecord(currentRaw);
    if (currentRaw !== undefined && !current) {
      return {
        reasonCode: EXECUTION_STATE_UNAVAILABLE_REASON,
        status: "unavailable" as const,
      };
    }
    const admission =
      current?.generation === index.generation
        ? current
        : emptyExecutionAdmissionRecord({
            generation: index.generation,
            nowMs: input.nowMs,
            targetProfileId: input.targetProfileId,
          });
    if (
      admission.activeExecutionIds.length > 0 ||
      admission.activeHeadLifecycleIds.length > 0
    ) {
      return {
        reasonCode: "runtime_coordinator.agent_profile_execution_active",
        status: "blocked" as const,
      };
    }
    const currentMutation = admission.controllerMutation;
    if (
      currentMutation &&
      currentMutation.expiresAtMs > input.nowMs &&
      currentMutation.operationId !== input.operationId
    ) {
      return {
        reasonCode: CONTROLLER_MUTATION_IN_PROGRESS_REASON,
        status: "unavailable" as const,
      };
    }

    const expiresAtMs = input.nowMs + CONTROLLER_MUTATION_LEASE_MS;
    await transaction.put(storageKey, {
      ...admission,
      controllerMutation: {
        expiresAtMs,
        operationId: input.operationId,
        startedAtMs: input.nowMs,
      },
      revision: admission.revision + 1,
      updatedAtMs: input.nowMs,
    } satisfies AgentProfileExecutionAdmissionRecord);
    return {
      expiresAtMs,
      operationId: input.operationId,
      status: "acquired" as const,
    };
  });
}

export async function releaseRuntimeCoordinatorAgentProfileControllerMutation(input: {
  nowMs: number;
  operationId: string;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
  targetProfileId: string;
}): Promise<RuntimeTransportAgentProfileControllerMutationReleaseResponse> {
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
      admission.controllerMutation?.operationId !== input.operationId
    ) {
      return { status: "not_owner" as const };
    }
    await transaction.put(storageKey, {
      ...admission,
      controllerMutation: null,
      revision: admission.revision + 1,
      updatedAtMs: input.nowMs,
    } satisfies AgentProfileExecutionAdmissionRecord);
    return { status: "released" as const };
  });
}

export async function writeRuntimeCoordinatorHeadLifecycleWithAdmission(input: {
  blockForControllerMutation: boolean;
  nowMs: number;
  record: RuntimeCoordinatorHeadLifecycleRecord;
  storage: ExecutionAdmissionStorage;
}): Promise<"controller_mutation_in_progress" | "written"> {
  return await input.storage.transaction(async (transaction) => {
    const rawIndex = await transaction.get<unknown>(
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

    const admissionKey = buildExecutionAdmissionStorageKey(
      input.record.targetWakeLifecycleIdentity.targetProfileId
    );
    const rawAdmission = await transaction.get<unknown>(admissionKey);
    const parsedAdmission = parseExecutionAdmissionRecord(rawAdmission);
    if (rawAdmission !== undefined && !parsedAdmission) {
      throw new Error("runtime_coordinator.execution_admission_invalid");
    }
    const admission =
      parsedAdmission?.generation === index.generation
        ? parsedAdmission
        : emptyExecutionAdmissionRecord({
            generation: index.generation,
            nowMs: input.nowMs,
            targetProfileId:
              input.record.targetWakeLifecycleIdentity.targetProfileId,
          });
    if (
      input.blockForControllerMutation &&
      admission.controllerMutation &&
      admission.controllerMutation.expiresAtMs > input.nowMs
    ) {
      return "controller_mutation_in_progress";
    }

    const currentMutation = admission.controllerMutation;
    const nextAdmission = applyHeadLifecycleToAdmission({
      admission: {
        ...admission,
        controllerMutation:
          currentMutation && currentMutation.expiresAtMs > input.nowMs
            ? currentMutation
            : null,
      },
      nowMs: input.nowMs,
      record: input.record,
    });
    const rawLegacyIndex = await transaction.get<unknown>(
      RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY
    );
    const legacyIds = normalizeLegacyIndex(rawLegacyIndex);
    const nextLegacyIds = legacyIds.includes(input.record.targetWakeLifecycleId)
      ? legacyIds
      : [...legacyIds, input.record.targetWakeLifecycleId].sort();
    const writes: Promise<unknown>[] = [
      transaction.put(
        buildRuntimeCoordinatorHeadLifecycleStorageKey(
          input.record.targetWakeLifecycleId
        ),
        input.record
      ),
      transaction.put(
        RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY,
        nextLegacyIds
      ),
      transaction.put(admissionKey, nextAdmission),
    ];
    if (!parsedIndex) {
      writes.push(transaction.put(EXECUTION_INDEX_STORAGE_KEY, index));
    }
    await Promise.all(writes);
    return "written";
  });
}

export async function writeRuntimeCoordinatorTokenAuthorityWithAdmission(input: {
  authority: import("@openmeld/schemas/types").RuntimeCoordinatorExecutionTokenAuthorityRecord;
  nowMs: number;
  storage: ExecutionAdmissionStorage;
}): Promise<void> {
  await input.storage.transaction(async (transaction) => {
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
        : emptyExecutionAdmissionRecord({
            generation,
            nowMs: input.nowMs,
            targetProfileId,
          });
    const executionId = input.authority.runtimeCoordinatorExecutionId;
    const activeExecutionIds = input.authority.terminalOutcome
      ? admission.activeExecutionIds.filter((id) => id !== executionId)
      : uniqueSorted([...admission.activeExecutionIds, executionId]);
    await Promise.all([
      transaction.put(
        buildRuntimeCoordinatorTokenAuthorityStorageKey(executionId),
        input.authority
      ),
      transaction.put(admissionKey, {
        ...admission,
        activeExecutionIds,
        revision: admission.revision + 1,
        updatedAtMs: input.nowMs,
      } satisfies AgentProfileExecutionAdmissionRecord),
    ]);
  });
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

  const prefix =
    state.phase === "head_lifecycles"
      ? RUNTIME_COORDINATOR_HEAD_LIFECYCLE_STORAGE_KEY_PREFIX
      : RUNTIME_COORDINATOR_RUN_COMMAND_STATE_STORAGE_KEY_PREFIX;
  const page = await input.storage.list<unknown>({
    limit: EXECUTION_INDEX_REPAIR_PAGE_SIZE,
    prefix,
    ...(state.cursor ? { startAfter: state.cursor } : {}),
  });
  let observations: ActiveObservationsByProfile;
  try {
    observations = await collectExecutionIndexRepairObservations({
      ownerUserId: state.ownerUserId,
      page,
      phase: state.phase,
      storage: input.storage,
    });
  } catch (error) {
    const failureCount = state.failureCount + 1;
    const failed: AgentProfileExecutionIndexState = {
      cursor: state.cursor,
      failureCount,
      generation: state.generation,
      modelVersion: EXECUTION_INDEX_MODEL_VERSION,
      ownerUserId: state.ownerUserId,
      phase: state.phase,
      reasonCode:
        error instanceof Error
          ? error.message
          : EXECUTION_STATE_UNAVAILABLE_REASON,
      retryAtMs:
        input.nowMs + resolveExecutionIndexRepairRetryDelayMs(failureCount),
      repairRequested: state.repairRequested,
      status: "failed",
      updatedAtMs: input.nowMs,
    };
    await input.storage.put(EXECUTION_INDEX_STORAGE_KEY, failed);
    console.warn("[runtime_coordinator.execution_index_repair_failed]", {
      error: failed.reasonCode,
      generation: failed.generation,
      ownerUserId: failed.ownerUserId,
      phase: state.phase,
      retryAtMs: failed.retryAtMs,
    });
    return "failed";
  }

  const nextState = resolveNextExecutionIndexRepairState({
    lastKey: [...page.keys()].at(-1) ?? null,
    nowMs: input.nowMs,
    pageComplete: page.size < EXECUTION_INDEX_REPAIR_PAGE_SIZE,
    state,
  });

  await input.storage.transaction(async (transaction) => {
    for (const [targetProfileId, observed] of observations) {
      const admissionKey = buildExecutionAdmissionStorageKey(targetProfileId);
      const current = parseExecutionAdmissionRecord(
        await transaction.get<unknown>(admissionKey)
      );
      const admission =
        current?.generation === state.generation
          ? current
          : emptyExecutionAdmissionRecord({
              generation: state.generation,
              nowMs: input.nowMs,
              targetProfileId,
            });
      await transaction.put(admissionKey, {
        ...admission,
        activeExecutionIds: uniqueSorted([
          ...admission.activeExecutionIds,
          ...observed.executionIds,
        ]),
        activeHeadLifecycleIds: uniqueSorted([
          ...admission.activeHeadLifecycleIds,
          ...observed.headLifecycleIds,
        ]),
        revision: admission.revision + 1,
        updatedAtMs: input.nowMs,
      } satisfies AgentProfileExecutionAdmissionRecord);
    }
    await transaction.put(EXECUTION_INDEX_STORAGE_KEY, nextState);
  });
  return nextState.status;
}

async function collectExecutionIndexRepairObservations(input: {
  ownerUserId: string;
  page: Map<string, unknown>;
  phase: "head_lifecycles" | "run_command_states";
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
  return {
    generation: input.state.generation,
    modelVersion: EXECUTION_INDEX_MODEL_VERSION,
    ownerUserId: input.state.ownerUserId,
    status: "ready",
    updatedAtMs: input.nowMs,
  };
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
    const raw = await input.storage.get<unknown>(EXECUTION_INDEX_STORAGE_KEY);
    state = rebuildingExecutionIndexState({
      generation: nextExecutionIndexGeneration(raw),
      nowMs: input.nowMs,
      ownerUserId: input.ownerUserId,
      repairRequested: true,
    });
    await input.storage.put(EXECUTION_INDEX_STORAGE_KEY, state);
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

async function resolveAdmissionExecutionState(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  nowMs: number;
  ownerUserId: string;
  storage: ExecutionAdmissionStorage;
}): Promise<RuntimeTransportAgentProfileExecutionStateResponse> {
  if (
    input.admission.activeExecutionIds.length > 128 ||
    input.admission.activeHeadLifecycleIds.length > 128
  ) {
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
      return { status: "inactive" as const };
    }
    const currentMutation = current.controllerMutation;
    const next = {
      ...current,
      activeExecutionIds: current.activeExecutionIds.filter(
        (id) => !input.staleExecutionIds.has(id)
      ),
      activeHeadLifecycleIds: current.activeHeadLifecycleIds.filter(
        (id) => !input.staleHeadIds.has(id)
      ),
      controllerMutation:
        currentMutation && currentMutation.expiresAtMs > input.nowMs
          ? currentMutation
          : null,
      revision: current.revision + 1,
      updatedAtMs: input.nowMs,
    } satisfies AgentProfileExecutionAdmissionRecord;
    if (
      next.activeExecutionIds.length > 0 ||
      next.activeHeadLifecycleIds.length > 0
    ) {
      return { status: "active" as const };
    }
    await transaction.put(storageKey, next);
    return next.controllerMutation
      ? unavailableExecutionState(CONTROLLER_MUTATION_IN_PROGRESS_REASON)
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

function applyHeadLifecycleToAdmission(input: {
  admission: AgentProfileExecutionAdmissionRecord;
  nowMs: number;
  record: RuntimeCoordinatorHeadLifecycleRecord;
}): AgentProfileExecutionAdmissionRecord {
  const activeHeadLifecycleIds = new Set(
    input.admission.activeHeadLifecycleIds
  );
  const activeExecutionIds = new Set(input.admission.activeExecutionIds);
  if (input.record.status === "accepted" || input.record.status === "waiting") {
    activeHeadLifecycleIds.add(input.record.targetWakeLifecycleId);
  } else {
    activeHeadLifecycleIds.delete(input.record.targetWakeLifecycleId);
  }
  if (input.record.status === "execution_linked") {
    if (!input.record.runtimeCoordinatorExecutionId) {
      throw new Error("runtime_coordinator.head_execution_authority_missing");
    }
    activeExecutionIds.add(input.record.runtimeCoordinatorExecutionId);
  }
  return {
    ...input.admission,
    activeExecutionIds: [...activeExecutionIds].sort(),
    activeHeadLifecycleIds: [...activeHeadLifecycleIds].sort(),
    revision: input.admission.revision + 1,
    updatedAtMs: input.nowMs,
  };
}

function emptyExecutionAdmissionRecord(input: {
  generation: number;
  nowMs: number;
  targetProfileId: string;
}): AgentProfileExecutionAdmissionRecord {
  return {
    activeExecutionIds: [],
    activeHeadLifecycleIds: [],
    controllerMutation: null,
    generation: input.generation,
    modelVersion: EXECUTION_ADMISSION_MODEL_VERSION,
    revision: 0,
    targetProfileId: input.targetProfileId,
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
  if (
    record.modelVersion !== EXECUTION_ADMISSION_MODEL_VERSION ||
    !isPositiveInteger(record.generation) ||
    !isNonnegativeInteger(record.revision) ||
    typeof record.targetProfileId !== "string" ||
    !isNonnegativeInteger(record.updatedAtMs) ||
    !isStringArray(record.activeExecutionIds) ||
    !isStringArray(record.activeHeadLifecycleIds) ||
    !isControllerMutationLeaseOrNull(record.controllerMutation)
  ) {
    return null;
  }
  return record as AgentProfileExecutionAdmissionRecord;
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
    (state.phase === "head_lifecycles" ||
      state.phase === "run_command_states") &&
    (state.cursor === null || typeof state.cursor === "string")
  ) {
    return state as AgentProfileExecutionIndexState;
  }
  if (
    state.status === "failed" &&
    isNonnegativeInteger(state.failureCount) &&
    (state.phase === "head_lifecycles" ||
      state.phase === "run_command_states") &&
    (state.cursor === null || typeof state.cursor === "string") &&
    typeof state.reasonCode === "string" &&
    typeof state.repairRequested === "boolean" &&
    isNonnegativeInteger(state.retryAtMs)
  ) {
    return state as AgentProfileExecutionIndexState;
  }
  return null;
}

function buildExecutionAdmissionStorageKey(targetProfileId: string): string {
  return `${EXECUTION_ADMISSION_STORAGE_KEY_PREFIX}${encodeURIComponent(
    targetProfileId
  )}`;
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

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
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

function isControllerMutationLeaseOrNull(
  value: unknown
): value is ControllerMutationLease | null {
  if (value === null) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const lease = value as Partial<ControllerMutationLease>;
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

// Kept exported for storage-level tests and compatibility repair diagnostics.
export const runtimeCoordinatorAgentProfileExecutionAdmissionStorageKeys = {
  admission: buildExecutionAdmissionStorageKey,
  index: EXECUTION_INDEX_STORAGE_KEY,
} as const;
