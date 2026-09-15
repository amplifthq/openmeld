import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runtimeTransportForkAgentSessionResultSchema } from "@openmeld/schemas";
import type {
  RuntimeTransportForkAgentSessionResult,
  RuntimeTransportLocalAgentControlForkSessionFramePayload,
} from "@openmeld/schemas/types";
import { z } from "zod/v4";

const STORE_SCHEMA = "openmeld-agent-session-fork-operation-store-v2" as const;
const LEGACY_STORE_SCHEMA = "openmeld-agent-session-fork-operation-store-v1";
const RECORD_SCHEMA =
  "openmeld-agent-session-fork-operation-record-v1" as const;
const STORE_FILE_NAME = "agent-session-fork-operations.json";
const STORE_TEMP_FILE_NAME = "agent-session-fork-operations.tmp";
const MAX_RETAINED_RECORDS = 256;

type ForkRequest =
  RuntimeTransportLocalAgentControlForkSessionFramePayload["request"];

const contextForkRequestSchema = z.strictObject({
  kind: z.literal("execution_context"),
  operationId: z.string().uuid(),
  sourceNativeSessionId: z.string().min(1),
  completedHistoryId: z.string().min(1),
  workingDirectory: z.string().min(1),
});
type ContextForkRequest = z.infer<typeof contextForkRequestSchema>;
const contextForkResultSchema = z.discriminatedUnion("status", [
  contextForkRequestSchema.extend({
    status: z.literal("completed"),
    childNativeSessionId: z.string().min(1),
  }),
  contextForkRequestSchema.extend({
    status: z.enum(["rejected", "outcome_unknown"]),
    reasonCode: z.string().min(1),
    message: z.string().min(1),
  }),
]);
type ContextForkResult = z.infer<typeof contextForkResultSchema>;
type ForkOperationRequest = ForkRequest | ContextForkRequest;
type ForkOperationResult =
  | RuntimeTransportForkAgentSessionResult
  | ContextForkResult;

type StoredOperation = {
  operationId: string;
  requestFingerprint: string;
  result: ForkOperationResult | null;
  schema: typeof RECORD_SCHEMA;
  updatedAtMs: number;
};

type OperationStore = {
  records: StoredOperation[];
  schema: typeof STORE_SCHEMA;
  updatedAtMs: number;
  v: 2;
};

type ReadRecordsResult =
  | { ok: true; records: StoredOperation[] }
  | {
      ok: false;
      reasonCode:
        | "agent_session_fork.operation_store_invalid"
        | "agent_session_fork.operation_store_unavailable"
        | "agent_session_fork.operation_store_update_required";
    };

const storeTails = new Map<string, Promise<void>>();

export async function runAgentSessionForkOperation(input: {
  execute: () => Promise<{ childNativeSessionId: string }>;
  ledgerRootPath: string;
  request: ForkRequest;
}): Promise<RuntimeTransportForkAgentSessionResult>;
export async function runAgentSessionForkOperation(input: {
  execute: () => Promise<{ childNativeSessionId: string }>;
  ledgerRootPath: string;
  request: ContextForkRequest;
}): Promise<ContextForkResult>;
export async function runAgentSessionForkOperation(input: {
  execute: () => Promise<{ childNativeSessionId: string }>;
  ledgerRootPath: string;
  request: ForkOperationRequest;
}): Promise<ForkOperationResult> {
  const previous = storeTails.get(input.ledgerRootPath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  storeTails.set(input.ledgerRootPath, tail);
  await previous;
  try {
    return await runSerialized(input);
  } finally {
    release();
    if (storeTails.get(input.ledgerRootPath) === tail) {
      storeTails.delete(input.ledgerRootPath);
    }
  }
}

async function runSerialized(input: {
  execute: () => Promise<{ childNativeSessionId: string }>;
  ledgerRootPath: string;
  request: ForkOperationRequest;
}): Promise<ForkOperationResult> {
  const stored = await readRecords(input.ledgerRootPath);
  if (!stored.ok) {
    return rejected(input.request, stored.reasonCode, stored.reasonCode);
  }
  const records = stored.records;
  const fingerprint = stableJson(input.request);
  const existing = records.find(
    (record) => record.operationId === input.request.operationId
  );
  if (existing) {
    if (existing.requestFingerprint !== fingerprint) {
      return rejected(
        input.request,
        "agent_session_fork.operation_identity_conflict",
        "This Fork operation id was already used for a different Session."
      );
    }
    return (
      existing.result ??
      outcomeUnknown(
        input.request,
        "The provider Fork started, but no authoritative child Session id was recorded."
      )
    );
  }
  if (
    records.filter(
      (record) =>
        record.result === null || record.result.status === "outcome_unknown"
    ).length >= MAX_RETAINED_RECORDS
  ) {
    return rejected(
      input.request,
      "agent_session_fork.unresolved_operation_limit",
      "Resolve uncertain fork operations before starting another fork."
    );
  }
  const started: StoredOperation = {
    operationId: input.request.operationId,
    requestFingerprint: fingerprint,
    result: null,
    schema: RECORD_SCHEMA,
    updatedAtMs: Date.now(),
  };
  try {
    await writeRecords(input.ledgerRootPath, [...records, started]);
  } catch (error) {
    return rejected(
      input.request,
      "agent_session_fork.operation_store_unavailable",
      toErrorMessage(error)
    );
  }
  let result: ForkOperationResult;
  try {
    const forked = await input.execute();
    result = parseForkOperationResult({
      ...input.request,
      childNativeSessionId: forked.childNativeSessionId,
      status: "completed",
    });
  } catch (error) {
    const reasonCode = readErrorCode(error);
    result = reasonCode
      ? rejected(input.request, reasonCode, toErrorMessage(error))
      : outcomeUnknown(input.request, toErrorMessage(error));
  }
  try {
    await writeRecords(input.ledgerRootPath, [
      ...records,
      { ...started, result, updatedAtMs: Date.now() },
    ]);
  } catch (error) {
    return outcomeUnknown(
      input.request,
      `The provider Fork finished, but OpenMeld could not record its result: ${toErrorMessage(error)}`
    );
  }
  return result;
}

async function readRecords(ledgerRootPath: string): Promise<ReadRecordsResult> {
  const path = join(ledgerRootPath, STORE_FILE_NAME);
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return { ok: true, records: [] };
    }
    return {
      ok: false,
      reasonCode: "agent_session_fork.operation_store_unavailable",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return {
      ok: false,
      reasonCode: "agent_session_fork.operation_store_invalid",
    };
  }
  if (!(parsed && typeof parsed === "object")) {
    return {
      ok: false,
      reasonCode: "agent_session_fork.operation_store_invalid",
    };
  }
  if (
    "schema" in parsed &&
    parsed.schema === LEGACY_STORE_SCHEMA &&
    "v" in parsed &&
    parsed.v === 1
  ) {
    parsed = { ...parsed, schema: STORE_SCHEMA, v: 2 };
  }
  const candidate = parsed as Partial<OperationStore>;
  if (candidate.schema !== STORE_SCHEMA || candidate.v !== 2) {
    return {
      ok: false,
      reasonCode: "agent_session_fork.operation_store_update_required",
    };
  }
  if (!isOperationStore(parsed)) {
    return {
      ok: false,
      reasonCode: "agent_session_fork.operation_store_invalid",
    };
  }
  return { ok: true, records: parsed.records };
}

