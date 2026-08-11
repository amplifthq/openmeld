import { describe, expect, it } from "vitest";
import {
  DISPATCH_PLANNER_BLOCKED_DECISION_CODE,
  DISPATCH_PLANNER_FAILED_DECISION_CODE,
} from "../dispatch/application/dispatch-trace-decision-codes";
import { recordMentionDispatchPlannerDecision } from "../dispatch/infrastructure/d1/dispatch-ledger-d1";
import { buildIdempotencyKey } from "../dispatch/rules/dispatch-idempotency";
import { OPENMELD_DAEMON_DISPATCH_STATE } from "../dispatch/rules/dispatch-lifecycle-contract";
import {
  readSpaceDispatchLookup,
  readSpaceDispatchLookupByClientMessageId,
} from "../space/infrastructure/d1/space-dispatch-read-repo";

type LedgerRow = {
  attemptCount: number;
  dispatchId: string;
  firstSeenAtMs: number;
  idempotencyKey: string;
  lastAttemptAtMs: number;
  latestAttemptId: string | null;
  replyHintSentAtMs: number | null;
  sourceClientMessageId?: string | null;
  sourceEventId: string;
  spaceId: string;
  status: string;
  targetProfileId: string;
};

type AttemptRow = {
  attemptId: string;
  attemptNo: number;
  connectionGeneration: number | null;
  createdAtMs: number;
  daemonSessionId: string | null;
  dispatchId: string;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAtMs: number | null;
  idempotencyKey: string;
  leaseEpoch: number | null;
  startedAtMs: number | null;
  status: string;
};

type OpsDecisionRow = {
  correlationId: string | null;
  decisionCode: string;
  decisionPayloadJson: string;
};

type PlannerEvidenceDbOptions = {
  simulateInsertRaceOnce?: boolean;
  simulateUpdateRaceOnce?: boolean;
};

function buildRuntimeRaceLedgerRow(args: unknown[]): LedgerRow {
  const [
    idempotencyKey,
    dispatchId,
    spaceId,
    sourceEventId,
    sourceClientMessageId,
    targetProfileId,
    ,
    firstSeenAtMs,
    lastAttemptAtMs,
    attemptCount,
  ] = args;

  const runtimeDispatchId = `${String(dispatchId)}-runtime`;

  return {
    attemptCount: Math.max(1, Number(attemptCount ?? 1)),
    dispatchId: runtimeDispatchId,
    firstSeenAtMs: Number(firstSeenAtMs ?? 0),
    idempotencyKey: String(idempotencyKey ?? ""),
    lastAttemptAtMs: Number(lastAttemptAtMs ?? firstSeenAtMs ?? 0),
    latestAttemptId: `runtime:${runtimeDispatchId}`,
    replyHintSentAtMs: null,
    sourceClientMessageId:
      sourceClientMessageId === null || sourceClientMessageId === undefined
        ? null
        : String(sourceClientMessageId),
    sourceEventId: String(sourceEventId ?? ""),
    spaceId: String(spaceId ?? ""),
    status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
    targetProfileId: String(targetProfileId ?? ""),
  };
}

