import {
  agentTaskCompletionObservationSchema,
  agentTaskHandleSchema,
} from "@openmeld/schemas";
import type {
  AgentTaskCompletionObservation,
  AgentTaskHandle,
} from "@openmeld/schemas/types";

export const RUNTIME_COORDINATOR_AGENT_TASK_OBSERVATION_DELIVERY_INDEX_STORAGE_KEY =
  "runtime-coordinator:agent-task-observation-delivery:index";

const RUNTIME_COORDINATOR_AGENT_TASK_OBSERVATION_DELIVERY_STORAGE_PREFIX =
  "runtime-coordinator:agent-task-observation-delivery:";

type RuntimeCoordinatorAgentTaskObservationDeliveryStorageOperations = Pick<
  DurableObjectStorage,
  "get" | "put"
>;

type RuntimeCoordinatorAgentTaskObservationDeliveryStorage =
  RuntimeCoordinatorAgentTaskObservationDeliveryStorageOperations &
    Pick<DurableObjectStorage, "transaction">;

export type RuntimeCoordinatorAgentTaskObservationDeliveryRecord = {
  createdAtMs: number;
  deliveryId: string;
  observation: AgentTaskCompletionObservation;
  projectedAtMs: number | null;
  runtimeCoordinatorExecutionId: string;
  status: "pending" | "projected";
  task: AgentTaskHandle;
  updatedAtMs: number;
  v: 1;
};

type UpsertRuntimeCoordinatorAgentTaskObservationDeliveryInput = {
  nowMs: number;
  observation: AgentTaskCompletionObservation;
  runtimeCoordinatorExecutionId: string;
  task: AgentTaskHandle;
};

export function buildRuntimeCoordinatorAgentTaskObservationDeliveryId(input: {
  eventId: string;
  runtimeCoordinatorExecutionId: string;
}): string {
  return `agent-task-observation:${input.runtimeCoordinatorExecutionId}:${input.eventId}`;
}

export async function upsertRuntimeCoordinatorAgentTaskObservationDelivery(
  storage: RuntimeCoordinatorAgentTaskObservationDeliveryStorage,
  input: UpsertRuntimeCoordinatorAgentTaskObservationDeliveryInput
): Promise<RuntimeCoordinatorAgentTaskObservationDeliveryRecord> {
  return await storage.transaction(
    async (transaction) =>
      await upsertRuntimeCoordinatorAgentTaskObservationDeliveryInTransaction(
        transaction,
        input
      )
  );
}

export async function upsertRuntimeCoordinatorAgentTaskObservationDeliveryInTransaction(
  storage: RuntimeCoordinatorAgentTaskObservationDeliveryStorageOperations,
  input: UpsertRuntimeCoordinatorAgentTaskObservationDeliveryInput
): Promise<RuntimeCoordinatorAgentTaskObservationDeliveryRecord> {
  const task = agentTaskHandleSchema.parse(input.task);
  const observation = agentTaskCompletionObservationSchema.parse(
    input.observation
  );
  const deliveryId = buildRuntimeCoordinatorAgentTaskObservationDeliveryId({
    eventId: observation.eventId,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
  });
  const existing =
    await readRuntimeCoordinatorAgentTaskObservationDeliveryRecord(
      storage,
      deliveryId
    );
  if (existing) {
    assertMatchingAgentTaskObservationDelivery(existing, {
      observation,
      runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
      task,
    });
    if (existing.status === "pending") {
      await addRuntimeCoordinatorAgentTaskObservationDeliveryToIndex(
        storage,
        deliveryId
      );
    }
    return existing;
  }

  const record: RuntimeCoordinatorAgentTaskObservationDeliveryRecord = {
    createdAtMs: input.nowMs,
    deliveryId,
    observation,
    projectedAtMs: null,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId,
    status: "pending",
    task,
    updatedAtMs: input.nowMs,
    v: 1,
  };
  await storage.put(
    buildRuntimeCoordinatorAgentTaskObservationDeliveryStorageKey(deliveryId),
    record
  );
  await addRuntimeCoordinatorAgentTaskObservationDeliveryToIndex(
    storage,
    deliveryId
  );
  return record;
}

export async function readRuntimeCoordinatorAgentTaskObservationDeliveriesFromIndex(
  storage: RuntimeCoordinatorAgentTaskObservationDeliveryStorage
): Promise<RuntimeCoordinatorAgentTaskObservationDeliveryRecord[]> {
  const deliveryIds =
    await readRuntimeCoordinatorAgentTaskObservationDeliveryIndex(storage);
  const records: RuntimeCoordinatorAgentTaskObservationDeliveryRecord[] = [];
  for (const deliveryId of deliveryIds) {
    const record =
      await readRuntimeCoordinatorAgentTaskObservationDeliveryRecord(
        storage,
        deliveryId
      );
    if (record) {
      records.push(record);
    }
  }
  return records;
}

