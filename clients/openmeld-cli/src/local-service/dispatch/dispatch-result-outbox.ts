import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { buildTaskResultEnvelope } from "@openmeld/local-execution";
import type {
  OpenMeldDaemonTaskResultEnvelope,
  OpenMeldDaemonTaskResultPayload,
  RuntimeCoordinatorExecutionTokenEcho,
  RuntimeTransportResultIdentityEcho,
} from "@openmeld/schemas/types";
import { emitDaemonDispatchJournalEvent } from "../../local-service/dispatch/daemon-dispatch-journal";
import type { Presenter } from "../../runtime/presenter/types";
import { emitRunLine, toErrorMessage } from "../core/logger";
import type { CurrentDaemonSocketRef, LedgerPaths } from "../core/types";
import { sendDispatchResultEnvelopeFrame } from "./send-dispatch-result";

const OUTBOX_SCHEMA = "openmeld-daemon-dispatch-result-outbox-v1";
const OUTBOX_RECORD_SCHEMA = "openmeld-daemon-dispatch-result-outbox-record-v1";
const RESULT_OUTBOX_FILE_NAME = "dispatch-result-outbox.json";
const RESULT_OUTBOX_TEMP_FILE_NAME = "dispatch-result-outbox.tmp";
const SEND_FAILURE_BACKOFF_MS = [1000, 5000, 15_000, 30_000] as const;
const ACK_PENDING_BACKOFF_MS = [15_000, 30_000, 60_000] as const;
const acknowledgementWaiters = new Map<
  string,
  Array<{
    recordKeys: Set<string>;
    resolve: (result: DispatchResultOutboxAcknowledgementWaitResult) => void;
  }>
>();
const settlementWaiters = new Map<
  string,
  Map<string, (result: DispatchResultOutboxSettlement) => void>
>();

export type DispatchResultOutboxAcknowledgementWaitResult =
  | "aborted"
  | "acknowledged";

export type DispatchResultOutboxSettlement =
  | { status: "accepted" }
  | {
      reasonCode: "space.agent_reply.context_changed";
      status: "review_required";
    }
  | { reasonCode: string; status: "rejected_terminal" };

type DispatchResultOutboxRecord = {
  schema: typeof OUTBOX_RECORD_SCHEMA;
  attemptCount: number;
  attemptId: string;
  blockedReasonCode: string | null;
  connectionGeneration: number;
  createdAtMs: number;
  daemonSessionId: string;
  dispatchId: string;
  executionIdentityEcho: RuntimeTransportResultIdentityEcho;
  executionTokenEcho?: RuntimeCoordinatorExecutionTokenEcho | null;
  lastFailureReason: string | null;
  lastSendAtMs: number | null;
  leaseEpoch: number;
  nextAttemptAtMs: number;
  runtimeCoordinatorExecutionId?: string | null;
  taskId: string;
  taskResult: OpenMeldDaemonTaskResultEnvelope;
  updatedAtMs: number;
};

type DispatchResultOutboxFile = {
  schema: typeof OUTBOX_SCHEMA;
  records: DispatchResultOutboxRecord[];
  updatedAtMs: number;
  v: 1;
};

