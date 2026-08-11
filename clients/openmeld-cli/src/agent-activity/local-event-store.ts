import { randomUUID } from "node:crypto";
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
import {
  AGENT_ACTIVITY_EVENT_BATCH_LIMIT,
  AGENT_ACTIVITY_EVENT_MAX_BYTES,
  agentActivityEventSchema,
} from "@openmeld/schemas";
import type {
  AgentActivityEvent,
  SubmitAgentActivityEventResult,
} from "@openmeld/schemas/types";
import { resolveOpenMeldRootDir } from "../config/paths";
import { withAgentActivityLocalStateLock } from "./local-state-lock";
import { isProjectBound } from "./project-bindings";

const OUTBOX_LIMIT = 10_000;
const PERMANENT_DIAGNOSTIC_LIMIT = 200;

type StoreInput = { rootDir?: string };

export type AgentActivityOutboxRecord = {
  attemptCount: number;
  event: AgentActivityEvent;
  nextAttemptAtMs: number;
  queuedAtMs: number;
};

type PermanentDiagnostic = {
  eventId: string | null;
  occurredAtMs: number;
  provider: AgentActivityEvent["provider"] | null;
  reason: string;
};

export class AgentActivitySubmissionResultsMismatchError extends Error {
  constructor() {
    super("Agent Activity submission response did not match the sent batch.");
    this.name = "AgentActivitySubmissionResultsMismatchError";
  }
}

export async function enqueueAgentActivityEvent(
  input: StoreInput & { event: AgentActivityEvent; nowMs?: number }
): Promise<"queued" | "reused" | "unbound"> {
  const event = agentActivityEventSchema.parse(input.event);
  if (
    Buffer.byteLength(JSON.stringify(event), "utf8") >
    AGENT_ACTIVITY_EVENT_MAX_BYTES
  ) {
    throw new Error("Agent Activity event exceeds its 16 KiB safety limit.");
  }
  const paths = await ensureStorePaths(input);
  return await withAgentActivityLocalStateLock(input, async () => {
    if (!(await isEventProjectStillBound(input, event))) {
      return "unbound";
    }
    const target = join(
      paths.outbox,
      `${safeEventFileName(event.eventId)}.json`
    );
    const existing = await readFile(target, "utf8").catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) {
        return null;
      }
      throw error;
    });
    if (existing !== null) {
      const record = parseOutboxRecord(existing, target);
      if (JSON.stringify(record.event) !== JSON.stringify(event)) {
        throw new Error(
          `Agent Activity outbox event id conflict: ${event.eventId}`
        );
      }
      return "reused";
    }
    const entries = await readdir(paths.outbox);
    if (entries.length >= OUTBOX_LIMIT) {
      throw new Error(
        `Agent Activity outbox reached its ${OUTBOX_LIMIT} event safety limit.`
      );
    }
    const nowMs = input.nowMs ?? Date.now();
    await atomicWriteJson(target, {
      attemptCount: 0,
      event,
      nextAttemptAtMs: nowMs,
      queuedAtMs: nowMs,
    } satisfies AgentActivityOutboxRecord);
    if (!(await isEventProjectStillBound(input, event))) {
      await rm(target, { force: true });
      return "unbound";
    }
    return "queued";
  });
}

export async function readDueAgentActivityOutbox(
  input: StoreInput & { limit?: number; nowMs?: number }
): Promise<AgentActivityOutboxRecord[]> {
  const paths = await ensureStorePaths(input);
  return await withAgentActivityLocalStateLock(input, async () => {
    const nowMs = input.nowMs ?? Date.now();
    const limit = Math.max(
      1,
      Math.min(
        AGENT_ACTIVITY_EVENT_BATCH_LIMIT,
        input.limit ?? AGENT_ACTIVITY_EVENT_BATCH_LIMIT
      )
    );
    const records: AgentActivityOutboxRecord[] = [];
    for (const name of (await readdir(paths.outbox)).sort()) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const path = join(paths.outbox, name);
      const raw = await readFile(path, "utf8");
      let record: AgentActivityOutboxRecord;
      try {
        record = parseOutboxRecord(raw, path);
      } catch {
        await quarantineInvalidOutboxRecord(paths, path, nowMs);
        continue;
      }
      if (record.nextAttemptAtMs <= nowMs) {
        records.push(record);
      }
      if (records.length >= limit) {
        break;
      }
    }
    return records;
  });
}

