import { AGENT_PROFILE_WORK_MAX_WAITING } from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import type {
  AgentProfileWorkCoordinator,
  AgentProfileWorkCoordinatorItem,
} from "../runtime-transport/application/agent-profile-work-coordinator";
import {
  AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING,
  acceptAgentProfileWork,
  approveAgentProfileWorkQueue,
  authorizeAgentProfileWorkContinuation,
  createAgentProfileWorkCoordinator,
  dropRetiredAgentProfileWork,
  handOffOccupiedAgentProfileWork,
  markAgentProfileWorkContinuationNeedsAttention,
  markAgentProfileWorkControllerConversationOccupancy,
  markAgentProfileWorkUsageAvailable,
  removeAgentProfileWork,
  reservedAgentProfileWork,
  settleAgentProfileWork,
  skipAgentProfileInterruptedWork,
  summarizeAgentProfileWorkCoordinator,
} from "../runtime-transport/application/agent-profile-work-coordinator";

const PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

const workItem = (index: number) => ({
  dispatchId: `dispatch-${index}`,
  enqueuedAtMs: 1_700_000_000_000 + index,
  targetWakeLifecycleId: `wake-${index}`,
});

describe("fork continuation follow-ups", () => {
  it.each([
    {
      outcome: "succeeded",
      successorContext: "replacement",
      gate: null,
      runs: true,
    },
    {
      outcome: "succeeded",
      successorContext: "unrelated",
      gate: null,
      runs: true,
    },
    {
      outcome: "succeeded",
      successorContext: "original",
      gate: "awaiting_owner_approval",
      runs: false,
    },
    {
      outcome: "stopped",
      successorContext: "replacement",
      gate: null,
      runs: true,
    },
    {
      outcome: "stopped",
      successorContext: "original",
      gate: "awaiting_owner_approval",
      runs: false,
    },
    {
      outcome: "failed",
      successorContext: "replacement",
      gate: "continuation_needs_attention",
      runs: true,
    },
    {
      outcome: "failed",
      successorContext: "original",
      gate: "continuation_needs_attention",
      runs: false,
    },
  ] as const)("settles $outcome with $successorContext follow-up", ({
    outcome,
    successorContext,
    gate,
    runs,
  }) => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1,
      targetProfileId: PROFILE_ID,
    });
    coordinator = acceptAgentProfileWork({
      coordinator,
      item: { ...workItem(1), executionContextId: "original" },
      nowMs: 2,
    }).coordinator;
    coordinator = settleAgentProfileWork({
      coordinator,
      outcome: "controller_conversation_occupied",
      targetWakeLifecycleId: "wake-1",
      nowMs: 3,
    }).coordinator;
    coordinator = authorizeAgentProfileWorkContinuation({
      coordinator,
      continuationClientMessageId: "fork",
      nowMs: 4,
    }).coordinator;
    coordinator = acceptAgentProfileWork({
      coordinator,
      continuationClientMessageId: "fork",
      item: { ...workItem(2), executionContextId: "replacement" },
      nowMs: 5,
    }).coordinator;
    coordinator = acceptAgentProfileWork({
      coordinator,
      item: { ...workItem(3), executionContextId: successorContext },
      nowMs: 6,
    }).coordinator;
    const result = settleAgentProfileWork({
      coordinator,
      outcome,
      targetWakeLifecycleId: "wake-2",
      nowMs: 7,
    });
    // The gate holds only the occupied context; other contexts are not held.
    expect(result.coordinator.recoveryGate?.status ?? null).toBe(gate);
    expect(
      reservedAgentProfileWork(result.coordinator).map(
        (item) => item.targetWakeLifecycleId
      )
    ).toEqual(runs ? ["wake-3"] : []);
  });

  it("limits an occupancy gate to its context until usage is exhausted", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1,
      targetProfileId: PROFILE_ID,
    });
    const accept = (index: number, context: string) => {
      const result = acceptAgentProfileWork({
        coordinator,
        item: { ...workItem(index), executionContextId: context },
        nowMs: 1 + index,
      });
      coordinator = result.coordinator;
      return result.status;
    };
    expect([accept(1, "context-a"), accept(2, "context-b")]).toEqual([
      "start",
      "start",
    ]);
    coordinator = settleAgentProfileWork({
      coordinator,
      outcome: "controller_conversation_occupied",
      targetWakeLifecycleId: "wake-1",
      nowMs: 10,
    }).coordinator;
    expect(coordinator.recoveryGate?.status).toBe(
      "awaiting_occupancy_decision"
    );
    expect([accept(3, "context-c"), accept(4, "context-a")]).toEqual([
      "start",
      "queued",
    ]);

    coordinator = settleAgentProfileWork({
      coordinator,
      outcome: "usage_exhausted",
      targetWakeLifecycleId: "wake-2",
      nowMs: 20,
    }).coordinator;
    expect(accept(5, "context-d")).toBe("queued");
  });

  it("gives the occupied context's reservation to waiting work of another context", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1,
      targetProfileId: PROFILE_ID,
    });
    for (const index of [1, 2, 3, 4, 5, 6]) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: { ...workItem(index), executionContextId: `context-${index}` },
        nowMs: 1 + index,
      }).coordinator;
    }
    const result = settleAgentProfileWork({
      coordinator,
      outcome: "controller_conversation_occupied",
      targetWakeLifecycleId: "wake-1",
      nowMs: 10,
    });
    expect(result.coordinator.recoveryGate?.status).toBe(
      "awaiting_occupancy_decision"
    );
    expect(
      result.promotedItems.map((item) => item.targetWakeLifecycleId)
    ).toEqual(["wake-6"]);
  });
});

