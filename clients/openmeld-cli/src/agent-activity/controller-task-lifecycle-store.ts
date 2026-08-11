import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { submitAgentControllerTaskLifecycleEventItemSchema } from "@openmeld/schemas";
import type {
  SubmitAgentControllerTaskLifecycleEventItem,
  SubmitAgentControllerTaskLifecycleEventResult,
} from "@openmeld/schemas/types";
import { resolveOpenMeldRootDir } from "../config/paths";
import { withAgentActivityLocalStateLock } from "./local-state-lock";

const OUTBOX_LIMIT = 10_000;
const BATCH_LIMIT = 64;
const PERMANENT_DIAGNOSTIC_LIMIT = 200;
const QUARANTINED_INVALID_RECORD_PATTERN =
  /^(?:(\d+)-)?([0-9a-f-]{36})\.(?:invalid|invalid-diagnostics)$/u;

type StoreInput = { rootDir?: string };

export type ControllerTaskLifecycleOutboxRecord = {
  attemptCount: number;
  event: SubmitAgentControllerTaskLifecycleEventItem;
  nextAttemptAtMs: number;
  queuedAtMs: number;
};

type PermanentDiagnostic = {
  eventId: string;
  occurredAtMs: number;
  reason: string;
};

function selectLatestPermanentDiagnostics(
  diagnostics: readonly PermanentDiagnostic[]
): PermanentDiagnostic[] {
  return [...diagnostics]
    .sort(
      (left, right) =>
        left.occurredAtMs - right.occurredAtMs ||
        left.eventId.localeCompare(right.eventId)
    )
    .slice(-PERMANENT_DIAGNOSTIC_LIMIT);
}

type CurrentOutboxRecordRead =
  | { status: "invalid" }
  | { status: "missing" }
  | {
      record: ControllerTaskLifecycleOutboxRecord;
      status: "valid";
    };

export class ControllerTaskLifecycleSubmissionMismatchError extends Error {
  constructor() {
    super(
      "Agent Controller task lifecycle submission response did not match the sent batch."
    );
    this.name = "ControllerTaskLifecycleSubmissionMismatchError";
  }
}

export async function enqueueControllerTaskLifecycleEvent(
  input: StoreInput & {
    event: SubmitAgentControllerTaskLifecycleEventItem;
    nowMs?: number;
  }
): Promise<"queued" | "reused"> {
  const event = submitAgentControllerTaskLifecycleEventItemSchema.parse(
    input.event
  );
  return await withAgentActivityLocalStateLock(input, async () => {
    return await enqueueControllerTaskLifecycleEventWhileLocked({
      ...input,
      event,
    });
  });
}

export async function enqueueControllerTaskLifecycleEventWhileLocked(
  input: StoreInput & {
    event: SubmitAgentControllerTaskLifecycleEventItem;
    nowMs?: number;
  }
): Promise<"queued" | "reused"> {
  const event = submitAgentControllerTaskLifecycleEventItemSchema.parse(
    input.event
  );
  const paths = await ensureStorePaths(input);
  const target = outboxPath(paths.outbox, event.eventId);
  const existing = await readCurrentOutboxRecord(target);
  if (existing.status === "valid") {
    if (JSON.stringify(existing.record.event) !== JSON.stringify(event)) {
      throw new Error(
        `Agent Controller task lifecycle outbox event id conflict: ${event.eventId}`
      );
    }
    return "reused";
  }
  const nowMs = input.nowMs ?? Date.now();
  if (existing.status === "invalid") {
    await quarantineInvalidRecord(paths, target, nowMs);
  }
  if ((await readdir(paths.outbox)).length >= OUTBOX_LIMIT) {
    throw new Error(
      `Agent Controller task lifecycle outbox reached its ${OUTBOX_LIMIT} event safety limit.`
    );
  }
  await atomicWriteJson(target, {
    attemptCount: 0,
    event,
    nextAttemptAtMs: nowMs,
    queuedAtMs: nowMs,
  } satisfies ControllerTaskLifecycleOutboxRecord);
  return "queued";
}

export async function readDueControllerTaskLifecycleOutbox(
  input: StoreInput & { limit?: number; nowMs?: number }
): Promise<ControllerTaskLifecycleOutboxRecord[]> {
  const paths = await ensureStorePaths(input);
  return await withAgentActivityLocalStateLock(input, async () => {
    const records: ControllerTaskLifecycleOutboxRecord[] = [];
    const limit = Math.max(
      1,
      Math.min(BATCH_LIMIT, input.limit ?? BATCH_LIMIT)
    );
    const nowMs = input.nowMs ?? Date.now();
    for (const name of (await readdir(paths.outbox)).sort()) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const path = join(paths.outbox, name);
      const current = await readCurrentOutboxRecord(path);
      if (current.status === "invalid") {
        await quarantineInvalidRecord(paths, path, nowMs);
        continue;
      }
      if (current.status === "missing") {
        continue;
      }
      const record = current.record;
      if (record.nextAttemptAtMs <= nowMs) {
        records.push(record);
      }
    }
    return records
      .sort((left, right) => {
        const queuedOrder = left.queuedAtMs - right.queuedAtMs;
        if (queuedOrder !== 0) {
          return queuedOrder;
        }
        return lifecycleEventOrder(left) - lifecycleEventOrder(right);
      })
      .slice(0, limit);
  });
}

