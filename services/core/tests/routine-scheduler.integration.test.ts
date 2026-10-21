import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { CENTER_AGENT_ROUTINE_LIMIT } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { claimRoutineWorkflowCheckBatch } from "../src/routines/routine-repository";
import {
  ROUTINE_CLAIM_WATCHDOG_TIMEOUT_MS,
  runRoutineSchedulerTick,
} from "../src/routines/routine-scheduler";
import { rpcListRoutineRuns, rpcListRoutines } from "../src/rpc/methods";
import { env } from "../test-support/worker-env";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ownedRoutineOrganizationIds = new Set<string>();
afterEach(async () => {
  try {
    await cleanupOwnedRoutineRows();
  } finally {
    vi.restoreAllMocks();
  }
});
describe("Core Routine scheduler", () => {
  it("rotates bounded Workflow checks past stuck Runs without changing execution state", async () => {
    const nowMs = Date.parse("2026-07-12T12:01:00.000Z");
    const fixture = await seedDueRoutine({
      cronExpression: "*/5 * * * *",
      nextDueAt: nowMs,
      suffix: crypto.randomUUID(),
    });
    const runIds = [0, 1, 2].map(() => `routine_run_${crypto.randomUUID()}`);
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of runIds.map((id, index) => ({
          ...{
            text: `
      INSERT INTO "openmeld"."routine_runs" (id, routine_id, organization_id, scheduled_for, status,
        routine_name_snapshot, execution_engine, started_at_ms)
      VALUES ($1, $2, $3, $4, 'submitted', 'Recovery rotation', 'workflow', $5)
    `,
            values: [],
          },
          values: [
            id,
            fixture.routineId,
            fixture.organizationId,
            nowMs + index,
            nowMs + index,
          ],
        }))) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const first = await claimRoutineWorkflowCheckBatch({
      db: getPostgresDatabase(env),
      limit: 2,
      nowMs: nowMs + 10,
    });
    expect(new Set(first)).toEqual(new Set(runIds.slice(0, 2)));
    const second = await claimRoutineWorkflowCheckBatch({
      db: getPostgresDatabase(env),
      limit: 2,
      nowMs: nowMs + 10,
    });
    expect(second).toEqual([runIds[2]]);
    const nextTick = await claimRoutineWorkflowCheckBatch({
      db: getPostgresDatabase(env),
      limit: 2,
      nowMs: nowMs + 60_000,
    });
    expect(new Set(nextTick)).toEqual(new Set(runIds.slice(0, 2)));
    const rows = await getPostgresDatabase(env).query({
      ...{
        text: 'SELECT status, failure_code FROM "openmeld"."routine_runs" WHERE routine_id = $1',
        values: [],
      },
      values: [fixture.routineId],
    });
    expect(rows.rows).toEqual(
      runIds.map(() => ({ status: "submitted", failure_code: null }))
    );
  });
  it("keeps global tick capacity independent from one Organization's Routine limit", async () => {
    const nowMs = Date.parse("2026-07-12T12:01:00.000Z");
    for (let index = 0; index <= CENTER_AGENT_ROUTINE_LIMIT; index += 1) {
      await seedDueRoutine({
        cronExpression: "*/5 * * * *",
        nextDueAt: nowMs - 60_000,
        suffix: `capacity_${String(index)}_${crypto.randomUUID()}`,
      });
    }
    const submitRoutineDelivery = vi.fn(async () => ({
      status: "submitted" as const,
    }));
    const summary = await runRoutineSchedulerTick({
      db: getPostgresDatabase(env),
      nowMs,
      submitRoutineDelivery,
    });
    expect(summary).toMatchObject({
      errors: 0,
      scanned: CENTER_AGENT_ROUTINE_LIMIT + 1,
      submitted: CENTER_AGENT_ROUTINE_LIMIT + 1,
    });
  });
  it("lets only one scanner claim and submit the same occurrence", async () => {
    const nowMs = Date.parse("2026-07-12T12:01:00.000Z");
    const fixture = await seedDueRoutine({
      cronExpression: "*/5 * * * *",
      nextDueAt: nowMs - 60_000,
      suffix: crypto.randomUUID(),
    });
    const submitRoutineDelivery = vi.fn(async () => ({
      status: "submitted" as const,
    }));
    await Promise.all([
      runRoutineSchedulerTick({
        db: getPostgresDatabase(env),
        nowMs,
        submitRoutineDelivery,
      }),
      runRoutineSchedulerTick({
        db: getPostgresDatabase(env),
        nowMs,
        submitRoutineDelivery,
      }),
    ]);
    expect(submitRoutineDelivery).toHaveBeenCalledTimes(1);
    await expect(readRuns(fixture.routineId)).resolves.toHaveLength(1);
    await expect(readRoutine(fixture.routineId)).resolves.toMatchObject({
      next_due_at: nowMs - 60_000 + FIVE_MINUTES_MS,
    });
  });
  it("catches up a slightly late occurrence inside its bounded window", async () => {
    const nowMs = Date.parse("2026-07-12T12:01:00.000Z");
    const scheduledFor = nowMs - 60_000;
    const fixture = await seedDueRoutine({
      cronExpression: "*/5 * * * *",
      nextDueAt: scheduledFor,
      suffix: crypto.randomUUID(),
    });
    const submitRoutineDelivery = vi.fn(async () => ({
      status: "submitted" as const,
    }));
    await runRoutineSchedulerTick({
      db: getPostgresDatabase(env),
      nowMs,
      submitRoutineDelivery,
    });
    expect(submitRoutineDelivery).toHaveBeenCalledTimes(1);
    await expect(readRuns(fixture.routineId)).resolves.toEqual([
      expect.objectContaining({
        scheduled_for: scheduledFor,
        status: "claimed",
      }),
    ]);
  });
  it("freezes the selected Workflow engine on the claimed Run", async () => {
    const nowMs = Date.parse("2026-07-12T12:01:00.000Z");
    const fixture = await seedDueRoutine({
      cronExpression: "*/5 * * * *",
      nextDueAt: nowMs - 60_000,
      suffix: crypto.randomUUID(),
    });
    const submitRoutineDelivery = vi.fn(async () => ({
      status: "pending" as const,
    }));
    const summary = await runRoutineSchedulerTick({
      db: getPostgresDatabase(env),
      nowMs,
      resolveExecutionEngine: () => "workflow",
      submitRoutineDelivery,
    });
    expect(summary).toMatchObject({ pending: 1, submitted: 0 });
    expect(submitRoutineDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ executionEngine: "workflow" })
    );
    await expect(
      getPostgresDatabase(env)
        .query({
          ...{
            text: 'SELECT execution_engine, status FROM "openmeld"."routine_runs" WHERE routine_id = $1',
            values: [],
          },
          values: [fixture.routineId],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toEqual({ execution_engine: "workflow", status: "claimed" });
  });
  it("records one skipped Run when the latest occurrence is beyond its catch-up window", async () => {
    const nowMs = Date.parse("2026-07-12T12:00:00.000Z");
    const scheduledFor = Date.parse("2026-07-12T09:00:00.000Z");
    const fixture = await seedDueRoutine({
      cronExpression: "0 9 * * *",
      nextDueAt: scheduledFor,
      suffix: crypto.randomUUID(),
    });
    const submitRoutineDelivery = vi.fn(async () => ({
      status: "submitted" as const,
    }));
    await runRoutineSchedulerTick({
      db: getPostgresDatabase(env),
      nowMs,
      submitRoutineDelivery,
    });
    expect(submitRoutineDelivery).not.toHaveBeenCalled();
    await expect(readRuns(fixture.routineId)).resolves.toEqual([
      expect.objectContaining({
        failure_code: "routine.occurrences_overdue",
        failure_detail:
          "Skipped 1 occurrence from 2026-07-12T09:00:00.000Z to 2026-07-12T09:00:00.000Z because this Routine was overdue beyond its catch-up window.",
        status: "skipped",
      }),
    ]);
    expect(Number((await readRoutine(fixture.routineId))?.next_due_at)).toBe(
      Date.parse("2026-07-13T09:00:00.000Z")
    );
  });
  it("aggregates a day of missed five-minute occurrences and executes only the current one", async () => {
    const nowMs = Date.parse("2026-07-12T12:00:00.000Z");
    const scheduledFor = nowMs - ONE_DAY_MS;
    const fixture = await seedDueRoutine({
      cronExpression: "*/5 * * * *",
      nextDueAt: scheduledFor,
      suffix: crypto.randomUUID(),
    });
    const submitRoutineDelivery = vi.fn(async () => ({
      status: "submitted" as const,
    }));
    await runRoutineSchedulerTick({
      db: getPostgresDatabase(env),
      nowMs,
      submitRoutineDelivery,
    });
    expect(submitRoutineDelivery).toHaveBeenCalledTimes(1);
    const runs = await readRuns(fixture.routineId);
    expect(runs).toHaveLength(2);
    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failure_detail: `Skipped 288 occurrences from ${new Date(scheduledFor).toISOString()} to ${new Date(nowMs - FIVE_MINUTES_MS).toISOString()} because this Routine was overdue beyond its catch-up window.`,
          scheduled_for: scheduledFor,
          status: "skipped",
        }),
        expect.objectContaining({ scheduled_for: nowMs, status: "claimed" }),
      ])
    );
    expect(Number((await readRoutine(fixture.routineId))?.next_due_at)).toBe(
      nowMs + FIVE_MINUTES_MS
    );
  });
  it("fast-forwards a year of five-minute occurrences without starving the next due Routine", async () => {
    const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const yearOldScheduledFor = Date.parse("2025-01-01T00:00:00.000Z");
    const yearOld = await seedDueRoutine({
      cronExpression: "*/5 * * * *",
      nextDueAt: yearOldScheduledFor,
      suffix: crypto.randomUUID(),
    });
    const nextRoutine = await seedDueRoutine({
      cronExpression: "*/5 * * * *",
      nextDueAt: nowMs,
      suffix: crypto.randomUUID(),
    });
    const submitRoutineDelivery = vi.fn(async () => ({
      status: "submitted" as const,
    }));
    const summary = await runRoutineSchedulerTick({
      db: getPostgresDatabase(env),
      nowMs,
      submitRoutineDelivery,
    });
    expect(summary).toMatchObject({ errors: 0, scanned: 2, submitted: 2 });
    expect(submitRoutineDelivery).toHaveBeenCalledTimes(2);
    await expect(readRuns(yearOld.routineId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failure_detail:
            "Skipped 105120 occurrences from 2025-01-01T00:00:00.000Z to 2025-12-31T23:55:00.000Z because this Routine was overdue beyond its catch-up window.",
          status: "skipped",
        }),
        expect.objectContaining({
          scheduled_for: nowMs,
          status: "claimed",
        }),
      ])
    );
    await expect(readRuns(nextRoutine.routineId)).resolves.toEqual([
      expect.objectContaining({ scheduled_for: nowMs, status: "claimed" }),
    ]);
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: "UPDATE \"openmeld\".\"routine_runs\" SET status = 'completed', finished_at_ms = $1 WHERE routine_id IN ($2, $3) AND status = 'claimed'",
              values: [],
            },
            values: [nowMs, yearOld.routineId, nextRoutine.routineId],
          },
          {
            ...{
              text: 'UPDATE "openmeld"."routines" SET status = \'paused\', next_due_at = NULL WHERE id IN ($1, $2)',
              values: [],
            },
            values: [yearOld.routineId, nextRoutine.routineId],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
  });
  it("quarantines a corrupt out-of-horizon schedule without poisoning later due Routines", async () => {
    const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const corruptScheduledFor = Date.parse("1969-12-31T23:55:00.000Z");
    const corrupt = await seedDueRoutine({
      cronExpression: "*/5 * * * *",
      nextDueAt: corruptScheduledFor,
      suffix: crypto.randomUUID(),
    });
    const healthy = await seedDueRoutine({
      cronExpression: "*/5 * * * *",
      nextDueAt: nowMs,
      suffix: crypto.randomUUID(),
    });
    const submitRoutineDelivery = vi.fn(async () => ({
      status: "submitted" as const,
    }));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const summary = await runRoutineSchedulerTick({
      db: getPostgresDatabase(env),
      nowMs,
      submitRoutineDelivery,
    });
    expect(summary).toMatchObject({
      errors: 0,
      scanned: 2,
      skipped: 1,
      submitted: 1,
    });
    expect(submitRoutineDelivery).toHaveBeenCalledTimes(1);
    const quarantinedRuns = await readRuns(corrupt.routineId);
    expect(quarantinedRuns).toEqual([
      expect.objectContaining({
        failure_code: "routine.schedule_invalid",
        failure_detail: expect.stringContaining(
          "supported Unix-to-Croner recovery horizon"
        ),
        scheduled_for: corruptScheduledFor,
        status: "skipped",
      }),
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      "[core.routine.scheduler.schedule_quarantined]",
      expect.objectContaining({ runId: quarantinedRuns[0]?.id })
    );
    await expect(readRoutine(corrupt.routineId)).resolves.toMatchObject({
      next_due_at: null,
      status: "paused",
    });
    const context = await seedRoutineReader(corrupt.organizationId);
    await getPostgresDatabase(env).query({
      text: "UPDATE openmeld.routines SET created_by_user_id=$1 WHERE id=$2",
      values: [context.actorContext.ownerUserId, corrupt.routineId],
    });
    await getPostgresDatabase(env).query({
      text: "UPDATE openmeld.routine_runs SET created_by_user_id_snapshot=$1 WHERE routine_id=$2",
      values: [context.actorContext.ownerUserId, corrupt.routineId],
    });
    await expect(
      rpcListRoutineRuns(env as CoreBindings, {
        context,
        routineId: corrupt.routineId,
      })
    ).resolves.toMatchObject({
      runs: [
        {
          failureCode: "routine.schedule_invalid",
          scheduledFor: corruptScheduledFor,
          status: "skipped",
        },
      ],
    });
    await expect(
      rpcListRoutines(env as CoreBindings, { context })
    ).resolves.toMatchObject({
      routines: expect.arrayContaining([
        expect.objectContaining({
          id: corrupt.routineId,
          lastRun: expect.objectContaining({
            failureCode: "routine.schedule_invalid",
            scheduledFor: corruptScheduledFor,
            status: "skipped",
          }),
        }),
      ]),
    });
    const completedRunId = `routine_run_${crypto.randomUUID()}`;
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."routine_runs" (
          id, routine_id, organization_id, scheduled_for, status,
          routine_name_snapshot, target_space_id_snapshot,
          started_at_ms, finished_at_ms, scope_snapshot, created_by_user_id_snapshot
        ) SELECT $1, $2, $3, $4, 'completed', 'Recovered schedule', $5, $6, $7,
          scope, created_by_user_id FROM openmeld.routines WHERE id=$2
      `,
        values: [],
      },
      values: [
        completedRunId,
        corrupt.routineId,
        corrupt.organizationId,
        nowMs,
        `space_scheduler_${corrupt.routineId}`,
        nowMs,
        nowMs + 1000,
      ],
    });
    await expect(
      rpcListRoutines(env as CoreBindings, { context })
    ).resolves.toMatchObject({
      routines: expect.arrayContaining([
        expect.objectContaining({
          id: corrupt.routineId,
          lastRun: expect.objectContaining({
            id: completedRunId,
            scheduledFor: nowMs,
            status: "completed",
          }),
        }),
      ]),
    });
    await expect(
      rpcListRoutineRuns(env as CoreBindings, {
        context,
        limit: 1,
        routineId: corrupt.routineId,
      })
    ).resolves.toMatchObject({
      runs: [{ id: completedRunId, scheduledFor: nowMs }],
    });
    await expect(
      rpcListRoutineRuns(env as CoreBindings, {
        beforeScheduledFor: nowMs,
        context,
        limit: 1,
        routineId: corrupt.routineId,
      })
    ).resolves.toMatchObject({
      runs: [
        {
          failureCode: "routine.schedule_invalid",
          scheduledFor: corruptScheduledFor,
          status: "skipped",
        },
      ],
    });
    await getPostgresDatabase(env).query({
      ...{
        text: `
        INSERT INTO "openmeld"."routine_runs" (
          id, routine_id, organization_id, scheduled_for, status,
          failure_code, failure_detail, started_at_ms, finished_at_ms,
          scope_snapshot,created_by_user_id_snapshot
        ) SELECT $1, $2, $3, $4, 'failed', 'remote_agent.test_failure',
          'Invalid negative Run evidence', $5, $6,scope,created_by_user_id
          FROM openmeld.routines WHERE id=$2
      `,
        values: [],
      },
      values: [
        `routine_run_${crypto.randomUUID()}`,
        corrupt.routineId,
        corrupt.organizationId,
        corruptScheduledFor - FIVE_MINUTES_MS,
        nowMs,
        nowMs + 1000,
      ],
    });
    await expect(
      rpcListRoutineRuns(env as CoreBindings, {
        context,
        routineId: corrupt.routineId,
      })
    ).rejects.toThrow("Failed to build a valid Routine response");
    await expect(readRuns(healthy.routineId)).resolves.toEqual([
      expect.objectContaining({ scheduled_for: nowMs, status: "claimed" }),
    ]);
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: "UPDATE \"openmeld\".\"routine_runs\" SET status = 'completed', finished_at_ms = $1 WHERE routine_id = $2 AND status = 'claimed'",
              values: [],
            },
            values: [nowMs, healthy.routineId],
          },
          {
            ...{
              text: 'UPDATE "openmeld"."routines" SET status = \'paused\', next_due_at = NULL WHERE id = $1',
              values: [],
            },
            values: [healthy.routineId],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
  });
  it("fails a stale claimed Run once without touching submitted Runs", async () => {
    const nowMs = Date.parse("2026-07-12T12:00:00.000Z");
    const suffix = crypto.randomUUID();
    const organizationId = `org_watchdog_${suffix}`;
    await insertOrganization(organizationId, suffix);
    await insertRun({
      id: `run_claimed_${suffix}`,
      organizationId,
      startedAtMs: nowMs - ROUTINE_CLAIM_WATCHDOG_TIMEOUT_MS - 1,
      status: "claimed",
    });
    await insertRun({
      id: `run_submitted_${suffix}`,
      organizationId,
      startedAtMs: nowMs - ROUTINE_CLAIM_WATCHDOG_TIMEOUT_MS - 1,
      status: "submitted",
    });
    const first = await runRoutineSchedulerTick({
      db: getPostgresDatabase(env),
      nowMs,
      submitRoutineDelivery: vi.fn(),
    });
    const second = await runRoutineSchedulerTick({
      db: getPostgresDatabase(env),
      nowMs: nowMs + 1000,
      submitRoutineDelivery: vi.fn(),
    });
    expect(first.watchdogFailed).toBe(1);
    expect(second.watchdogFailed).toBe(0);
    const result = await getPostgresDatabase(env).query<{
      failure_code: string | null;
      id: string;
      status: string;
    }>({
      ...{
        text: 'SELECT id, status, failure_code FROM "openmeld"."routine_runs" WHERE organization_id = $1 ORDER BY id',
        values: [],
      },
      values: [organizationId],
    });
    expect(result.rows).toEqual([
      {
        failure_code: "routine.claim_timeout",
        id: `run_claimed_${suffix}`,
        status: "failed",
      },
      {
        failure_code: null,
        id: `run_submitted_${suffix}`,
        status: "submitted",
      },
    ]);
  });
  it("logs one Routine failure and continues processing the remaining due batch", async () => {
    const nowMs = Date.parse("2026-07-12T12:01:00.000Z");
    const first = await seedDueRoutine({
      cronExpression: "*/5 * * * *",
      nextDueAt: nowMs - 60_000,
      suffix: crypto.randomUUID(),
    });
    const second = await seedDueRoutine({
      cronExpression: "*/5 * * * *",
      nextDueAt: nowMs - 60_000,
      suffix: crypto.randomUUID(),
    });
    const submitRoutineDelivery = vi.fn(({ routine }) => {
      if (routine.id === first.routineId) {
        return Promise.reject(new Error("first Routine failed"));
      }
      return Promise.resolve({ status: "submitted" as const });
    });
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const summary = await runRoutineSchedulerTick({
      db: getPostgresDatabase(env),
      nowMs,
      submitRoutineDelivery,
    });
    expect(submitRoutineDelivery).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ errors: 1, submitted: 1 });
    await expect(readRuns(first.routineId)).resolves.toEqual([
      expect.objectContaining({
        failure_code: "routine.native_delivery_submission_failed",
        status: "failed",
      }),
    ]);
    await expect(readRuns(second.routineId)).resolves.toEqual([
      expect.objectContaining({ status: "claimed" }),
    ]);
    expect(error).toHaveBeenCalledWith(
      "[core.routine.scheduler.item_failed]",
      expect.objectContaining({ routineId: first.routineId })
    );
  });
  it("reports native delivery outcomes without counting failures or skips as submissions", async () => {
    const nowMs = Date.parse("2026-07-12T12:01:00.000Z");
    const failed = await seedDueRoutine({
      cronExpression: "*/5 * * * *",
      nextDueAt: nowMs - 60_000,
      suffix: crypto.randomUUID(),
    });
    await seedDueRoutine({
      cronExpression: "*/5 * * * *",
      nextDueAt: nowMs - 60_000,
      suffix: crypto.randomUUID(),
    });
    const submitRoutineDelivery = vi.fn(({ routine }) =>
      Promise.resolve({
        status: routine.id === failed.routineId ? "failed" : "skipped",
      } as const)
    );
    const summary = await runRoutineSchedulerTick({
      db: getPostgresDatabase(env),
      nowMs,
      submitRoutineDelivery,
    });
    expect(summary).toMatchObject({
      errors: 0,
      failed: 1,
      skipped: 1,
      submitted: 0,
    });
  });
});
async function seedDueRoutine(input: {
  cronExpression: string;
  nextDueAt: number;
  suffix: string;
}) {
  const organizationId = `org_routine_scheduler_${input.suffix}`;
  const routineId = `routine_scheduler_${input.suffix}`;
  await insertOrganization(organizationId, input.suffix);
  const recordTimestamp = Math.max(0, input.nextDueAt - 1000);
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."routines" (
        id, organization_id, name, instructions, schedule_kind,
        cron_expression, timezone, target_space_id, status, next_due_at,
        created_by_user_id, updated_by_user_id, created_at_ms, updated_at_ms
      ) VALUES ($1, $2, 'Feedback review', 'Review feedback.', 'cron', $3, 'UTC', $4,
        'enabled', $5, 'creator_user', 'creator_user', $6, $7)
    `,
      values: [],
    },
    values: [
      routineId,
      organizationId,
      input.cronExpression,
      `space_scheduler_${input.suffix}`,
      input.nextDueAt,
      recordTimestamp,
      recordTimestamp,
    ],
  });
  return { organizationId, routineId };
}
async function insertOrganization(organizationId: string, suffix: string) {
  ownedRoutineOrganizationIds.add(organizationId);
  await getPostgresDatabase(env).query({
    ...{
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Scheduler Org\', $2, $3)',
      values: [],
    },
    values: [organizationId, `scheduler-${suffix}`, Date.now()],
  });
}
async function seedRoutineReader(organizationId: string) {
  const suffix = crypto.randomUUID();
  const userId = `user_scheduler_${suffix}`;
  const memberId = `member_scheduler_${suffix}`;
  const profileId = crypto.randomUUID();
  const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, \'Scheduler reader\', $2, 1, $3, $4)',
            values: [],
          },
          values: [userId, `${userId}@example.com`, nowMs, nowMs],
        },
        {
          ...{
            text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'member\', $4)',
            values: [],
          },
          values: [memberId, organizationId, userId, nowMs],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          created_at, updated_at
        ) VALUES ($1, 'Scheduler reader', $2, 'human', 1, 'active', NULL, $3, $4, 'auth_bootstrap', $5, $6)
      `,
            values: [],
          },
          values: [
            profileId,
            `scheduler-reader-${suffix}`,
            userId,
            userId,
            nowMs,
            nowMs,
          ],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return {
    activeOrganizationId: organizationId,
    actorContext: {
      callerPrincipalId: userId,
      ownerUserId: userId,
      profileKind: "human" as const,
      requestId: `request_scheduler_${suffix}`,
      openMeldProfileId: profileId,
    },
  };
}
async function insertRun(input: {
  id: string;
  organizationId: string;
  startedAtMs: number;
  status: "claimed" | "submitted";
}) {
  await getPostgresDatabase(env).query({
    ...{
      text: `
      INSERT INTO "openmeld"."routine_runs" (
        id, routine_id, organization_id, scheduled_for, status, started_at_ms
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `,
      values: [],
    },
    values: [
      input.id,
      `deleted_routine_${input.id}`,
      input.organizationId,
      input.startedAtMs,
      input.status,
      input.startedAtMs,
    ],
  });
}
async function readRuns(routineId: string) {
  const result = await getPostgresDatabase(env).query<{
    failure_code: string | null;
    failure_detail: string | null;
    id: string;
    scheduled_for: number;
    status: string;
  }>({
    ...{
      text: `
      SELECT id, scheduled_for, status, failure_code, failure_detail
      FROM "openmeld"."routine_runs"
      WHERE routine_id = $1
      ORDER BY scheduled_for ASC, id ASC
    `,
      values: [],
    },
    values: [routineId],
  });
  return result.rows ?? [];
}
async function readRoutine(routineId: string) {
  return await getPostgresDatabase(env)
    .query<{
      next_due_at: number | null;
      status: string;
    }>({
      ...{
        text: 'SELECT next_due_at, status FROM "openmeld"."routines" WHERE id = $1',
        values: [],
      },
      values: [routineId],
    })
    .then((result) => result.rows[0] ?? null);
}
async function cleanupOwnedRoutineRows(): Promise<void> {
  const cleanupErrors: Error[] = [];
  for (const organizationId of ownedRoutineOrganizationIds) {
    const cleanupSteps = [
      [
        "native delivery rows",
        {
          ...{
            text: 'DELETE FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
      [
        "Routine Run rows",
        {
          ...{
            text: 'DELETE FROM "openmeld"."routine_runs" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
      [
        "Routine rows",
        {
          ...{
            text: 'DELETE FROM "openmeld"."routines" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
    ] as const;
    for (const [description, statement] of cleanupSteps) {
      try {
        await getPostgresDatabase(env).query({
          text: statement.text,
          values: [...statement.values],
        });
      } catch (cause) {
        cleanupErrors.push(
          new Error(
            `Failed to clean owned ${description} for Organization ${organizationId}.`,
            { cause }
          )
        );
      }
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "Failed to clean owned Routine scheduler test rows."
    );
  }
  ownedRoutineOrganizationIds.clear();
}
