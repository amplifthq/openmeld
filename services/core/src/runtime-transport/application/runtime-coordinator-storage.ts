import {
  runtimeCoordinatorExecutionTokenAuthorityRecordSchema,
  runtimeCoordinatorFinalizationCommandSchema,
  runtimeCoordinatorFinalizationOutcomeSchema,
} from "@openmeld/schemas";
import type {
  RuntimeCoordinatorExecutionTokenAuthorityRecord,
  RuntimeCoordinatorFinalizationCommand,
  RuntimeCoordinatorFinalizationOutcome,
} from "@openmeld/schemas/types";
import {
  buildRuntimeCoordinatorDecisionLogStorageKey,
  buildRuntimeCoordinatorFinalizationCommandStorageKey,
  buildRuntimeCoordinatorFinalizationOutcomeStorageKey,
  buildRuntimeCoordinatorHeadLifecycleStorageKey,
  buildRuntimeCoordinatorPreExecutionHandoffStorageKey,
  buildRuntimeCoordinatorRunCommandStateStorageKey,
  buildRuntimeCoordinatorTokenAuthorityStorageKey,
  isRuntimeCoordinatorDurableDecisionRecord,
  isRuntimeCoordinatorHeadLifecycleRecord,
  isRuntimeCoordinatorPreExecutionHandoffRecord,
  isRuntimeCoordinatorRunCommandState,
  normalizeRuntimeCoordinatorFinalizationRetryEntry,
  RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY,
  RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY,
  RUNTIME_COORDINATOR_MAX_DECISION_RECORDS,
  RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_INDEX_STORAGE_KEY,
  RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY,
  type RuntimeCoordinatorDurableDecisionRecord,
  type RuntimeCoordinatorFinalizationRetryEntry,
  type RuntimeCoordinatorHeadLifecycleRecord,
  type RuntimeCoordinatorPreExecutionHandoffRecord,
  type RuntimeCoordinatorRunCommandState,
} from "./runtime-coordinator-authority";

type RuntimeCoordinatorStorage = Pick<
  DurableObjectStorage,
  "delete" | "get" | "put"
>;