export async function applyAgentActivitySubmissionResults(
  input: StoreInput & {
    nowMs?: number;
    records: readonly AgentActivityOutboxRecord[];
    results: readonly SubmitAgentActivityEventResult[];
    writePermanentDiagnostic?: (
      root: string,
      diagnostic: PermanentDiagnostic
    ) => Promise<void>;
  }
): Promise<void> {
  assertSubmissionResultsMatchRecords(input.records, input.results);
  const paths = await ensureStorePaths(input);
  const byIndex = new Map(
    input.results.map((result) => [result.index, result])
  );
  const nowMs = input.nowMs ?? Date.now();
  for (const [index, record] of input.records.entries()) {
    const result = byIndex.get(index);
    if (!result) {
      await retryRecord(input, paths, record, nowMs);
      continue;
    }
    if (
      result.outcome === "accepted" ||
      result.outcome === "reused" ||
      result.outcome === "permanent_rejected"
    ) {
      await commitTerminalResult({
        diagnostic:
          result.outcome === "permanent_rejected"
            ? {
                eventId: result.eventId ?? record.event.eventId,
                occurredAtMs: nowMs,
                provider: record.event.provider,
                reason: result.reason ?? "unknown",
              }
            : null,
        input,
        paths,
        record,
        writePermanentDiagnostic: input.writePermanentDiagnostic,
      });
      continue;
    }
    await retryRecord(input, paths, record, nowMs);
  }
}

function assertSubmissionResultsMatchRecords(
  records: readonly AgentActivityOutboxRecord[],
  results: readonly SubmitAgentActivityEventResult[]
) {
  if (results.length !== records.length) {
    throw new AgentActivitySubmissionResultsMismatchError();
  }
  const seen = new Set<number>();
  for (const result of results) {
    const record = records[result.index];
    if (
      !record ||
      seen.has(result.index) ||
      result.eventId !== record.event.eventId
    ) {
      throw new AgentActivitySubmissionResultsMismatchError();
    }
    seen.add(result.index);
  }
}

export async function deferAgentActivityOutbox(
  input: StoreInput & {
    nowMs?: number;
    records: readonly AgentActivityOutboxRecord[];
  }
): Promise<void> {
  const paths = await ensureStorePaths(input);
  const nowMs = input.nowMs ?? Date.now();
  await Promise.all(
    input.records.map(
      async (record) => await retryRecord(input, paths, record, nowMs)
    )
  );
}

export async function removeProjectOutbox(
  input: StoreInput & {
    organizationId: string;
    projectId?: string;
    projectSlug?: string;
  }
): Promise<number> {
  const paths = await ensureStorePaths(input);
  return await withAgentActivityLocalStateLock(input, async () => {
    let removed = 0;
    for (const name of await readdir(paths.outbox)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const path = join(paths.outbox, name);
      let record: AgentActivityOutboxRecord;
      try {
        record = parseOutboxRecord(await readFile(path, "utf8"), path);
      } catch {
        await quarantineInvalidOutboxRecord(paths, path, Date.now());
        continue;
      }
      if (
        record.event.organizationId === input.organizationId &&
        (input.projectId === undefined ||
          record.event.projectId === input.projectId)
      ) {
        await rm(path, { force: true });
        removed += 1;
      }
    }
    return removed;
  });
}

export async function readAgentActivityOutboxHealth(input: StoreInput) {
  const paths = await ensureStorePaths(input);
  return await withAgentActivityLocalStateLock(input, async () => {
    let pending = 0;
    let retrying = 0;
    for (const name of await readdir(paths.outbox)) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const path = join(paths.outbox, name);
      let record: AgentActivityOutboxRecord;
      try {
        record = parseOutboxRecord(await readFile(path, "utf8"), path);
      } catch {
        await quarantineInvalidOutboxRecord(paths, path, Date.now());
        continue;
      }
      pending += 1;
      if (record.attemptCount > 0) {
        retrying += 1;
      }
    }
    const diagnostics = await readPermanentDiagnostics(paths.root);
    return { pending, permanentlyRejected: diagnostics.length, retrying };
  });
}