export async function markRuntimeCoordinatorAgentTaskObservationDeliveryProjected(
  storage: RuntimeCoordinatorAgentTaskObservationDeliveryStorage,
  input: {
    deliveryId: string;
    projectedAtMs: number;
  }
): Promise<void> {
  const existing =
    await readRuntimeCoordinatorAgentTaskObservationDeliveryRecord(
      storage,
      input.deliveryId
    );
  if (!existing) {
    throw new Error(
      "runtime_coordinator.agent_task_observation_delivery_missing"
    );
  }
  if (existing.status !== "projected") {
    await storage.put(
      buildRuntimeCoordinatorAgentTaskObservationDeliveryStorageKey(
        input.deliveryId
      ),
      {
        ...existing,
        projectedAtMs: input.projectedAtMs,
        status: "projected",
        updatedAtMs: input.projectedAtMs,
      } satisfies RuntimeCoordinatorAgentTaskObservationDeliveryRecord
    );
  }
  await removeRuntimeCoordinatorAgentTaskObservationDeliveryFromIndex(
    storage,
    input.deliveryId
  );
}

export async function removeRuntimeCoordinatorAgentTaskObservationDeliveryFromIndex(
  storage: RuntimeCoordinatorAgentTaskObservationDeliveryStorage,
  deliveryId: string
): Promise<void> {
  const existingIds =
    await readRuntimeCoordinatorAgentTaskObservationDeliveryIndex(storage);
  if (!existingIds.includes(deliveryId)) {
    return;
  }
  await storage.put(
    RUNTIME_COORDINATOR_AGENT_TASK_OBSERVATION_DELIVERY_INDEX_STORAGE_KEY,
    existingIds.filter((existingId) => existingId !== deliveryId)
  );
}

export async function readRuntimeCoordinatorAgentTaskObservationDeliveryRecord(
  storage: RuntimeCoordinatorAgentTaskObservationDeliveryStorageOperations,
  deliveryId: string
): Promise<RuntimeCoordinatorAgentTaskObservationDeliveryRecord | null> {
  const raw = await storage.get<unknown>(
    buildRuntimeCoordinatorAgentTaskObservationDeliveryStorageKey(deliveryId)
  );
  if (raw === undefined || raw === null) {
    return null;
  }
  if (!isRuntimeCoordinatorAgentTaskObservationDeliveryRecord(raw)) {
    throw new Error(
      "runtime_coordinator.agent_task_observation_delivery_invalid"
    );
  }
  return raw;
}

async function addRuntimeCoordinatorAgentTaskObservationDeliveryToIndex(
  storage: RuntimeCoordinatorAgentTaskObservationDeliveryStorageOperations,
  deliveryId: string
): Promise<void> {
  const existingIds =
    await readRuntimeCoordinatorAgentTaskObservationDeliveryIndex(storage);
  if (existingIds.includes(deliveryId)) {
    return;
  }
  await storage.put(
    RUNTIME_COORDINATOR_AGENT_TASK_OBSERVATION_DELIVERY_INDEX_STORAGE_KEY,
    [...existingIds, deliveryId].sort()
  );
}

async function readRuntimeCoordinatorAgentTaskObservationDeliveryIndex(
  storage: RuntimeCoordinatorAgentTaskObservationDeliveryStorageOperations
): Promise<string[]> {
  const raw = await storage.get<unknown>(
    RUNTIME_COORDINATOR_AGENT_TASK_OBSERVATION_DELIVERY_INDEX_STORAGE_KEY
  );
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0
  );
}

function buildRuntimeCoordinatorAgentTaskObservationDeliveryStorageKey(
  deliveryId: string
): string {
  return `${RUNTIME_COORDINATOR_AGENT_TASK_OBSERVATION_DELIVERY_STORAGE_PREFIX}${deliveryId}`;
}

function assertMatchingAgentTaskObservationDelivery(
  existing: RuntimeCoordinatorAgentTaskObservationDeliveryRecord,
  expected: {
    observation: AgentTaskCompletionObservation;
    runtimeCoordinatorExecutionId: string;
    task: AgentTaskHandle;
  }
): void {
  if (
    existing.runtimeCoordinatorExecutionId !==
      expected.runtimeCoordinatorExecutionId ||
    JSON.stringify(existing.task) !== JSON.stringify(expected.task) ||
    JSON.stringify(existing.observation) !==
      JSON.stringify(expected.observation)
  ) {
    throw new Error(
      "runtime_coordinator.agent_task_observation_delivery_conflict"
    );
  }
}

function isRuntimeCoordinatorAgentTaskObservationDeliveryRecord(
  value: unknown
): value is RuntimeCoordinatorAgentTaskObservationDeliveryRecord {
  if (!(value && typeof value === "object")) {
    return false;
  }
  const record =
    value as Partial<RuntimeCoordinatorAgentTaskObservationDeliveryRecord>;
  return (
    record.v === 1 &&
    typeof record.deliveryId === "string" &&
    record.deliveryId.length > 0 &&
    typeof record.runtimeCoordinatorExecutionId === "string" &&
    record.runtimeCoordinatorExecutionId.length > 0 &&
    (record.status === "pending" || record.status === "projected") &&
    typeof record.createdAtMs === "number" &&
    Number.isFinite(record.createdAtMs) &&
    typeof record.updatedAtMs === "number" &&
    Number.isFinite(record.updatedAtMs) &&
    (record.projectedAtMs === null ||
      (typeof record.projectedAtMs === "number" &&
        Number.isFinite(record.projectedAtMs))) &&
    agentTaskHandleSchema.safeParse(record.task).success &&
    agentTaskCompletionObservationSchema.safeParse(record.observation).success
  );
}
