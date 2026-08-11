import { describe, expect, it, vi } from "vitest";
import { buildHealthView, emitHealthFinding } from "../src";

describe("agent-runtime health view helpers", () => {
  it("builds a stable health view from a finding", () => {
    expect(
      buildHealthView({
        finding: {
          reasonCode: "runtime.replay_stuck",
          severity: "warn",
          summaryKey: "runtime.replay_stuck",
          humanContext: {
            taskId: "task-1",
          },
        },
      })
    ).toEqual({
      finding: {
        reasonCode: "runtime.replay_stuck",
        severity: "warn",
        summaryKey: "runtime.replay_stuck",
      },
      human: {
        taskId: "task-1",
      },
    });
  });

  it("emits through the provided sink and strips undefined extra fields", () => {
    const warn = vi.fn();

    emitHealthFinding({
      eventName: "[runtime.openMeldDaemon.health.replay_stuck]",
      fields: {
        oldestReplayAgeMs: 30_000,
        omitted: undefined,
      },
      finding: {
        reasonCode: "runtime.replay_stuck",
        severity: "warn",
        summaryKey: "runtime.replay_stuck",
        humanContext: {
          taskId: "task-1",
        },
      },
      logSink: {
        warn,
      },
    });

    expect(warn).toHaveBeenCalledWith(
      "[runtime.openMeldDaemon.health.replay_stuck]",
      {
        finding: {
          reasonCode: "runtime.replay_stuck",
          severity: "warn",
          summaryKey: "runtime.replay_stuck",
        },
        human: {
          taskId: "task-1",
        },
        oldestReplayAgeMs: 30_000,
      }
    );
  });
});