describe("independent execution context reservations", () => {
  const empty = () =>
    createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
  const accept = (
    coordinator: ReturnType<typeof empty>,
    index: number,
    context: string
  ) =>
    acceptAgentProfileWork({
      coordinator,
      item: { ...workItem(index), executionContextId: context },
      nowMs: 1_700_000_000_000 + index,
    });

  it("starts five contexts and admits the sixth when a non-head execution finishes", () => {
    let coordinator = empty();
    const statuses = [1, 2, 3, 4, 5, 6].map((index) => {
      const result = accept(coordinator, index, `context-${index}`);
      coordinator = result.coordinator;
      return result.status;
    });
    expect(statuses).toEqual([
      "start",
      "start",
      "start",
      "start",
      "start",
      "queued",
    ]);
    expect(summarizeAgentProfileWorkCoordinator(coordinator).waitingCount).toBe(
      1
    );
    const settled = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      targetWakeLifecycleId: "wake-2",
      outcome: "succeeded",
    });
    expect(settled.promotedItems.map((item) => item.dispatchId)).toEqual([
      "dispatch-6",
    ]);
    expect(
      summarizeAgentProfileWorkCoordinator(
        settled.coordinator
      ).currentWorks.map((item) => item.dispatchId)
    ).toEqual([
      "dispatch-1",
      "dispatch-3",
      "dispatch-4",
      "dispatch-5",
      "dispatch-6",
    ]);
  });

  it("serializes one context without blocking independent work", () => {
    const first = accept(empty(), 1, "context-a");
    const followUp = accept(first.coordinator, 2, "context-a");
    const independent = accept(followUp.coordinator, 3, "context-b");
    expect(followUp.status).toBe("queued");
    expect(independent.status).toBe("start");
    const finished = settleAgentProfileWork({
      coordinator: independent.coordinator,
      nowMs: 1_700_000_000_100,
      targetWakeLifecycleId: "wake-1",
      outcome: "succeeded",
    });
    expect(finished.promotedItems.map((item) => item.dispatchId)).toEqual([
      "dispatch-2",
    ]);
    expect(
      summarizeAgentProfileWorkCoordinator(finished.coordinator).currentWorks
    ).toHaveLength(2);
  });

  it("keeps legacy work exclusive while independent contexts drain", () => {
    const first = accept(empty(), 1, "context-a");
    const legacy = acceptAgentProfileWork({
      coordinator: first.coordinator,
      item: workItem(2),
      nowMs: 1_700_000_000_002,
    });
    const later = accept(legacy.coordinator, 3, "context-b");
    expect(legacy.status).toBe("queued");
    expect(later.status).toBe("queued");
    const firstDone = removeAgentProfileWork({
      coordinator: later.coordinator,
      nowMs: 1_700_000_000_100,
      targetWakeLifecycleId: "wake-1",
    });
    expect(firstDone.promotedItems.map((item) => item.dispatchId)).toEqual([
      "dispatch-2",
    ]);
    const legacyDone = removeAgentProfileWork({
      coordinator: firstDone.coordinator,
      nowMs: 1_700_000_000_200,
      targetWakeLifecycleId: "wake-2",
    });
    expect(legacyDone.promotedItems.map((item) => item.dispatchId)).toEqual([
      "dispatch-3",
    ]);
  });

  it("does not free a running context when its queued follow-up is cancelled", () => {
    const first = accept(empty(), 1, "context-a");
    const followUp = accept(first.coordinator, 2, "context-a");
    const cancelled = removeAgentProfileWork({
      coordinator: followUp.coordinator,
      nowMs: 1_700_000_000_100,
      targetWakeLifecycleId: "wake-2",
    });
    expect(cancelled.promotedItems).toEqual([]);
    expect(
      summarizeAgentProfileWorkCoordinator(
        cancelled.coordinator
      ).currentWorks.map((item) => item.dispatchId)
    ).toEqual(["dispatch-1"]);
  });

  it("retains concurrent interrupted work and lets other reservations finish", () => {
    let coordinator = empty();
    for (const index of [1, 2, 3, 4, 5, 6]) {
      coordinator = accept(coordinator, index, `context-${index}`).coordinator;
    }
    const firstFailure = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      targetWakeLifecycleId: "wake-2",
      outcome: "usage_exhausted",
    });
    expect(firstFailure.promotedItems).toEqual([]);
    expect(
      summarizeAgentProfileWorkCoordinator(firstFailure.coordinator)
        .currentWorks
    ).toHaveLength(4);
    const secondFailure = settleAgentProfileWork({
      coordinator: firstFailure.coordinator,
      nowMs: 1_700_000_000_101,
      targetWakeLifecycleId: "wake-3",
      outcome: "usage_exhausted",
    });
    expect(
      secondFailure.coordinator.recoveryGate?.interruptedWork.dispatchId
    ).toBe("dispatch-2");
    expect(
      secondFailure.coordinator.recoveryGate?.additionalInterruptedWork?.map(
        (item) => item.dispatchId
      )
    ).toEqual(["dispatch-3"]);
    expect(
      summarizeAgentProfileWorkCoordinator(
        secondFailure.coordinator
      ).currentWorks.map((item) => item.dispatchId)
    ).toEqual(["dispatch-1", "dispatch-4", "dispatch-5"]);
  });
});