function createInMemoryPlannerEvidenceDb(
  options: PlannerEvidenceDbOptions = {}
) {
  const ledgerRows = new Map<string, LedgerRow>();
  const attemptRows = new Map<string, AttemptRow>();
  const opsDecisionRows: OpsDecisionRow[] = [];
  let insertRaceConsumed = false;
  let updateRaceConsumed = false;

  const db = {
    prepare: (query: string) => {
      const compactQuery = query.toLowerCase().replace(/\s+/g, " ").trim();
      const queryIncludes = (sql: string) =>
        compactQuery.includes(sql.toLowerCase());
      return {
        bind: (...args: unknown[]) => ({
          first: <T>() => {
            if (
              queryIncludes("from openMeldDaemon_dispatch_ledger") &&
              queryIncludes("where idempotency_key = ?")
            ) {
              const row = ledgerRows.get(String(args[0] ?? ""));
              if (!row) {
                return Promise.resolve(null as T | null);
              }
              return Promise.resolve({
                dispatch_id: row.dispatchId,
                first_seen_at_ms: row.firstSeenAtMs,
                last_attempt_at_ms: row.lastAttemptAtMs,
                latest_attempt_id: row.latestAttemptId,
                attempt_count: row.attemptCount,
                reply_hint_sent_at_ms: row.replyHintSentAtMs,
                status: row.status,
              } as T);
            }
            if (
              queryIncludes("from openMeldDaemon_dispatch_attempts") &&
              queryIncludes("where attempt_id = ?")
            ) {
              const row = attemptRows.get(String(args[0] ?? ""));
              if (!row) {
                return Promise.resolve(null as T | null);
              }
              return Promise.resolve({
                attemptId: row.attemptId,
                attemptNo: row.attemptNo,
                status: row.status,
                errorCode: row.errorCode,
                daemonSessionId: row.daemonSessionId,
                connectionGeneration: row.connectionGeneration,
                leaseEpoch: row.leaseEpoch,
              } as T);
            }
            throw new Error(`unsupported first() query: ${query}`);
          },
          all: <T>() => {
            if (
              queryIncludes("from openMeldDaemon_dispatch_ledger as ledger") &&
              queryIncludes(
                "left join openMeldDaemon_dispatch_attempts as attempt"
              )
            ) {
              const spaceId = String(args[0] ?? "");
              const selectorValue = String(args[1] ?? "");
              const targetProfileId =
                args.length > 2 ? String(args[2] ?? "") : null;
              const byClientMessage = queryIncludes(
                "ledger.source_client_message_id = ?"
              );
              const results = [...ledgerRows.values()]
                .filter((row) => {
                  if (row.spaceId !== spaceId) {
                    return false;
                  }
                  if (byClientMessage) {
                    if (row.sourceClientMessageId !== selectorValue) {
                      return false;
                    }
                  } else if (row.sourceEventId !== selectorValue) {
                    return false;
                  }
                  if (
                    targetProfileId &&
                    row.targetProfileId !== targetProfileId
                  ) {
                    return false;
                  }
                  return true;
                })
                .sort((left, right) => {
                  if (left.firstSeenAtMs !== right.firstSeenAtMs) {
                    return right.firstSeenAtMs - left.firstSeenAtMs;
                  }
                  return right.dispatchId.localeCompare(left.dispatchId);
                })
                .map((row) => {
                  const attempt = row.latestAttemptId
                    ? (attemptRows.get(row.latestAttemptId) ?? null)
                    : null;
                  return {
                    attemptCount: row.attemptCount,
                    dispatchId: row.dispatchId,
                    dispatchStatus: row.status,
                    latestAttemptErrorCode: attempt?.errorCode ?? null,
                    latestAttemptErrorMessage: attempt?.errorMessage ?? null,
                    latestAttemptId: row.latestAttemptId,
                    latestAttemptStatus: attempt?.status ?? null,
                    sourceSignalId: row.sourceEventId,
                    targetProfileId: row.targetProfileId,
                  };
                });
              return Promise.resolve({ results } as T);
            }
            throw new Error(`unsupported all() query: ${query}`);
          },
          run: () => {
            if (
              queryIncludes(
                "insert or ignore into openMeldDaemon_dispatch_ledger"
              )
            ) {
              const [
                idempotencyKey,
                dispatchId,
                spaceId,
                sourceEventId,
                sourceClientMessageId,
                targetProfileId,
                status,
                firstSeenAtMs,
                lastAttemptAtMs,
                attemptCount,
                latestAttemptId,
              ] = args;
              if (
                options.simulateInsertRaceOnce &&
                !insertRaceConsumed &&
                !ledgerRows.has(String(idempotencyKey))
              ) {
                insertRaceConsumed = true;
                ledgerRows.set(
                  String(idempotencyKey),
                  buildRuntimeRaceLedgerRow(args)
                );
                return Promise.resolve({ meta: { changes: 0 } });
              }
              if (ledgerRows.has(String(idempotencyKey))) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              ledgerRows.set(String(idempotencyKey), {
                attemptCount: Number(attemptCount),
                dispatchId: String(dispatchId),
                firstSeenAtMs: Number(firstSeenAtMs),
                idempotencyKey: String(idempotencyKey),
                lastAttemptAtMs: Number(lastAttemptAtMs),
                latestAttemptId:
                  latestAttemptId === null ? null : String(latestAttemptId),
                replyHintSentAtMs: null,
                sourceClientMessageId:
                  sourceClientMessageId === null ||
                  sourceClientMessageId === undefined
                    ? null
                    : String(sourceClientMessageId),
                sourceEventId: String(sourceEventId),
                spaceId: String(spaceId),
                status: String(status),
                targetProfileId: String(targetProfileId),
              });
              return Promise.resolve({ meta: { changes: 1 } });
            }
            if (
              queryIncludes("update openMeldDaemon_dispatch_ledger") &&
              queryIncludes("set dispatch_id = ?") &&
              queryIncludes("status in (?, ?)") &&
              queryIncludes("latest_attempt_id = ?")
            ) {
              const [
                dispatchId,
                spaceId,
                sourceEventId,
                sourceClientMessageId,
                targetProfileId,
                status,
                lastAttemptAtMs,
                nextLatestAttemptId,
                idempotencyKey,
                allowedStatusA,
                allowedStatusB,
                expectedLatestAttemptId,
              ] = args;
              const row = ledgerRows.get(String(idempotencyKey ?? ""));
              if (!row) {
                throw new Error(
                  `missing ledger row for ${String(idempotencyKey ?? "")}`
                );
              }
              const allowedStatuses = new Set(
                [allowedStatusA, allowedStatusB]
                  .filter((value) => value !== null && value !== undefined)
                  .map((value) => String(value))
              );
              const normalizedExpectedLatestAttemptId =
                expectedLatestAttemptId === null ||
                expectedLatestAttemptId === undefined
                  ? null
                  : String(expectedLatestAttemptId);
              if (
                !allowedStatuses.has(row.status) ||
                row.latestAttemptId !== normalizedExpectedLatestAttemptId
              ) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              if (options.simulateUpdateRaceOnce && !updateRaceConsumed) {
                updateRaceConsumed = true;
                ledgerRows.set(String(idempotencyKey), {
                  ...row,
                  dispatchId: `${String(dispatchId)}-runtime`,
                  lastAttemptAtMs: Number(lastAttemptAtMs),
                  latestAttemptId: `runtime:${String(dispatchId)}-runtime`,
                  sourceClientMessageId:
                    sourceClientMessageId === null ||
                    sourceClientMessageId === undefined
                      ? null
                      : String(sourceClientMessageId),
                  sourceEventId: String(sourceEventId),
                  spaceId: String(spaceId),
                  status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
                  targetProfileId: String(targetProfileId),
                });
                return Promise.resolve({ meta: { changes: 0 } });
              }
              row.dispatchId = String(dispatchId);
              row.spaceId = String(spaceId);
              row.sourceEventId = String(sourceEventId);
              if (
                sourceClientMessageId !== null &&
                sourceClientMessageId !== undefined
              ) {
                row.sourceClientMessageId = String(sourceClientMessageId);
              }
              row.targetProfileId = String(targetProfileId);
              row.status = String(status);
              row.lastAttemptAtMs = Number(lastAttemptAtMs);
              row.latestAttemptId =
                nextLatestAttemptId === null
                  ? null
                  : String(nextLatestAttemptId);
              row.attemptCount = Math.max(1, row.attemptCount);
              return { meta: { changes: 1 } };
            }
            if (
              queryIncludes("update openMeldDaemon_dispatch_ledger") &&
              queryIncludes("set dispatch_id = ?")
            ) {
              const [
                dispatchId,
                spaceId,
                sourceEventId,
                sourceClientMessageId,
                targetProfileId,
                status,
                lastAttemptAtMs,
                latestAttemptId,
                idempotencyKey,
              ] = args;
              const row = ledgerRows.get(String(idempotencyKey ?? ""));
              if (!row) {
                throw new Error(
                  `missing ledger row for ${String(idempotencyKey ?? "")}`
                );
              }
              row.dispatchId = String(dispatchId);
              row.spaceId = String(spaceId);
              row.sourceEventId = String(sourceEventId);
              row.sourceClientMessageId =
                sourceClientMessageId === null ||
                sourceClientMessageId === undefined
                  ? null
                  : String(sourceClientMessageId);
              row.targetProfileId = String(targetProfileId);
              row.status = String(status);
              row.lastAttemptAtMs = Number(lastAttemptAtMs);
              row.latestAttemptId =
                latestAttemptId === null ? null : String(latestAttemptId);
              row.attemptCount = Math.max(1, row.attemptCount);
              return { meta: { changes: 1 } };
            }
            if (
              queryIncludes("update openMeldDaemon_dispatch_ledger") &&
              queryIncludes(
                "set status = ?, last_attempt_at_ms = ?, latest_attempt_id = ?"
              )
            ) {
              const [status, lastAttemptAtMs, latestAttemptId, idempotencyKey] =
                args;
              const row = ledgerRows.get(String(idempotencyKey ?? ""));
              if (!row) {
                throw new Error(
                  `missing ledger row for ${String(idempotencyKey ?? "")}`
                );
              }
              row.status = String(status);
              row.lastAttemptAtMs = Number(lastAttemptAtMs);
              row.latestAttemptId =
                latestAttemptId === null ? null : String(latestAttemptId);
              return { meta: { changes: 1 } };
            }
            if (
              queryIncludes("insert into openMeldDaemon_dispatch_attempts") ||
              queryIncludes(
                "insert or ignore into openMeldDaemon_dispatch_attempts"
              )
            ) {
              const isPlannerInsert = queryIncludes(
                "insert or ignore into openMeldDaemon_dispatch_attempts"
              );
              const [
                attemptId,
                dispatchId,
                idempotencyKey,
                attemptNo,
                status,
                createdAtMs,
                startedAtMs,
              ] = args;
              if (isPlannerInsert && attemptRows.has(String(attemptId))) {
                return Promise.resolve({ meta: { changes: 0 } });
              }
              attemptRows.set(String(attemptId), {
                attemptId: String(attemptId),
                attemptNo: Number(attemptNo),
                connectionGeneration: null,
                createdAtMs: Number(createdAtMs),
                daemonSessionId: null,
                dispatchId: String(dispatchId),
                errorCode: null,
                errorMessage: null,
                finishedAtMs: null,
                idempotencyKey: String(idempotencyKey),
                leaseEpoch: null,
                startedAtMs:
                  startedAtMs === null || startedAtMs === undefined
                    ? null
                    : Number(startedAtMs),
                status: String(status),
              });
              return { meta: { changes: 1 } };
            }
            if (
              queryIncludes("update openMeldDaemon_dispatch_attempts") &&
              queryIncludes("where attempt_id = ?")
            ) {
              const [
                status,
                daemonSessionId,
                connectionGeneration,
                leaseEpoch,
                ,
                ,
                startedAtMs,
                finishedAtMs,
                errorCode,
                errorMessage,
                attemptId,
              ] = args;
              const row = attemptRows.get(String(attemptId ?? ""));
              if (!row) {
                return { meta: { changes: 0 } };
              }
              row.status = String(status);
              row.daemonSessionId =
                daemonSessionId === null || daemonSessionId === undefined
                  ? row.daemonSessionId
                  : String(daemonSessionId);
              row.connectionGeneration =
                connectionGeneration === null ||
                connectionGeneration === undefined
                  ? row.connectionGeneration
                  : Number(connectionGeneration);
              row.leaseEpoch =
                leaseEpoch === null || leaseEpoch === undefined
                  ? row.leaseEpoch
                  : Number(leaseEpoch);
              row.startedAtMs =
                startedAtMs === null || startedAtMs === undefined
                  ? row.startedAtMs
                  : Number(startedAtMs);
              row.finishedAtMs =
                finishedAtMs === null || finishedAtMs === undefined
                  ? row.finishedAtMs
                  : Number(finishedAtMs);
              row.errorCode =
                errorCode === null || errorCode === undefined
                  ? null
                  : String(errorCode);
              row.errorMessage =
                errorMessage === null || errorMessage === undefined
                  ? null
                  : String(errorMessage);
              return Promise.resolve({ meta: { changes: 1 } });
            }
            if (queryIncludes("insert into openMeldDaemon_ops_decisions")) {
              const [
                ,
                decisionCode,
                decisionPayloadJson,
                ,
                ,
                ,
                ,
                correlationId,
              ] = args;
              opsDecisionRows.push({
                correlationId:
                  correlationId === null ? null : String(correlationId),
                decisionCode: String(decisionCode),
                decisionPayloadJson: String(decisionPayloadJson),
              });
              return Promise.resolve({ meta: { changes: 1 } });
            }
            throw new Error(`unsupported run() query: ${query}`);
          },
        }),
      };
    },
  } as unknown as D1Database;

  return {
    attemptRows,
    db,
    ledgerRows,
    opsDecisionRows,
  };
}

