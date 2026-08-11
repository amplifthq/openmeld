import type { AdapterRuntimeEvent } from "@openmeld/adapter-core";
import {
  createInflightTaskControlRegistry,
  syncRuntimeEventToInflightTaskControlRegistry,
} from "@openmeld/local-service";
import { describe, expect, it } from "vitest";

describe("syncRuntimeEventToInflightTaskControlRegistry", () => {
  it("hydrates the inflight process id from later runtime events", () => {
    const registry = createInflightTaskControlRegistry();
    registry.registerTask({
      adapterId: "codex",
      dispatchId: "dispatch-1",
      taskId: "task-1",
    });

    const firstStdoutEvent: AdapterRuntimeEvent = {
      phase: "first_stdout",
      processId: 43_210,
      tsMs: 1_775_000_000_000,
    };

    syncRuntimeEventToInflightTaskControlRegistry({
      event: firstStdoutEvent,
      registry,
      taskId: "task-1",
    });

    expect(registry.getTask("task-1")).toMatchObject({
      processId: 43_210,
    });
  });

  it("clears the inflight process id when the runtime exits", () => {
    const registry = createInflightTaskControlRegistry();
    registry.registerTask({
      adapterId: "claude-code",
      dispatchId: "dispatch-2",
      taskId: "task-2",
    });
    registry.updateTaskProcess({
      processId: 99_887,
      taskId: "task-2",
    });

    const exitEvent: AdapterRuntimeEvent = {
      exitCode: 0,
      phase: "process_exit",
      processId: 99_887,
      signal: null,
      signalTarget: "process_group",
      tsMs: 1_775_000_000_100,
    };

    syncRuntimeEventToInflightTaskControlRegistry({
      event: exitEvent,
      registry,
      taskId: "task-2",
    });

    expect(registry.getTask("task-2")).toMatchObject({
      processId: null,
    });
  });

  it("ignores non-exit runtime events that still lack a valid process id", () => {
    const registry = createInflightTaskControlRegistry();
    registry.registerTask({
      adapterId: "openclaw",
      dispatchId: "dispatch-3",
      taskId: "task-3",
    });

    const stderrEvent: AdapterRuntimeEvent = {
      phase: "first_stderr",
      processId: null,
      tsMs: 1_775_000_000_200,
    };

    syncRuntimeEventToInflightTaskControlRegistry({
      event: stderrEvent,
      registry,
      taskId: "task-3",
    });

    expect(registry.getTask("task-3")).toMatchObject({
      processId: null,
    });
  });
});