describe("Agent Profile Work Coordinator", () => {
  it("starts one item and keeps later Space and DM work in strict FIFO order", () => {
    const empty = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });

    const first = acceptAgentProfileWork({
      coordinator: empty,
      item: workItem(1),
      nowMs: 1_700_000_000_001,
    });
    expect(first).toMatchObject({
      queuePosition: 0,
      status: "start",
      waitingCount: 0,
    });

    const second = acceptAgentProfileWork({
      coordinator: first.coordinator,
      item: workItem(2),
      nowMs: 1_700_000_000_002,
    });
    const third = acceptAgentProfileWork({
      coordinator: second.coordinator,
      item: workItem(3),
      nowMs: 1_700_000_000_003,
    });

    expect(second).toMatchObject({
      queuePosition: 1,
      status: "queued",
      waitingCount: 1,
    });
    expect(third).toMatchObject({
      queuePosition: 2,
      status: "queued",
      waitingCount: 2,
    });
    expect(third.coordinator.workItems.map((item) => item.dispatchId)).toEqual([
      "dispatch-1",
      "dispatch-2",
      "dispatch-3",
    ]);
  });

  it("replays the same Wake idempotently without adding another queue item", () => {
    const first = acceptAgentProfileWork({
      coordinator: createAgentProfileWorkCoordinator({
        nowMs: 1_700_000_000_000,
        targetProfileId: PROFILE_ID,
      }),
      item: workItem(1),
      nowMs: 1_700_000_000_001,
    });

    const replay = acceptAgentProfileWork({
      coordinator: first.coordinator,
      item: workItem(1),
      nowMs: 1_700_000_000_100,
    });

    expect(replay).toMatchObject({
      queuePosition: 0,
      status: "already_accepted",
      waitingCount: 0,
    });
    expect(replay.coordinator.workItems).toHaveLength(1);
    expect(replay.coordinator.revision).toBe(first.coordinator.revision);
  });

  it("allows fifty waiting items and rejects the next item without changing order", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (
      let index = 0;
      index <= AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING;
      index += 1
    ) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: workItem(index),
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }

    const full = acceptAgentProfileWork({
      coordinator,
      item: workItem(999),
      nowMs: 1_700_000_001_000,
    });

    expect(full).toMatchObject({
      queuePosition: null,
      status: "queue_full",
      waitingCount: AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING,
    });
    expect(full.coordinator).toBe(coordinator);
    expect(full.coordinator.workItems).toHaveLength(
      AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING + 1
    );
  });

  it("promotes exactly the FIFO successor when current work settles", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 3; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: workItem(index),
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }

    const settled = removeAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      targetWakeLifecycleId: "wake-1",
    });

    expect(settled.removed).toBe(true);
    expect(settled.promotedItem).toEqual(workItem(2));
    expect(
      settled.coordinator.workItems.map((item) => item.dispatchId)
    ).toEqual(["dispatch-2", "dispatch-3"]);
  });

  it("keeps an occupied controller conversation at the FIFO head until provider admission becomes available", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 3; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: workItem(index),
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }

    const occupied = markAgentProfileWorkControllerConversationOccupancy({
      coordinator,
      dispatchId: "dispatch-1",
      nowMs: 1_700_000_000_100,
      state: "occupied",
    });

    expect(occupied.changed).toBe(true);
    expect(occupied.coordinator.workItems).toEqual([
      { ...workItem(1), waitReason: "controller_conversation_occupied" },
      workItem(2),
      workItem(3),
    ]);
    expect(summarizeAgentProfileWorkCoordinator(occupied.coordinator)).toEqual({
      currentWaitReason: "controller_conversation_occupied",
      currentWorks: [
        { ...workItem(1), waitReason: "controller_conversation_occupied" },
      ],
      currentWork: {
        ...workItem(1),
        waitReason: "controller_conversation_occupied",
      },
      queuedWork: [workItem(2), workItem(3)],
      status: "working",
      waitingCount: 2,
    });

    const available = markAgentProfileWorkControllerConversationOccupancy({
      coordinator: occupied.coordinator,
      dispatchId: "dispatch-1",
      nowMs: 1_700_000_000_200,
      state: "available",
    });
    expect(available.changed).toBe(true);
    expect(available.coordinator.workItems).toEqual([
      workItem(1),
      workItem(2),
      workItem(3),
    ]);
  });

  it("removes cancelled waiting work without disturbing the current item", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 3; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: workItem(index),
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }

    const cancelled = removeAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      targetWakeLifecycleId: "wake-2",
    });

    expect(cancelled.promotedItem).toBeNull();
    expect(
      cancelled.coordinator.workItems.map((item) => item.dispatchId)
    ).toEqual(["dispatch-1", "dispatch-3"]);
  });

  it("projects current work and queued work from the Coordinator without inventing another state", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    expect(summarizeAgentProfileWorkCoordinator(coordinator)).toEqual({
      currentWork: null,
      currentWorks: [],
      queuedWork: [],
      status: "idle",
      waitingCount: 0,
    });

    for (let index = 1; index <= 3; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: workItem(index),
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }

    expect(summarizeAgentProfileWorkCoordinator(coordinator)).toEqual({
      currentWork: workItem(1),
      currentWorks: [workItem(1)],
      queuedWork: [workItem(2), workItem(3)],
      status: "working",
      waitingCount: 2,
    });
  });

  it("holds every queued Wake when running work ends because Usage is exhausted", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 3; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: workItem(index),
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }

    const exhausted = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      outcome: "usage_exhausted",
      targetWakeLifecycleId: "wake-1",
    });
    const later = acceptAgentProfileWork({
      coordinator: exhausted.coordinator,
      item: workItem(4),
      nowMs: 1_700_000_000_101,
    });

    expect(exhausted.promotedItem).toBeNull();
    expect(exhausted.coordinator.recoveryGate).toMatchObject({
      interruptedWork: workItem(1),
      status: "awaiting_usage",
    });
    expect(later).toMatchObject({
      queuePosition: 3,
      status: "queued",
      waitingCount: 3,
    });
    expect(summarizeAgentProfileWorkCoordinator(later.coordinator)).toEqual({
      currentWork: null,
      currentWorks: [],
      queuedWork: [workItem(2), workItem(3), workItem(4)],
      status: "paused",
      waitingCount: 3,
    });
  });

  it("holds queued work behind an occupancy decision and lets the branch jump the queue", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 3; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: workItem(index),
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }

    const occupied = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      outcome: "controller_conversation_occupied",
      targetWakeLifecycleId: "wake-1",
    });

    expect(occupied.promotedItem).toBeNull();
    expect(occupied.coordinator.recoveryGate).toMatchObject({
      interruptedWork: workItem(1),
      status: "awaiting_occupancy_decision",
    });
    expect(
      summarizeAgentProfileWorkCoordinator(occupied.coordinator)
    ).toMatchObject({
      currentWorks: [],
      queuedWork: [workItem(2), workItem(3)],
      status: "paused",
    });

    const authorized = authorizeAgentProfileWorkContinuation({
      continuationClientMessageId: "client-continuation-fork-1",
      coordinator: occupied.coordinator,
      nowMs: 1_700_000_000_200,
    });
    expect(authorized.coordinator.recoveryGate).toMatchObject({
      continuationClientMessageId: "client-continuation-fork-1",
      status: "continuation_authorized",
    });

    const branch = acceptAgentProfileWork({
      continuationClientMessageId: "client-continuation-fork-1",
      coordinator: authorized.coordinator,
      item: workItem(9),
      nowMs: 1_700_000_000_300,
    });
    expect(branch.status).toBe("start");
    expect(branch.coordinator.recoveryGate?.status).toBe(
      "continuation_running"
    );
    expect(
      summarizeAgentProfileWorkCoordinator(branch.coordinator).currentWorks
    ).toEqual([workItem(9)]);
  });

  it("settles a second occupied Wake plainly rather than stranding it behind an open gate", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 3; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: { ...workItem(index), executionContextId: `context-${index}` },
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }
    const first = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      outcome: "controller_conversation_occupied",
      targetWakeLifecycleId: "wake-1",
    });
    const second = settleAgentProfileWork({
      coordinator: first.coordinator,
      nowMs: 1_700_000_000_101,
      outcome: "controller_conversation_occupied",
      targetWakeLifecycleId: "wake-2",
    });

    // An `awaiting_usage` follow-up would come back as a resume into the same
    // occupied conversation, so the gate stays on the first Wake only.
    expect(second.coordinator.recoveryGate).toMatchObject({
      interruptedWork: workItem(1),
      status: "awaiting_occupancy_decision",
    });
    expect(
      second.coordinator.recoveryGate?.additionalInterruptedWork ?? []
    ).toEqual([]);
    expect(
      second.coordinator.workItems.map((item) => item.dispatchId)
    ).not.toContain("dispatch-2");
  });

  it("clears the occupancy gate when the owner skips the occupied work", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 2; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: workItem(index),
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }
    const occupied = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      outcome: "controller_conversation_occupied",
      targetWakeLifecycleId: "wake-1",
    });

    const skipped = skipAgentProfileInterruptedWork({
      coordinator: occupied.coordinator,
      nowMs: 1_700_000_000_200,
    });

    expect(skipped.coordinator.recoveryGate).toBeNull();
    expect(skipped.promotedItems.map((item) => item.dispatchId)).toEqual([
      "dispatch-2",
    ]);
  });

  it("keeps an occupancy decision open as attention when the execution target moved", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    coordinator = acceptAgentProfileWork({
      coordinator,
      item: workItem(1),
      nowMs: 1_700_000_000_001,
    }).coordinator;
    const occupied = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      outcome: "controller_conversation_occupied",
      targetWakeLifecycleId: "wake-1",
    });

    const attention = markAgentProfileWorkContinuationNeedsAttention({
      coordinator: occupied.coordinator,
      nowMs: 1_700_000_000_200,
    });

    expect(attention.changed).toBe(true);
    expect(attention.coordinator.recoveryGate).toMatchObject({
      interruptedWork: workItem(1),
      status: "continuation_needs_attention",
    });
  });

  it("continues interrupted work first and requires separate approval before FIFO resumes", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 3; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: workItem(index),
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }
    coordinator = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      outcome: "usage_exhausted",
      targetWakeLifecycleId: "wake-1",
    }).coordinator;
    const usageRecovered = markAgentProfileWorkUsageAvailable({
      coordinator,
      nowMs: 1_700_000_000_200,
    });
    expect(usageRecovered.coordinator.recoveryGate?.status).toBe(
      "continuation_pending"
    );
    coordinator = usageRecovered.coordinator;
    const newIntentAfterRecovery = acceptAgentProfileWork({
      coordinator,
      item: workItem(4),
      nowMs: 1_700_000_000_250,
    });
    expect(newIntentAfterRecovery).toMatchObject({
      queuePosition: 3,
      status: "queued",
      waitingCount: 3,
    });
    coordinator = newIntentAfterRecovery.coordinator;
    coordinator = authorizeAgentProfileWorkContinuation({
      continuationClientMessageId: "client-continuation-1",
      coordinator,
      nowMs: 1_700_000_000_300,
    }).coordinator;

    const continuation = acceptAgentProfileWork({
      continuationClientMessageId: "client-continuation-1",
      coordinator,
      item: workItem(10),
      nowMs: 1_700_000_000_400,
    });
    expect(continuation).toMatchObject({
      queuePosition: 0,
      status: "start",
      waitingCount: 3,
    });
    expect(continuation.coordinator.workItems).toEqual([
      workItem(10),
      workItem(2),
      workItem(3),
      workItem(4),
    ]);

    const continued = settleAgentProfileWork({
      coordinator: continuation.coordinator,
      nowMs: 1_700_000_000_500,
      outcome: "succeeded",
      targetWakeLifecycleId: "wake-10",
    });
    expect(continued.promotedItem).toBeNull();
    expect(continued.coordinator.recoveryGate?.status).toBe(
      "awaiting_owner_approval"
    );
    expect(summarizeAgentProfileWorkCoordinator(continued.coordinator)).toEqual(
      {
        currentWork: null,
        currentWorks: [],
        queuedWork: [workItem(2), workItem(3), workItem(4)],
        status: "paused",
        waitingCount: 3,
      }
    );

    const approved = approveAgentProfileWorkQueue({
      coordinator: continued.coordinator,
      nowMs: 1_700_000_000_600,
    });
    expect(approved.promotedItem).toEqual(workItem(2));
    expect(approved.coordinator.recoveryGate).toBeNull();
    expect(summarizeAgentProfileWorkCoordinator(approved.coordinator)).toEqual({
      currentWork: workItem(2),
      currentWorks: [workItem(2)],
      queuedWork: [workItem(3), workItem(4)],
      status: "working",
      waitingCount: 2,
    });
  });

  it.each([
    "failed",
    "usage_exhausted",
  ] as const)("moves a %s automatic continuation to Needs attention without retrying it", (continuationOutcome) => {
    let coordinator = acceptAgentProfileWork({
      coordinator: createAgentProfileWorkCoordinator({
        nowMs: 1_700_000_000_000,
        targetProfileId: PROFILE_ID,
      }),
      item: workItem(1),
      nowMs: 1_700_000_000_001,
    }).coordinator;
    coordinator = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      outcome: "usage_exhausted",
      targetWakeLifecycleId: "wake-1",
    }).coordinator;
    coordinator = markAgentProfileWorkUsageAvailable({
      coordinator,
      nowMs: 1_700_000_000_200,
    }).coordinator;
    coordinator = authorizeAgentProfileWorkContinuation({
      continuationClientMessageId: "client-continuation-1",
      coordinator,
      nowMs: 1_700_000_000_300,
    }).coordinator;
    coordinator = acceptAgentProfileWork({
      continuationClientMessageId: "client-continuation-1",
      coordinator,
      item: workItem(10),
      nowMs: 1_700_000_000_400,
    }).coordinator;

    const failedContinuation = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_500,
      outcome: continuationOutcome,
      targetWakeLifecycleId: "wake-10",
    });

    expect(failedContinuation.coordinator.recoveryGate).toMatchObject({
      continuationClientMessageId: null,
      interruptedWork: workItem(1),
      status: "continuation_needs_attention",
    });
    expect(failedContinuation.coordinator.workItems).toEqual([]);
    expect(
      markAgentProfileWorkUsageAvailable({
        coordinator: failedContinuation.coordinator,
        nowMs: 1_700_000_000_600,
      })
    ).toEqual({
      changed: false,
      coordinator: failedContinuation.coordinator,
    });
  });

  it("lets the owner skip unsafe interrupted work and starts the FIFO head once", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 2; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: workItem(index),
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }
    coordinator = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      outcome: "usage_exhausted",
      targetWakeLifecycleId: "wake-1",
    }).coordinator;
    coordinator = markAgentProfileWorkUsageAvailable({
      coordinator,
      nowMs: 1_700_000_000_150,
    }).coordinator;
    coordinator = markAgentProfileWorkContinuationNeedsAttention({
      coordinator,
      nowMs: 1_700_000_000_200,
    }).coordinator;

    const skipped = skipAgentProfileInterruptedWork({
      coordinator,
      nowMs: 1_700_000_000_300,
    });

    expect(skipped.coordinator.recoveryGate).toBeNull();
    expect(skipped.promotedItem).toEqual(workItem(2));
    expect(summarizeAgentProfileWorkCoordinator(skipped.coordinator)).toEqual({
      currentWork: workItem(2),
      currentWorks: [workItem(2)],
      queuedWork: [],
      status: "working",
      waitingCount: 0,
    });
  });

  it("never restarts a stopped continuation and keeps later work behind owner approval", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 2; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: workItem(index),
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }
    coordinator = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      outcome: "usage_exhausted",
      targetWakeLifecycleId: "wake-1",
    }).coordinator;
    coordinator = markAgentProfileWorkUsageAvailable({
      coordinator,
      nowMs: 1_700_000_000_200,
    }).coordinator;
    coordinator = authorizeAgentProfileWorkContinuation({
      continuationClientMessageId: "client-continuation-1",
      coordinator,
      nowMs: 1_700_000_000_300,
    }).coordinator;
    coordinator = acceptAgentProfileWork({
      continuationClientMessageId: "client-continuation-1",
      coordinator,
      item: workItem(10),
      nowMs: 1_700_000_000_400,
    }).coordinator;

    const stopped = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_500,
      outcome: "stopped",
      targetWakeLifecycleId: "wake-10",
    });

    expect(stopped.promotedItem).toBeNull();
    expect(stopped.coordinator.recoveryGate).toMatchObject({
      continuationClientMessageId: null,
      interruptedWork: workItem(1),
      status: "awaiting_owner_approval",
    });
    expect(summarizeAgentProfileWorkCoordinator(stopped.coordinator)).toEqual({
      currentWork: null,
      currentWorks: [],
      queuedWork: [workItem(2)],
      status: "paused",
      waitingCount: 1,
    });
    expect(
      markAgentProfileWorkUsageAvailable({
        coordinator: stopped.coordinator,
        nowMs: 1_700_000_000_600,
      })
    ).toEqual({ coordinator: stopped.coordinator, changed: false });
  });

  it("clears recovery after a stopped continuation when no later work exists", () => {
    let coordinator = acceptAgentProfileWork({
      coordinator: createAgentProfileWorkCoordinator({
        nowMs: 1_700_000_000_000,
        targetProfileId: PROFILE_ID,
      }),
      item: workItem(1),
      nowMs: 1_700_000_000_001,
    }).coordinator;
    coordinator = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_100,
      outcome: "usage_exhausted",
      targetWakeLifecycleId: "wake-1",
    }).coordinator;
    coordinator = markAgentProfileWorkUsageAvailable({
      coordinator,
      nowMs: 1_700_000_000_200,
    }).coordinator;
    coordinator = authorizeAgentProfileWorkContinuation({
      continuationClientMessageId: "client-continuation-1",
      coordinator,
      nowMs: 1_700_000_000_300,
    }).coordinator;
    coordinator = acceptAgentProfileWork({
      continuationClientMessageId: "client-continuation-1",
      coordinator,
      item: workItem(10),
      nowMs: 1_700_000_000_400,
    }).coordinator;

    const stopped = settleAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_500,
      outcome: "stopped",
      targetWakeLifecycleId: "wake-10",
    });

    expect(stopped.coordinator.recoveryGate).toBeNull();
    expect(summarizeAgentProfileWorkCoordinator(stopped.coordinator)).toEqual({
      currentWork: null,
      currentWorks: [],
      queuedWork: [],
      status: "idle",
      waitingCount: 0,
    });
  });
});

