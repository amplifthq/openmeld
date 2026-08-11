import { describe, expect, it } from "vitest";
import {
  listRecentDispatchLedgerEntriesForSpace,
  markDispatchStatus,
} from "../dispatch/infrastructure/d1/dispatch-ledger-d1";

type DispatchHistoryFixtureRow = {
  attemptCount?: number;
  attemptCreatedAtMs?: number;
  attemptErrorCode?: string | null;
  attemptErrorMessage?: string | null;
  attemptFinishedAtMs?: number | null;
  attemptId?: string | null;
  attemptNo?: number;
  attemptStartedAtMs?: number | null;
  attemptStatus?: string | null;
  dispatchId: string;
  firstSeenAtMs?: number;
  lastAttemptAtMs?: number;
  spaceId: string;
  status: string;
  targetProfileId: string;
};

// Real 2026-07-10 dogfooding incident shape (see W-CA-CAP1): the local daemon
// reported this OpenAI 400 body as errorMessage alongside errorCode
// "runtime.turn.failed". Dispatch History must expose only the whitelisted
// diagnostic fields, never the rest of the provider response.
const OPENAI_400_ERROR_MESSAGE = JSON.stringify({
  error: {
    code: "invalid_value",
    message: `Invalid value: 'max'. Supported values are: ...\n${"raw detail ".repeat(80)}`,
    param: "reasoning.effort",
    type: "invalid_request_error",
  },
  requestBody: { prompt: "must-not-reach-center-agent" },
  status: 400,
  type: "error",
});
const OPENAI_400_PUBLIC_SUMMARY_RE =
  /^invalid_value \(invalid_request_error\): Invalid value: 'max'\./;
const createInMemoryDispatchHistoryDb = (rows: DispatchHistoryFixtureRow[]) => {
  const db = {
    prepare: (sql: string) => {
      const normalizedSql = sql.toLowerCase().replace(/\s+/g, " ").trim();
      return {
        bind: (...args: unknown[]) => ({
          all: () => {
            if (
              !normalizedSql.includes(
                "from openmelddaemon_dispatch_ledger as ledger"
              )
            ) {
              throw new Error(`unsupported all() query: ${sql}`);
            }
            const spaceId = String(args[0] ?? "");
            const hasTargetProfileFilter = normalizedSql.includes(
              "and ledger.target_profile_id = ?"
            );
            const hasDispatchIdFilter = normalizedSql.includes(
              "and ledger.dispatch_id = ?"
            );
            let argIndex = 1;
            const targetProfileId = hasTargetProfileFilter
              ? String(args[argIndex++] ?? "")
              : null;
            const dispatchId = hasDispatchIdFilter
              ? String(args[argIndex++] ?? "")
              : null;
            const limit = Number(args[argIndex] ?? 10);

            const results = rows
              .filter((row) => row.spaceId === spaceId)
              .filter(
                (row) =>
                  !targetProfileId || row.targetProfileId === targetProfileId
              )
              .filter((row) => !dispatchId || row.dispatchId === dispatchId)
              .sort(
                (left, right) =>
                  (right.lastAttemptAtMs ?? 0) - (left.lastAttemptAtMs ?? 0)
              )
              .slice(0, limit)
              .map((row) => ({
                attemptCount: row.attemptCount ?? 1,
                attemptCreatedAtMs: row.attemptCreatedAtMs ?? 0,
                attemptErrorCode: row.attemptErrorCode ?? null,
                attemptErrorMessage: row.attemptErrorMessage ?? null,
                attemptFinishedAtMs: row.attemptFinishedAtMs ?? null,
                attemptId: row.attemptId ?? null,
                attemptNo: row.attemptNo ?? 1,
                attemptStartedAtMs: row.attemptStartedAtMs ?? null,
                attemptStatus: row.attemptStatus ?? null,
                dispatchId: row.dispatchId,
                firstSeenAtMs: row.firstSeenAtMs ?? 0,
                lastAttemptAtMs: row.lastAttemptAtMs ?? 0,
                status: row.status,
                targetProfileId: row.targetProfileId,
              }));

            return Promise.resolve({ results });
          },
        }),
      };
    },
  } as unknown as D1Database;

  return db;
};

