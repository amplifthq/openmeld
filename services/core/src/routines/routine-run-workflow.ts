import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  remoteAgentCoreCallbackBodySchema,
  routineWorkflowContinuationEventPayloadSchema,
} from "@openmeld/schemas";
import type {
  RemoteAgentCoreCallbackBody,
  RoutineWorkflowContinuationEventPayload,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { localStateDb } from "../lib/bindings";
import {
  completeRemoteAgentNativeDelivery,
  ensureRemoteAgentRoutineWorkflowSubmission,
  finalizeRemoteAgentRoutineContinuationFailure,
} from "../remote-agent/application/native-delivery-service";
import { readRoutineRunExecutionRecord } from "./routine-repository";
import {
  ROUTINE_WORKFLOW_CALLBACK_EVENTS,
  ROUTINE_WORKFLOW_ERROR_NAMES,
  ROUTINE_WORKFLOW_STEPS,
} from "./routine-workflow-contract";
import { emitRoutineWorkflowRuntimeEvidence } from "./routine-workflow-observability";

const ROUTINE_WORKFLOW_RETRY = {
  retries: { backoff: "exponential", delay: "1 second", limit: 5 },
  timeout: "1 minute",
} as const;

type RoutineRunWorkflowParams = { runId: string };

export class RoutineRunWorkflow extends WorkflowEntrypoint<
  CoreBindings,
  RoutineRunWorkflowParams
> {
  async run(
    event: Readonly<WorkflowEvent<RoutineRunWorkflowParams>>,
    step: WorkflowStep
  ): Promise<{
    reasonCode?: string;
    status: "blocked" | "completed" | "terminal";
  }> {
    const runId = parseRoutineRunWorkflowParams(event.payload).runId;
    const submission = await step.do(
      ROUTINE_WORKFLOW_STEPS.ensureSubmission,
      ROUTINE_WORKFLOW_RETRY,
      async () =>
        await runRoutineWorkflowOperation({
          errorMessage: "Routine Workflow submission failed",
          errorName: ROUTINE_WORKFLOW_ERROR_NAMES.submission,
          operation: async () => {
            const db = requireRoutineWorkflowDb(this.env);
            return await ensureRemoteAgentRoutineWorkflowSubmission({
              db,
              env: this.env,
              nowMs: Date.now(),
              runId,
            });
          },
        })
    );
    if (submission.status === "terminal") {
      return { status: "terminal" };
    }
    if (submission.status === "blocked") {
      emitRoutineWorkflowRuntimeEvidence(this.env, {
        event: "instance_recovery_blocked",
        reasonCode: submission.reasonCode,
        runId,
        status: "failed",
      });
      return {
        reasonCode: submission.reasonCode,
        status: "blocked",
      };
    }
    const callbackEvent = await step.waitForEvent<RemoteAgentCoreCallbackBody>(
      ROUTINE_WORKFLOW_STEPS.waitForCallback,
      { type: ROUTINE_WORKFLOW_CALLBACK_EVENTS.initial }
    );
    const callback = remoteAgentCoreCallbackBodySchema.parse(
      callbackEvent.payload
    );

    const firstFinalization = await step.do(
      ROUTINE_WORKFLOW_STEPS.finalizeCallback,
      ROUTINE_WORKFLOW_RETRY,
      async () => {
        return await runRoutineWorkflowOperation({
          errorMessage: "Routine Workflow callback finalization failed",
          errorName: ROUTINE_WORKFLOW_ERROR_NAMES.callbackFinalization,
          operation: async () =>
            await finalizeRoutineWorkflowCallback({
              callback,
              env: this.env,
              runId,
            }),
        });
      }
    );
    if (firstFinalization.terminal) {
      return { status: "completed" };
    }
    const continuationEvent =
      await step.waitForEvent<RoutineWorkflowContinuationEventPayload>(
        ROUTINE_WORKFLOW_STEPS.waitForContinuationCallback,
        { type: ROUTINE_WORKFLOW_CALLBACK_EVENTS.continuation }
      );
    const continuation = routineWorkflowContinuationEventPayloadSchema.parse(
      continuationEvent.payload
    );
    if (continuation.kind === "terminal_failure") {
      await step.do(
        ROUTINE_WORKFLOW_STEPS.finalizeContinuationFailure,
        ROUTINE_WORKFLOW_RETRY,
        async () =>
          await runRoutineWorkflowOperation({
            errorMessage:
              "Routine Workflow continuation failure finalization failed",
            errorName:
              ROUTINE_WORKFLOW_ERROR_NAMES.continuationFailureFinalization,
            operation: async () =>
              await finalizeRemoteAgentRoutineContinuationFailure({
                db: requireRoutineWorkflowDb(this.env),
                env: this.env,
                failureCode: continuation.failureCode,
                nowMs: Date.now(),
                runId,
              }),
          })
      );
      return {
        reasonCode: continuation.failureCode,
        status: "terminal",
      };
    }
    await step.do(
      ROUTINE_WORKFLOW_STEPS.finalizeContinuationCallback,
      ROUTINE_WORKFLOW_RETRY,
      async () =>
        await runRoutineWorkflowOperation({
          errorMessage:
            "Routine Workflow continuation callback finalization failed",
          errorName:
            ROUTINE_WORKFLOW_ERROR_NAMES.continuationCallbackFinalization,
          operation: async () => {
            const finalization = await finalizeRoutineWorkflowCallback({
              callback: continuation.callback,
              env: this.env,
              runId,
            });
            if (!finalization.terminal) {
              throw new Error(
                `Routine Workflow ${runId} exhausted its single Center Agent continuation without a terminal Run`
              );
            }
            return finalization;
          },
        })
    );
    return { status: "completed" };
  }
}

async function finalizeRoutineWorkflowCallback(input: {
  callback: RemoteAgentCoreCallbackBody;
  env: CoreBindings;
  runId: string;
}): Promise<{ finalized: true; terminal: boolean }> {
  const result = await completeRemoteAgentNativeDelivery(
    input.env,
    input.callback,
    { bypassRoutineWorkflowRouting: true }
  );
  if (result.status !== "accepted" && result.status !== "duplicate_rejected") {
    throw new Error(
      `Routine Workflow callback finalization returned ${result.status}: ${result.reasonCode ?? "unknown"}`
    );
  }
  const run = await readRoutineRunExecutionRecord({
    db: requireRoutineWorkflowDb(input.env),
    runId: input.runId,
  });
  return {
    finalized: true,
    terminal: run?.status === "completed" || run?.status === "failed",
  };
}

function parseRoutineRunWorkflowParams(
  value: Readonly<RoutineRunWorkflowParams>
): RoutineRunWorkflowParams {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length !== 1 ||
    typeof value.runId !== "string" ||
    value.runId.length === 0
  ) {
    throw new Error("Routine Run Workflow received invalid parameters");
  }
  return { runId: value.runId };
}

function requireRoutineWorkflowDb(env: CoreBindings): D1Database {
  const db = localStateDb(env);
  if (!db) {
    throw new Error("Routine Run Workflow database is unavailable");
  }
  return db;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runRoutineWorkflowOperation<T>(input: {
  errorMessage: string;
  errorName: string;
  operation: () => Promise<T> | T;
}): Promise<T> {
  try {
    return await input.operation();
  } catch (cause) {
    const error = new Error(`${input.errorMessage}: ${toErrorMessage(cause)}`, {
      cause,
    });
    error.name = input.errorName;
    throw error;
  }
}