function lifecycleEventOrder(
  record: ControllerTaskLifecycleOutboxRecord
): number {
  if (record.event.eventType === "registered") {
    return 0;
  }
  if (record.event.eventType === "needs_attention") {
    return 1;
  }
  return 2;
}

export async function applyControllerTaskLifecycleSubmissionResults(
  input: StoreInput & {
    nowMs?: number;
    records: readonly ControllerTaskLifecycleOutboxRecord[];
    results: readonly SubmitAgentControllerTaskLifecycleEventResult[];
    writePermanentDiagnostic?: (
      root: string,
      diagnostic: PermanentDiagnostic
    ) => Promise<void>;
  }
): Promise<void> {
  assertResultsMatch(input.records, input.results);
  const paths = await ensureStorePaths(input);
  const byEventId = new Map(
    input.results.map((result) => [result.eventId, result])
  );
  const nowMs = input.nowMs ?? Date.now();
  for (const record of input.records) {
    const result = byEventId.get(record.event.eventId);
    if (!result || result.status === "retryable_rejected") {
      await retryRecord(input, paths, record, nowMs);
      continue;
    }
    await commitTerminalResult({
      diagnostic:
        result.status === "permanently_rejected"
          ? {
              eventId: record.event.eventId,
              occurredAtMs: nowMs,
              reason: result.reason ?? "unknown",
            }
          : null,
      input,
      paths,
      record,
      writePermanentDiagnostic: input.writePermanentDiagnostic,
    });
  }
}

export async function deferControllerTaskLifecycleOutbox(
  input: StoreInput & {
    nowMs?: number;
    records: readonly ControllerTaskLifecycleOutboxRecord[];
  }
): Promise<void> {
  const paths = await ensureStorePaths(input);
  const nowMs = input.nowMs ?? Date.now();
  for (const record of input.records) {
    await retryRecord(input, paths, record, nowMs);
  }
}

export async function removeUnboundControllerTaskLifecycleEvents(
  input: StoreInput & { organizationIds: ReadonlySet<string> }
): Promise<number> {
  const paths = await ensureStorePaths(input);
  return await withAgentActivityLocalStateLock(input, async () => {
    let removed = 0;
    for (const name of await readdir(paths.outbox)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const path = join(paths.outbox, name);
      const current = await readCurrentOutboxRecord(path);
      if (current.status === "invalid") {
        await quarantineInvalidRecord(paths, path, Date.now());
        continue;
      }
      if (
        current.status === "valid" &&
        !input.organizationIds.has(current.record.event.organizationId)
      ) {
        await rm(path, { force: true });
        removed += 1;
      }
    }
    return removed;
  });
}

export async function readControllerTaskLifecycleOutboxHealth(
  input: StoreInput
): Promise<{
  pending: number;
  permanentlyRejected: number;
  retrying: number;
}> {
  const paths = await ensureStorePaths(input);
  return await withAgentActivityLocalStateLock(input, async () => {
    let pending = 0;
    let retrying = 0;
    for (const name of await readdir(paths.outbox)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const path = join(paths.outbox, name);
      const current = await readCurrentOutboxRecord(path);
      if (current.status === "invalid") {
        await quarantineInvalidRecord(paths, path, Date.now());
        continue;
      }
      if (current.status === "missing") {
        continue;
      }
      const record = current.record;
      pending += 1;
      if (record.attemptCount > 0) {
        retrying += 1;
      }
    }
    const diagnostics = await readPermanentDiagnostics(paths.root);
    return { pending, permanentlyRejected: diagnostics.length, retrying };
  });
}

async function retryRecord(
  input: StoreInput,
  paths: Awaited<ReturnType<typeof ensureStorePaths>>,
  record: ControllerTaskLifecycleOutboxRecord,
  nowMs: number
): Promise<void> {
  await withAgentActivityLocalStateLock(input, async () => {
    const path = outboxPath(paths.outbox, record.event.eventId);
    const current = await readCurrentOutboxRecord(path);
    if (current.status === "invalid") {
      await quarantineInvalidRecord(paths, path, nowMs);
      return;
    }
    if (current.status === "missing" || !sameRevision(current.record, record)) {
      return;
    }
    const attemptCount = current.record.attemptCount + 1;
    const delayMs = Math.min(5 * 60_000, 1000 * 2 ** Math.min(attemptCount, 8));
    await atomicWriteJson(path, {
      ...current.record,
      attemptCount,
      nextAttemptAtMs: nowMs + delayMs,
    } satisfies ControllerTaskLifecycleOutboxRecord);
  });
}

