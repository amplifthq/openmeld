import { runtimeCoordinatorExecutionTokenAuthorityRecordSchema } from "@openmeld/schemas";
import {
  buildRuntimeCoordinatorRunCommandStateStorageKey,
  buildRuntimeCoordinatorTokenAuthorityStorageKey,
  isRuntimeCoordinatorRunCommandState,
  RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY,
  RUNTIME_COORDINATOR_RUN_COMMAND_STATE_STORAGE_KEY_PREFIX,
  type RuntimeCoordinatorRunCommandState,
  resolveRuntimeCoordinatorRunCommandStateWatchdogAtMs,
} from "./runtime-coordinator-authority";

const DUE_PREFIX = "runtime-coordinator:watchdog-due:v1:";
const REFERENCE_PREFIX = "runtime-coordinator:watchdog-reference:v1:";
const REPAIR_KEY = "runtime-coordinator:watchdog-repair:v1";
const PAGE_SIZE = 10;
type Storage = Pick<
  DurableObjectStorage,
  "get" | "put" | "delete" | "list" | "transaction"
>;
type Transaction = Pick<DurableObjectTransaction, "get" | "put" | "delete">;

// Scheduling projection only. Every consumer rechecks command and authority.
export async function writeRuntimeCoordinatorWatchdogSchedule(
  transaction: Transaction,
  executionId: string,
  nextCheckAtMs: number | null
): Promise<void> {
  const referenceKey = `${REFERENCE_PREFIX}${executionId}`;
  const previous = await transaction.get<string>(referenceKey);
  const next =
    nextCheckAtMs === null
      ? null
      : `${DUE_PREFIX}${String(nextCheckAtMs).padStart(16, "0")}:${executionId}`;
  if (previous && previous !== next) {
    await transaction.delete(previous);
  }
  if (next) {
    await transaction.put(next, executionId);
    await transaction.put(referenceKey, next);
  } else {
    await transaction.delete(referenceKey);
  }
}

async function readEligibleCommand(
  transaction: Transaction,
  executionId: string
) {
  const [rawCommand, rawAuthority] = await Promise.all([
    transaction.get(
      buildRuntimeCoordinatorRunCommandStateStorageKey(executionId)
    ),
    transaction.get(
      buildRuntimeCoordinatorTokenAuthorityStorageKey(executionId)
    ),
  ]);
  if (rawAuthority === undefined) {
    return null;
  }
  const authority =
    runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
      rawAuthority
    );
  if (!authority.success) {
    throw new Error("runtime_coordinator.execution_token_authority_invalid");
  }
  if (authority.data.terminalOutcome || rawCommand === undefined) {
    return null;
  }
  if (!isRuntimeCoordinatorRunCommandState(rawCommand)) {
    throw new Error("runtime_coordinator.run_command_state_invalid");
  }
  return rawCommand;
}

export async function syncRuntimeCoordinatorWatchdogSchedule(
  transaction: Transaction,
  executionId: string
): Promise<void> {
  const command = await readEligibleCommand(transaction, executionId);
  await writeRuntimeCoordinatorWatchdogSchedule(
    transaction,
    executionId,
    command
      ? resolveRuntimeCoordinatorRunCommandStateWatchdogAtMs(command)
      : null
  );
}

// Old records are repaired in bounded pages. The cursor and repaired schedules
// commit together; concurrent progress/terminal writes cannot resurrect stale work.
export async function repairRuntimeCoordinatorWatchdogSchedule(
  storage: Storage
): Promise<void> {
  await storage.transaction(async (transaction) => {
    const cursor = await transaction.get<string | null>(REPAIR_KEY);
    if (cursor === null) {
      return;
    }
    const records = await transaction.list({
      prefix: RUNTIME_COORDINATOR_RUN_COMMAND_STATE_STORAGE_KEY_PREFIX,
      ...(cursor ? { startAfter: cursor } : {}),
      limit: PAGE_SIZE,
    });
    for (const key of records.keys()) {
      if (key === RUNTIME_COORDINATOR_RUN_COMMAND_STATE_INDEX_STORAGE_KEY) {
        continue;
      }
      const executionId = key.slice(
        RUNTIME_COORDINATOR_RUN_COMMAND_STATE_STORAGE_KEY_PREFIX.length
      );
      await syncRuntimeCoordinatorWatchdogSchedule(transaction, executionId);
    }
    await transaction.put(
      REPAIR_KEY,
      records.size < PAGE_SIZE ? null : [...records.keys()].at(-1)
    );
  });
}

export async function readRuntimeCoordinatorWatchdogDueCommands(
  storage: Storage,
  nowMs: number
): Promise<RuntimeCoordinatorRunCommandState[]> {
  const entries = await storage.list<string>({
    prefix: DUE_PREFIX,
    end: `${DUE_PREFIX}${String(nowMs + 1).padStart(16, "0")}:`,
    limit: PAGE_SIZE,
  });
  const commands: RuntimeCoordinatorRunCommandState[] = [];
  for (const [key, executionId] of entries) {
    const command = await storage.transaction(async (transaction) => {
      // Do not mutate a schedule that advanced while this page was being read.
      if (
        (await transaction.get(`${REFERENCE_PREFIX}${executionId}`)) !== key
      ) {
        await transaction.delete(key);
        return null;
      }
      const current = await readEligibleCommand(transaction, executionId);
      const dueAtMs = current
        ? resolveRuntimeCoordinatorRunCommandStateWatchdogAtMs(current)
        : null;
      if (dueAtMs === null || dueAtMs > nowMs) {
        await writeRuntimeCoordinatorWatchdogSchedule(
          transaction,
          executionId,
          dueAtMs
        );
        return null;
      }
      // A failing record must not monopolize the prefix. This retry timestamp
      // does not change progress, execution authority, or the expiry baseline.
      await writeRuntimeCoordinatorWatchdogSchedule(
        transaction,
        executionId,
        nowMs + 30_000
      );
      return current;
    });
    if (command) {
      commands.push(command);
    }
  }
  return commands;
}

export async function readNextRuntimeCoordinatorWatchdogAlarmAtMs(
  storage: Storage,
  nowMs: number
): Promise<number | null> {
  const [repairCursor, entries] = await Promise.all([
    storage.get<string | null>(REPAIR_KEY),
    storage.list<string>({ prefix: DUE_PREFIX, limit: 1 }),
  ]);
  const firstKey = entries.keys().next().value;
  const nextDueAtMs = firstKey
    ? Number(firstKey.slice(DUE_PREFIX.length, DUE_PREFIX.length + 16))
    : null;
  return repairCursor !== null
    ? Math.min(nextDueAtMs ?? nowMs + 1000, nowMs + 1000)
    : nextDueAtMs;
}
