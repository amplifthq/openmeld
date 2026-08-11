import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  assertRoutineWorkflowConfiguration,
  resolveRoutineExecutionEngine,
  resolveRoutineExecutionEngineSelection,
} from "../src/routines/routine-execution-engine";
import { ROUTINE_WORKFLOW_ERROR_NAMES } from "../src/routines/routine-workflow-contract";
import { ensureRoutineRunWorkflowStarted } from "../src/routines/routine-workflow-coordinator";

describe("Routine execution engine selection", () => {
  it("uses Workflow as the default for every new Run", () => {
    expect(
      resolveRoutineExecutionEngine({
        env: {} as CoreBindings,
        organizationId: "org-default",
      })
    ).toBe("workflow");
  });

  it("lets operators switch every new Run to legacy", () => {
    expect(
      resolveRoutineExecutionEngine({
        env: {
          OPENMELD_ROUTINE_ENGINE_DEFAULT: "legacy",
        } as CoreBindings,
        organizationId: "org-legacy",
      })
    ).toBe("legacy");
  });

  it("lets an organization fall back to legacy without changing the Workflow default", () => {
    const env = {
      OPENMELD_ROUTINE_ENGINE_DEFAULT: "workflow",
      OPENMELD_ROUTINE_LEGACY_ORGANIZATION_IDS:
        "org-other, org-fallback,org-third",
    } as CoreBindings;

    expect(
      resolveRoutineExecutionEngine({ env, organizationId: "org-fallback" })
    ).toBe("legacy");
    expect(
      resolveRoutineExecutionEngine({ env, organizationId: "org-ordinary" })
    ).toBe("workflow");
  });

  it("reports whether the engine came from the default or the legacy override", () => {
    const env = {
      OPENMELD_ROUTINE_LEGACY_ORGANIZATION_IDS: "org-fallback",
    } as CoreBindings;

    expect(
      resolveRoutineExecutionEngineSelection({
        env,
        organizationId: "org-default",
      })
    ).toEqual({ engine: "workflow", source: "default" });
    expect(
      resolveRoutineExecutionEngineSelection({
        env,
        organizationId: "org-fallback",
      })
    ).toEqual({
      engine: "legacy",
      source: "legacy_organization_override",
    });
  });

  it("fails fast on an unknown engine instead of silently falling back", () => {
    expect(() =>
      resolveRoutineExecutionEngine({
        env: {
          OPENMELD_ROUTINE_ENGINE_DEFAULT: "workflows",
        } as CoreBindings,
        organizationId: "org-invalid",
      })
    ).toThrow("OPENMELD_ROUTINE_ENGINE_DEFAULT");
  });

  it("requires a Workflow binding whenever configuration can select the Workflow engine", () => {
    expect(() =>
      assertRoutineWorkflowConfiguration({} as CoreBindings)
    ).toThrow("OPENMELD_ROUTINE_RUN_WORKFLOW");

    expect(() =>
      assertRoutineWorkflowConfiguration({
        OPENMELD_ROUTINE_ENGINE_DEFAULT: "legacy",
      } as CoreBindings)
    ).not.toThrow();
  });

  it("uses the Run id as the stable Workflow instance id", async () => {
    const create = vi.fn(() => Promise.resolve({} as WorkflowInstance));
    const get = vi
      .fn()
      .mockRejectedValueOnce(new Error("instance.not_found"))
      .mockResolvedValue({
        status: async () => ({ status: "running" as const }),
      });
    const workflow = {
      create,
      get,
    } as unknown as Workflow<{ runId: string }>;
    const env = {
      OPENMELD_ROUTINE_RUN_WORKFLOW: workflow,
    } as CoreBindings;

    await ensureRoutineRunWorkflowStarted({ env, runId: "run-stable" });
    await ensureRoutineRunWorkflowStarted({ env, runId: "run-stable" });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-stable",
        params: { runId: "run-stable" },
      })
    );
  });

  it("restarts an errored Workflow instead of crossing back to legacy", async () => {
    const restart = vi.fn(() => Promise.resolve());
    const workflow = {
      get: vi.fn(() =>
        Promise.resolve({
          restart,
          status: () =>
            Promise.resolve({
              error: {
                message: "submission step exhausted its retries",
                name: ROUTINE_WORKFLOW_ERROR_NAMES.submission,
              },
              status: "errored" as const,
            }),
        })
      ),
    } as unknown as Workflow<{ runId: string }>;

    await ensureRoutineRunWorkflowStarted({
      env: { OPENMELD_ROUTINE_RUN_WORKFLOW: workflow } as CoreBindings,
      runId: "run-restart",
    });

    expect(restart).toHaveBeenCalledTimes(1);
  });
});
