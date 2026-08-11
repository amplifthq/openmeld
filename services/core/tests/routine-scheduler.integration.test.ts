import { env } from "cloudflare:test";
import { CENTER_AGENT_ROUTINE_LIMIT } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  ROUTINE_CLAIM_WATCHDOG_TIMEOUT_MS,
  runRoutineSchedulerTick,
} from "../src/routines/routine-scheduler";
import { rpcListRoutineRuns, rpcListRoutines } from "../src/rpc/methods";

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
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
        nowMs,
        submitRoutineDelivery,
      }),
      runRoutineSchedulerTick({
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      nowMs,
      resolveExecutionEngine: () => "workflow",
      submitRoutineDelivery,
    });

    expect(summary).toMatchObject({ pending: 1, submitted: 0 });
    expect(submitRoutineDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ executionEngine: "workflow" })
    );
    await expect(
      env.OPENMELD_DB.prepare(
        "SELECT execution_engine, status FROM routine_runs WHERE routine_id = ?"
      )
        .bind(fixture.routineId)
        .first()
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
      db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "UPDATE routine_runs SET status = 'completed', finished_at_ms = ? WHERE routine_id IN (?, ?) AND status = 'claimed'"
      ).bind(nowMs, yearOld.routineId, nextRoutine.routineId),
      env.OPENMELD_DB.prepare(
        "UPDATE routines SET status = 'paused', next_due_at = NULL WHERE id IN (?, ?)"
      ).bind(yearOld.routineId, nextRoutine.routineId),
    ]);
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
      db: env.OPENMELD_DB,
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
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO routine_runs (
          id, routine_id, organization_id, scheduled_for, status,
          routine_name_snapshot, target_space_id_snapshot,
          started_at_ms, finished_at_ms
        ) VALUES (?, ?, ?, ?, 'completed', 'Recovered schedule', ?, ?, ?)
      `
    )
      .bind(
        completedRunId,
        corrupt.routineId,
        corrupt.organizationId,
        nowMs,
        `space_scheduler_${corrupt.routineId}`,
        nowMs,
        nowMs + 1000
      )
      .run();
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
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO routine_runs (
          id, routine_id, organization_id, scheduled_for, status,
          failure_code, failure_detail, started_at_ms, finished_at_ms
        ) VALUES (?, ?, ?, ?, 'failed', 'remote_agent.test_failure',
          'Invalid negative Run evidence', ?, ?)
      `
    )
      .bind(
        `routine_run_${crypto.randomUUID()}`,
        corrupt.routineId,
        corrupt.organizationId,
        corruptScheduledFor - FIVE_MINUTES_MS,
        nowMs,
        nowMs + 1000
      )
      .run();
    await expect(
      rpcListRoutineRuns(env as CoreBindings, {
        context,
        routineId: corrupt.routineId,
      })
    ).rejects.toThrow("Failed to build a valid Routine response");
    await expect(readRuns(healthy.routineId)).resolves.toEqual([
      expect.objectContaining({ scheduled_for: nowMs, status: "claimed" }),
    ]);
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "UPDATE routine_runs SET status = 'completed', finished_at_ms = ? WHERE routine_id = ? AND status = 'claimed'"
      ).bind(nowMs, healthy.routineId),
      env.OPENMELD_DB.prepare(
        "UPDATE routines SET status = 'paused', next_due_at = NULL WHERE id = ?"
      ).bind(healthy.routineId),
    ]);
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
      db: env.OPENMELD_DB,
      nowMs,
      submitRoutineDelivery: vi.fn(),
    });
    const second = await runRoutineSchedulerTick({
      db: env.OPENMELD_DB,
      nowMs: nowMs + 1000,
      submitRoutineDelivery: vi.fn(),
    });

    expect(first.watchdogFailed).toBe(1);
    expect(second.watchdogFailed).toBe(0);
    const result = await env.OPENMELD_DB.prepare(
      "SELECT id, status, failure_code FROM routine_runs WHERE organization_id = ? ORDER BY id"
    )
      .bind(organizationId)
      .all<{ failure_code: string | null; id: string; status: string }>();
    expect(result.results).toEqual([
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
      db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO routines (
        id, organization_id, name, instructions, schedule_kind,
        cron_expression, timezone, target_space_id, status, next_due_at,
        created_by_user_id, updated_by_user_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, 'Feedback review', 'Review feedback.', 'cron', ?, 'UTC', ?,
        'enabled', ?, 'creator_user', 'creator_user', ?, ?)
    `
  )
    .bind(
      routineId,
      organizationId,
      input.cronExpression,
      `space_scheduler_${input.suffix}`,
      input.nextDueAt,
      recordTimestamp,
      recordTimestamp
    )
    .run();
  return { organizationId, routineId };
}

async function insertOrganization(organizationId: string, suffix: string) {
  ownedRoutineOrganizationIds.add(organizationId);
  await env.OPENMELD_DB.prepare(
    "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'Scheduler Org', ?, ?)"
  )
    .bind(organizationId, `scheduler-${suffix}`, Date.now())
    .run();
}

async function seedRoutineReader(organizationId: string) {
  const suffix = crypto.randomUUID();
  const userId = `user_scheduler_${suffix}`;
  const memberId = `member_scheduler_${suffix}`;
  const profileId = crypto.randomUUID();
  const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'Scheduler reader', ?, 1, ?, ?)"
    ).bind(userId, `${userId}@example.com`, nowMs, nowMs),
    env.OPENMELD_DB.prepare(
      "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)"
    ).bind(memberId, organizationId, userId, nowMs),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          created_at, updated_at
        ) VALUES (?, 'Scheduler reader', ?, 'human', 1, 'active', NULL, ?, ?, 'auth_bootstrap', ?, ?)
      `
    ).bind(
      profileId,
      `scheduler-reader-${suffix}`,
      userId,
      userId,
      nowMs,
      nowMs
    ),
  ]);
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
  await env.OPENMELD_DB.prepare(
    `
      INSERT INTO routine_runs (
        id, routine_id, organization_id, scheduled_for, status, started_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      input.id,
      `deleted_routine_${input.id}`,
      input.organizationId,
      input.startedAtMs,
      input.status,
      input.startedAtMs
    )
    .run();
}

async function readRuns(routineId: string) {
  const result = await env.OPENMELD_DB.prepare(
    `
      SELECT id, scheduled_for, status, failure_code, failure_detail
      FROM routine_runs
      WHERE routine_id = ?
      ORDER BY scheduled_for ASC, id ASC
    `
  )
    .bind(routineId)
    .all<{
      failure_code: string | null;
      failure_detail: string | null;
      id: string;
      scheduled_for: number;
      status: string;
    }>();
  return result.results ?? [];
}

async function readRoutine(routineId: string) {
  return await env.OPENMELD_DB.prepare(
    "SELECT next_due_at, status FROM routines WHERE id = ?"
  )
    .bind(routineId)
    .first<{ next_due_at: number | null; status: string }>();
}

async function cleanupOwnedRoutineRows(): Promise<void> {
  const cleanupErrors: Error[] = [];

  for (const organizationId of ownedRoutineOrganizationIds) {
    const cleanupSteps = [
      [
        "native delivery rows",
        env.OPENMELD_DB.prepare(
          'DELETE FROM "openMeldRemoteAgent_native_delivery_ledger" WHERE organization_id = ?'
        ).bind(organizationId),
      ],
      [
        "Routine Run rows",
        env.OPENMELD_DB.prepare(
          "DELETE FROM routine_runs WHERE organization_id = ?"
        ).bind(organizationId),
      ],
      [
        "Routine rows",
        env.OPENMELD_DB.prepare(
          "DELETE FROM routines WHERE organization_id = ?"
        ).bind(organizationId),
      ],
    ] as const;

    for (const [description, statement] of cleanupSteps) {
      try {
        await statement.run();
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