export function enqueueDispatchResultOutboxRecord(input: {
  attemptId: string;
  connectionGeneration: number;
  currentSocketRef: CurrentDaemonSocketRef;
  daemonSessionId: string;
  dispatchId: string;
  executionIdentityEcho: RuntimeTransportResultIdentityEcho;
  executionTokenEcho?: RuntimeCoordinatorExecutionTokenEcho | null;
  ledgerPaths: LedgerPaths;
  leaseEpoch: number;
  payload: OpenMeldDaemonTaskResultPayload;
  presenter: Presenter;
  runtimeCoordinatorExecutionId?: string | null;
  taskId: string;
  waitForSettlement?: boolean;
}): Promise<DispatchResultOutboxSettlement> | null {
  const nowMs = Date.now();
  const record: DispatchResultOutboxRecord = {
    schema: OUTBOX_RECORD_SCHEMA,
    attemptCount: 0,
    attemptId: input.attemptId,
    blockedReasonCode: null,
    connectionGeneration: input.connectionGeneration,
    createdAtMs: nowMs,
    daemonSessionId: input.daemonSessionId,
    dispatchId: input.dispatchId,
    executionIdentityEcho: input.executionIdentityEcho,
    executionTokenEcho: input.executionTokenEcho ?? null,
    lastFailureReason: null,
    lastSendAtMs: null,
    leaseEpoch: input.leaseEpoch,
    nextAttemptAtMs: nowMs,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId ?? null,
    taskId: input.taskId,
    taskResult: buildTaskResultEnvelope(
      sanitizeTaskResultPayload(input.payload)
    ),
    updatedAtMs: nowMs,
  };

  upsertOutboxRecord(input.ledgerPaths, record);
  const settlement = input.waitForSettlement
    ? registerDispatchResultOutboxSettlementWaiter({
        ledgerPaths: input.ledgerPaths,
        recordKey: buildRecordKey(record),
      })
    : null;
  emitRunLine({
    presenter: input.presenter,
    code: "daemon.run.result_outbox_queued",
    text: `daemon result queued for durable delivery (${input.dispatchId})`,
    payload: {
      attemptId: input.attemptId,
      dispatchId: input.dispatchId,
      taskId: input.taskId,
    },
  });
  flushDispatchResultOutbox({
    currentSocketRef: input.currentSocketRef,
    ledgerPaths: input.ledgerPaths,
    presenter: input.presenter,
  });
  return settlement;
}

export function acknowledgeDispatchResultOutboxRecord(input: {
  attemptId: string | null;
  dispatchId: string;
  ledgerPaths: LedgerPaths;
  ok: boolean;
  presenter: Presenter;
  reasonCode?: string | null;
  status?:
    | "accepted"
    | "rejected_terminal"
    | "review_required"
    | "retry_later"
    | null;
}): void {
  const acknowledgedAtMs = Date.now();
  const records = readOutboxRecords(input.ledgerPaths);
  const matchedRecordKeys = records
    .filter(
      (record) =>
        record.dispatchId === input.dispatchId &&
        (!input.attemptId || record.attemptId === input.attemptId)
    )
    .map(buildRecordKey);
  const nextRecords = records.flatMap((record) => {
    if (
      record.dispatchId !== input.dispatchId ||
      (input.attemptId && record.attemptId !== input.attemptId)
    ) {
      return [record];
    }
    if (input.ok || input.status === "review_required") {
      return [];
    }
    if (input.status === "retry_later") {
      const attemptCount = Math.max(1, record.attemptCount);
      return [
        {
          ...record,
          blockedReasonCode: null,
          lastFailureReason:
            input.reasonCode ?? "daemon.dispatch.result_retry_later",
          nextAttemptAtMs:
            record.nextAttemptAtMs > acknowledgedAtMs
              ? record.nextAttemptAtMs
              : acknowledgedAtMs + resolveAckPendingBackoffMs(attemptCount),
          updatedAtMs: acknowledgedAtMs,
        },
      ];
    }
    return [
      {
        ...record,
        blockedReasonCode:
          input.reasonCode ?? "daemon.dispatch.result_rejected",
        updatedAtMs: acknowledgedAtMs,
      },
    ];
  });
  writeOutboxRecords(input.ledgerPaths, nextRecords);
  const settlement = resolveDispatchResultOutboxSettlement(input);
  if (settlement) {
    notifySettlementWaiters(input.ledgerPaths, matchedRecordKeys, settlement);
  }
  const retryLater = !input.ok && input.status === "retry_later";
  let eventCode = "daemon.run.result_outbox_rejected";
  let eventText = `daemon result outbox rejected for dispatch ${input.dispatchId}: ${input.reasonCode ?? "unknown"}`;
  if (input.ok) {
    eventCode = "daemon.run.result_outbox_acknowledged";
    eventText = `daemon result outbox acknowledged for dispatch ${input.dispatchId}`;
  } else if (retryLater) {
    eventCode = "daemon.run.result_outbox_retry_later";
    eventText = `daemon result outbox will retry dispatch ${input.dispatchId}: ${input.reasonCode ?? "unknown"}`;
  }
  emitRunLine({
    presenter: input.presenter,
    code: eventCode,
    text: eventText,
    payload: {
      attemptId: input.attemptId,
      dispatchId: input.dispatchId,
      ok: input.ok,
      reasonCode: input.reasonCode ?? null,
      status: input.status ?? null,
    },
  });
}