async function commitTerminalResult(input: {
  diagnostic: PermanentDiagnostic | null;
  input: StoreInput;
  paths: Awaited<ReturnType<typeof ensureStorePaths>>;
  record: ControllerTaskLifecycleOutboxRecord;
  writePermanentDiagnostic?: (
    root: string,
    diagnostic: PermanentDiagnostic
  ) => Promise<void>;
}): Promise<void> {
  await withAgentActivityLocalStateLock(input.input, async () => {
    const path = outboxPath(input.paths.outbox, input.record.event.eventId);
    const current = await readCurrentOutboxRecord(path);
    if (current.status === "invalid") {
      await quarantineInvalidRecord(
        input.paths,
        path,
        input.diagnostic?.occurredAtMs ?? Date.now()
      );
      return;
    }
    if (
      current.status === "missing" ||
      !sameRevision(current.record, input.record)
    ) {
      return;
    }
    if (input.diagnostic) {
      await (input.writePermanentDiagnostic ?? appendPermanentDiagnostic)(
        input.paths.root,
        input.diagnostic
      );
    }
    await rm(path, { force: true });
  });
}

function assertResultsMatch(
  records: readonly ControllerTaskLifecycleOutboxRecord[],
  results: readonly SubmitAgentControllerTaskLifecycleEventResult[]
): void {
  if (records.length !== results.length) {
    throw new ControllerTaskLifecycleSubmissionMismatchError();
  }
  const expected = new Set(records.map((record) => record.event.eventId));
  const actual = new Set(results.map((result) => result.eventId));
  if (
    actual.size !== results.length ||
    expected.size !== actual.size ||
    [...expected].some((eventId) => !actual.has(eventId))
  ) {
    throw new ControllerTaskLifecycleSubmissionMismatchError();
  }
}

async function appendPermanentDiagnostic(
  root: string,
  diagnostic: PermanentDiagnostic
): Promise<void> {
  const current = await readPermanentDiagnostics(root);
  if (
    !current.some(
      (entry) =>
        entry.eventId === diagnostic.eventId &&
        entry.reason === diagnostic.reason
    )
  ) {
    current.push(diagnostic);
  }
  await atomicWriteJson(
    join(root, "permanent-rejections.json"),
    selectLatestPermanentDiagnostics(current)
  );
}

async function readPermanentDiagnostics(
  root: string
): Promise<PermanentDiagnostic[]> {
  const path = join(root, "permanent-rejections.json");
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw error;
  });
  let diagnostics: PermanentDiagnostic[] = [];
  let needsRepair = false;
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(isPermanentDiagnostic)) {
        diagnostics = parsed;
      } else {
        needsRepair = true;
      }
    } catch {
      needsRepair = true;
    }
  }
  const quarantine = join(root, "quarantine");
  if (needsRepair) {
    const nowMs = Date.now();
    const diagnosticId = randomUUID();
    await mkdir(quarantine, { mode: 0o700, recursive: true });
    await rename(
      path,
      join(quarantine, `${nowMs}-${diagnosticId}.invalid-diagnostics`)
    ).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) {
        throw error;
      }
    });
    diagnostics.push({
      eventId: `invalid:${diagnosticId}`,
      occurredAtMs: nowMs,
      reason: "invalid_outbox_record",
    });
  }
  const recovered = await readQuarantinedInvalidRecordDiagnostics(quarantine);
  for (const { diagnostic } of recovered) {
    if (
      !diagnostics.some(
        (entry) =>
          entry.eventId === diagnostic.eventId &&
          entry.reason === diagnostic.reason
      )
    ) {
      diagnostics.push(diagnostic);
      needsRepair = true;
    }
  }
  const selectedDiagnostics = selectLatestPermanentDiagnostics(diagnostics);
  needsRepair ||=
    JSON.stringify(selectedDiagnostics) !== JSON.stringify(diagnostics);
  diagnostics = selectedDiagnostics;
  if (needsRepair) {
    await atomicWriteJson(path, diagnostics);
  }
  await markQuarantinedInvalidRecordsReconciled(quarantine, recovered);
  await trimQuarantineEntries(quarantine);
  return diagnostics;
}

