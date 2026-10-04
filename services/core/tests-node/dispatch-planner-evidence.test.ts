import { describe, expect, it, onTestFinished } from "vitest";
import {
  DISPATCH_PLANNER_BLOCKED_DECISION_CODE,
  DISPATCH_PLANNER_FAILED_DECISION_CODE,
} from "../src/dispatch/application/dispatch-trace-decision-codes";
import { recordMentionDispatchPlannerDecision } from "../src/dispatch/infrastructure/postgresql/dispatch-ledger-postgresql";
import { buildIdempotencyKey } from "../src/dispatch/rules/dispatch-idempotency";
import { OPENMELD_DAEMON_DISPATCH_STATE } from "../src/dispatch/rules/dispatch-lifecycle-contract";
import {
  readSpaceDispatchLookup,
  readSpaceDispatchLookupByClientMessageId,
} from "../src/space/infrastructure/postgresql/space-dispatch-read-repo";

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

import {
  createBeforeMatchingPostgresTransaction,
  createPostgresHarness,
} from "./helpers/postgresql-harness.test-support";

type Harness = Awaited<ReturnType<typeof createPostgresHarness>>;
async function createPlannerEvidenceFixture(
  options: {
    simulateInsertRaceOnce?: boolean;
    simulateUpdateRaceOnce?: boolean;
  } = {}
) {
  const harness = await createPostgresHarness();
  onTestFinished(async () => {
    await harness.close();
  });
  const isInsert = options.simulateInsertRaceOnce === true;
  const race = isInsert || options.simulateUpdateRaceOnce === true;
  const id = isInsert ? "dispatch-insert-race-1" : "dispatch-update-race-1";
  const source = isInsert ? "sig-source-3" : "sig-source-4";
  const profile = isInsert ? "agt-race-insert-1" : "agt-race-update-1";
  const idempotencyKey = buildIdempotencyKey({
    sourceEventId: source,
    targetProfileId: profile,
  });
  const db = race
    ? createBeforeMatchingPostgresTransaction({
        db: harness.db,
        matches: (sql) =>
          sql.includes(
            `${isInsert ? "INSERT INTO" : "UPDATE"} "openmeld"."openMeldDaemon_dispatch_ledger"`
          ),
        beforeTransaction: async () => {
          if (isInsert) {
            await seedLedger(harness, {
              attemptCount: 1,
              dispatchId: `${id}-runtime`,
              firstSeenAtMs: 1_700_000_000_002,
              idempotencyKey,
              lastAttemptAtMs: 1_700_000_000_002,
              latestAttemptId: `runtime:${id}-runtime`,
              replyHintSentAtMs: null,
              sourceEventId: source,
              spaceId: "space-1",
              status: "dispatching",
              targetProfileId: profile,
            });
          } else {
            await harness.query({
              text: `UPDATE "openmeld"."openMeldDaemon_dispatch_ledger"
          SET dispatch_id = $1, latest_attempt_id = $2, status = 'dispatching' WHERE idempotency_key = $3`,
              values: [
                `${id}-runtime`,
                `runtime:${id}-runtime`,
                idempotencyKey,
              ],
            });
          }
        },
      })
    : harness.db;
  return { db, harness };
}
async function seedLedger(harness: Harness, row: LedgerRow) {
  await harness.query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_dispatch_ledger"
    (attempt_count, dispatch_id, first_seen_at_ms, idempotency_key, last_attempt_at_ms, latest_attempt_id,
     reply_hint_sent_at_ms, source_client_message_id, source_event_id, space_id, status, target_profile_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    values: [
      row.attemptCount,
      row.dispatchId,
      row.firstSeenAtMs,
      row.idempotencyKey,
      row.lastAttemptAtMs,
      row.latestAttemptId,
      row.replyHintSentAtMs,
      row.sourceClientMessageId ?? null,
      row.sourceEventId,
      row.spaceId,
      row.status,
      row.targetProfileId,
    ],
  });
}
async function seedAttempt(harness: Harness, row: AttemptRow) {
  await harness.query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_dispatch_attempts"
    (attempt_id, attempt_no, connection_generation, created_at_ms, daemon_session_id, dispatch_id, error_code,
     error_message, finished_at_ms, idempotency_key, lease_epoch, started_at_ms, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    values: [
      row.attemptId,
      row.attemptNo,
      row.connectionGeneration,
      row.createdAtMs,
      row.daemonSessionId,
      row.dispatchId,
      row.errorCode,
      row.errorMessage,
      row.finishedAtMs,
      row.idempotencyKey,
      row.leaseEpoch,
      row.startedAtMs,
      row.status,
    ],
  });
}
async function readLedger(harness: Harness) {
  return await harness.queryAll<LedgerRow>({
    text: `SELECT attempt_count AS "attemptCount", dispatch_id AS "dispatchId",
    first_seen_at_ms AS "firstSeenAtMs", idempotency_key AS "idempotencyKey", last_attempt_at_ms AS "lastAttemptAtMs",
    latest_attempt_id AS "latestAttemptId", reply_hint_sent_at_ms AS "replyHintSentAtMs", source_client_message_id AS "sourceClientMessageId",
    source_event_id AS "sourceEventId", space_id AS "spaceId", status, target_profile_id AS "targetProfileId"
    FROM "openmeld"."openMeldDaemon_dispatch_ledger" ORDER BY id`,
  });
}
async function readAttempts(harness: Harness) {
  return await harness.queryAll<AttemptRow>({
    text: `SELECT attempt_id AS "attemptId", attempt_no AS "attemptNo",
    connection_generation AS "connectionGeneration", created_at_ms AS "createdAtMs", daemon_session_id AS "daemonSessionId",
    dispatch_id AS "dispatchId", error_code AS "errorCode", error_message AS "errorMessage", finished_at_ms AS "finishedAtMs",
    idempotency_key AS "idempotencyKey", lease_epoch AS "leaseEpoch", started_at_ms AS "startedAtMs", status
    FROM "openmeld"."openMeldDaemon_dispatch_attempts" ORDER BY attempt_id`,
  });
}
async function readOps(harness: Harness) {
  return await harness.queryAll<OpsDecisionRow>({
    text: `SELECT correlation_id AS "correlationId", decision_code AS "decisionCode",
    decision_payload_json AS "decisionPayloadJson" FROM "openmeld"."openMeldDaemon_ops_decisions" ORDER BY id`,
  });
}