export function waitForDispatchResultOutboxSettlement(input: {
  attemptId: string;
  dispatchId: string;
  ledgerPaths: LedgerPaths;
}): Promise<DispatchResultOutboxSettlement> {
  const recordKey = buildRecordKey(input);
  if (
    !readOutboxRecords(input.ledgerPaths).some(
      (record) => buildRecordKey(record) === recordKey
    )
  ) {
    return Promise.resolve({ status: "accepted" });
  }
  return registerDispatchResultOutboxSettlementWaiter({
    ledgerPaths: input.ledgerPaths,
    recordKey,
  });
}

const registerDispatchResultOutboxSettlementWaiter = (input: {
  ledgerPaths: LedgerPaths;
  recordKey: string;
}): Promise<DispatchResultOutboxSettlement> =>
  new Promise<DispatchResultOutboxSettlement>((resolve) => {
    const rootKey = input.ledgerPaths.rootDirPath;
    const waiters = settlementWaiters.get(rootKey) ?? new Map();
    waiters.set(input.recordKey, resolve);
    settlementWaiters.set(rootKey, waiters);
  });

export function waitForDispatchResultOutboxAcknowledgement(input: {
  abortSignal?: AbortSignal;
  ledgerPaths: LedgerPaths;
  recordKeys: readonly string[];
}): Promise<DispatchResultOutboxAcknowledgementWaitResult> {
  const recordKeys = new Set(input.recordKeys);
  if (
    recordKeys.size === 0 ||
    !readOutboxRecords(input.ledgerPaths).some((record) =>
      recordKeys.has(buildRecordKey(record))
    )
  ) {
    return Promise.resolve("acknowledged");
  }
  return new Promise<DispatchResultOutboxAcknowledgementWaitResult>(
    (resolve) => {
      const rootKey = input.ledgerPaths.rootDirPath;
      const waiters = acknowledgementWaiters.get(rootKey) ?? [];
      let settled = false;
      const settle = (
        result: DispatchResultOutboxAcknowledgementWaitResult
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        input.abortSignal?.removeEventListener("abort", abort);
        const currentWaiters = acknowledgementWaiters.get(rootKey);
        if (currentWaiters) {
          const pendingWaiters = currentWaiters.filter(
            (waiter) => waiter.resolve !== settle
          );
          if (pendingWaiters.length === 0) {
            acknowledgementWaiters.delete(rootKey);
          } else {
            acknowledgementWaiters.set(rootKey, pendingWaiters);
          }
        }
        resolve(result);
      };
      const abort = () => settle("aborted");
      if (input.abortSignal?.aborted) {
        abort();
        return;
      }
      waiters.push({ recordKeys, resolve: settle });
      acknowledgementWaiters.set(rootKey, waiters);
      input.abortSignal?.addEventListener("abort", abort, { once: true });
    }
  );
}

export function listDispatchResultOutboxPendingAcknowledgementKeys(input: {
  ledgerPaths: LedgerPaths;
}): string[] {
  return readOutboxRecords(input.ledgerPaths)
    .filter((record) => record.blockedReasonCode === null)
    .map(buildRecordKey);
}

