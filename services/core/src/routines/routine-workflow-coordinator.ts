import type { CoreBindings } from "../lib/bindings";
import { listPendingRoutineWorkflowRunIds } from "./routine-repository";
import {
  ROUTINE_WORKFLOW_ERROR_NAMES,
  ROUTINE_WORKFLOW_STEPS,
} from "./routine-workflow-contract";
import { emitRoutineWorkflowRuntimeEvidence } from "./routine-workflow-observability";

const ROUTINE_WORKFLOW_RETENTION = {
  errorRetention: "30 days",
  successRetention: "1 day",
} as const satisfies NonNullable<WorkflowInstanceCreateOptions["retention"]>;

export async function ensureRoutineRunWorkflowStarted(input: {
  env: CoreBindings;
  runId: string;
}): Promise<void> {
  const workflow = input.env.OPENMELD_ROUTINE_RUN_WORKFLOW;
  if (!workflow) {
    throw new Error("Routine Run Workflow binding is unavailable");
  }
  let existing: WorkflowInstance;
  try {
    existing = await workflow.get(input.runId);
  } catch (initialGetError) {
    try {
      await workflow.create({
        id: input.runId,
        params: { runId: input.runId },
        retention: ROUTINE_WORKFLOW_RETENTION,
      });
      emitRoutineWorkflowRuntimeEvidence(input.env, {
        event: "instance_created",
        reasonCode: "workflow.created",
        runId: input.runId,
        status: "succeeded",
      });
      return;
    } catch (createError) {
      try {
        existing = await workflow.get(input.runId);
      } catch (racedGetError) {
        const error = new AggregateError(
          [initialGetError, createError, racedGetError],
          `Routine Run Workflow ${input.runId} could not be found or created`
        );
        emitRoutineWorkflowRuntimeEvidence(input.env, {
          errorName: error.name,
          event: "instance_creation_failed",
          reasonCode: "workflow.create_failed",
          runId: input.runId,
          status: "failed",
        });
        throw error;
      }
    }
  }
  let existingStatus: InstanceStatus;
  try {
    existingStatus = await existing.status();
  } catch (error) {
    emitRoutineWorkflowRuntimeEvidence(input.env, {
      errorName: toErrorName(error),
      event: "instance_recovery_blocked",
      reasonCode: "workflow.status_read_failed",
      runId: input.runId,
      status: "failed",
    });
    throw error;
  }
  if (existingStatus.status === "errored") {
    const restart = resolveRoutineWorkflowRestart(existingStatus.error?.name);
    if (!restart) {
      emitRoutineWorkflowRuntimeEvidence(input.env, {
        errorName: existingStatus.error?.name ?? null,
        event: "instance_recovery_blocked",
        reasonCode: "workflow.error_phase_unknown",
        runId: input.runId,
        status: "failed",
      });
      throw new Error(
        `Routine Run Workflow ${input.runId} cannot be safely restarted from error ${existingStatus.error?.name ?? "unknown"}`
      );
    }
    try {
      await existing.restart(restart.options);
    } catch (error) {
      emitRoutineWorkflowRuntimeEvidence(input.env, {
        errorName: toErrorName(error),
        event: "instance_recovery_blocked",
        reasonCode: "workflow.restart_failed",
        runId: input.runId,
        status: "failed",
      });
      throw error;
    }
    emitRoutineWorkflowRuntimeEvidence(input.env, {
      event: "instance_restarted",
      reasonCode: `workflow.restarted.${existingStatus.error?.name ?? "unknown"}`,
      runId: input.runId,
      status: "succeeded",
    });
    return;
  }
  if (existingStatus.status === "terminated") {
    emitRoutineWorkflowRuntimeEvidence(input.env, {
      event: "instance_recovery_blocked",
      reasonCode: "workflow.terminated",
      runId: input.runId,
      status: "failed",
    });
    throw new Error(
      `Routine Run Workflow ${input.runId} was explicitly terminated and requires operator recovery`
    );
  }
  if (existingStatus.status === "complete") {
    emitRoutineWorkflowRuntimeEvidence(input.env, {
      event: "instance_recovery_blocked",
      reasonCode: "workflow.complete_run_nonterminal",
      runId: input.runId,
      status: "failed",
    });
    throw new Error(
      `Routine Run Workflow ${input.runId} completed before its D1 Run became terminal`
    );
  }
  if (existingStatus.status === "unknown") {
    emitRoutineWorkflowRuntimeEvidence(input.env, {
      event: "instance_recovery_blocked",
      reasonCode: "workflow.status_unknown",
      runId: input.runId,
      status: "failed",
    });
    throw new Error(
      `Routine Run Workflow ${input.runId} returned an unknown status`
    );
  }
}

function resolveRoutineWorkflowRestart(
  errorName: string | undefined
): { options?: WorkflowInstanceRestartOptions } | null {
  switch (errorName) {
    case ROUTINE_WORKFLOW_ERROR_NAMES.submission:
      return {};
    case ROUTINE_WORKFLOW_ERROR_NAMES.callbackFinalization:
      return {
        options: restartFromStep(ROUTINE_WORKFLOW_STEPS.finalizeCallback),
      };
    case ROUTINE_WORKFLOW_ERROR_NAMES.continuationCallbackFinalization:
      return {
        options: restartFromStep(
          ROUTINE_WORKFLOW_STEPS.finalizeContinuationCallback
        ),
      };
    case ROUTINE_WORKFLOW_ERROR_NAMES.continuationFailureFinalization:
      return {
        options: restartFromStep(
          ROUTINE_WORKFLOW_STEPS.finalizeContinuationFailure
        ),
      };
    default:
      return null;
  }
}

function restartFromStep(name: string): WorkflowInstanceRestartOptions {
  return { from: { name, type: "do" } };
}

export async function retryPendingRoutineRunWorkflowStarts(input: {
  db: D1Database;
  env: CoreBindings;
  limit?: number;
}): Promise<{ errors: number; scanned: number; started: number }> {
  const runIds = await listPendingRoutineWorkflowRunIds({
    db: input.db,
    limit: input.limit ?? 50,
  });
  const summary = { errors: 0, scanned: runIds.length, started: 0 };
  for (const runId of runIds) {
    try {
      await ensureRoutineRunWorkflowStarted({ env: input.env, runId });
      summary.started += 1;
    } catch (error) {
      summary.errors += 1;
      console.warn("[core.routine.workflow.start_retry_failed]", {
        error: toErrorMessage(error),
        runId,
      });
    }
  }
  console.info("[core.routine.workflow.start_retry_completed]", summary);
  return summary;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toErrorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
