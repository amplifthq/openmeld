import { wakeTimingSchema } from "@openmeld/schemas";
import type {
  SpaceDispatchTraceSnapshot,
  WakeTiming,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  type ProjectWakeTimingInput,
  projectWakeTiming,
} from "../space/application/wake-timing";

type RuntimeCoordinatorEvent =
  SpaceDispatchTraceSnapshot["runtimeCoordinatorEvents"][number];
type RuntimeCoordinatorExecution = NonNullable<
  SpaceDispatchTraceSnapshot["runtimeCoordinatorExecution"]
>;
type HeadLifecycle = Extract<
  NonNullable<SpaceDispatchTraceSnapshot["runtimeCoordinatorHeadLifecycle"]>,
  { readStatus: "found" }
>;

const T0 = Date.parse("2026-05-13T00:00:00.000Z");
const at = (seconds: number) => T0 + seconds * 1000;
const iso = (seconds: number) => new Date(at(seconds)).toISOString();

describe("Wake timing projection", () => {
  it("keeps OpenMeld's result acceptance and Space visibility fixed when later writes or the computer's clock disagree", () => {
    const timing = projectParsed({
      asOfMs: at(700),
      summaryStatus: "replied",
      trace: buildTrace({
        head: buildHead({ createdAt: 3, executionLinkedAt: 5 }),
        events: [
          lifecycleEvent("lifecycle_accepted_local", 6, {
            localQueue: { status: "queued", waitReason: "workspace_conflict" },
          }),
          lifecycleEvent("lifecycle_accepted_local", 66, {
            localQueue: { status: "ready" },
          }),
          lifecycleEvent("lifecycle_running", 67, { runningAtMs: at(66.5) }),
          // The computer's clock runs ahead of OpenMeld's result acceptance.
          lifecycleEvent("lifecycle_completed_local", 101, {
            lifecycleAtMs: at(103),
          }),
          // Written after the reply was already visible.
          lifecycleEvent("result_accepted", 130),
        ],
        execution: {
          status: "reply_published",
          terminalOutcome: terminalOutcome("reply_published", 130),
        },
        resultAcceptedAt: 100,
        visibleAt: 110,
      }),
    });

    expect(timing.state).toBe("settled");
    expect(summarizeSegments(timing)).toEqual([
      ["routing", 3000, null],
      ["queue", 2000, null],
      ["delivery", 1000, null],
      ["startup", 60_500, "runtime.local_queue.waiting_workspace_conflict"],
      ["agent_run", 33_500, null],
      ["publishing", 10_000, null],
    ]);
    expect(readMilestoneAt(timing, "result_accepted")).toBe(iso(100));
    expect(readMilestoneAt(timing, "result_visible")).toBe(iso(110));
    expect(timing.totals.endToEndMs).toBe(110_000);
  });

  it.each([
    [
      "a result delivered from the outbox without a completion report",
      null,
      { agent_run: 0, not_recorded: 586_000, result_delivery: 0 },
    ],
    [
      "a completion report replayed after reconnecting",
      lifecycleEvent("lifecycle_completed_local", 589, {
        lifecycleAtMs: at(300),
      }),
      { agent_run: 296_000, not_recorded: 0, result_delivery: 290_000 },
    ],
  ])("attributes only reported Agent work for %s", (_case, completion, expected) => {
    const timing = projectParsed({
      asOfMs: at(600),
      summaryStatus: "replied",
      trace: buildTrace({
        head: buildHead({ createdAt: 1, executionLinkedAt: 2 }),
        events: [
          lifecycleEvent("lifecycle_accepted_local", 3),
          lifecycleEvent("lifecycle_running", 5, { runningAtMs: at(4) }),
          ...(completion ? [completion] : []),
          lifecycleEvent("result_received", 590),
        ],
        execution: {
          status: "reply_published",
          terminalOutcome: terminalOutcome("reply_published", 592),
        },
        resultAcceptedAt: 590,
        visibleAt: 592,
      }),
    });

    expect(timing.totals.byKind).toMatchObject(expected);
    expect(timing.totals.endToEndMs).toBe(592_000);
  });

  it.each<[string, SpaceDispatchTraceSnapshot | null]>([
    ["a Space outbox record without a dispatch trace", null],
    [
      "a hosted Agent whose dispatch has a native delivery",
      {
        ...buildTrace({
          head: buildHead({ createdAt: 0.5, executionLinkedAt: null }),
          events: [],
          execution: null,
        }),
        nativeDelivery: buildNativeDelivery(),
      },
    ],
    [
      "a workstation dispatch whose head could not be read",
      {
        ...buildTrace({ events: [], execution: null }),
        runtimeCoordinatorHeadLifecycle: {
          factSource: "runtime_coordinator_head_lifecycle",
          readStatus: "authority_unavailable",
          reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
          targetWakeLifecycleId: "twl",
        },
      },
    ],
  ])("omits timing for %s", (_case, trace) => {
    expect(
      projectWakeTiming({
        asOfMs: at(600),
        interaction: null,
        requestReceivedAtMs: at(0),
        summaryStatus: "pending",
        trace,
      })
    ).toBeNull();
  });

  it("starts a pending publication at the no-execution decision instead of extending the queue", () => {
    const timing = projectParsed({
      asOfMs: at(600),
      summaryStatus: "pending",
      trace: buildTrace({
        head: buildHead({
          createdAt: 1,
          executionLinkedAt: null,
          noExecutionDecidedAt: 100,
          publicationIntentReadyAt: 100,
        }),
        events: [],
        execution: null,
      }),
    });

    expect(timing.state).toBe("in_progress");
    expect(summarizeSegments(timing)).toEqual([
      ["routing", 1000, null],
      ["queue", 99_000, "daemon.profile.offline"],
      ["publishing", 500_000, null],
    ]);
    expect(timing.segments.at(-1)?.endedAt).toBeNull();
  });

  it("keeps a Wake that never started in the Agent queue until OpenMeld decided its outcome", () => {
    const timing = projectParsed({
      asOfMs: at(400),
      summaryStatus: "failed",
      trace: buildTrace({
        head: buildHead({
          createdAt: 1,
          executionLinkedAt: null,
          noExecutionDecidedAt: 301,
        }),
        events: [],
        execution: null,
        visibleAt: 303,
      }),
    });

    expect(timing.state).toBe("settled");
    expect(summarizeSegments(timing)).toEqual([
      ["routing", 1000, null],
      ["queue", 300_000, "daemon.profile.offline"],
      ["publishing", 2000, null],
    ]);
  });

  it("marks an open stage as not recorded when RuntimeCoordinator reports a later stage than the recorded boundaries", () => {
    const timing = projectParsed({
      asOfMs: at(600),
      summaryStatus: "running",
      trace: buildTrace({
        head: buildHead({ createdAt: 1, executionLinkedAt: 2 }),
        events: [],
        execution: { status: "running" },
      }),
    });

    expect(timing.segments.at(-1)).toEqual({
      kind: "not_recorded",
      startedAt: iso(2),
      endedAt: null,
      durationMs: 598_000,
      reasonCode: null,
    });
    expect(timing.totals.byKind.delivery).toBe(0);
  });

  it.each([
    [
      "Core's arrival time for the request",
      590,
      [
        ["agent_run", 586_000, null],
        [
          "waiting_for_input",
          10_000,
          "runtime_coordinator.interaction_waiting",
        ],
      ],
    ],
    ["no Core arrival time", null, [["not_recorded", 596_000, null]]],
  ] as const)("splits an open Agent run at %s", (_case, requestArrivedAt, expectedTail) => {
    const timing = projectParsed({
      asOfMs: at(600),
      interaction: {
        hasPendingRequest: true,
        updatedAtMs: requestArrivedAt === null ? null : at(requestArrivedAt),
      },
      summaryStatus: "running",
      trace: buildTrace({
        head: buildHead({ createdAt: 1, executionLinkedAt: 2 }),
        events: [
          lifecycleEvent("lifecycle_accepted_local", 3),
          lifecycleEvent("lifecycle_running", 4, { runningAtMs: at(4) }),
        ],
        execution: { status: "running" },
      }),
    });

    expect(summarizeSegments(timing).slice(4)).toEqual(expectedTail);
    expect(timing.lastEvidenceAt).toBe(iso(requestArrivedAt ?? 4));
  });

  it("counts a redelivered execution's Agent run once from its first recorded start", () => {
    const timing = projectParsed({
      asOfMs: at(500),
      summaryStatus: "replied",
      trace: buildTrace({
        head: buildHead({ createdAt: 1, executionLinkedAt: 2 }),
        events: [
          lifecycleEvent("lifecycle_accepted_local", 4, {}, "attempt-1"),
          // The Service clock reported a start before Core saw acceptance.
          lifecycleEvent(
            "lifecycle_running",
            5,
            { runningAtMs: at(3.5) },
            "attempt-1"
          ),
          lifecycleEvent("lifecycle_accepted_local", 300, {}, "attempt-2"),
          lifecycleEvent(
            "lifecycle_running",
            301,
            { runningAtMs: at(3.5) },
            "attempt-2"
          ),
          lifecycleEvent("lifecycle_completed_local", 400, {}, "attempt-2"),
        ],
        execution: {
          status: "reply_published",
          terminalOutcome: terminalOutcome("reply_published", 402),
        },
        resultAcceptedAt: 401,
        visibleAt: 402,
      }),
    });

    expect(summarizeSegments(timing)).toEqual([
      ["routing", 1000, null],
      ["queue", 1000, null],
      ["delivery", 2000, null],
      ["agent_run", 396_000, null],
      ["result_delivery", 1000, null],
      ["publishing", 1000, null],
    ]);
    expect(timing.totals.endToEndMs).toBe(402_000);
  });
});