describe("occupied work handoff", () => {
  const FORK = {
    dispatchId: "dispatch-fork",
    enqueuedAtMs: 1_700_000_000_500,
    executionContextId: "context-fork",
    targetWakeLifecycleId: "wake-fork",
  };
  const legacyQueue = (count: number) => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= count; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: workItem(index),
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }
    return coordinator;
  };
  const occupy = (
    coordinator: AgentProfileWorkCoordinator,
    dispatchId: string
  ) =>
    markAgentProfileWorkControllerConversationOccupancy({
      coordinator,
      dispatchId,
      nowMs: 1_700_000_000_100,
      state: "occupied",
    }).coordinator;
  const handOff = (
    coordinator: AgentProfileWorkCoordinator,
    sourceTargetWakeLifecycleId = "wake-1",
    successor: AgentProfileWorkCoordinatorItem = FORK
  ) =>
    handOffOccupiedAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_600,
      sourceTargetWakeLifecycleId,
      successor,
    });

  it("continues a blocked legacy head in the fork without letting the next legacy item start", () => {
    const occupied = occupy(legacyQueue(3), "dispatch-1");
    const result = handOff(occupied);

    expect(result.status).toBe("handed_off");
    const summary = summarizeAgentProfileWorkCoordinator(result.coordinator);
    expect(summary.currentWorks).toEqual([
      { ...FORK, reservationState: "reserved" },
    ]);
    expect(summary.currentWaitReason).toBeUndefined();
    expect(summary.queuedWork.map((item) => item.dispatchId)).toEqual([
      "dispatch-2",
      "dispatch-3",
    ]);
    expect(result.coordinator.revision).toBe(occupied.revision + 1);
  });

  it("reuses the same reservation instead of adding one, so the ceiling still holds", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 6; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: { ...workItem(index), executionContextId: `context-${index}` },
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }
    const result = handOff(occupy(coordinator, "dispatch-1"));

    expect(result.status).toBe("handed_off");
    const summary = summarizeAgentProfileWorkCoordinator(result.coordinator);
    expect(summary.currentWorks.map((item) => item.dispatchId)).toEqual([
      "dispatch-fork",
      "dispatch-2",
      "dispatch-3",
      "dispatch-4",
      "dispatch-5",
    ]);
    expect(summary.queuedWork.map((item) => item.dispatchId)).toEqual([
      "dispatch-6",
    ]);
  });

  it("rescues the blocked item under serial and draining without admitting anything new", () => {
    for (const admissionMode of ["serial", "draining"] as const) {
      const accepted = acceptAgentProfileWork({
        coordinator: createAgentProfileWorkCoordinator({
          nowMs: 1_700_000_000_000,
          targetProfileId: PROFILE_ID,
        }),
        item: { ...workItem(1), executionContextId: "context-1" },
        nowMs: 1_700_000_000_001,
      }).coordinator;
      const queued = acceptAgentProfileWork({
        coordinator: { ...accepted, admissionMode },
        item: { ...workItem(2), executionContextId: "context-2" },
        nowMs: 1_700_000_000_002,
      });
      expect(queued.status).toBe("queued");

      const result = handOff(occupy(queued.coordinator, "dispatch-1"));
      expect(result.status).toBe("handed_off");
      const summary = summarizeAgentProfileWorkCoordinator(result.coordinator);
      expect(summary.currentWorks.map((item) => item.dispatchId)).toEqual([
        "dispatch-fork",
      ]);
      expect(summary.queuedWork.map((item) => item.dispatchId)).toEqual([
        "dispatch-2",
      ]);
    }
  });

  it("refuses work that is running rather than blocked on the occupied conversation", () => {
    const coordinator = legacyQueue(2);
    const result = handOff(coordinator);

    expect(result.status).toBe("source_not_occupied");
    expect(result.coordinator).toBe(coordinator);
  });

  it("refuses a queued waiter that holds no reservation to hand over", () => {
    const occupied = occupy(legacyQueue(3), "dispatch-1");
    const result = handOff(occupied, "wake-2");

    expect(result.status).toBe("source_not_occupied");
    expect(result.coordinator).toBe(occupied);
  });

  it("refuses a paused legacy head, which holds no reservation to hand over", () => {
    const occupied = occupy(legacyQueue(2), "dispatch-1");
    const paused: AgentProfileWorkCoordinator = {
      ...occupied,
      recoveryGate: {
        continuationClientMessageId: null,
        interruptedWork: workItem(9),
        status: "awaiting_usage",
        updatedAtMs: 1_700_000_000_200,
      },
    };
    expect(summarizeAgentProfileWorkCoordinator(paused).currentWorks).toEqual(
      []
    );

    const result = handOff(paused);
    expect(result.status).toBe("source_not_occupied");
    expect(result.coordinator).toBe(paused);
  });

  it("still hands off a reserved context while a recovery gate holds the queue", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 2; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: { ...workItem(index), executionContextId: `context-${index}` },
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }
    const paused = settleAgentProfileWork({
      coordinator: occupy(coordinator, "dispatch-1"),
      nowMs: 1_700_000_000_200,
      outcome: "usage_exhausted",
      targetWakeLifecycleId: "wake-2",
    }).coordinator;
    expect(paused.recoveryGate?.status).toBe("awaiting_usage");

    const result = handOff(paused);
    expect(result.status).toBe("handed_off");
    expect(
      summarizeAgentProfileWorkCoordinator(result.coordinator).currentWorks.map(
        (item) => item.dispatchId
      )
    ).toEqual(["dispatch-fork"]);
  });

  it("answers a replayed handoff without moving the slot a second time", () => {
    const first = handOff(occupy(legacyQueue(3), "dispatch-1"));
    const replay = handOff(first.coordinator);

    expect(replay.status).toBe("already_handed_off");
    expect(replay.coordinator).toBe(first.coordinator);
  });

  it("refuses a successor that would run a second execution in an already reserved context", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 2; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: { ...workItem(index), executionContextId: `context-${index}` },
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }
    const occupied = occupy(coordinator, "dispatch-1");
    const result = handOff(occupied, "wake-1", {
      ...FORK,
      executionContextId: "context-2",
    });

    expect(result.status).toBe("successor_conflict");
    expect(result.coordinator).toBe(occupied);
  });

  it("refuses a successor that would not hold the slot it was given", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (let index = 1; index <= 2; index += 1) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item: { ...workItem(index), executionContextId: `context-${index}` },
        nowMs: 1_700_000_000_000 + index,
      }).coordinator;
    }
    const occupied = occupy(coordinator, "dispatch-2");
    const { executionContextId: _context, ...legacySuccessor } = FORK;
    const result = handOff(occupied, "wake-2", legacySuccessor);

    expect(result.status).toBe("successor_conflict");
    expect(result.coordinator).toBe(occupied);
  });

  it("consumes the successor's own queue entry instead of leaving two entries for one piece of work", () => {
    const occupied = occupy(legacyQueue(3), "dispatch-1");
    const queued = acceptAgentProfileWork({
      coordinator: occupied,
      item: FORK,
      nowMs: 1_700_000_000_500,
    }).coordinator;
    expect(queued.workItems).toHaveLength(4);

    const result = handOff(queued);

    expect(result.status).toBe("handed_off");
    expect(
      result.coordinator.workItems.map((item) => item.targetWakeLifecycleId)
    ).toEqual(["wake-fork", "wake-2", "wake-3"]);
    const summary = summarizeAgentProfileWorkCoordinator(result.coordinator);
    expect(summary.currentWorks).toEqual([
      { ...FORK, reservationState: "reserved" },
    ]);
    // The work kept the source's place in line rather than its own later one.
    expect(summary.currentWorks[0]?.enqueuedAtMs).toBe(FORK.enqueuedAtMs);
    expect(summary.waitingCount).toBe(2);
  });

  it("refuses a successor whose queued entry names a different execution context", () => {
    const occupied = occupy(legacyQueue(2), "dispatch-1");
    const queued = acceptAgentProfileWork({
      coordinator: occupied,
      item: { ...FORK, executionContextId: "context-other" },
      nowMs: 1_700_000_000_500,
    }).coordinator;

    const result = handOff(queued);

    expect(result.status).toBe("successor_conflict");
    expect(result.coordinator).toBe(queued);
  });

  it("refuses a successor whose queued entry already holds a reservation of its own", () => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (const item of [
      {
        dispatchId: "dispatch-1",
        enqueuedAtMs: 1_700_000_000_001,
        executionContextId: "context-1",
        targetWakeLifecycleId: "wake-1",
      },
      FORK,
    ]) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item,
        nowMs: item.enqueuedAtMs,
      }).coordinator;
    }
    const occupied = occupy(coordinator, "dispatch-1");
    expect(
      reservedAgentProfileWork(occupied).map((item) => item.dispatchId)
    ).toEqual(["dispatch-1", "dispatch-fork"]);

    const result = handOff(occupied);

    expect(result.status).toBe("successor_conflict");
    expect(result.coordinator).toBe(occupied);
  });

  it("promotes the next waiter normally once the fork finishes", () => {
    const handedOff = handOff(occupy(legacyQueue(3), "dispatch-1")).coordinator;
    const settled = settleAgentProfileWork({
      coordinator: handedOff,
      nowMs: 1_700_000_000_700,
      outcome: "succeeded",
      targetWakeLifecycleId: "wake-fork",
    });

    expect(settled.removed).toBe(true);
    expect(
      summarizeAgentProfileWorkCoordinator(settled.coordinator).currentWork
        ?.dispatchId
    ).toBe("dispatch-2");
  });
});

