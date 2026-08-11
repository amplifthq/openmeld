import { describe, expect, it } from "vitest";
import {
  buildRuntimeCompensationStuckFinding,
  buildRuntimeHeartbeatUnhealthyFinding,
  buildRuntimeReplayStuckFinding,
  resolveRuntimeCompensationStuckHealthFinding,
  resolveRuntimeHeartbeatHealthFinding,
  resolveRuntimeReplayStuckHealthFinding,
  resolveRuntimeResultMappingViolation,
  resolveRuntimeTaskResultTransitionContractViolation,
  resolveRuntimeTrackingTransitionContractViolation,
} from "../src/runtime-health-invariant-policy";

describe("runtime health invariant policy", () => {
  it("builds stable warning metadata for runtime health findings", () => {
    expect(
      buildRuntimeHeartbeatUnhealthyFinding({
        humanContext: {
          runtimeState: "suspect",
        },
      })
    ).toEqual({
      humanContext: {
        runtimeState: "suspect",
      },
      reasonCode: "runtime.heartbeat_unhealthy",
      severity: "warn",
      summaryKey: "runtime.heartbeat_unhealthy",
    });

    expect(
      buildRuntimeReplayStuckFinding({
        humanContext: {
          oldestReplayAgeMs: 50_000,
        },
      })
    ).toEqual({
      humanContext: {
        oldestReplayAgeMs: 50_000,
      },
      reasonCode: "runtime.replay_stuck",
      severity: "warn",
      summaryKey: "runtime.replay_stuck",
    });

    expect(
      buildRuntimeCompensationStuckFinding({
        humanContext: {
          taskId: "task-1",
        },
      })
    ).toEqual({
      humanContext: {
        taskId: "task-1",
      },
      reasonCode: "runtime.compensation_stuck",
      severity: "warn",
      summaryKey: "runtime.compensation_stuck",
    });
  });

  it("keeps healthy and aligned runtime facts quiet", () => {
    expect(
      resolveRuntimeHeartbeatHealthFinding({
        externalState: "ok",
        runtimeState: "healthy",
      })
    ).toBeNull();

    expect(
      resolveRuntimeReplayStuckHealthFinding({
        hasReplayCandidates: true,
        oldestReplayAgeMs: 10_000,
        staleAfterMs: 20_000,
      })
    ).toBeNull();

    expect(
      resolveRuntimeCompensationStuckHealthFinding({
        transitionKind: "schedule_next_compensation",
      })
    ).toBeNull();

    expect(
      resolveRuntimeTrackingTransitionContractViolation({
        hasInflightTask: false,
      })
    ).toBeNull();

    expect(
      resolveRuntimeTaskResultTransitionContractViolation({
        payloadStatus: "success",
      })
    ).toBeNull();

    expect(
      resolveRuntimeResultMappingViolation({
        expectedSuccessLike: true,
        payloadStatus: "partial_success",
      })
    ).toBeNull();
  });

  it("reports unhealthy runtime facts and semantic drifts", () => {
    expect(
      resolveRuntimeHeartbeatHealthFinding({
        externalState: "ok",
        runtimeState: "down",
      })
    ).toMatchObject({
      reasonCode: "runtime.heartbeat_unhealthy",
      severity: "warn",
    });

    expect(
      resolveRuntimeReplayStuckHealthFinding({
        hasReplayCandidates: true,
        oldestReplayAgeMs: 30_000,
        staleAfterMs: 20_000,
      })
    ).toMatchObject({
      reasonCode: "runtime.replay_stuck",
      severity: "warn",
    });

    expect(
      resolveRuntimeCompensationStuckHealthFinding({
        transitionKind: "exhaust_failed_compensation",
      })
    ).toMatchObject({
      reasonCode: "runtime.compensation_stuck",
      severity: "warn",
    });

    expect(
      resolveRuntimeCompensationStuckHealthFinding({
        transitionKind: "settle_successful_compensation",
      })
    ).toBeNull();

    expect(
      resolveRuntimeResultMappingViolation({
        expectedSuccessLike: false,
        payloadStatus: "success",
      })
    ).toMatchObject({
      reasonCode: "runtime.result_mapping_violation",
      severity: "error",
    });
  });
});
