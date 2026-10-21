import { introspectWorkflowInstance } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { resolveRoutineWorkflowErrorName } from "../src/routines/routine-workflow-contract";
import { ensureRoutineRunWorkflowStarted } from "../src/routines/routine-workflow-coordinator";
import { env } from "../test-support/worker-env";

const CALLBACK = {
  agentProfileId: "agt_00000000-0000-4000-8000-000000000001",
  bindingId: "binding-workflow",
  dispatchId: "run-workflow",
  idempotencyKey: "run-workflow",
  organizationId: "org-workflow",
  spaceId: "space-workflow",
  status: "completed" as const,
  submissionId: "submission-workflow",
  text: "Workflow reply",
  triggerMessageId: "run-workflow",
};

describe("Routine Run Workflow", () => {
  it("recognizes an exhausted real submission step for coordinator recovery", async () => {
    const runId = `routine_run_workflow_${crypto.randomUUID()}`;
    const workflow = requireWorkflowBinding();
    await using instance = await introspectWorkflowInstance(workflow, runId);
    const handle = await workflow.create({ id: runId, params: { runId } });
    await instance.waitForStatus("errored");
    const error = await instance.getError();
    expect(resolveRoutineWorkflowErrorName(error)).toBe(
      "RoutineWorkflowSubmissionError"
    );
    // The installed Workers test binding does not implement restart. Retain
    // the real serialized status and replace only that unavailable API call.
    const restart = vi.fn().mockResolvedValue(undefined);
    await ensureRoutineRunWorkflowStarted({
      env: {
        OPENMELD_ROUTINE_RUN_WORKFLOW: {
          get: async () => ({ status: () => handle.status(), restart }),
        },
      } as unknown as CoreBindings,
      runId,
    });
    expect(restart).toHaveBeenCalledExactlyOnceWith(undefined);
  }, 40_000);
  it.each([
    ["wait for Remote Agent callback", "remote-agent-initial-callback"],
    [
      "wait for Center Agent continuation callback",
      "remote-agent-continuation-callback",
    ],
  ])("renews %s after timeout and accepts the eventual callback", async (stepName, eventType) => {
    const runId = `routine_run_workflow_${crypto.randomUUID()}`;
    const workflow = requireWorkflowBinding();
    await using instance = await introspectWorkflowInstance(workflow, runId);
    await instance.modify(async (modifier) => {
      await modifier.mockStepResult(
        { name: "ensure Remote Agent submission" },
        waitingSubmission(runId)
      );
      if (stepName === "wait for Center Agent continuation callback") {
        await modifier.mockEvent({
          payload: { ...CALLBACK, dispatchId: runId, idempotencyKey: runId },
          type: "remote-agent-initial-callback",
        });
        await modifier.mockStepResult(
          { name: "finalize Remote Agent callback" },
          { finalized: true, terminal: false }
        );
      }
      await modifier.forceEventTimeout({ name: stepName });
      await modifier.mockStepResult(
        {
          name:
            eventType === "remote-agent-initial-callback"
              ? "finalize Remote Agent callback"
              : "finalize Center Agent continuation callback",
        },
        { finalized: true, terminal: true }
      );
    });
    const handle = await workflow.create({ id: runId, params: { runId } });
    await handle.sendEvent({
      type: eventType,
      payload:
        eventType === "remote-agent-initial-callback"
          ? { ...CALLBACK, dispatchId: runId, idempotencyKey: runId }
          : {
              kind: "callback",
              callback: {
                ...CALLBACK,
                dispatchId: runId,
                idempotencyKey: runId,
              },
            },
    });
    await instance.waitForStatus("complete");
    await expect(instance.getOutput()).resolves.toEqual({
      status: "completed",
    });
  });
  it("creates a missing Workflow instance through the production coordinator", async () => {
    const runId = `routine_run_workflow_${crypto.randomUUID()}`;
    const workflow = requireWorkflowBinding();
    await using instance = await introspectWorkflowInstance(workflow, runId);
    await instance.modify(async (modifier) => {
      await modifier.mockStepResult(
        { name: "ensure Remote Agent submission" },
        { status: "terminal" }
      );
    });

    await ensureRoutineRunWorkflowStarted({
      env: env as unknown as CoreBindings,
      runId,
    });
    await instance.waitForStatus("complete");

    await expect(instance.getOutput()).resolves.toEqual({
      status: "terminal",
    });
  });

  it("completes as blocked without waiting when target recovery needs an operator", async () => {
    const runId = `routine_run_workflow_${crypto.randomUUID()}`;
    const workflow = requireWorkflowBinding();
    await using instance = await introspectWorkflowInstance(workflow, runId);
    await instance.modify(async (modifier) => {
      await modifier.mockStepResult(
        { name: "ensure Remote Agent submission" },
        {
          reasonCode: "remote_agent.routine_target_recovery_blocked",
          status: "blocked",
        }
      );
    });

    await workflow.create({ id: runId, params: { runId } });
    await instance.waitForStatus("complete");

    await expect(instance.getOutput()).resolves.toEqual({
      reasonCode: "remote_agent.routine_target_recovery_blocked",
      status: "blocked",
    });
  });

  it("buffers an early callback event and completes the Run workflow", async () => {
    const runId = `routine_run_workflow_${crypto.randomUUID()}`;
    const workflow = requireWorkflowBinding();
    await using instance = await introspectWorkflowInstance(workflow, runId);
    await instance.modify(async (modifier) => {
      await modifier.mockStepResult(
        { name: "ensure Remote Agent submission" },
        waitingSubmission(runId)
      );
      await modifier.mockEvent({
        payload: { ...CALLBACK, dispatchId: runId, idempotencyKey: runId },
        type: "remote-agent-initial-callback",
      });
      await modifier.mockStepResult(
        { name: "finalize Remote Agent callback" },
        { finalized: true, terminal: true }
      );
    });

    await workflow.create({ id: runId, params: { runId } });
    await instance.waitForStatus("complete");

    await expect(instance.getOutput()).resolves.toEqual({
      status: "completed",
    });
  });

  it("retries a transient Remote Agent submission step before waiting", async () => {
    const runId = `routine_run_workflow_${crypto.randomUUID()}`;
    const workflow = requireWorkflowBinding();
    await using instance = await introspectWorkflowInstance(workflow, runId);
    await instance.modify(async (modifier) => {
      await modifier.mockStepError(
        { name: "ensure Remote Agent submission" },
        new Error("temporary service-binding failure"),
        2
      );
      await modifier.mockStepResult(
        { name: "ensure Remote Agent submission" },
        waitingSubmission(runId)
      );
      await modifier.mockEvent({
        payload: { ...CALLBACK, dispatchId: runId, idempotencyKey: runId },
        type: "remote-agent-initial-callback",
      });
      await modifier.mockStepResult(
        { name: "finalize Remote Agent callback" },
        { finalized: true, terminal: true }
      );
    });

    await workflow.create({ id: runId, params: { runId } });
    await instance.waitForStatus("complete");

    await expect(instance.getOutput()).resolves.toEqual({
      status: "completed",
    });
  });

  it("waits for one Center Agent continuation before completing", async () => {
    const runId = `routine_run_workflow_${crypto.randomUUID()}`;
    const workflow = requireWorkflowBinding();
    await using instance = await introspectWorkflowInstance(workflow, runId);
    await instance.modify(async (modifier) => {
      await modifier.mockStepResult(
        { name: "ensure Remote Agent submission" },
        waitingSubmission(runId)
      );
      await modifier.mockEvent({
        payload: { ...CALLBACK, dispatchId: runId, idempotencyKey: runId },
        type: "remote-agent-initial-callback",
      });
      await modifier.mockStepResult(
        { name: "finalize Remote Agent callback" },
        { finalized: true, terminal: false }
      );
      await modifier.mockEvent({
        payload: { ...CALLBACK, dispatchId: runId, idempotencyKey: runId },
        type: "remote-agent-initial-callback",
      });
      await modifier.mockEvent({
        payload: {
          callback: {
            ...CALLBACK,
            dispatchId: `${runId}:continuation`,
            idempotencyKey: `${runId}:continuation`,
            submissionId: "submission-workflow-continuation",
          },
          kind: "callback",
        },
        type: "remote-agent-continuation-callback",
      });
      await modifier.mockStepResult(
        { name: "finalize Center Agent continuation callback" },
        { finalized: true, terminal: true }
      );
    });

    await workflow.create({ id: runId, params: { runId } });
    await instance.waitForStatus("complete");

    await expect(instance.getOutput()).resolves.toEqual({
      status: "completed",
    });
  });

  it("stops waiting when continuation admission fails", async () => {
    const runId = `routine_run_workflow_${crypto.randomUUID()}`;
    const workflow = requireWorkflowBinding();
    await using instance = await introspectWorkflowInstance(workflow, runId);
    await instance.modify(async (modifier) => {
      await modifier.mockStepResult(
        { name: "ensure Remote Agent submission" },
        waitingSubmission(runId)
      );
      await modifier.mockEvent({
        payload: { ...CALLBACK, dispatchId: runId, idempotencyKey: runId },
        type: "remote-agent-initial-callback",
      });
      await modifier.mockStepResult(
        { name: "finalize Remote Agent callback" },
        { finalized: true, terminal: false }
      );
      await modifier.mockEvent({
        payload: {
          failureCode: "remote_agent.routine_identity_mismatch",
          kind: "terminal_failure",
        },
        type: "remote-agent-continuation-callback",
      });
      await modifier.mockStepResult(
        { name: "finalize Center Agent continuation failure" },
        { finalized: true, terminal: true }
      );
    });

    await workflow.create({ id: runId, params: { runId } });
    await instance.waitForStatus("complete");

    await expect(instance.getOutput()).resolves.toEqual({
      reasonCode: "remote_agent.routine_identity_mismatch",
      status: "terminal",
    });
  });
});

function requireWorkflowBinding(): Workflow<{ runId: string }> {
  const workflow = (env as unknown as CoreBindings)
    .OPENMELD_ROUTINE_RUN_WORKFLOW;
  if (!workflow) {
    throw new Error("Routine Workflow test binding is unavailable");
  }
  return workflow;
}

function waitingSubmission(
  runId: string,
  submissionId = "submission-workflow"
) {
  return {
    dispatchId: runId,
    idempotencyKey: runId,
    organizationId: "org-workflow",
    spaceId: "space-workflow",
    status: "waiting" as const,
    submissionId,
  };
}