export const readRuntimeCoordinatorFinalizationCommandFromStorage = async (
  storage: RuntimeCoordinatorStorage,
  commandId: string
): Promise<RuntimeCoordinatorFinalizationCommand | null> => {
  const raw = await storage.get(
    buildRuntimeCoordinatorFinalizationCommandStorageKey(commandId)
  );
  const parsed = runtimeCoordinatorFinalizationCommandSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export const readRuntimeCoordinatorFinalizationOutcomeFromStorage = async (
  storage: RuntimeCoordinatorStorage,
  commandId: string
): Promise<RuntimeCoordinatorFinalizationOutcome | null> => {
  const raw = await storage.get(
    buildRuntimeCoordinatorFinalizationOutcomeStorageKey(commandId)
  );
  const parsed = runtimeCoordinatorFinalizationOutcomeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

export const upsertRuntimeCoordinatorFinalizationRetryEntryInStorage = async (
  storage: RuntimeCoordinatorStorage,
  entry: RuntimeCoordinatorFinalizationRetryEntry
): Promise<void> => {
  const existingEntries =
    await readRuntimeCoordinatorFinalizationRetriesFromStorage(storage);
  const nextEntries = [
    ...existingEntries.filter(
      (existingEntry) =>
        existingEntry.finalizationCommandId !== entry.finalizationCommandId
    ),
    entry,
  ].sort((left, right) =>
    left.finalizationCommandId.localeCompare(right.finalizationCommandId)
  );
  await storage.put(
    RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY,
    nextEntries
  );
};

export const removeRuntimeCoordinatorFinalizationRetryFromStorage = async (
  storage: RuntimeCoordinatorStorage,
  finalizationCommandId: string
): Promise<void> => {
  const existingEntries =
    await readRuntimeCoordinatorFinalizationRetriesFromStorage(storage);
  const nextEntries = existingEntries.filter(
    (entry) => entry.finalizationCommandId !== finalizationCommandId
  );
  if (nextEntries.length === existingEntries.length) {
    return;
  }
  await storage.put(
    RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY,
    nextEntries
  );
};

export const readRuntimeCoordinatorFinalizationRetriesFromStorage = async (
  storage: RuntimeCoordinatorStorage
): Promise<RuntimeCoordinatorFinalizationRetryEntry[]> => {
  const raw = await storage.get<unknown>(
    RUNTIME_COORDINATOR_FINALIZATION_RETRY_INDEX_STORAGE_KEY
  );
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((value) => {
    const retryEntry = normalizeRuntimeCoordinatorFinalizationRetryEntry(value);
    return retryEntry ? [retryEntry] : [];
  });
};

export const readRuntimeCoordinatorTokenAuthorityFromStorage = async (
  storage: RuntimeCoordinatorStorage,
  runtimeCoordinatorExecutionId: string
): Promise<RuntimeCoordinatorExecutionTokenAuthorityRecord | null> => {
  const raw = await storage.get<unknown>(
    buildRuntimeCoordinatorTokenAuthorityStorageKey(
      runtimeCoordinatorExecutionId
    )
  );
  if (raw === undefined || raw === null) {
    return null;
  }
  const parsed =
    runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("runtime_coordinator.execution_token_authority_invalid");
  }
  return parsed.data;
};

export const writeRuntimeCoordinatorTokenAuthorityToStorage = async (
  storage: RuntimeCoordinatorStorage,
  authority: RuntimeCoordinatorExecutionTokenAuthorityRecord
): Promise<void> => {
  await storage.put(
    buildRuntimeCoordinatorTokenAuthorityStorageKey(
      authority.runtimeCoordinatorExecutionId
    ),
    authority
  );
};

export const readRuntimeCoordinatorRunCommandStateFromStorage = async (
  storage: RuntimeCoordinatorStorage,
  runtimeCoordinatorExecutionId: string
): Promise<RuntimeCoordinatorRunCommandState | null> => {
  const raw = await storage.get<unknown>(
    buildRuntimeCoordinatorRunCommandStateStorageKey(
      runtimeCoordinatorExecutionId
    )
  );
  return isRuntimeCoordinatorRunCommandState(raw) ? raw : null;
};

export const writeRuntimeCoordinatorRunCommandStateToStorage = async (
  storage: RuntimeCoordinatorStorage,
  state: RuntimeCoordinatorRunCommandState
): Promise<void> => {
  await storage.put(
    buildRuntimeCoordinatorRunCommandStateStorageKey(
      state.runtimeCoordinatorExecutionId
    ),
    state
  );
  await addRuntimeCoordinatorRunCommandStateToStorageIndex(
    storage,
    state.runtimeCoordinatorExecutionId
  );
};

export const deleteRuntimeCoordinatorRunCommandStateFromStorage = async (
  storage: RuntimeCoordinatorStorage,
  runtimeCoordinatorExecutionId: string
): Promise<void> => {
  await storage.delete(
    buildRuntimeCoordinatorRunCommandStateStorageKey(
      runtimeCoordinatorExecutionId
    )
  );
  await removeRuntimeCoordinatorRunCommandStateFromStorageIndex(
    storage,
    runtimeCoordinatorExecutionId
  );
};

export const readRuntimeCoordinatorRunCommandStatesFromStorageIndex = async (
  storage: RuntimeCoordinatorStorage
): Promise<RuntimeCoordinatorRunCommandState[]> => {
  const ids = await readRuntimeCoordinatorRunCommandStateStorageIndex(storage);
  const states: RuntimeCoordinatorRunCommandState[] = [];
  for (const runtimeCoordinatorExecutionId of ids) {
    const commandState = await readRuntimeCoordinatorRunCommandStateFromStorage(
      storage,
      runtimeCoordinatorExecutionId
    );
    if (commandState) {
      states.push(commandState);
    }
  }
  return states;
};

const addRuntimeCoordinatorRunCommandStateToStorageIndex = async (
  storage: RuntimeCoordinatorStorage,
  runtimeCoordinatorExecutionId: string
): Promise<void> => {
  const existingIds =
    await readRuntimeCoordinatorRunCommandStateStorageIndex(storage);
  if (existingIds.includes(runtimeCoordinatorExecutionId)) {
    return;
  }
  await storage.put(
    RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY,
    [...existingIds, runtimeCoordinatorExecutionId].sort()
  );
};

const removeRuntimeCoordinatorRunCommandStateFromStorageIndex = async (
  storage: RuntimeCoordinatorStorage,
  runtimeCoordinatorExecutionId: string
): Promise<void> => {
  const existingIds =
    await readRuntimeCoordinatorRunCommandStateStorageIndex(storage);
  const nextIds = existingIds.filter(
    (id) => id !== runtimeCoordinatorExecutionId
  );
  if (nextIds.length === existingIds.length) {
    return;
  }
  await storage.put(
    RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY,
    nextIds
  );
};

const readRuntimeCoordinatorRunCommandStateStorageIndex = async (
  storage: RuntimeCoordinatorStorage
): Promise<string[]> => {
  const raw = await storage.get<unknown>(
    RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY
  );
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
};

export const readRuntimeCoordinatorHeadLifecycleRecordFromStorage = async (
  storage: RuntimeCoordinatorStorage,
  targetWakeLifecycleId: string
): Promise<RuntimeCoordinatorHeadLifecycleRecord | null> => {
  const raw = await storage.get<unknown>(
    buildRuntimeCoordinatorHeadLifecycleStorageKey(targetWakeLifecycleId)
  );
  if (raw === undefined || raw === null) {
    return null;
  }
  if (!isRuntimeCoordinatorHeadLifecycleRecord(raw)) {
    throw new Error("runtime_coordinator.head_lifecycle_record_invalid");
  }
  return raw;
};

export const writeRuntimeCoordinatorHeadLifecycleRecordToStorage = async (
  storage: RuntimeCoordinatorStorage,
  record: RuntimeCoordinatorHeadLifecycleRecord
): Promise<void> => {
  await storage.put(
    buildRuntimeCoordinatorHeadLifecycleStorageKey(
      record.targetWakeLifecycleId
    ),
    record
  );
  await addRuntimeCoordinatorHeadLifecycleToStorageIndex(
    storage,
    record.targetWakeLifecycleId
  );
};

export const readRuntimeCoordinatorHeadLifecycleRecordsFromStorageIndex =
  async (
    storage: RuntimeCoordinatorStorage
  ): Promise<RuntimeCoordinatorHeadLifecycleRecord[]> => {
    const ids = await readRuntimeCoordinatorHeadLifecycleStorageIndex(storage);
    const records: RuntimeCoordinatorHeadLifecycleRecord[] = [];
    for (const id of ids) {
      const record = await readRuntimeCoordinatorHeadLifecycleRecordFromStorage(
        storage,
        id
      );
      if (record) {
        records.push(record);
      }
    }
    return records;
  };

const addRuntimeCoordinatorHeadLifecycleToStorageIndex = async (
  storage: RuntimeCoordinatorStorage,
  targetWakeLifecycleId: string
): Promise<void> => {
  const existingIds =
    await readRuntimeCoordinatorHeadLifecycleStorageIndex(storage);
  if (existingIds.includes(targetWakeLifecycleId)) {
    return;
  }
  await storage.put(
    RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY,
    [...existingIds, targetWakeLifecycleId].sort()
  );
};

const readRuntimeCoordinatorHeadLifecycleStorageIndex = async (
  storage: RuntimeCoordinatorStorage
): Promise<string[]> => {
  const raw = await storage.get<unknown>(
    RUNTIME_COORDINATOR_HEAD_LIFECYCLE_INDEX_STORAGE_KEY
  );
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
};

export const readRuntimeCoordinatorDecisionByKeyFromStorage = async (
  storage: RuntimeCoordinatorStorage,
  input: {
    idempotencyKey: string;
    runtimeCoordinatorExecutionId: string;
  }
): Promise<RuntimeCoordinatorDurableDecisionRecord | null> => {
  const decisions = await readRuntimeCoordinatorDecisionRecordsFromStorage(
    storage,
    input.runtimeCoordinatorExecutionId
  );
  return (
    [...decisions]
      .reverse()
      .find((decision) => decision.idempotencyKey === input.idempotencyKey) ??
    null
  );
};

export const appendRuntimeCoordinatorDecisionRecordToStorage = async (
  storage: RuntimeCoordinatorStorage,
  input: {
    decision: RuntimeCoordinatorDurableDecisionRecord;
    runtimeCoordinatorExecutionId: string;
  }
): Promise<void> => {
  const decisions = await readRuntimeCoordinatorDecisionRecordsFromStorage(
    storage,
    input.runtimeCoordinatorExecutionId
  );
  if (
    decisions.some(
      (decision) => decision.decisionId === input.decision.decisionId
    )
  ) {
    return;
  }
  const nextDecisions = [...decisions, input.decision]
    .sort((first, second) => first.createdAtMs - second.createdAtMs)
    .slice(-RUNTIME_COORDINATOR_MAX_DECISION_RECORDS);
  await storage.put(
    buildRuntimeCoordinatorDecisionLogStorageKey(
      input.runtimeCoordinatorExecutionId
    ),
    nextDecisions
  );
};

export const readRuntimeCoordinatorDecisionRecordsFromStorage = async (
  storage: RuntimeCoordinatorStorage,
  runtimeCoordinatorExecutionId: string
): Promise<RuntimeCoordinatorDurableDecisionRecord[]> => {
  const raw = await storage.get<unknown>(
    buildRuntimeCoordinatorDecisionLogStorageKey(runtimeCoordinatorExecutionId)
  );
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isRuntimeCoordinatorDurableDecisionRecord);
};