describe("dropping retired work", () => {
  const queueOf = (items: readonly AgentProfileWorkCoordinatorItem[]) => {
    let coordinator = createAgentProfileWorkCoordinator({
      nowMs: 1_700_000_000_000,
      targetProfileId: PROFILE_ID,
    });
    for (const item of items) {
      coordinator = acceptAgentProfileWork({
        coordinator,
        item,
        nowMs: item.enqueuedAtMs,
      }).coordinator;
    }
    return coordinator;
  };

  it("releases the reservation a retired Wake held and promotes the next waiter", () => {
    const coordinator = queueOf([workItem(1), workItem(2), workItem(3)]);

    const dropped = dropRetiredAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_500,
      retiredTargetWakeLifecycleIds: new Set(["wake-1"]),
    });

    expect(dropped.removedItems.map((item) => item.dispatchId)).toEqual([
      "dispatch-1",
    ]);
    expect(dropped.promotedItems.map((item) => item.dispatchId)).toEqual([
      "dispatch-2",
    ]);
    const summary = summarizeAgentProfileWorkCoordinator(dropped.coordinator);
    expect(summary.currentWork?.dispatchId).toBe("dispatch-2");
    expect(summary.waitingCount).toBe(1);
  });

  it("promotes past a run of retired work instead of handing the slot to another retired Wake", () => {
    const coordinator = queueOf([workItem(1), workItem(2), workItem(3)]);

    const dropped = dropRetiredAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_500,
      retiredTargetWakeLifecycleIds: new Set(["wake-1", "wake-2"]),
    });

    expect(dropped.promotedItems.map((item) => item.dispatchId)).toEqual([
      "dispatch-3",
    ]);
    expect(
      summarizeAgentProfileWorkCoordinator(dropped.coordinator).waitingCount
    ).toBe(0);
  });

  it("refills every free execution context reservation the retired work was blocking", () => {
    const coordinator = queueOf([
      { ...workItem(1), executionContextId: "context-1" },
      { ...workItem(2), executionContextId: "context-1" },
      { ...workItem(3), executionContextId: "context-2" },
    ]);
    expect(
      reservedAgentProfileWork(coordinator).map((item) => item.dispatchId)
    ).toEqual(["dispatch-1", "dispatch-3"]);

    const dropped = dropRetiredAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_500,
      retiredTargetWakeLifecycleIds: new Set(["wake-1"]),
    });

    expect(dropped.promotedItems.map((item) => item.dispatchId)).toEqual([
      "dispatch-2",
    ]);
    expect(
      reservedAgentProfileWork(dropped.coordinator).map(
        (item) => item.dispatchId
      )
    ).toEqual(["dispatch-2", "dispatch-3"]);
  });

  it("leaves the queue untouched when no named work is still claimed", () => {
    const coordinator = queueOf([workItem(1), workItem(2)]);

    const dropped = dropRetiredAgentProfileWork({
      coordinator,
      nowMs: 1_700_000_000_500,
      retiredTargetWakeLifecycleIds: new Set(["wake-9"]),
    });

    expect(dropped.coordinator).toBe(coordinator);
    expect(dropped.removedItems).toEqual([]);
    expect(dropped.promotedItems).toEqual([]);
  });
});

describe("agent-profile-work-coordinator shared policy", () => {
  it("reads the waiting limit from the shared agent-runtime work policy", () => {
    expect(AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING).toBe(
      AGENT_PROFILE_WORK_MAX_WAITING
    );
    expect(AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING).toBe(50);
  });
});