function projectParsed(
  input: Omit<ProjectWakeTimingInput, "interaction" | "requestReceivedAtMs"> &
    Partial<Pick<ProjectWakeTimingInput, "interaction">>
): WakeTiming {
  return wakeTimingSchema.parse(
    projectWakeTiming({
      interaction: null,
      requestReceivedAtMs: at(0),
      ...input,
    })
  );
}

function summarizeSegments(
  timing: WakeTiming
): [string, number, string | null][] {
  return timing.segments.map((segment) => [
    segment.kind,
    segment.durationMs,
    segment.reasonCode,
  ]);
}

function readMilestoneAt(timing: WakeTiming, name: string): string | null {
  return (
    timing.milestones.find((milestone) => milestone.name === name)?.at ?? null
  );
}

function lifecycleEvent(
  eventType: RuntimeCoordinatorEvent["eventType"],
  observedAtSeconds: number,
  payload: Record<string, unknown> = {},
  attemptId = "attempt-1"
): RuntimeCoordinatorEvent {
  return {
    eventId: `event:${attemptId}:${eventType}:${observedAtSeconds}`,
    eventType,
    factSource: "runtime_coordinator_projection",
    idempotencyKey: `lifecycle:dispatch-1:${attemptId}:${eventType}`,
    observedAtMs: at(observedAtSeconds),
    payloadJson: JSON.stringify(payload),
    reasonCode: null,
    runtimeCoordinatorExecutionId: "rce-1",
    statusAfter: null,
  };
}