export const writeRuntimeCoordinatorPreExecutionHandoffRecordToStorage = async (
  storage: RuntimeCoordinatorStorage,
  record: RuntimeCoordinatorPreExecutionHandoffRecord
): Promise<void> => {
  await storage.put(
    buildRuntimeCoordinatorPreExecutionHandoffStorageKey(record.dispatchId),
    record
  );
  await addRuntimeCoordinatorPreExecutionHandoffStorageIndex(
    storage,
    record.dispatchId
  );
};

export const readRuntimeCoordinatorPreExecutionHandoffRecordFromStorage =
  async (
    storage: RuntimeCoordinatorStorage,
    dispatchId: string
  ): Promise<RuntimeCoordinatorPreExecutionHandoffRecord | null> => {
    const record = await storage.get<unknown>(
      buildRuntimeCoordinatorPreExecutionHandoffStorageKey(dispatchId)
    );
    return isRuntimeCoordinatorPreExecutionHandoffRecord(record)
      ? record
      : null;
  };

export const deleteRuntimeCoordinatorPreExecutionHandoffRecordFromStorage =
  async (
    storage: RuntimeCoordinatorStorage,
    dispatchId: string
  ): Promise<void> => {
    await storage.delete(
      buildRuntimeCoordinatorPreExecutionHandoffStorageKey(dispatchId)
    );
    const ids =
      (await storage.get<string[]>(
        RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_INDEX_STORAGE_KEY
      )) ?? [];
    await storage.put(
      RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_INDEX_STORAGE_KEY,
      ids.filter((id) => id !== dispatchId)
    );
  };

export const readRuntimeCoordinatorPreExecutionHandoffRecordsFromStorageIndex =
  async (
    storage: RuntimeCoordinatorStorage
  ): Promise<RuntimeCoordinatorPreExecutionHandoffRecord[]> => {
    const ids =
      (await storage.get<string[]>(
        RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_INDEX_STORAGE_KEY
      )) ?? [];
    const records: RuntimeCoordinatorPreExecutionHandoffRecord[] = [];
    for (const dispatchId of ids) {
      const record =
        await readRuntimeCoordinatorPreExecutionHandoffRecordFromStorage(
          storage,
          dispatchId
        );
      if (record) {
        records.push(record);
      }
    }
    return records;
  };

const addRuntimeCoordinatorPreExecutionHandoffStorageIndex = async (
  storage: RuntimeCoordinatorStorage,
  dispatchId: string
): Promise<void> => {
  const ids =
    (await storage.get<string[]>(
      RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_INDEX_STORAGE_KEY
    )) ?? [];
  if (ids.includes(dispatchId)) {
    return;
  }
  await storage.put(
    RUNTIME_COORDINATOR_PRE_EXECUTION_HANDOFF_INDEX_STORAGE_KEY,
    [...ids, dispatchId]
  );
};
