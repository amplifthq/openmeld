import { wakeTimingSchema } from "@openmeld/schemas";
import type {
  SpaceDispatchTraceSnapshot,
  WakeTiming,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { projectWakeTiming } from "../space/application/wake-timing";

type RuntimeCoordinatorEvent =
  SpaceDispatchTraceSnapshot["runtimeCoordinatorEvents"][number];
type HeadLifecycle = Extract<
  NonNullable<SpaceDispatchTraceSnapshot["runtimeCoordinatorHeadLifecycle"]>,
  { readStatus: "found" }
>;

const T0 = Date.parse("2026-05-13T00:00:00.000Z");
const at = (seconds: number) => T0 + seconds * 1000;
const iso = (seconds: number) => new Date(at(seconds)).toISOString();

describe("Wake timing projection", () => {
  it("attributes a finished Wake to platform, startup wait, and Agent run without double counting", () => {
    const timing = projectParsed({
      asOfMs: at(700),
      pendingInteractionRequestedAtMs: null,
      requestReceivedAtMs: at(0),
      summaryStatus: "replied",
      trace: buildTrace({
        head: buildHead({ createdAt: iso(3), executionLinkedAt: iso(5) }),
        events: [
          lifecycleEvent("lifecycle_accepted_local", 6, {
            localQueue: { status: "queued", waitReason: "workspace_conflict" },
          }),
          lifecycleEvent("lifecycle_accepted_local", 66, {
            localQueue: { status: "ready" },
          }),
          lifecycleEvent("lifecycle_running", 67, { runningAtMs: at(66.5) }),
          lifecycleEvent("lifecycle_completed_local", 667, {
            runningAtMs: at(66.5),
          }),
          lifecycleEvent("result_accepted", 667.2),
        ],
        visibleAt: iso(669),
      }),
    });

    expect(timing.state).toBe("settled");
    expect(summarizeSegments(timing)).toEqual([
      ["routing", 3000, null],
      ["queue", 2000, null],
      ["delivery", 1000, null],
      ["startup", 60_500, "runtime.local_queue.waiting_workspace_conflict"],
      ["agent_run", 600_500, null],
      ["result_delivery", 200, null],
      ["publishing", 1800, null],
    ]);
    expect(timing.totals.endToEndMs).toBe(669_000);
    expect(timing.totals.byKind.agent_run).toBe(600_500);
  });

  it("counts a redelivered execution's Agent run once from its first recorded start", () => {
    const timing = projectParsed({
      asOfMs: at(500),
      pendingInteractionRequestedAtMs: null,
      requestReceivedAtMs: at(0),
      summaryStatus: "replied",
      trace: buildTrace({
        head: buildHead({ createdAt: iso(1), executionLinkedAt: iso(2) }),
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
          lifecycleEvent(
            "lifecycle_completed_local",
            400,
            { runningAtMs: at(3.5) },
            "attempt-2"
          ),
          lifecycleEvent("result_accepted", 401),
        ],
        visibleAt: iso(402),
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

  it("splits the open Agent run at an unanswered input request", () => {
    const timing = projectParsed({
      asOfMs: at(1000),
      pendingInteractionRequestedAtMs: at(400),
      requestReceivedAtMs: at(0),
      summaryStatus: "running",
      trace: buildTrace({
        head: buildHead({ createdAt: iso(1), executionLinkedAt: iso(2) }),
        events: [
          lifecycleEvent("lifecycle_accepted_local", 3),
          lifecycleEvent("lifecycle_running", 4, { runningAtMs: at(4) }),
        ],
        updatedAtMs: at(990),
      }),
    });

    expect(timing.state).toBe("in_progress");
    expect(timing.segments.at(-1)).toEqual({
      kind: "waiting_for_input",
      startedAt: iso(400),
      endedAt: null,
      durationMs: 600_000,
      reasonCode: "runtime_coordinator.interaction_waiting",
    });
    expect(timing.totals.byKind.agent_run).toBe(396_000);
    expect(timing.totals.endToEndMs).toBe(1_000_000);
    expect(timing.lastEvidenceAt).toBe(iso(990));
  });

  it("keeps time between unrecorded boundaries as not recorded", () => {
    const timing = projectParsed({
      asOfMs: at(600),
      pendingInteractionRequestedAtMs: null,
      requestReceivedAtMs: at(0),
      summaryStatus: "replied",
      trace: buildTrace({
        head: buildHead({ createdAt: iso(1), executionLinkedAt: iso(2) }),
        events: [
          lifecycleEvent("lifecycle_completed_local", 500),
          lifecycleEvent("result_accepted", 501),
        ],
        visibleAt: iso(502),
      }),
    });

    expect(summarizeSegments(timing)).toEqual([
      ["routing", 1000, null],
      ["queue", 1000, null],
      ["not_recorded", 498_000, null],
      ["result_delivery", 1000, null],
      ["publishing", 1000, null],
    ]);
    expect(
      timing.milestones
        .filter((milestone) => milestone.at === null)
        .map((milestone) => milestone.name)
    ).toEqual(["accepted_on_computer", "agent_started"]);
    expect(timing.totals.byKind.agent_run).toBe(0);
  });

  it("keeps a Wake that never started in the Agent queue until OpenMeld decided its outcome", () => {
    const timing = projectParsed({
      asOfMs: at(400),
      pendingInteractionRequestedAtMs: null,
      requestReceivedAtMs: at(0),
      summaryStatus: "failed",
      trace: {
        ...buildTrace({
          head: buildHead({
            createdAt: iso(1),
            executionLinkedAt: null,
            noExecutionDecidedAt: iso(301),
          }),
          events: [],
          visibleAt: iso(303),
        }),
        runtimeCoordinatorExecution: null,
      },
    });

    expect(timing.state).toBe("settled");
    expect(summarizeSegments(timing)).toEqual([
      ["routing", 1000, null],
      ["queue", 300_000, "daemon.profile.offline"],
      ["publishing", 2000, null],
    ]);
  });
});

function projectParsed(
  input: Parameters<typeof projectWakeTiming>[0]
): WakeTiming {
  const timing = projectWakeTiming(input);
  return wakeTimingSchema.parse(timing);
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

function buildHead(input: {
  createdAt: string;
  executionLinkedAt: string | null;
  noExecutionDecidedAt?: string;
}): HeadLifecycle {
  const targetWakeLifecycleId = "twl_v1|7:space-1|12:sig-source-1|7:agent-1";
  return {
    createdAt: input.createdAt,
    duplicateDispatchCount: 0,
    executionLinkedAt: input.executionLinkedAt,
    factSource: "runtime_coordinator_head_lifecycle",
    modelVersion: "openmeld.runtime_coordinator.head_lifecycle.v1",
    noExecutionDecision: input.noExecutionDecidedAt
      ? {
          decidedAt: input.noExecutionDecidedAt,
          publicationCategory: "service_not_connected",
          reasonCode: "daemon.profile.offline",
          source: "runtime_coordinator_head_waiting_deadline",
          userRecoveryAction: "start_or_restart_openmeld_service",
        }
      : null,
    ownerUserId: "owner-1",
    primaryDispatchId: "dispatch-1",
    publicationIntent: null,
    readStatus: "found",
    runtimeCoordinatorExecutionId: input.executionLinkedAt ? "rce-1" : null,
    status: input.executionLinkedAt ? "execution_linked" : "accepted",
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
    updatedAt: input.noExecutionDecidedAt ?? input.createdAt,
    waitingBoundary: null,
  };
}

function buildTrace(input: {
  events: RuntimeCoordinatorEvent[];
  head: HeadLifecycle;
  updatedAtMs?: number;
  visibleAt?: string;
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
      status: input.visibleAt ? "succeeded" : "dispatching",
      firstSeenAt: iso(0.5),
      lastAttemptAt: iso(0.5),
      attemptCount: 1,
      latestAttemptId: "attempt-1",
    },
    runtimeCoordinatorExecution: {
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
      status: input.visibleAt ? "reply_published" : "running",
      terminalOutcome: input.visibleAt
        ? {
            kind: "reply_published",
            reasonCode: null,
            observedAtMs: Date.parse(input.visibleAt),
          }
        : null,
      createdAtMs: at(2),
      updatedAtMs: input.updatedAtMs ?? at(2),
      legacyPointers: {
        attemptId: "attempt-1",
        claimLeaseId: null,
        daemonSessionId: "daemon-session-1",
        connectionGeneration: 1,
        leaseEpoch: 1,
      },
      factSource: "runtime_coordinator_projection",
    },
    runtimeCoordinatorCreationDiagnostics: [],
    runtimeCoordinatorEvents: input.events,
    runtimeCoordinatorHeadLifecycle: input.head,
    latestAttempt: null,
    executionIdentity: null,
    claimLease: null,
    result: null,
    resultInbox: null,
    recentOpsDecisions: [],
    replySignal: null,
    finalVisibleMessage: input.visibleAt
      ? {
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
          createdAt: input.visibleAt,
        }
      : null,
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