describe("dispatch planner evidence", () => {
  it("persists blocked planner decisions into the shared ledger and lookup read path", async () => {
    const { attemptRows, db, ledgerRows, opsDecisionRows } =
      createInMemoryPlannerEvidenceDb();

    await recordMentionDispatchPlannerDecision({
      db,
      decision: {
        dispatchId: "dispatch-blocked-1",
        sourceEventId: "sig-source-1",
        targetProfileId: "agt-blocked-1",
        status: "blocked",
        errorCode: "route.not_registered",
        ruleSource: "space",
        ruleId: "space.rule.1",
        ruleReason: "route missing",
      },
      nowMs: 1_700_000_000_000,
      sourceClientMessageId: "client-message-1",
      spaceId: "space-1",
    });

    expect([...ledgerRows.values()][0]).toMatchObject({
      dispatchId: "dispatch-blocked-1",
      sourceClientMessageId: "client-message-1",
      sourceEventId: "sig-source-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.blocked,
      targetProfileId: "agt-blocked-1",
    });
    expect([...attemptRows.values()][0]).toMatchObject({
      attemptId: "planner:dispatch-blocked-1",
      dispatchId: "dispatch-blocked-1",
      errorCode: "route.not_registered",
      errorMessage: "route missing",
      startedAtMs: null,
      status: "blocked",
    });
    expect(opsDecisionRows).toEqual([
      expect.objectContaining({
        correlationId: "dispatch-blocked-1",
        decisionCode: DISPATCH_PLANNER_BLOCKED_DECISION_CODE,
      }),
    ]);

    const lookup = await readSpaceDispatchLookup({
      db,
      sourceSignalId: "sig-source-1",
      spaceId: "space-1",
    });
    expect(lookup.matches).toEqual([
      expect.objectContaining({
        dispatchId: "dispatch-blocked-1",
        latestAttemptErrorCode: "route.not_registered",
        latestAttemptStatus: "blocked",
        sourceSignalId: "sig-source-1",
        status: "blocked",
        targetProfileId: "agt-blocked-1",
      }),
    ]);

    const clientMessageLookup = await readSpaceDispatchLookupByClientMessageId({
      db,
      clientMessageId: "client-message-1",
      spaceId: "space-1",
      targetProfileId: "agt-blocked-1",
    });
    expect(clientMessageLookup.matches).toEqual([
      expect.objectContaining({
        dispatchId: "dispatch-blocked-1",
        latestAttemptErrorCode: "route.not_registered",
        latestAttemptStatus: "blocked",
        sourceSignalId: "sig-source-1",
        status: "blocked",
        targetProfileId: "agt-blocked-1",
      }),
    ]);
  });

  it("maps planner failed decisions to failed_terminal evidence", async () => {
    const { attemptRows, db, ledgerRows, opsDecisionRows } =
      createInMemoryPlannerEvidenceDb();

    await recordMentionDispatchPlannerDecision({
      db,
      decision: {
        dispatchId: "dispatch-failed-1",
        sourceEventId: "sig-source-2",
        targetProfileId: "agt-failed-1",
        status: "failed",
        errorCode: "controller.binding.missing",
        ruleSource: "system",
        ruleId: "system.binding.missing",
        ruleReason: "controller binding is missing",
      },
      nowMs: 1_700_000_000_001,
      spaceId: "space-1",
    });

    expect([...ledgerRows.values()][0]).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
    });
    expect([...attemptRows.values()][0]).toMatchObject({
      errorCode: "controller.binding.missing",
      status: "failed_terminal",
    });
    expect(opsDecisionRows).toEqual([
      expect.objectContaining({
        decisionCode: DISPATCH_PLANNER_FAILED_DECISION_CODE,
      }),
    ]);
  });

  it("does not write planner evidence when the insert loses a race", async () => {
    const { attemptRows, db, ledgerRows, opsDecisionRows } =
      createInMemoryPlannerEvidenceDb({
        simulateInsertRaceOnce: true,
      });
    const idempotencyKey = buildIdempotencyKey({
      sourceEventId: "sig-source-3",
      targetProfileId: "agt-race-insert-1",
    });

    await recordMentionDispatchPlannerDecision({
      db,
      decision: {
        dispatchId: "dispatch-insert-race-1",
        sourceEventId: "sig-source-3",
        targetProfileId: "agt-race-insert-1",
        status: "blocked",
        errorCode: "route.not_registered",
        ruleSource: "space",
        ruleId: "space.rule.race.insert",
        ruleReason: "route missing",
      },
      nowMs: 1_700_000_000_002,
      spaceId: "space-1",
    });

    expect(ledgerRows.get(idempotencyKey)).toMatchObject({
      dispatchId: "dispatch-insert-race-1-runtime",
      latestAttemptId: "runtime:dispatch-insert-race-1-runtime",
      sourceEventId: "sig-source-3",
      spaceId: "space-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      targetProfileId: "agt-race-insert-1",
    });
    expect(attemptRows.size).toBe(0);
    expect(opsDecisionRows).toEqual([]);
  });

  it("does not write planner evidence when the guarded update loses a race", async () => {
    const { attemptRows, db, ledgerRows, opsDecisionRows } =
      createInMemoryPlannerEvidenceDb({
        simulateUpdateRaceOnce: true,
      });
    const idempotencyKey = buildIdempotencyKey({
      sourceEventId: "sig-source-4",
      targetProfileId: "agt-race-update-1",
    });
    ledgerRows.set(idempotencyKey, {
      attemptCount: 2,
      dispatchId: "dispatch-update-race-1",
      firstSeenAtMs: 1_700_000_000_000,
      idempotencyKey,
      lastAttemptAtMs: 1_700_000_000_001,
      latestAttemptId: "planner:dispatch-update-race-1",
      replyHintSentAtMs: null,
      sourceEventId: "sig-source-4",
      spaceId: "space-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.blocked,
      targetProfileId: "agt-race-update-1",
    });

    await recordMentionDispatchPlannerDecision({
      db,
      decision: {
        dispatchId: "dispatch-update-race-1",
        sourceEventId: "sig-source-4",
        targetProfileId: "agt-race-update-1",
        status: "blocked",
        errorCode: "route.not_registered",
        ruleSource: "space",
        ruleId: "space.rule.race.update",
        ruleReason: "route missing",
      },
      nowMs: 1_700_000_000_010,
      spaceId: "space-1",
    });

    expect(ledgerRows.get(idempotencyKey)).toMatchObject({
      dispatchId: "dispatch-update-race-1-runtime",
      latestAttemptId: "runtime:dispatch-update-race-1-runtime",
      sourceEventId: "sig-source-4",
      spaceId: "space-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      targetProfileId: "agt-race-update-1",
    });
    expect(attemptRows.size).toBe(0);
    expect(opsDecisionRows).toEqual([]);
  });

  it("does not simulate a guarded planner update for rows in an ineligible status", async () => {
    const { attemptRows, db, ledgerRows, opsDecisionRows } =
      createInMemoryPlannerEvidenceDb({
        simulateUpdateRaceOnce: true,
      });
    const idempotencyKey = buildIdempotencyKey({
      sourceEventId: "sig-source-4b",
      targetProfileId: "agt-race-update-2",
    });
    ledgerRows.set(idempotencyKey, {
      attemptCount: 2,
      dispatchId: "dispatch-update-race-2",
      firstSeenAtMs: 1_700_000_000_000,
      idempotencyKey,
      lastAttemptAtMs: 1_700_000_000_001,
      latestAttemptId: "planner:dispatch-update-race-2",
      replyHintSentAtMs: null,
      sourceEventId: "sig-source-4b",
      spaceId: "space-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      targetProfileId: "agt-race-update-2",
    });

    await recordMentionDispatchPlannerDecision({
      db,
      decision: {
        dispatchId: "dispatch-update-race-2",
        sourceEventId: "sig-source-4b",
        targetProfileId: "agt-race-update-2",
        status: "blocked",
        errorCode: "route.not_registered",
        ruleSource: "space",
        ruleId: "space.rule.race.update.ineligible",
        ruleReason: "route missing",
      },
      nowMs: 1_700_000_000_010,
      spaceId: "space-1",
    });

    expect(ledgerRows.get(idempotencyKey)).toMatchObject({
      dispatchId: "dispatch-update-race-2",
      latestAttemptId: "planner:dispatch-update-race-2",
      sourceEventId: "sig-source-4b",
      spaceId: "space-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      targetProfileId: "agt-race-update-2",
    });
    expect(attemptRows.size).toBe(0);
    expect(opsDecisionRows).toEqual([]);
  });

  it("updates a stable planner-owned non-ready row", async () => {
    const { attemptRows, db, ledgerRows, opsDecisionRows } =
      createInMemoryPlannerEvidenceDb();
    const idempotencyKey = buildIdempotencyKey({
      sourceEventId: "sig-source-5",
      targetProfileId: "agt-owned-1",
    });
    ledgerRows.set(idempotencyKey, {
      attemptCount: 2,
      dispatchId: "dispatch-owned-1",
      firstSeenAtMs: 1_700_000_000_000,
      idempotencyKey,
      lastAttemptAtMs: 1_700_000_000_001,
      latestAttemptId: "planner:dispatch-owned-1",
      replyHintSentAtMs: null,
      sourceClientMessageId: "client-message-existing",
      sourceEventId: "sig-source-5",
      spaceId: "space-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.blocked,
      targetProfileId: "agt-owned-1",
    });

    await recordMentionDispatchPlannerDecision({
      db,
      decision: {
        dispatchId: "dispatch-owned-1",
        sourceEventId: "sig-source-5",
        targetProfileId: "agt-owned-1",
        status: "blocked",
        errorCode: "route.not_registered",
        ruleSource: "space",
        ruleId: "space.rule.stable",
        ruleReason: "route missing",
      },
      nowMs: 1_700_000_000_020,
      spaceId: "space-1",
    });

    expect(ledgerRows.get(idempotencyKey)).toMatchObject({
      attemptCount: 2,
      dispatchId: "dispatch-owned-1",
      lastAttemptAtMs: 1_700_000_000_020,
      latestAttemptId: "planner:dispatch-owned-1",
      sourceClientMessageId: "client-message-existing",
      sourceEventId: "sig-source-5",
      spaceId: "space-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.blocked,
      targetProfileId: "agt-owned-1",
    });
    expect(attemptRows.get("planner:dispatch-owned-1")).toMatchObject({
      attemptId: "planner:dispatch-owned-1",
      attemptNo: 1,
      dispatchId: "dispatch-owned-1",
      errorCode: "route.not_registered",
      errorMessage: "route missing",
      status: "blocked",
    });
    expect(opsDecisionRows).toEqual([
      expect.objectContaining({
        correlationId: "dispatch-owned-1",
        decisionCode: DISPATCH_PLANNER_BLOCKED_DECISION_CODE,
      }),
    ]);
  });

  it("does not overwrite active dispatch work with planner evidence", async () => {
    const { attemptRows, db, ledgerRows, opsDecisionRows } =
      createInMemoryPlannerEvidenceDb();
    const idempotencyKey = buildIdempotencyKey({
      sourceEventId: "sig-source-3",
      targetProfileId: "agt-active-1",
    });
    ledgerRows.set(idempotencyKey, {
      attemptCount: 2,
      dispatchId: "dispatch-active-1",
      firstSeenAtMs: 1_700_000_000_000,
      idempotencyKey,
      lastAttemptAtMs: 1_700_000_000_002,
      latestAttemptId: "attempt-active-1",
      replyHintSentAtMs: null,
      sourceEventId: "sig-source-3",
      spaceId: "space-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      targetProfileId: "agt-active-1",
    });
    attemptRows.set("attempt-active-1", {
      attemptId: "attempt-active-1",
      attemptNo: 2,
      connectionGeneration: 1,
      createdAtMs: 1_700_000_000_000,
      daemonSessionId: "daemon-1",
      dispatchId: "dispatch-active-1",
      errorCode: null,
      errorMessage: null,
      finishedAtMs: null,
      idempotencyKey,
      leaseEpoch: 1,
      startedAtMs: 1_700_000_000_001,
      status: "waiting_result",
    });

    await recordMentionDispatchPlannerDecision({
      db,
      decision: {
        dispatchId: "dispatch-blocked-2",
        sourceEventId: "sig-source-3",
        targetProfileId: "agt-active-1",
        status: "blocked",
        errorCode: "route.not_registered",
        ruleSource: "space",
        ruleId: "space.rule.2",
        ruleReason: "route missing",
      },
      nowMs: 1_700_000_000_010,
      spaceId: "space-1",
    });

    expect([...ledgerRows.values()][0]).toMatchObject({
      dispatchId: "dispatch-active-1",
      latestAttemptId: "attempt-active-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
    });
    expect(opsDecisionRows).toEqual([]);
  });
});