export function flushDispatchResultOutbox(input: {
  currentSocketRef: CurrentDaemonSocketRef;
  ledgerPaths: LedgerPaths;
  presenter: Presenter;
}): void {
  const socket = input.currentSocketRef.socket;
  const activeConnectionGeneration =
    input.currentSocketRef.connectionGeneration;
  if (!socket || activeConnectionGeneration === null) {
    return;
  }

  const nowMs = Date.now();
  const records = readOutboxRecords(input.ledgerPaths);
  let changed = false;
  const nextRecords = records.map((record) => {
    if (record.blockedReasonCode || record.nextAttemptAtMs > nowMs) {
      return record;
    }

    try {
      sendDispatchResultEnvelopeFrame({
        attemptId: record.attemptId,
        connectionGeneration: activeConnectionGeneration,
        daemonSessionId: record.daemonSessionId,
        dispatchId: record.dispatchId,
        executionIdentityEcho: record.executionIdentityEcho,
        executionTokenEcho: record.executionTokenEcho ?? null,
        leaseEpoch: record.leaseEpoch,
        runtimeCoordinatorExecutionId:
          record.runtimeCoordinatorExecutionId ?? null,
        socket,
        taskResult: record.taskResult,
      });
      emitDaemonDispatchJournalEvent({
        attemptId: record.attemptId,
        connectionGeneration: activeConnectionGeneration,
        daemonSessionId: record.daemonSessionId,
        dispatchId: record.dispatchId,
        leaseEpoch: record.leaseEpoch,
        metadata: {
          delivery: "outbox_flush",
          outboxAttemptCount: record.attemptCount + 1,
        },
        result: record.taskResult.payload.status,
        taskId: record.taskId,
        type: "dispatch.result.sent",
      });
      changed = true;
      return {
        ...record,
        attemptCount: record.attemptCount + 1,
        connectionGeneration: activeConnectionGeneration,
        lastFailureReason: null,
        lastSendAtMs: nowMs,
        nextAttemptAtMs:
          nowMs + resolveAckPendingBackoffMs(record.attemptCount + 1),
        updatedAtMs: nowMs,
      };
    } catch (error) {
      changed = true;
      return {
        ...record,
        attemptCount: record.attemptCount + 1,
        lastFailureReason: toErrorMessage(error),
        nextAttemptAtMs:
          nowMs + resolveSendFailureBackoffMs(record.attemptCount + 1),
        updatedAtMs: nowMs,
      };
    }
  });

  if (changed) {
    writeOutboxRecords(input.ledgerPaths, nextRecords);
  }
}

const sanitizeTaskResultPayload = (
  payload: OpenMeldDaemonTaskResultPayload
): OpenMeldDaemonTaskResultPayload => {
  const {
    bootstrapTemplateFacts: _bootstrapTemplateFacts,
    promptTrace: _promptTrace,
    ...safePayload
  } = payload as OpenMeldDaemonTaskResultPayload & {
    bootstrapTemplateFacts?: unknown;
    promptTrace?: unknown;
  };
  return safePayload as OpenMeldDaemonTaskResultPayload;
};

const resolveAckPendingBackoffMs = (attemptCount: number): number => {
  const index = Math.min(
    ACK_PENDING_BACKOFF_MS.length - 1,
    Math.max(0, attemptCount - 1)
  );
  const backoffMs = ACK_PENDING_BACKOFF_MS[index];
  return typeof backoffMs === "number" ? backoffMs : 60_000;
};

const resolveSendFailureBackoffMs = (attemptCount: number): number => {
  const index = Math.min(
    SEND_FAILURE_BACKOFF_MS.length - 1,
    Math.max(0, attemptCount - 1)
  );
  const backoffMs = SEND_FAILURE_BACKOFF_MS[index];
  return typeof backoffMs === "number" ? backoffMs : 30_000;
};

const upsertOutboxRecord = (
  ledgerPaths: LedgerPaths,
  record: DispatchResultOutboxRecord
): void => {
  const records = readOutboxRecords(ledgerPaths);
  const key = buildRecordKey(record);
  const nextRecords = [
    ...records.filter((candidate) => buildRecordKey(candidate) !== key),
    record,
  ].sort((left, right) => left.createdAtMs - right.createdAtMs);
  writeOutboxRecords(ledgerPaths, nextRecords);
};

const readOutboxRecords = (
  ledgerPaths: LedgerPaths
): DispatchResultOutboxRecord[] => {
  const outboxPath = resolveOutboxPath(ledgerPaths);
  if (!existsSync(outboxPath)) {
    return [];
  }
  const parsed = JSON.parse(
    readFileSync(outboxPath, "utf8")
  ) as Partial<DispatchResultOutboxFile>;
  if (parsed.schema !== OUTBOX_SCHEMA || !Array.isArray(parsed.records)) {
    return [];
  }
  return parsed.records.filter(isDispatchResultOutboxRecord);
};