function parseOutboxRecord(
  raw: string,
  path: string
): AgentActivityOutboxRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Agent Activity outbox record is invalid: ${path}`, {
      cause: error,
    });
  }
  if (!(value && typeof value === "object" && "event" in value)) {
    throw new Error(`Agent Activity outbox record is invalid: ${path}`);
  }
  const event = agentActivityEventSchema.safeParse(value.event);
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
    !(event.success && Number.isInteger(attemptCount)) ||
    attemptCount < 0 ||
    !Number.isFinite(nextAttemptAtMs) ||
    !Number.isFinite(queuedAtMs)
  ) {
    throw new Error(`Agent Activity outbox record is invalid: ${path}`);
  }
  return { attemptCount, event: event.data, nextAttemptAtMs, queuedAtMs };
}

async function retryRecord(
  input: StoreInput,
  paths: Awaited<ReturnType<typeof ensureStorePaths>>,
  record: AgentActivityOutboxRecord,
  nowMs: number
) {
  await withAgentActivityLocalStateLock(input, async () => {
    const path = outboxPath(paths.outbox, record.event.eventId);
    const current = await readCurrentOutboxRecord(path);
    if (!(current && sameOutboxRevision(current, record))) {
      return;
    }
    if (!(await isEventProjectStillBound(input, record.event))) {
      await rm(path, { force: true });
      return;
    }
    const attemptCount = record.attemptCount + 1;
    const delayMs = Math.min(5 * 60_000, 1000 * 2 ** Math.min(attemptCount, 8));
    await atomicWriteJson(path, {
      ...record,
      attemptCount,
      nextAttemptAtMs: nowMs + delayMs,
    } satisfies AgentActivityOutboxRecord);
  });
}

async function commitTerminalResult(input: {
  diagnostic: PermanentDiagnostic | null;
  input: StoreInput;
  paths: Awaited<ReturnType<typeof ensureStorePaths>>;
  record: AgentActivityOutboxRecord;
  writePermanentDiagnostic?: (
    root: string,
    diagnostic: PermanentDiagnostic
  ) => Promise<void>;
}) {
  await withAgentActivityLocalStateLock(input.input, async () => {
    const path = outboxPath(input.paths.outbox, input.record.event.eventId);
    const current = await readCurrentOutboxRecord(path);
    if (!(current && sameOutboxRevision(current, input.record))) {
      return;
    }
    await rm(path, { force: true });
    if (input.diagnostic) {
      await (input.writePermanentDiagnostic ?? appendPermanentDiagnostic)(
        input.paths.root,
        input.diagnostic
      ).catch(() => {
        process.stderr.write(
          "[openmeld.agent_activity.diagnostic_write_failed] Permanent rejection remained terminal, but its local diagnostic could not be recorded.\n"
        );
      });
    }
  });
}

async function appendPermanentDiagnostic(
  root: string,
  diagnostic: PermanentDiagnostic
) {
  const diagnostics = await readPermanentDiagnostics(root);
  if (
    !diagnostics.some(
      (current) =>
        current.eventId === diagnostic.eventId &&
        current.reason === diagnostic.reason
    )
  ) {
    diagnostics.push(diagnostic);
  }
  await atomicWriteJson(
    join(root, "permanent-rejections.json"),
    diagnostics.slice(-PERMANENT_DIAGNOSTIC_LIMIT)
  );
}

async function readPermanentDiagnostics(root: string) {
  const path = join(root, "permanent-rejections.json");
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return "[]";
    }
    throw error;
  });
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value) && value.every(isPermanentDiagnostic)) {
      return value;
    }
  } catch {
    // Invalid diagnostics are quarantined below without copying their content.
  }
  const quarantine = join(root, "quarantine");
  await mkdir(quarantine, { mode: 0o700, recursive: true });
  await rename(
    path,
    join(quarantine, `${randomUUID()}.invalid-diagnostics`)
  ).catch((error: unknown) => {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  });
  return [];
}

function isPermanentDiagnostic(value: unknown): value is PermanentDiagnostic {
  return Boolean(
    value &&
      typeof value === "object" &&
      "eventId" in value &&
      (value.eventId === null || typeof value.eventId === "string") &&
      "occurredAtMs" in value &&
      Number.isFinite(Number(value.occurredAtMs)) &&
      "provider" in value &&
      (value.provider === null ||
        value.provider === "codex" ||
        value.provider === "claude-code" ||
        value.provider === "opencode") &&
      "reason" in value &&
      typeof value.reason === "string"
  );
}

async function ensureStorePaths(input: StoreInput) {
  const root = join(
    input.rootDir ?? resolveOpenMeldRootDir(),
    "device",
    "agent-activity"
  );
  const outbox = join(root, "outbox");
  const quarantine = join(root, "quarantine");
  await mkdir(outbox, { mode: 0o700, recursive: true });
  await mkdir(quarantine, { mode: 0o700, recursive: true });
  await chmod(root, 0o700);
  await chmod(outbox, 0o700);
  await chmod(quarantine, 0o700);
  return { outbox, quarantine, root };
}

async function quarantineInvalidOutboxRecord(
  paths: Awaited<ReturnType<typeof ensureStorePaths>>,
  path: string,
  nowMs: number
) {
  const target = join(paths.quarantine, `${randomUUID()}.invalid-outbox`);
  await rename(path, target).catch((error: unknown) => {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  });
  await appendPermanentDiagnostic(paths.root, {
    eventId: null,
    occurredAtMs: nowMs,
    provider: null,
    reason: "invalid_outbox_record",
  });
  const entries = (await readdir(paths.quarantine)).sort();
  for (const stale of entries.slice(0, -PERMANENT_DIAGNOSTIC_LIMIT)) {
    await rm(join(paths.quarantine, stale), { force: true });
  }
}

async function readCurrentOutboxRecord(path: string) {
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw error;
  });
  return raw === null ? null : parseOutboxRecord(raw, path);
}

function sameOutboxRevision(
  left: AgentActivityOutboxRecord,
  right: AgentActivityOutboxRecord
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function isEventProjectStillBound(
  input: StoreInput,
  event: AgentActivityEvent
) {
  return await isProjectBound({
    organizationId: event.organizationId,
    projectId: event.projectId,
    rootDir: input.rootDir,
  });
}

async function atomicWriteJson(path: string, value: unknown) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function outboxPath(root: string, eventId: string) {
  return join(root, `${safeEventFileName(eventId)}.json`);
}

function safeEventFileName(eventId: string) {
  return Buffer.from(eventId).toString("base64url");
}

function isNodeError(error: unknown, code: string) {
  return (
    error instanceof Error && "code" in error && String(error.code) === code
  );
}