async function readQuarantinedInvalidRecordDiagnostics(
  quarantine: string
): Promise<Array<{ diagnostic: PermanentDiagnostic; entry: string }>> {
  const entries = await readQuarantineEntries(quarantine);
  const legacyRecoveryOccurredAtMs = Date.now();
  return entries.flatMap((entry) => {
    const match = QUARANTINED_INVALID_RECORD_PATTERN.exec(entry);
    const diagnosticId = match?.[2];
    if (!diagnosticId) {
      return [];
    }
    const occurredAtMs = Number(match?.[1] ?? legacyRecoveryOccurredAtMs);
    return [
      {
        diagnostic: {
          eventId: `invalid:${diagnosticId}`,
          occurredAtMs,
          reason: "invalid_outbox_record",
        },
        entry,
      },
    ];
  });
}

async function readQuarantineEntries(quarantine: string): Promise<string[]> {
  return await readdir(quarantine).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return [];
    }
    throw error;
  });
}

async function markQuarantinedInvalidRecordsReconciled(
  quarantine: string,
  recovered: ReadonlyArray<{ entry: string }>
): Promise<void> {
  for (const { entry } of recovered) {
    await rename(
      join(quarantine, entry),
      join(quarantine, `${entry}.reconciled`)
    ).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) {
        throw error;
      }
    });
  }
}

async function ensureStorePaths(input: StoreInput) {
  const root = join(
    input.rootDir ?? resolveOpenMeldRootDir(),
    "device",
    "agent-task-coordination"
  );
  const outbox = join(root, "outbox");
  const quarantine = join(root, "quarantine");
  await Promise.all([
    mkdir(outbox, { mode: 0o700, recursive: true }),
    mkdir(quarantine, { mode: 0o700, recursive: true }),
  ]);
  return { outbox, quarantine, root };
}

async function quarantineInvalidRecord(
  paths: Awaited<ReturnType<typeof ensureStorePaths>>,
  path: string,
  nowMs: number
): Promise<void> {
  const diagnosticId = randomUUID();
  await rename(
    path,
    join(paths.quarantine, `${nowMs}-${diagnosticId}.invalid`)
  ).catch((error: unknown) => {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  });
  await appendPermanentDiagnostic(paths.root, {
    eventId: `invalid:${diagnosticId}`,
    occurredAtMs: nowMs,
    reason: "invalid_outbox_record",
  });
  await trimQuarantineEntries(paths.quarantine);
}

async function trimQuarantineEntries(quarantine: string): Promise<void> {
  const entries = (await readQuarantineEntries(quarantine)).sort();
  for (const stale of entries.slice(0, -PERMANENT_DIAGNOSTIC_LIMIT)) {
    await rm(join(quarantine, stale), { force: true });
  }
}

async function readCurrentOutboxRecord(
  path: string
): Promise<CurrentOutboxRecordRead> {
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return { status: "missing" };
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!(value && typeof value === "object" && "event" in value)) {
      return { status: "invalid" };
    }
    const event = submitAgentControllerTaskLifecycleEventItemSchema.safeParse(
      value.event
    );
    const attemptCount = Number(
      "attemptCount" in value ? value.attemptCount : Number.NaN
    );
    const nextAttemptAtMs = Number(
      "nextAttemptAtMs" in value ? value.nextAttemptAtMs : Number.NaN
    );
    const queuedAtMs = Number(
      "queuedAtMs" in value ? value.queuedAtMs : Number.NaN
    );
    if (
      !(
        event.success &&
        Number.isInteger(attemptCount) &&
        attemptCount >= 0 &&
        Number.isFinite(nextAttemptAtMs) &&
        Number.isFinite(queuedAtMs)
      )
    ) {
      return { status: "invalid" };
    }
    return {
      record: {
        attemptCount,
        event: event.data,
        nextAttemptAtMs,
        queuedAtMs,
      },
      status: "valid",
    };
  } catch {
    return { status: "invalid" };
  }
}

function sameRevision(
  left: ControllerTaskLifecycleOutboxRecord,
  right: ControllerTaskLifecycleOutboxRecord
): boolean {
  return (
    left.attemptCount === right.attemptCount &&
    left.nextAttemptAtMs === right.nextAttemptAtMs &&
    left.queuedAtMs === right.queuedAtMs &&
    JSON.stringify(left.event) === JSON.stringify(right.event)
  );
}

function outboxPath(directory: string, eventId: string): string {
  const fileName = createHash("sha256").update(eventId).digest("hex");
  return join(directory, `${fileName}.json`);
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

function isPermanentDiagnostic(value: unknown): value is PermanentDiagnostic {
  return Boolean(
    value &&
      typeof value === "object" &&
      "eventId" in value &&
      typeof value.eventId === "string" &&
      "occurredAtMs" in value &&
      Number.isFinite(value.occurredAtMs) &&
      "reason" in value &&
      typeof value.reason === "string"
  );
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error && "code" in error && String(error.code) === code
  );
}
