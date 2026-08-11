import { describe, expect, it } from "vitest";
import {
  createEmptyLedgerState,
  upsertInflightTask,
} from "../src/ledger-store";
import {
  markRecoveryReplayCommitted,
  planRecoveryReplay,
  settleRecoveredTask,
} from "../src/recovery-policy";

const FIRST_SEEN_AT_MS = Date.UTC(2026, 1, 25, 10, 0, 0);

describe("ledger-recovery recovery replay once", () => {
  it("replays each inflight task once and keeps same-binding FIFO order", () => {
    const withTask2 = upsertInflightTask({
      state: createEmptyLedgerState(FIRST_SEEN_AT_MS),
      task: {
        bindingKey: "space-1|agent-1",
        firstSeenAtMs: FIRST_SEEN_AT_MS + 1000,
        idempotencyKey: "k-2",
        sequence: 2,
        taskId: "task-2",
      },
    });
    const withAllTasks = upsertInflightTask({
      state: withTask2,
      task: {
        bindingKey: "space-1|agent-1",
        firstSeenAtMs: FIRST_SEEN_AT_MS,
        idempotencyKey: "k-1",
        sequence: 1,
        taskId: "task-1",
      },
    });

    const firstRecovery = planRecoveryReplay({
      state: withAllTasks,
    });
    expect(firstRecovery.runtimeState).toBe("recovering");
    expect(
      firstRecovery.replayCandidates.map((candidate) => candidate.taskId)
    ).toEqual(["task-1", "task-2"]);

    const beforeCommitRecovery = planRecoveryReplay({
      state: withAllTasks,
    });
    expect(beforeCommitRecovery.runtimeState).toBe("recovering");
    expect(beforeCommitRecovery.replayCandidates).toHaveLength(2);

    const committedTask1 = markRecoveryReplayCommitted({
      state: withAllTasks,
      taskId: "task-1",
    });
    const committedTask2 = markRecoveryReplayCommitted({
      state: committedTask1,
      taskId: "task-2",
    });
    const afterCommitRecovery = planRecoveryReplay({
      state: committedTask2,
    });
    expect(afterCommitRecovery.runtimeState).toBe("idle");
    expect(afterCommitRecovery.replayCandidates).toHaveLength(0);
  });

  it("removes recovered task from inflight after settle", () => {
    const state = upsertInflightTask({
      state: createEmptyLedgerState(FIRST_SEEN_AT_MS),
      task: {
        bindingKey: "space-2|agent-2",
        firstSeenAtMs: FIRST_SEEN_AT_MS,
        idempotencyKey: "k-settle-1",
        sequence: 1,
        taskId: "task-settle-1",
      },
    });

    const planned = planRecoveryReplay({
      state,
    });
    const settled = settleRecoveredTask({
      state,
      taskId: "task-settle-1",
    });

    expect(planned.replayCandidates).toHaveLength(1);
    expect(settled.inflightByTaskId["task-settle-1"]).toBeUndefined();
    expect(settled.replayedTaskIds["task-settle-1"]).toBe(true);
  });
});
