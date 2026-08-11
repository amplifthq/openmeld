import type { CenterAgentRoutineRun } from "@openmeld/schemas/types";
import type { RoutineExecutionEngine } from "./routine-execution-engine";
import {
  claimRoutineOccurrenceAndAdvance,
  type DueRoutine,
  failStaleClaimedRoutineRuns,
  listDueRoutineRecords,
  markClaimedRoutineRunFailed,
  quarantineInvalidRoutineSchedule,
} from "./routine-repository";
import { loadRoutineSchedule } from "./routine-schedule-runtime";

export const ROUTINE_SCHEDULER_BATCH_SIZE = 250;
export const ROUTINE_CLAIM_WATCHDOG_TIMEOUT_MS = 4 * 60 * 1000;
export const ROUTINE_CATCH_UP_MAX_WINDOW_MS = 60 * 60 * 1000;

type RoutineDeliverySubmitter = (input: {
  db: D1Database;
  executionEngine: RoutineExecutionEngine;
  nowMs: number;
  routine: DueRoutine;
  run: CenterAgentRoutineRun;
}) => Promise<{ status: "failed" | "pending" | "skipped" | "submitted" }>;

export type RoutineSchedulerTickSummary = {
  claimed: number;
  errors: number;
  failed: number;
  lostRace: number;
  pending: number;
  scanned: number;
  skipped: number;
  submitted: number;
  watchdogFailed: number;
};

export async function runRoutineSchedulerTick(input: {
  db: D1Database;
  generateRunId?: () => string;
  limit?: number;
  nowMs: number;
  resolveExecutionEngine?: (routine: DueRoutine) => RoutineExecutionEngine;
  submitRoutineDelivery: RoutineDeliverySubmitter;
}): Promise<RoutineSchedulerTickSummary> {
  const limit = input.limit ?? ROUTINE_SCHEDULER_BATCH_SIZE;
  const summary: RoutineSchedulerTickSummary = {
    claimed: 0,
    errors: 0,
    failed: 0,
    lostRace: 0,
    pending: 0,
    scanned: 0,
    skipped: 0,
    submitted: 0,
    watchdogFailed: await failStaleClaimedRoutineRuns({
      cutoffMs: input.nowMs - ROUTINE_CLAIM_WATCHDOG_TIMEOUT_MS,
      db: input.db,
      limit,
      nowMs: input.nowMs,
    }),
  };
  const routines = await listDueRoutineRecords({
    db: input.db,
    limit,
    nowMs: input.nowMs,
  });
  summary.scanned = routines.length;
  const generateRunId =
    input.generateRunId ?? (() => `routine_run_${crypto.randomUUID()}`);

  for (const routine of routines) {
    try {
      await processDueRoutine({
        db: input.db,
        generateRunId,
        nowMs: input.nowMs,
        resolveExecutionEngine:
          input.resolveExecutionEngine ?? (() => "legacy"),
        routine,
        submitRoutineDelivery: input.submitRoutineDelivery,
        summary,
      });
    } catch (error) {
      summary.errors += 1;
      console.error("[core.routine.scheduler.item_failed]", {
        error: toErrorMessage(error),
        nextDueAt: routine.nextDueAt,
        organizationId: routine.organizationId,
        routineId: routine.id,
      });
    }
  }

  console.info("[core.routine.scheduler.tick_completed]", summary);
  return summary;
}