function terminalOutcome(
  kind: NonNullable<RuntimeCoordinatorExecution["terminalOutcome"]>["kind"],
  observedAtSeconds: number
): RuntimeCoordinatorExecution["terminalOutcome"] {
  return { kind, reasonCode: null, observedAtMs: at(observedAtSeconds) };
}

function buildHead(input: {
  createdAt: number;
  executionLinkedAt: number | null;
  noExecutionDecidedAt?: number;
  publicationIntentReadyAt?: number;
}): HeadLifecycle {
  const targetWakeLifecycleId = "twl_v1|7:space-1|12:sig-source-1|7:agent-1";
  let status: HeadLifecycle["status"] = "accepted";
  if (input.executionLinkedAt !== null) {
    status = "execution_linked";
  } else if (input.publicationIntentReadyAt !== undefined) {
    status = "publication_intent_ready";
  }
  return {
    createdAt: iso(input.createdAt),
    duplicateDispatchCount: 0,
    executionLinkedAt:
      input.executionLinkedAt === null ? null : iso(input.executionLinkedAt),
    factSource: "runtime_coordinator_head_lifecycle",
    modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
    noExecutionDecision:
      input.noExecutionDecidedAt === undefined
        ? null
        : {
            decidedAt: iso(input.noExecutionDecidedAt),
            publicationCategory: "service_not_connected",
            reasonCode: "daemon.profile.offline",
            source: "runtime_coordinator_head_waiting_deadline",
            userRecoveryAction: "start_or_restart_openmeld_service",
          },
    ownerUserId: "owner-1",
    primaryDispatchId: "dispatch-1",
    publicationIntent:
      input.publicationIntentReadyAt === undefined
        ? null
        : {
            intentId: `rcpi:no_execution:${targetWakeLifecycleId}`,
            kind: "no_execution_failure",
            publicationCategory: "service_not_connected",
            readyAt: iso(input.publicationIntentReadyAt),
            reasonCode: "daemon.profile.offline",
            status: "ready_for_phase_6",
            userRecoveryAction: "start_or_restart_openmeld_service",
          },
    readStatus: "found",
    runtimeCoordinatorExecutionId:
      input.executionLinkedAt === null ? null : "rce-1",
    status,
    targetWakeLifecycleIdentity: {
      modelVersion: "openmeld.target_wake.lifecycle_identity.v1",
      targetWakeLifecycleId,
      spaceId: "space-1",
      sourceSignalId: "sig-source-1",
      clientMessageId: null,
      targetProfileId: "agent-1",
      dispatchId: "dispatch-1",
    },
    targetWakeLifecycleId,
    updatedAt: iso(
      input.noExecutionDecidedAt ?? input.executionLinkedAt ?? input.createdAt
    ),
    waitingBoundary: null,
  };
}