async function writeRecords(
  ledgerRootPath: string,
  records: StoredOperation[]
): Promise<void> {
  const path = join(ledgerRootPath, STORE_FILE_NAME);
  const tempPath = join(ledgerRootPath, STORE_TEMP_FILE_NAME);
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const ordered = [...records].sort(
    (left, right) => right.updatedAtMs - left.updatedAtMs
  );
  const unresolved = ordered.filter(
    (record) =>
      record.result === null || record.result.status === "outcome_unknown"
  );
  const retained = [
    ...unresolved,
    ...ordered
      .filter((record) => !unresolved.includes(record))
      .slice(0, Math.max(0, MAX_RETAINED_RECORDS - unresolved.length)),
  ];
  await writeFile(
    tempPath,
    `${JSON.stringify(
      {
        records: retained,
        schema: STORE_SCHEMA,
        updatedAtMs: Date.now(),
        v: 2,
      } satisfies OperationStore,
      null,
      2
    )}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  await rename(tempPath, path);
}

function isOperationStore(value: unknown): value is OperationStore {
  if (!(value && typeof value === "object")) {
    return false;
  }
  const candidate = value as Partial<OperationStore>;
  return (
    candidate.schema === STORE_SCHEMA &&
    candidate.v === 2 &&
    Array.isArray(candidate.records) &&
    candidate.records.every(isStoredOperation)
  );
}

function isStoredOperation(value: unknown): value is StoredOperation {
  if (!(value && typeof value === "object")) {
    return false;
  }
  const candidate = value as Partial<StoredOperation>;
  return (
    candidate.schema === RECORD_SCHEMA &&
    typeof candidate.operationId === "string" &&
    typeof candidate.requestFingerprint === "string" &&
    typeof candidate.updatedAtMs === "number" &&
    (candidate.result === null ||
      runtimeTransportForkAgentSessionResultSchema.safeParse(candidate.result)
        .success ||
      contextForkResultSchema.safeParse(candidate.result).success)
  );
}

function rejected(
  request: ForkOperationRequest,
  reasonCode: string,
  message: string
): ForkOperationResult {
  return parseForkOperationResult({
    ...request,
    message,
    reasonCode,
    status: "rejected",
  });
}

function outcomeUnknown(
  request: ForkOperationRequest,
  message: string
): ForkOperationResult {
  return parseForkOperationResult({
    ...request,
    message,
    reasonCode: "agent_session_fork.provider_outcome_unknown",
    status: "outcome_unknown",
  });
}

function readErrorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    ? String(error.code).trim() || null
    : null;
}

function parseForkOperationResult(
  value: Record<string, unknown>
): ForkOperationResult {
  return value.kind === "execution_context"
    ? contextForkResultSchema.parse(value)
    : runtimeTransportForkAgentSessionResultSchema.parse(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error && (error as NodeJS.ErrnoException).code === code
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