async function processDueRoutine(input: {
  db: D1Database;
  generateRunId: () => string;
  nowMs: number;
  resolveExecutionEngine: (routine: DueRoutine) => RoutineExecutionEngine;
  routine: DueRoutine;
  submitRoutineDelivery: RoutineDeliverySubmitter;
  summary: RoutineSchedulerTickSummary;
}): Promise<void> {
  let plan: Awaited<ReturnType<typeof buildRoutineOccurrencePlan>>;
  const routineSchedule = await loadRoutineSchedule();
  try {
    plan = buildRoutineOccurrencePlan(
      input.routine,
      input.nowMs,
      routineSchedule.getStoredRoutineOccurrenceWindow
    );
  } catch (error) {
    if (!(error instanceof routineSchedule.RoutineScheduleValidationError)) {
      throw error;
    }
    const quarantine = await quarantineInvalidRoutineSchedule({
      db: input.db,
      failureDetail: error.message,
      nowMs: input.nowMs,
      organizationId: input.routine.organizationId,
      routineId: input.routine.id,
      runId: input.generateRunId(),
      scheduledFor: input.routine.nextDueAt,
    });
    if (quarantine.status === "lost_race") {
      input.summary.lostRace += 1;
      return;
    }
    input.summary.skipped += 1;
    console.error("[core.routine.scheduler.schedule_quarantined]", {
      error: error.message,
      nextDueAt: input.routine.nextDueAt,
      organizationId: input.routine.organizationId,
      routineId: input.routine.id,
      runId: quarantine.run.id,
    });
    return;
  }
  if (plan.skipped) {
    console.info("[core.routine.scheduler.overdue_fast_forwarded]", {
      calendarMonthsEvaluated: plan.skipped.calendarMonthsEvaluated,
      firstSkippedAt: new Date(plan.skipped.first).toISOString(),
      lastSkippedAt: new Date(plan.skipped.last).toISOString(),
      organizationId: input.routine.organizationId,
      routineId: input.routine.id,
      skippedCount: plan.skipped.count,
      timezoneTransitionsEvaluated: plan.skipped.timezoneTransitionsEvaluated,
    });
    const skippedClaim = await claimRoutineOccurrenceAndAdvance({
      db: input.db,
      failureCode: "routine.occurrences_overdue",
      failureDetail: buildOverdueFailureDetail(plan.skipped),
      finishedAtMs: input.nowMs,
      nextDueAt: plan.skipped.advanceTo,
      nowMs: input.nowMs,
      organizationId: input.routine.organizationId,
      routineId: input.routine.id,
      runId: input.generateRunId(),
      scheduledFor: plan.skipped.first,
      status: "skipped",
    });
    if (skippedClaim.status === "lost_race") {
      input.summary.lostRace += 1;
      return;
    }
    input.summary.skipped += 1;
  }

  if (!plan.catchUp) {
    return;
  }
  const runId = input.generateRunId();
  const executionEngine = input.resolveExecutionEngine(input.routine);
  const claim = await claimRoutineOccurrenceAndAdvance({
    db: input.db,
    executionEngine,
    nextDueAt: plan.catchUp.nextDueAt,
    nowMs: input.nowMs,
    organizationId: input.routine.organizationId,
    routineId: input.routine.id,
    runId,
    scheduledFor: plan.catchUp.scheduledFor,
    status: "claimed",
  });
  if (claim.status === "lost_race") {
    input.summary.lostRace += 1;
    return;
  }
  input.summary.claimed += 1;
  try {
    const delivery = await input.submitRoutineDelivery({
      db: input.db,
      executionEngine,
      nowMs: input.nowMs,
      routine: input.routine,
      run: claim.run,
    });
    if (delivery.status === "submitted") {
      input.summary.submitted += 1;
    } else if (delivery.status === "pending") {
      input.summary.pending += 1;
    } else if (delivery.status === "skipped") {
      input.summary.skipped += 1;
    } else {
      input.summary.failed += 1;
    }
  } catch (error) {
    if (executionEngine === "workflow") {
      input.summary.errors += 1;
      input.summary.pending += 1;
      console.warn("[core.routine.scheduler.workflow_start_pending]", {
        error: toErrorMessage(error),
        organizationId: input.routine.organizationId,
        routineId: input.routine.id,
        runId,
      });
      return;
    }
    await markClaimedRoutineRunFailed({
      db: input.db,
      failureCode: "routine.native_delivery_submission_failed",
      failureDetail: toErrorMessage(error),
      nowMs: input.nowMs,
      runId,
    });
    throw error;
  }
}

function buildRoutineOccurrencePlan(
  routine: DueRoutine,
  nowMs: number,
  getStoredRoutineOccurrenceWindow: (
    input: Parameters<
      typeof import("@openmeld/routine-schedule").getStoredRoutineOccurrenceWindow
    >[0]
  ) => ReturnType<
    typeof import("@openmeld/routine-schedule").getStoredRoutineOccurrenceWindow
  >
): {
  catchUp: { nextDueAt: number | null; scheduledFor: number } | null;
  skipped: {
    advanceTo: number;
    calendarMonthsEvaluated: number;
    count: number;
    first: number;
    last: number;
    timezoneTransitionsEvaluated: number;
  } | null;
} {
  if (routine.scheduleKind === "once") {
    if (routine.runAtMs === null || routine.nextDueAt !== routine.runAtMs) {
      throw new Error(`One-time Routine ${routine.id} has invalid due state`);
    }
    return {
      catchUp: { nextDueAt: null, scheduledFor: routine.runAtMs },
      skipped: null,
    };
  }
  if (!(routine.cronExpression && routine.timezone)) {
    throw new Error(`Recurring Routine ${routine.id} has invalid schedule`);
  }
  const window = getStoredRoutineOccurrenceWindow({
    cronExpression: routine.cronExpression,
    from: routine.nextDueAt,
    through: nowMs,
    timezone: routine.timezone,
  });
  const latestDueAt = window.latestDueAt.getTime();
  const nextDueAt = window.nextDueAt.getTime();
  const catchUpWindowMs = Math.min(
    ROUTINE_CATCH_UP_MAX_WINDOW_MS,
    nextDueAt - latestDueAt
  );
  const shouldCatchUp = nowMs - latestDueAt < catchUpWindowMs;
  const skippedCount = shouldCatchUp ? window.dueCount - 1 : window.dueCount;
  let lastSkipped: number | null = null;
  if (skippedCount > 0) {
    lastSkipped = shouldCatchUp
      ? (window.previousDueAt?.getTime() ?? null)
      : latestDueAt;
  }
  const skipped =
    lastSkipped === null
      ? null
      : {
          advanceTo: shouldCatchUp ? latestDueAt : nextDueAt,
          calendarMonthsEvaluated: window.calendarMonthsEvaluated,
          count: skippedCount,
          first: routine.nextDueAt,
          last: lastSkipped,
          timezoneTransitionsEvaluated: window.timezoneTransitionsEvaluated,
        };
  return {
    catchUp: shouldCatchUp ? { nextDueAt, scheduledFor: latestDueAt } : null,
    skipped,
  };
}

function buildOverdueFailureDetail(input: {
  count: number;
  first: number;
  last: number;
}): string {
  const occurrenceLabel = input.count === 1 ? "occurrence" : "occurrences";
  return `Skipped ${input.count} ${occurrenceLabel} from ${new Date(input.first).toISOString()} to ${new Date(input.last).toISOString()} because this Routine was overdue beyond its catch-up window.`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
