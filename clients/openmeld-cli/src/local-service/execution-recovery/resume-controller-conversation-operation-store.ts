import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  RuntimeTransportResumeControllerConversationFramePayload,
  RuntimeTransportResumeControllerConversationResult,
} from "@openmeld/schemas/types";

const STORE_SCHEMA =
  "openmeld-daemon-execution-recovery-operation-store-v1" as const;
const RECORD_SCHEMA =
  "openmeld-daemon-execution-recovery-operation-record-v1" as const;
const STORE_FILE_NAME = "execution-recovery-operations.json";
const STORE_TEMP_FILE_NAME = "execution-recovery-operations.tmp";
const MAX_RETAINED_RECORDS = 256;

type StoredResumeControllerConversationOperation = {
  operationId: string;
  request: RuntimeTransportResumeControllerConversationFramePayload;
  requestFingerprint: string;
  result: RuntimeTransportResumeControllerConversationResult | null;
  schema: typeof RECORD_SCHEMA;
  status: "completed" | "in_progress" | "outcome_unknown";
  updatedAtMs: number;
};

type OperationStoreFile = {
  records: StoredResumeControllerConversationOperation[];
  schema: typeof STORE_SCHEMA;
  updatedAtMs: number;
  v: 1;
};

type ReadRecordsResult =
  | {
      ok: true;
      records: StoredResumeControllerConversationOperation[];
    }
  | {
      ok: false;
      reasonCode:
        | "execution_recovery.operation_store_invalid"
        | "execution_recovery.operation_store_unavailable"
        | "execution_recovery.operation_store_update_required";
    };

const storeTails = new Map<string, Promise<void>>();

export async function runResumeControllerConversationOperation(input: {
  execute: () => Promise<RuntimeTransportResumeControllerConversationResult>;
  ledgerRootPath: string;
  request: RuntimeTransportResumeControllerConversationFramePayload;
}): Promise<RuntimeTransportResumeControllerConversationResult> {
  const previous = storeTails.get(input.ledgerRootPath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  storeTails.set(input.ledgerRootPath, tail);
  await previous;
  try {
    return await runSerializedResumeControllerConversationOperation(input);
  } finally {
    release();
    if (storeTails.get(input.ledgerRootPath) === tail) {
      storeTails.delete(input.ledgerRootPath);
    }
  }
}

async function runSerializedResumeControllerConversationOperation(input: {
  execute: () => Promise<RuntimeTransportResumeControllerConversationResult>;
  ledgerRootPath: string;
  request: RuntimeTransportResumeControllerConversationFramePayload;
}): Promise<RuntimeTransportResumeControllerConversationResult> {
  const stored = readRecords(input.ledgerRootPath);
  if (!stored.ok) {
    return rejected(input.request, stored.reasonCode);
  }
  const records = stored.records;
  const requestFingerprint = stableJson(input.request);
  const existing = records.find(
    (record) => record.operationId === input.request.operationId
  );
  if (existing) {
    if (existing.requestFingerprint !== requestFingerprint) {
      return rejected(
        input.request,
        "execution_recovery.operation_identity_conflict"
      );
    }
    if (existing.result) {
      return existing.result;
    }
    return outcomeUnknown(
      input.request,
      "The exact controller command started, but no authoritative result was recorded."
    );
  }

  const started: StoredResumeControllerConversationOperation = {
    operationId: input.request.operationId,
    request: input.request,
    requestFingerprint,
    result: null,
    schema: RECORD_SCHEMA,
    status: "in_progress",
    updatedAtMs: Date.now(),
  };
  writeRecords(input.ledgerRootPath, [...records, started]);

  let result: RuntimeTransportResumeControllerConversationResult;
  try {
    result = await input.execute();
  } catch (error) {
    result = outcomeUnknown(
      input.request,
      error instanceof Error ? error.message : String(error)
    );
  }
  const completed: StoredResumeControllerConversationOperation = {
    ...started,
    result,
    status:
      result.status === "completed" || result.status === "rejected"
        ? "completed"
        : "outcome_unknown",
    updatedAtMs: Date.now(),
  };
  writeRecords(input.ledgerRootPath, [...records, completed]);
  return result;
}

function outcomeUnknown(
  request: RuntimeTransportResumeControllerConversationFramePayload,
  message: string
): RuntimeTransportResumeControllerConversationResult {
  return {
    destination: request.destination,
    identity: request.identity,
    message,
    operationId: request.operationId,
    reasonCode: "execution_recovery.controller_outcome_unknown",
    status: "outcome_unknown",
  };
}

function rejected(
  request: RuntimeTransportResumeControllerConversationFramePayload,
  reasonCode: string
): RuntimeTransportResumeControllerConversationResult {
  return {
    destination: request.destination,
    identity: request.identity,
    message: reasonCode,
    operationId: request.operationId,
    reasonCode,
    status: "rejected",
  };
}

function readRecords(ledgerRootPath: string): ReadRecordsResult {
  const path = resolveStorePath(ledgerRootPath);
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return { ok: true, records: [] };
    }
    return {
      ok: false,
      reasonCode: "execution_recovery.operation_store_unavailable",
    };
  }
  let parsed: Partial<OperationStoreFile>;
  try {
    parsed = JSON.parse(source) as Partial<OperationStoreFile>;
  } catch {
    return {
      ok: false,
      reasonCode: "execution_recovery.operation_store_invalid",
    };
  }
  if (parsed.schema !== STORE_SCHEMA || parsed.v !== 1) {
    return {
      ok: false,
      reasonCode: "execution_recovery.operation_store_update_required",
    };
  }
  if (
    !(Array.isArray(parsed.records) && parsed.records.every(isStoredOperation))
  ) {
    return {
      ok: false,
      reasonCode: "execution_recovery.operation_store_invalid",
    };
  }
  return { ok: true, records: parsed.records };
}

function writeRecords(
  ledgerRootPath: string,
  records: StoredResumeControllerConversationOperation[]
): void {
  const path = resolveStorePath(ledgerRootPath);
  const tempPath = join(ledgerRootPath, STORE_TEMP_FILE_NAME);
  mkdirSync(dirname(path), { recursive: true });
  const retained = [...records]
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, MAX_RETAINED_RECORDS);
  writeFileSync(
    tempPath,
    JSON.stringify(
      {
        records: retained,
        schema: STORE_SCHEMA,
        updatedAtMs: Date.now(),
        v: 1,
      } satisfies OperationStoreFile,
      null,
      2
    ),
    { encoding: "utf8", mode: 0o600 }
  );
  renameSync(tempPath, path);
}

function resolveStorePath(ledgerRootPath: string): string {
  return join(ledgerRootPath, STORE_FILE_NAME);
}

function isStoredOperation(
  value: unknown
): value is StoredResumeControllerConversationOperation {
  const candidate =
    value as Partial<StoredResumeControllerConversationOperation>;
  return (
    candidate.schema === RECORD_SCHEMA &&
    typeof candidate.operationId === "string" &&
    typeof candidate.requestFingerprint === "string" &&
    typeof candidate.request === "object" &&
    candidate.request !== null &&
    (candidate.result === null ||
      (typeof candidate.result === "object" && candidate.result !== null)) &&
    (candidate.status === "completed" ||
      candidate.status === "in_progress" ||
      candidate.status === "outcome_unknown") &&
    typeof candidate.updatedAtMs === "number"
  );
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
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
