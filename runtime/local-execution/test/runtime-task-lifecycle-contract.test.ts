import { describe, expect, it } from "vitest";
import {
  resolveCompensationTransition,
  resolveInflightTaskTransitionForSettle,
  resolveInflightTaskTransitionForTracking,
  resolveReplayTransitionForCommit,
  resolveReplayTransitionForPlan,
  resolveReplayTransitionForSettle,
  resolveRuntimeTaskResultDeliverySemantic,
  resolveTaskResultTransitionForPayloadStatus,
} from "../src/runtime-task-lifecycle-contract";

describe("runtime task lifecycle contract", () => {
  it("tracks and settles inflight tasks through explicit transitions", () => {
    expect(
      resolveInflightTaskTransitionForTracking({
        hasInflightTask: false,
      })
    ).toMatchObject({
      kind: "track_new_inflight_task",
      toState: "tracked",
    });

    expect(
      resolveInflightTaskTransitionForTracking({
        hasInflightTask: true,
      })
    ).toMatchObject({
      kind: "refresh_tracked_inflight_task",
      toState: "tracked",
    });

    expect(
      resolveInflightTaskTransitionForSettle({
        hasInflightTask: true,
      })
    ).toMatchObject({
      kind: "settle_tracked_inflight_task",
      toState: "absent",
    });
  });

  it("models replay progression as candidate -> committed -> settled", () => {
    expect(
      resolveReplayTransitionForPlan({
        hasReplayCandidates: true,
      })
    ).toMatchObject({
      kind: "surface_replay_candidate",
      toState: "candidate",
    });

    expect(
      resolveReplayTransitionForCommit({
        hasInflightTask: true,
        replayCommitted: false,
      })
    ).toMatchObject({
      kind: "commit_recovery_replay",
      toState: "committed",
    });

    expect(
      resolveReplayTransitionForSettle({
        hasInflightTask: true,
        replayCommitted: true,
      })
    ).toMatchObject({
      kind: "settle_committed_replay",
      toState: "settled",
    });
  });

  it("keeps task result payload transitions explicit", () => {
    expect(
      resolveTaskResultTransitionForPayloadStatus({
        payloadStatus: "success",
      })
    ).toMatchObject({
      kind: "emit_success_payload",
      toState: "success",
    });

    expect(
      resolveTaskResultTransitionForPayloadStatus({
        payloadStatus: "partial_success",
      })
    ).toMatchObject({
      kind: "emit_partial_success_payload",
      toState: "partial_success",
    });

    expect(
      resolveTaskResultTransitionForPayloadStatus({
        payloadStatus: "failed",
      })
    ).toMatchObject({
      kind: "emit_failed_payload",
      toState: "failed",
    });
  });

  it("maps runtime task result statuses to delivery semantics", () => {
    expect(
      resolveRuntimeTaskResultDeliverySemantic({
        payloadStatus: "success",
      })
    ).toEqual({
      kind: "success_like",
      successLike: true,
    });

    expect(
      resolveRuntimeTaskResultDeliverySemantic({
        payloadStatus: "partial_success",
      })
    ).toEqual({
      kind: "success_like",
      successLike: true,
    });

    expect(
      resolveRuntimeTaskResultDeliverySemantic({
        payloadStatus: "failed",
      })
    ).toEqual({
      kind: "failed_requires_classification",
      successLike: false,
    });
  });

  it("models compensation as retry-until-terminal progression", () => {
    expect(
      resolveCompensationTransition({
        attemptsCompleted: 0,
        lastAttemptSucceeded: false,
      })
    ).toMatchObject({
      kind: "schedule_next_compensation",
      toState: "active",
      terminal: false,
    });

    expect(
      resolveCompensationTransition({
        attemptsCompleted: 1,
        lastAttemptSucceeded: true,
      })
    ).toMatchObject({
      kind: "settle_successful_compensation",
      toState: "terminal",
      terminal: true,
    });

    expect(
      resolveCompensationTransition({
        attemptsCompleted: 3,
        lastAttemptSucceeded: false,
      })
    ).toMatchObject({
      kind: "exhaust_failed_compensation",
      toState: "terminal",
      terminal: true,
    });
  });
});
