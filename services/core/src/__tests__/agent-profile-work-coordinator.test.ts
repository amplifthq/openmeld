import { AGENT_PROFILE_WORK_MAX_WAITING } from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import {
  AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING,
  acceptAgentProfileWork,
  approveAgentProfileWorkQueue,
  authorizeAgentProfileWorkContinuation,
  createAgentProfileWorkCoordinator,
  markAgentProfileWorkContinuationNeedsAttention,
  markAgentProfileWorkControllerConversationOccupancy,
  markAgentProfileWorkUsageAvailable,
  removeAgentProfileWork,
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
      queuedWork: [workItem(2), workItem(3), workItem(4)],
      status: "paused",
      waitingCount: 3,
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
      queuedWork: [],
      status: "idle",
      waitingCount: 0,
    });
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