function buildTrace(input: {
  events: RuntimeCoordinatorEvent[];
  execution:
    | Pick<RuntimeCoordinatorExecution, "status" | "terminalOutcome">
    | null
    | {
        status: RuntimeCoordinatorExecution["status"];
      };
  head?: HeadLifecycle;
  resultAcceptedAt?: number;
  visibleAt?: number;
}): SpaceDispatchTraceSnapshot {
  return {
    dispatch: {
      factSource: "dispatch_ledger",
      dispatchId: "dispatch-1",
      idempotencyKey: "idempotency-1",
      sourceEventId: "sig-source-1",
      sourceClientMessageId: null,
      owner: { kind: "owner_account", id: "owner-1" },
      targetProfileId: "agent-1",
      status: input.visibleAt === undefined ? "dispatching" : "succeeded",
      firstSeenAt: iso(0.5),
      lastAttemptAt: iso(0.5),
      attemptCount: 1,
      latestAttemptId: "attempt-1",
    },
    runtimeCoordinatorExecution: input.execution
      ? {
          runtimeCoordinatorExecutionId: "rce-1",
          modelVersion: "openmeld.runtime_coordinator.execution.v1",
          spaceId: "space-1",
          dispatchId: "dispatch-1",
          targetProfileId: "agent-1",
          sourceClientMessageId: null,
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          status: input.execution.status,
          terminalOutcome:
            "terminalOutcome" in input.execution
              ? input.execution.terminalOutcome
              : null,
          createdAtMs: at(2),
          updatedAtMs: at(2),
          legacyPointers: {
            attemptId: "attempt-1",
            claimLeaseId: null,
            daemonSessionId: "daemon-session-1",
            connectionGeneration: 1,
            leaseEpoch: 1,
          },
          factSource: "runtime_coordinator_projection",
        }
      : null,
    runtimeCoordinatorCreationDiagnostics: [],
    runtimeCoordinatorEvents: input.events,
    runtimeCoordinatorHeadLifecycle: input.head ?? null,
    latestAttempt: null,
    executionIdentity: null,
    claimLease: null,
    result: null,
    resultInbox:
      input.resultAcceptedAt === undefined
        ? null
        : {
            factSource: "dispatch_result_inbox",
            resultKey: "result-key-1",
            dispatchId: "dispatch-1",
            attemptId: "attempt-1",
            taskId: "task-1",
            targetProfileId: "agent-1",
            daemonSessionId: "daemon-session-1",
            leaseEpoch: 1,
            submittedConnectionGeneration: 1,
            publishState: "reply_published",
            publishedSignalId: "sig-reply-1",
            publicationErrorCode: null,
            acceptedAt: iso(input.resultAcceptedAt),
            updatedAt: iso(input.visibleAt ?? input.resultAcceptedAt),
          },
    recentOpsDecisions: [],
    replySignal: null,
    finalVisibleMessage:
      input.visibleAt === undefined
        ? null
        : {
            factSource: "space_signal_by_published_signal_id",
            signalId: "sig-reply-1",
            signalType: "signal.text",
            dispatchId: "dispatch-1",
            targetProfileId: "agent-1",
            profileId: "agent-1",
            profileKind: "agent",
            profileName: "Ada",
            text: "Done.",
            reasonCode: null,
            noticeType: null,
            statusType: null,
            createdAt: iso(input.visibleAt),
          },
    streaming: null,
    runtime: null,
    execution: null,
    origin: null,
    prompt: null,
    dispatchExecution: null,
    openClawGatewayVisibility: null,
    openClawBinding: null,
    structuredActionFailure: null,
  };
}

function buildNativeDelivery(): NonNullable<
  SpaceDispatchTraceSnapshot["nativeDelivery"]
> {
  return {
    factSource: "remote_agent_native_delivery_ledger",
    deliveryId: "delivery-1",
    dispatchId: "dispatch-1",
    idempotencyKey: "idempotency-1",
    bindingId: "binding-hosted",
    runtimeFamily: "hosted_center_agent",
    status: "accepted",
    submissionId: null,
    destination: {
      conversationKind: "space",
      organizationId: "org-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    },
    controllerNormalization: {
      factSource: "remote_agent_native_delivery_ledger",
      canonicalAgentControllerRef: "hosted:center-agent",
      reasonCode: "hosted_runtime_family_controller_canonicalized",
      storedAgentControllerRef: null,
      storedAgentControllerRefStatus: "canonical",
      bindingUpdatedAt: null,
    },
    createdAt: iso(0.5),
    updatedAt: iso(0.5),
  };
}