describe("dispatch planner evidence", () => {
  it("persists blocked planner decisions into the shared ledger and lookup read path", async () => {
    const { db, harness } = await createPlannerEvidenceFixture();

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

    expect((await readLedger(harness))[0]).toMatchObject({
      dispatchId: "dispatch-blocked-1",
      sourceClientMessageId: "client-message-1",
      sourceEventId: "sig-source-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.blocked,
      targetProfileId: "agt-blocked-1",
    });
    expect((await readAttempts(harness))[0]).toMatchObject({
      attemptId: "planner:dispatch-blocked-1",
      dispatchId: "dispatch-blocked-1",
      errorCode: "route.not_registered",
      errorMessage: "route missing",
      startedAtMs: null,
      status: "blocked",
    });
    expect(await readOps(harness)).toEqual([
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
    const { db, harness } = await createPlannerEvidenceFixture();

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

    expect((await readLedger(harness))[0]).toMatchObject({
      status: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
    });
    expect((await readAttempts(harness))[0]).toMatchObject({
      errorCode: "controller.binding.missing",
      status: "failed_terminal",
    });
    expect(await readOps(harness)).toEqual([
      expect.objectContaining({
        decisionCode: DISPATCH_PLANNER_FAILED_DECISION_CODE,
      }),
    ]);
  });

  it("does not write planner evidence when the insert loses a race", async () => {
    const { db, harness } = await createPlannerEvidenceFixture({
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

    expect(
      (await readLedger(harness)).find(
        (row) => row.idempotencyKey === idempotencyKey
      )
    ).toMatchObject({
      dispatchId: "dispatch-insert-race-1-runtime",
      latestAttemptId: "runtime:dispatch-insert-race-1-runtime",
      sourceEventId: "sig-source-3",
      spaceId: "space-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      targetProfileId: "agt-race-insert-1",
    });
    expect((await readAttempts(harness)).length).toBe(0);
    expect(await readOps(harness)).toEqual([]);
  });

  it("does not write planner evidence when the guarded update loses a race", async () => {
    const { db, harness } = await createPlannerEvidenceFixture({
      simulateUpdateRaceOnce: true,
    });
    const idempotencyKey = buildIdempotencyKey({
      sourceEventId: "sig-source-4",
      targetProfileId: "agt-race-update-1",
    });
    await seedLedger(harness, {
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

    expect(
      (await readLedger(harness)).find(
        (row) => row.idempotencyKey === idempotencyKey
      )
    ).toMatchObject({
      dispatchId: "dispatch-update-race-1-runtime",
      latestAttemptId: "runtime:dispatch-update-race-1-runtime",
      sourceEventId: "sig-source-4",
      spaceId: "space-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      targetProfileId: "agt-race-update-1",
    });
    expect((await readAttempts(harness)).length).toBe(0);
    expect(await readOps(harness)).toEqual([]);
  });

  it("does not simulate a guarded planner update for rows in an ineligible status", async () => {
    const { db, harness } = await createPlannerEvidenceFixture({
      simulateUpdateRaceOnce: true,
    });
    const idempotencyKey = buildIdempotencyKey({
      sourceEventId: "sig-source-4b",
      targetProfileId: "agt-race-update-2",
    });
    await seedLedger(harness, {
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

    expect(
      (await readLedger(harness)).find(
        (row) => row.idempotencyKey === idempotencyKey
      )
    ).toMatchObject({
      dispatchId: "dispatch-update-race-2",
      latestAttemptId: "planner:dispatch-update-race-2",
      sourceEventId: "sig-source-4b",
      spaceId: "space-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
      targetProfileId: "agt-race-update-2",
    });
    expect((await readAttempts(harness)).length).toBe(0);
    expect(await readOps(harness)).toEqual([]);
  });

  it("updates a stable planner-owned non-ready row", async () => {
    const { db, harness } = await createPlannerEvidenceFixture();
    const idempotencyKey = buildIdempotencyKey({
      sourceEventId: "sig-source-5",
      targetProfileId: "agt-owned-1",
    });
    await seedLedger(harness, {
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

    expect(
      (await readLedger(harness)).find(
        (row) => row.idempotencyKey === idempotencyKey
      )
    ).toMatchObject({
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
    expect(
      (await readAttempts(harness)).find(
        (row) => row.attemptId === "planner:dispatch-owned-1"
      )
    ).toMatchObject({
      attemptId: "planner:dispatch-owned-1",
      attemptNo: 1,
      dispatchId: "dispatch-owned-1",
      errorCode: "route.not_registered",
      errorMessage: "route missing",
      status: "blocked",
    });
    expect(await readOps(harness)).toEqual([
      expect.objectContaining({
        correlationId: "dispatch-owned-1",
        decisionCode: DISPATCH_PLANNER_BLOCKED_DECISION_CODE,
      }),
    ]);
  });

  it("does not overwrite active dispatch work with planner evidence", async () => {
    const { db, harness } = await createPlannerEvidenceFixture();
    const idempotencyKey = buildIdempotencyKey({
      sourceEventId: "sig-source-3",
      targetProfileId: "agt-active-1",
    });
    await seedLedger(harness, {
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
    await seedAttempt(harness, {
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

    expect((await readLedger(harness))[0]).toMatchObject({
      dispatchId: "dispatch-active-1",
      latestAttemptId: "attempt-active-1",
      status: OPENMELD_DAEMON_DISPATCH_STATE.dispatching,
    });
    expect(await readOps(harness)).toEqual([]);
  });
});