const writeOutboxRecords = (
  ledgerPaths: LedgerPaths,
  records: DispatchResultOutboxRecord[]
): void => {
  const outboxPath = resolveOutboxPath(ledgerPaths);
  const tempPath = join(ledgerPaths.rootDirPath, RESULT_OUTBOX_TEMP_FILE_NAME);
  mkdirSync(dirname(outboxPath), { recursive: true });
  writeFileSync(
    tempPath,
    JSON.stringify(
      {
        schema: OUTBOX_SCHEMA,
        v: 1,
        records,
        updatedAtMs: Date.now(),
      } satisfies DispatchResultOutboxFile,
      null,
      2
    ),
    "utf8"
  );
  renameSync(tempPath, outboxPath);
  notifyAcknowledgementWaiters(ledgerPaths, records);
};

const resolveOutboxPath = (ledgerPaths: LedgerPaths): string => {
  return join(ledgerPaths.rootDirPath, RESULT_OUTBOX_FILE_NAME);
};

const buildRecordKey = (record: {
  attemptId: string;
  dispatchId: string;
}): string => {
  return `${record.dispatchId}::${record.attemptId}`;
};

const notifyAcknowledgementWaiters = (
  ledgerPaths: LedgerPaths,
  records: readonly DispatchResultOutboxRecord[]
): void => {
  const rootKey = ledgerPaths.rootDirPath;
  const waiters = acknowledgementWaiters.get(rootKey);
  if (!waiters) {
    return;
  }
  const retainedKeys = new Set(
    records
      .filter((record) => record.blockedReasonCode === null)
      .map(buildRecordKey)
  );
  const pendingWaiters = waiters.filter((waiter) => {
    const isPending = [...waiter.recordKeys].some((key) =>
      retainedKeys.has(key)
    );
    if (!isPending) {
      waiter.resolve("acknowledged");
    }
    return isPending;
  });
  if (pendingWaiters.length === 0) {
    acknowledgementWaiters.delete(rootKey);
    return;
  }
  acknowledgementWaiters.set(rootKey, pendingWaiters);
};

const resolveDispatchResultOutboxSettlement = (input: {
  ok: boolean;
  reasonCode?: string | null;
  status?:
    | "accepted"
    | "rejected_terminal"
    | "review_required"
    | "retry_later"
    | null;
}): DispatchResultOutboxSettlement | null => {
  if (input.ok) {
    return { status: "accepted" };
  }
  if (
    input.status === "review_required" &&
    input.reasonCode === "space.agent_reply.context_changed"
  ) {
    return {
      reasonCode: input.reasonCode,
      status: "review_required",
    };
  }
  if (input.status === "rejected_terminal") {
    return {
      reasonCode: input.reasonCode ?? "daemon.dispatch.result_rejected",
      status: "rejected_terminal",
    };
  }
  return null;
};

const notifySettlementWaiters = (
  ledgerPaths: LedgerPaths,
  recordKeys: readonly string[],
  settlement: DispatchResultOutboxSettlement
): void => {
  const rootKey = ledgerPaths.rootDirPath;
  const waiters = settlementWaiters.get(rootKey);
  if (!waiters) {
    return;
  }
  for (const recordKey of recordKeys) {
    const resolve = waiters.get(recordKey);
    if (!resolve) {
      continue;
    }
    waiters.delete(recordKey);
    resolve(settlement);
  }
  if (waiters.size === 0) {
    settlementWaiters.delete(rootKey);
  }
};

const isDispatchResultOutboxRecord = (
  value: unknown
): value is DispatchResultOutboxRecord => {
  const candidate = value as Partial<DispatchResultOutboxRecord>;
  return (
    candidate.schema === OUTBOX_RECORD_SCHEMA &&
    typeof candidate.attemptId === "string" &&
    typeof candidate.dispatchId === "string" &&
    typeof candidate.daemonSessionId === "string" &&
    typeof candidate.executionIdentityEcho === "object" &&
    candidate.executionIdentityEcho !== null &&
    typeof candidate.leaseEpoch === "number" &&
    typeof candidate.connectionGeneration === "number" &&
    typeof candidate.taskId === "string" &&
    typeof candidate.taskResult === "object" &&
    candidate.taskResult !== null &&
    typeof candidate.createdAtMs === "number" &&
    typeof candidate.updatedAtMs === "number" &&
    typeof candidate.nextAttemptAtMs === "number" &&
    typeof candidate.attemptCount === "number"
  );
};
