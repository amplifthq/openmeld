import { describe, expect, it } from "vitest";
import {
  spaceDispatchTraceResponseContractVersionHeaderSchema,
  spaceDispatchTraceRuntimeCoordinatorHeadLifecycleSchema,
  spaceDispatchTraceRuntimeCoordinatorHeadLifecycleV1Schema,
  spaceDispatchTraceRuntimeCoordinatorHeadLifecycleV2Schema,
} from "../../src/schemas/http/space-dispatch-trace";

const PENDING_ROUTE_HEAD = {
  createdAt: "2026-03-09T00:00:01.100Z",
  duplicateDispatchCount: 0,
  executionLinkedAt: null,
  factSource: "runtime_coordinator_head_lifecycle",
  modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
  noExecutionDecision: null,
  ownerUserId: "owner-1",
  primaryDispatchId: "dispatch-1",
  publicationIntent: null,
  readStatus: "found",
  runtimeCoordinatorExecutionId: null,
  status: "waiting",
  targetWakeLifecycleIdentity: {
    clientMessageId: "client-message-1",
    dispatchId: "dispatch-1",
    modelVersion: "openmeld.target_wake.lifecycle_identity.v1",
    sourceSignalId: "signal-1",
    spaceId: "space-1",
    targetProfileId: "agent-1",
    targetWakeLifecycleId: "twl_v1|7:space-1|8:signal-1|7:agent-1",
  },
  targetWakeLifecycleId: "twl_v1|7:space-1|8:signal-1|7:agent-1",
  updatedAt: "2026-03-09T00:00:01.300Z",
  waitingBoundary: {
    deadlineAt: "2026-03-09T00:05:00.000Z",
    deadlineOutcome: "publication_intent_ready",
    observedAt: "2026-03-09T00:00:01.200Z",
    reasonCode: "daemon.profile.pending_first_report",
    softDeadlineAt: "2026-03-09T00:00:30.000Z",
    trigger: "wake_route_reported",
    triggerOwner: "runtime_coordinator",
    userRecoveryAction: "wait_for_wake_route_report",
    userVisibleState: "waiting_for_wake_route_report",
    waitingCategory: "wake_route_registration_pending",
    waitingFor: "wake_route_report",
    waitingSince: "2026-03-09T00:00:01.100Z",
  },
} as const;

const DISABLED_LOCAL_AGENT_HEAD = {
  ...PENDING_ROUTE_HEAD,
  noExecutionDecision: {
    decidedAt: "2026-03-09T00:00:01.400Z",
    publicationCategory: "local_agent_unavailable",
    reasonCode: "controller.registry.disabled",
    source: "dispatch_preflight",
    userRecoveryAction: "enable_local_agent",
  },
  publicationIntent: {
    intentId: "disabled-local-agent-intent-1",
    kind: "no_execution_failure",
    publicationCategory: "local_agent_unavailable",
    readyAt: "2026-03-09T00:00:01.400Z",
    reasonCode: "controller.registry.disabled",
    status: "ready_for_phase_6",
    userRecoveryAction: "enable_local_agent",
  },
  status: "publication_intent_ready",
  waitingBoundary: null,
} as const;

describe("Space dispatch trace response contract versions", () => {
  it("accepts pending route evidence only in the negotiated current contract", () => {
    expect(
      spaceDispatchTraceRuntimeCoordinatorHeadLifecycleSchema.safeParse(
        PENDING_ROUTE_HEAD
      ).success
    ).toBe(true);
    expect(
      spaceDispatchTraceRuntimeCoordinatorHeadLifecycleV1Schema.safeParse(
        PENDING_ROUTE_HEAD
      ).success
    ).toBe(false);
  });

  it("keeps disabled Local Agent outcomes out of the strict v2 trace contract", () => {
    expect(
      spaceDispatchTraceRuntimeCoordinatorHeadLifecycleSchema.safeParse(
        DISABLED_LOCAL_AGENT_HEAD
      ).success
    ).toBe(true);
    expect(
      spaceDispatchTraceRuntimeCoordinatorHeadLifecycleV2Schema.safeParse(
        DISABLED_LOCAL_AGENT_HEAD
      ).success
    ).toBe(false);
    expect(
      spaceDispatchTraceRuntimeCoordinatorHeadLifecycleV1Schema.safeParse(
        DISABLED_LOCAL_AGENT_HEAD
      ).success
    ).toBe(false);
  });

  it("parses the current and previous response version headers", () => {
    expect(
      spaceDispatchTraceResponseContractVersionHeaderSchema.parse("8")
    ).toBe(8);
    expect(
      spaceDispatchTraceResponseContractVersionHeaderSchema.parse("7")
    ).toBe(7);
    expect(
      spaceDispatchTraceResponseContractVersionHeaderSchema.parse("6")
    ).toBe(6);
    expect(
      spaceDispatchTraceResponseContractVersionHeaderSchema.parse("5")
    ).toBe(5);
    expect(
      spaceDispatchTraceResponseContractVersionHeaderSchema.parse("4")
    ).toBe(4);
    expect(
      spaceDispatchTraceResponseContractVersionHeaderSchema.parse("3")
    ).toBe(3);
    expect(
      spaceDispatchTraceResponseContractVersionHeaderSchema.parse("2")
    ).toBe(2);
    expect(
      spaceDispatchTraceResponseContractVersionHeaderSchema.safeParse("1")
        .success
    ).toBe(false);
    expect(
      spaceDispatchTraceResponseContractVersionHeaderSchema.safeParse("9")
        .success
    ).toBe(false);
  });
});