describe("listRecentDispatchLedgerEntriesForSpace", () => {
  it("sanitizes vendor error bodies before writing a dispatch attempt", async () => {
    const boundStatements: unknown[][] = [];
    const db = {
      prepare: () => ({
        bind: (...args: unknown[]) => {
          boundStatements.push(args);
          return { run: () => Promise.resolve({ meta: { changes: 1 } }) };
        },
      }),
    } as unknown as D1Database;

    await markDispatchStatus({
      attemptId: "attempt-1",
      db,
      errorCode: "runtime.turn.failed",
      errorMessage: OPENAI_400_ERROR_MESSAGE,
      idempotencyKey: "event-1::profile-1",
      nowMs: 2000,
      status: "failed_terminal",
    });

    expect(boundStatements).toHaveLength(2);
    expect(boundStatements[1]?.[9]).toMatch(OPENAI_400_PUBLIC_SUMMARY_RE);
    expect(JSON.stringify(boundStatements)).not.toContain(
      "must-not-reach-center-agent"
    );
  });

  it("surfaces errorCode and errorMessage for a failed_terminal dispatch (2026-07-10 incident shape)", async () => {
    const db = createInMemoryDispatchHistoryDb([
      {
        attemptCount: 1,
        attemptCreatedAtMs: 1000,
        attemptErrorCode: "runtime.turn.failed",
        attemptErrorMessage: OPENAI_400_ERROR_MESSAGE,
        attemptFinishedAtMs: 2000,
        attemptId: "attempt-1",
        attemptNo: 1,
        attemptStartedAtMs: 1100,
        attemptStatus: "failed_terminal",
        dispatchId: "dispatch-incident-1",
        firstSeenAtMs: 1000,
        lastAttemptAtMs: 2000,
        spaceId: "space-1",
        status: "failed_terminal",
        targetProfileId: "agt_incident",
      },
    ]);

    const entries = await listRecentDispatchLedgerEntriesForSpace({
      db,
      limit: 20,
      spaceId: "space-1",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      attemptCount: 1,
      dispatchId: "dispatch-incident-1",
      firstSeenAtMs: 1000,
      lastAttemptAtMs: 2000,
      latestAttempt: {
        attemptId: "attempt-1",
        attemptNo: 1,
        createdAtMs: 1000,
        errorCode: "runtime.turn.failed",
        errorMessage: expect.stringMatching(OPENAI_400_PUBLIC_SUMMARY_RE),
        finishedAtMs: 2000,
        startedAtMs: 1100,
        status: "failed_terminal",
      },
      status: "failed_terminal",
      targetProfileId: "agt_incident",
    });
    expect(JSON.stringify(entries)).not.toContain(
      "must-not-reach-center-agent"
    );
    expect(entries[0]?.latestAttempt?.errorMessage).not.toContain("\n");
    expect(entries[0]?.latestAttempt?.errorMessage?.length).toBeLessThanOrEqual(
      512
    );
  });

  it("distinguishes an in-flight dispatch (dispatching / waiting_result) from a failed one", async () => {
    const db = createInMemoryDispatchHistoryDb([
      {
        attemptCreatedAtMs: 1000,
        attemptId: "attempt-running-1",
        attemptStartedAtMs: 1100,
        attemptStatus: "waiting_result",
        dispatchId: "dispatch-running-1",
        firstSeenAtMs: 1000,
        lastAttemptAtMs: 5000,
        spaceId: "space-1",
        status: "dispatching",
        targetProfileId: "agt_running",
      },
    ]);

    const entries = await listRecentDispatchLedgerEntriesForSpace({
      db,
      limit: 20,
      spaceId: "space-1",
    });

    expect(entries[0]?.status).toBe("dispatching");
    expect(entries[0]?.latestAttempt?.status).toBe("waiting_result");
    expect(entries[0]?.latestAttempt?.errorCode).toBeNull();
    expect(entries[0]?.latestAttempt?.finishedAtMs).toBeNull();
  });

  it("reports no attempt evidence when the dispatch never reached a real attempt row", async () => {
    const db = createInMemoryDispatchHistoryDb([
      {
        dispatchId: "dispatch-blocked-1",
        firstSeenAtMs: 1000,
        lastAttemptAtMs: 1000,
        spaceId: "space-1",
        status: "blocked",
        targetProfileId: "agt_blocked",
      },
    ]);

    const entries = await listRecentDispatchLedgerEntriesForSpace({
      db,
      limit: 20,
      spaceId: "space-1",
    });

    expect(entries[0]?.status).toBe("blocked");
    expect(entries[0]?.latestAttempt).toBeNull();
  });

  it("filters by space, optional targetProfileId, and optional dispatchId", async () => {
    const db = createInMemoryDispatchHistoryDb([
      {
        dispatchId: "dispatch-a",
        lastAttemptAtMs: 3000,
        spaceId: "space-1",
        status: "succeeded",
        targetProfileId: "agt_a",
      },
      {
        dispatchId: "dispatch-b",
        lastAttemptAtMs: 4000,
        spaceId: "space-1",
        status: "failed_terminal",
        targetProfileId: "agt_b",
      },
      {
        dispatchId: "dispatch-other-space",
        lastAttemptAtMs: 9000,
        spaceId: "space-2",
        status: "succeeded",
        targetProfileId: "agt_a",
      },
    ]);

    const spaceScoped = await listRecentDispatchLedgerEntriesForSpace({
      db,
      limit: 20,
      spaceId: "space-1",
    });
    expect(spaceScoped.map((entry) => entry.dispatchId).sort()).toEqual([
      "dispatch-a",
      "dispatch-b",
    ]);

    const profileScoped = await listRecentDispatchLedgerEntriesForSpace({
      db,
      limit: 20,
      spaceId: "space-1",
      targetProfileId: "agt_b",
    });
    expect(profileScoped.map((entry) => entry.dispatchId)).toEqual([
      "dispatch-b",
    ]);

    const dispatchScoped = await listRecentDispatchLedgerEntriesForSpace({
      db,
      dispatchId: "dispatch-a",
      limit: 20,
      spaceId: "space-1",
    });
    expect(dispatchScoped.map((entry) => entry.dispatchId)).toEqual([
      "dispatch-a",
    ]);
  });

  it("orders by recency and clamps the caller limit to the 20-row cap", async () => {
    const rows: DispatchHistoryFixtureRow[] = Array.from(
      { length: 25 },
      (_, index) => ({
        dispatchId: `dispatch-${index}`,
        lastAttemptAtMs: index,
        spaceId: "space-1",
        status: "succeeded",
        targetProfileId: "agt_a",
      })
    );
    const db = createInMemoryDispatchHistoryDb(rows);

    const entries = await listRecentDispatchLedgerEntriesForSpace({
      db,
      limit: 999,
      spaceId: "space-1",
    });

    expect(entries).toHaveLength(20);
    expect(entries[0]?.dispatchId).toBe("dispatch-24");
    expect(entries.at(-1)?.dispatchId).toBe("dispatch-5");
  });
});
