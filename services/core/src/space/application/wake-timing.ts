import {
  projectSpaceDispatchTraceFinalVisibleOutcome,
  WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE,
  WAKE_TIMING_MILESTONE_NAMES,
  WAKE_TIMING_MODEL_VERSION,
  WAKE_TIMING_SEGMENT_KINDS,
} from "@openmeld/schemas";
import type {
  SpaceDispatchTraceSnapshot,
  WakeTiming,
  WakeTimingMilestoneName,
  WakeTimingSegment,
  WakeTimingSegmentKind,
  WakeTimingTotals,
  WakeTraceWaterfallSummaryStatus,
} from "@openmeld/schemas/types";
import {
  parseRuntimeCoordinatorEventPayload,
  readPayloadObject,
  resolveLocalQueuePayloadReasonCode,
  resolveRuntimeCoordinatorConversationOccupancyWaitReasonCode,
} from "./wake-trace-waterfall";

type RuntimeCoordinatorEvent =
  SpaceDispatchTraceSnapshot["runtimeCoordinatorEvents"][number];
type FoundHeadLifecycle = Extract<
  NonNullable<SpaceDispatchTraceSnapshot["runtimeCoordinatorHeadLifecycle"]>,
  { readStatus: "found" }
>;
type MilestoneTime = {
  atMs: number | null;
  name: WakeTimingMilestoneName;
  reportedByComputer: boolean;
};
type RecordedMilestone = {
  atMs: number;
  index: number;
  name: WakeTimingMilestoneName;
};
type SegmentDraft = {
  endedAtMs: number | null;
  kind: WakeTimingSegmentKind;
  reasonCode: string | null;
  startedAtMs: number;
};
type ProgressStageKind = Exclude<
  WakeTimingSegmentKind,
  "waiting_for_input" | "not_recorded"
>;

const SEGMENT_KIND_AFTER_MILESTONE = {
  request_received: "routing",
  queued: "queue",
  execution_created: "delivery",
  accepted_on_computer: "startup",
  agent_started: "agent_run",
  agent_finished: "result_delivery",
  result_accepted: "publishing",
  result_visible: null,
} as const satisfies Record<WakeTimingMilestoneName, ProgressStageKind | null>;

// Stages a RuntimeCoordinator decision ends by itself. The computer's stages
// may have ended earlier than the decision that noticed it.
const DECISION_ENDED_STAGES: ReadonlySet<WakeTimingSegmentKind> = new Set([
  "queue",
  "delivery",
  "publishing",
]);
const TERMINAL_SUMMARY_STATUSES: ReadonlySet<WakeTraceWaterfallSummaryStatus> =
  new Set(["failed", "replied", "stopped"]);
const LIFECYCLE_EVIDENCE_EVENT_TYPES: ReadonlySet<
  RuntimeCoordinatorEvent["eventType"]
> = new Set([
  "delivery_accepted",
  "lifecycle_accepted_local",
  "lifecycle_running",
  "lifecycle_completed_local",
  "result_received",
  "result_accepted",
  "runtime_evidence_observed",
  "reply_published",
]);
const HEAD_QUEUED_REASON_CODE = "runtime_coordinator.head_queued";
const INTERACTION_WAITING_REASON_CODE =
  "runtime_coordinator.interaction_waiting";

export type WakeTimingInteraction = {
  hasPendingRequest: boolean;
  /** Core time of the latest interaction change; a pending request's arrival. */
  updatedAtMs: number | null;
};

export type ProjectWakeTimingInput = {
  asOfMs: number;
  /** RuntimeCoordinator's interaction read for the viewer, while work is open. */
  interaction: WakeTimingInteraction | null;
  requestReceivedAtMs: number;
  summaryStatus: WakeTraceWaterfallSummaryStatus;
  trace: SpaceDispatchTraceSnapshot | null;
};

/**
 * Partitions one workstation Wake target's elapsed time using only facts
 * OpenMeld observed. Each interval belongs to exactly one segment; an interval
 * whose stage cannot be placed from recorded boundaries and current
 * RuntimeCoordinator state stays `not_recorded` instead of being attributed to
 * the Agent or to OpenMeld.
 */
export function projectWakeTiming(
  input: ProjectWakeTimingInput
): WakeTiming | null {
  const trace = input.trace;
  if (!(trace && hasWorkstationTimingEvidence(trace))) {
    return null;
  }
  const asOfMs = Math.floor(input.asOfMs);
  const head = readFoundHeadLifecycle(trace);
  const milestones = alignMilestoneTimes(
    readMilestoneTimes({
      head,
      requestReceivedAtMs: input.requestReceivedAtMs,
      trace,
    }),
    asOfMs
  );
  const recorded = milestones.flatMap((milestone, index) =>
    milestone.atMs === null
      ? []
      : [{ atMs: milestone.atMs, index, name: milestone.name }]
  );
  const visible =
    recorded.find((milestone) => milestone.name === "result_visible") ?? null;
  const progress = recorded.filter(
    (milestone) => milestone.name !== "result_visible"
  );
  const lastProgress = progress.at(-1);
  if (!lastProgress) {
    return null;
  }
  const publicationStatus =
    projectSpaceDispatchTraceFinalVisibleOutcome(trace).status;
  const awaitingPublication =
    publicationStatus === "publication_pending" ||
    publicationStatus === "publication_retrying";
  let state: WakeTiming["state"] = "ended";
  if (visible) {
    state = "settled";
  } else if (
    awaitingPublication ||
    !TERMINAL_SUMMARY_STATUSES.has(input.summaryStatus)
  ) {
    state = "in_progress";
  }
  const drafts = [
    ...buildProgressSegments(progress, trace),
    ...buildOutcomeSegments({
      asOfMs,
      awaitingPublication,
      decisionAtMs: readDecisionAtMs({
        asOfMs,
        head,
        lastProgress,
        trace,
        visible,
      }),
      head,
      interaction: input.interaction,
      lastProgress,
      state,
      trace,
      visible,
    }),
  ];
  const segments = mergeSegments(
    drafts
      .map((draft) => toSegment(draft, asOfMs))
      .filter((segment) => segment.endedAt === null || segment.durationMs > 0)
  );

  return {
    modelVersion: WAKE_TIMING_MODEL_VERSION,
    factSource: "platform_observed",
    state,
    asOf: toIso(asOfMs),
    lastEvidenceAt: toIso(
      readLastEvidenceAtMs({
        asOfMs,
        head,
        interaction: input.interaction,
        lastRecordedAtMs: recorded.at(-1)?.atMs ?? lastProgress.atMs,
        trace,
      })
    ),
    milestones: milestones.map((milestone) => ({
      name: milestone.name,
      at: milestone.atMs === null ? null : toIso(milestone.atMs),
    })),
    segments,
    totals: sumSegments(segments),
  };
}

// Only workstation Wakes with RuntimeCoordinator evidence have stages to
// attribute. A Space outbox record without a dispatch trace, a hosted native
// delivery, or an unreadable head carries no comparable boundaries.
function hasWorkstationTimingEvidence(
  trace: SpaceDispatchTraceSnapshot
): boolean {
  return (
    !trace.nativeDelivery &&
    (trace.runtimeCoordinatorExecution !== null ||
      trace.runtimeCoordinatorHeadLifecycle?.readStatus === "found")
  );
}

function readMilestoneTimes(input: {
  head: FoundHeadLifecycle | null;
  requestReceivedAtMs: number;
  trace: SpaceDispatchTraceSnapshot;
}): MilestoneTime[] {
  const { head, trace } = input;
  const events = trace.runtimeCoordinatorEvents;
  const fact = (atMs: number | null) => ({ atMs, reportedByComputer: false });
  const reported = (atMs: number | null) => ({
    atMs,
    reportedByComputer: true,
  });
  const times: Record<WakeTimingMilestoneName, Omit<MilestoneTime, "name">> = {
    request_received: fact(input.requestReceivedAtMs),
    queued: fact(
      parseIsoMs(head?.createdAt) ?? parseIsoMs(trace.dispatch.firstSeenAt)
    ),
    execution_created: fact(
      parseIsoMs(head?.executionLinkedAt) ??
        trace.runtimeCoordinatorExecution?.createdAtMs ??
        null
    ),
    accepted_on_computer: reported(
      readEarliestLifecycleAtMs(events, "lifecycle_accepted_local")
    ),
    // Event observation times are replaced by keepalives; only the recorded
    // first running time is working-start evidence.
    agent_started: reported(readEarliestRunningAtMs(events)),
    // A result can reach Core long after the Agent finished, for example from
    // the Service outbox after a reconnect, so only a completion report counts.
    agent_finished: reported(
      readEarliestLifecycleAtMs(events, "lifecycle_completed_local")
    ),
    // The `result_accepted` event can be written after Space publication.
    result_accepted: fact(parseIsoMs(trace.resultInbox?.acceptedAt)),
    result_visible: fact(readResultVisibleAtMs(trace)),
  };
  return WAKE_TIMING_MILESTONE_NAMES.map((name) => ({
    ...times[name],
    name,
  }));
}

// OpenMeld's own boundaries only move to stay in order. Times the computer
// reported are bounded by Core receipt but may carry clock skew, so they are
// kept inside the window between the surrounding OpenMeld boundaries.
function alignMilestoneTimes(
  milestones: readonly MilestoneTime[],
  asOfMs: number
): MilestoneTime[] {
  let factFloorMs = Number.NEGATIVE_INFINITY;
  const factsAligned = milestones.map((milestone) => {
    if (milestone.atMs === null) {
      return milestone;
    }
    const cappedAtMs = Math.min(asOfMs, Math.floor(milestone.atMs));
    if (milestone.reportedByComputer) {
      return { ...milestone, atMs: cappedAtMs };
    }
    factFloorMs = Math.max(factFloorMs, cappedAtMs);
    return { ...milestone, atMs: factFloorMs };
  });
  let previousAtMs = Number.NEGATIVE_INFINITY;
  return factsAligned.map((milestone, index) => {
    if (milestone.atMs === null) {
      return milestone;
    }
    if (!milestone.reportedByComputer) {
      previousAtMs = milestone.atMs;
      return milestone;
    }
    const nextFactAtMs =
      factsAligned
        .slice(index + 1)
        .find((later) => later.atMs !== null && !later.reportedByComputer)
        ?.atMs ?? asOfMs;
    const atMs = Math.min(nextFactAtMs, Math.max(previousAtMs, milestone.atMs));
    previousAtMs = atMs;
    return { ...milestone, atMs };
  });
}

function buildProgressSegments(
  progress: readonly RecordedMilestone[],
  trace: SpaceDispatchTraceSnapshot
): SegmentDraft[] {
  return progress.flatMap((to, index): SegmentDraft[] => {
    const from = progress[index - 1];
    if (!from) {
      return [];
    }
    const kind =
      to.index === from.index + 1
        ? (SEGMENT_KIND_AFTER_MILESTONE[from.name] ?? "not_recorded")
        : "not_recorded";
    return [
      {
        endedAtMs: to.atMs,
        kind,
        reasonCode:
          kind === "startup" ? readRecordedStartupReasonCode(trace) : null,
        startedAtMs: from.atMs,
      },
    ];
  });
}

function buildOutcomeSegments(input: {
  asOfMs: number;
  awaitingPublication: boolean;
  decisionAtMs: number | null;
  head: FoundHeadLifecycle | null;
  interaction: WakeTimingInteraction | null;
  lastProgress: RecordedMilestone;
  state: WakeTiming["state"];
  trace: SpaceDispatchTraceSnapshot;
  visible: RecordedMilestone | null;
}): SegmentDraft[] {
  const lastStage =
    SEGMENT_KIND_AFTER_MILESTONE[input.lastProgress.name] ?? "not_recorded";
  if (input.decisionAtMs !== null) {
    const decidedStage = DECISION_ENDED_STAGES.has(lastStage)
      ? lastStage
      : "not_recorded";
    const drafts: SegmentDraft[] = [
      {
        endedAtMs: input.decisionAtMs,
        kind: decidedStage,
        reasonCode:
          decidedStage === "queue" ? readHeadWaitReasonCode(input.head) : null,
        startedAtMs: input.lastProgress.atMs,
      },
    ];
    if (input.visible || input.state === "in_progress") {
      drafts.push({
        endedAtMs: input.visible?.atMs ?? null,
        kind: "publishing",
        reasonCode: null,
        startedAtMs: input.decisionAtMs,
      });
    }
    return drafts;
  }
  if (input.visible) {
    return [
      {
        endedAtMs: input.visible.atMs,
        kind:
          input.lastProgress.name === "result_accepted"
            ? "publishing"
            : "not_recorded",
        reasonCode: null,
        startedAtMs: input.lastProgress.atMs,
      },
    ];
  }
  if (input.state !== "in_progress") {
    return [];
  }
  const currentStage = input.awaitingPublication
    ? "publishing"
    : readCurrentStage(input.trace, input.head);
  const kind = currentStage === lastStage ? lastStage : "not_recorded";
  return buildOpenSegments({
    asOfMs: input.asOfMs,
    current: {
      endedAtMs: null,
      kind,
      reasonCode: readOpenReasonCode({
        head: input.head,
        kind,
        trace: input.trace,
      }),
      startedAtMs: input.lastProgress.atMs,
    },
    interaction: input.interaction,
  });
}

function buildOpenSegments(input: {
  asOfMs: number;
  current: SegmentDraft;
  interaction: WakeTimingInteraction | null;
}): SegmentDraft[] {
  if (!input.interaction?.hasPendingRequest) {
    return [input.current];
  }
  const requestArrivedAtMs = input.interaction.updatedAtMs;
  if (requestArrivedAtMs === null) {
    // The Agent is waiting for input, but nothing places when that began.
    return [{ ...input.current, kind: "not_recorded", reasonCode: null }];
  }
  const inputWaitStartedAtMs = Math.min(
    input.asOfMs,
    Math.max(input.current.startedAtMs, Math.floor(requestArrivedAtMs))
  );
  return [
    { ...input.current, endedAtMs: inputWaitStartedAtMs },
    {
      endedAtMs: null,
      kind: "waiting_for_input",
      reasonCode: INTERACTION_WAITING_REASON_CODE,
      startedAtMs: inputWaitStartedAtMs,
    },
  ];
}

// The stage RuntimeCoordinator currently reports. An open segment keeps the
// stage of the last recorded boundary only when this state agrees with it.
function readCurrentStage(
  trace: SpaceDispatchTraceSnapshot,
  head: FoundHeadLifecycle | null
): ProgressStageKind | null {
  const execution = trace.runtimeCoordinatorExecution;
  if (execution) {
    switch (execution.status) {
      case "created":
      case "delivery_pending":
      case "delivery_accepted":
        return "delivery";
      case "accepted_local":
        return "startup";
      case "running":
        return "agent_run";
      case "completed_local":
      case "result_received":
        return "result_delivery";
      case "result_accepted":
      case "reply_published":
        return "publishing";
      default:
        return null;
    }
  }
  return head &&
    (head.status === "accepted" ||
      head.status === "queued" ||
      head.status === "waiting")
    ? "queue"
    : null;
}

function readOpenReasonCode(input: {
  head: FoundHeadLifecycle | null;
  kind: WakeTimingSegmentKind;
  trace: SpaceDispatchTraceSnapshot;
}): string | null {
  switch (input.kind) {
    case "queue":
      return readHeadWaitReasonCode(input.head);
    case "startup":
      return (
        resolveRuntimeCoordinatorConversationOccupancyWaitReasonCode(
          input.trace
        ) ??
        resolveLocalQueuePayloadReasonCode(readLatestLocalQueue(input.trace))
      );
    case "agent_run":
      return resolveRuntimeCoordinatorConversationOccupancyWaitReasonCode(
        input.trace
      );
    default:
      return null;
  }
}

function readHeadWaitReasonCode(
  head: FoundHeadLifecycle | null
): string | null {
  return (
    head?.waitingBoundary?.reasonCode ??
    head?.noExecutionDecision?.reasonCode ??
    (head?.status === "queued" ? HEAD_QUEUED_REASON_CODE : null)
  );
}

// A finished startup keeps the wait the Service reported while the task was
// queued; the later frame that left the queue has no wait reason.
function readRecordedStartupReasonCode(
  trace: SpaceDispatchTraceSnapshot
): string | null {
  const payloads = trace.runtimeCoordinatorEvents
    .filter((event) => event.eventType === "lifecycle_accepted_local")
    .map((event) => parseRuntimeCoordinatorEventPayload(event));
  const occupied = payloads.some(
    (payload) =>
      readPayloadObject(payload, "agentControllerConversationOccupancy")
        ?.state === "occupied"
  );
  if (occupied) {
    return WAKE_PROGRESS_CONTROLLER_CONVERSATION_OCCUPIED_REASON_CODE;
  }
  const localQueues = payloads.map((payload) =>
    readPayloadObject(payload, "localQueue")
  );
  const queued = localQueues.find((queue) => queue?.status === "queued");
  const startingRuntime = localQueues.find(
    (queue) => queue?.status === "starting_runtime"
  );
  return resolveLocalQueuePayloadReasonCode(queued ?? startingRuntime ?? null);
}

function readLatestLocalQueue(
  trace: SpaceDispatchTraceSnapshot
): Record<string, unknown> | null {
  const event = trace.runtimeCoordinatorEvents
    .filter((candidate) => candidate.eventType === "lifecycle_accepted_local")
    .at(-1);
  return event
    ? readPayloadObject(
        parseRuntimeCoordinatorEventPayload(event),
        "localQueue"
      )
    : null;
}

// The RuntimeCoordinator decision that ended work: a final execution outcome
// or a head no-execution decision. A retryable outcome leads to redelivery, so
// it ends nothing. The decision counts only when it follows every recorded
// progress boundary and does not follow Space visibility.
function readDecisionAtMs(input: {
  asOfMs: number;
  head: FoundHeadLifecycle | null;
  lastProgress: RecordedMilestone;
  trace: SpaceDispatchTraceSnapshot;
  visible: RecordedMilestone | null;
}): number | null {
  const terminalOutcome =
    input.trace.runtimeCoordinatorExecution?.terminalOutcome ?? null;
  const decidedAtMs =
    (terminalOutcome && terminalOutcome.kind !== "failed_retryable"
      ? terminalOutcome.observedAtMs
      : null) ??
    parseIsoMs(input.head?.noExecutionDecision?.decidedAt) ??
    parseIsoMs(input.head?.publicationIntent?.readyAt) ??
    null;
  if (decidedAtMs === null) {
    return null;
  }
  const atMs = Math.min(input.asOfMs, Math.floor(decidedAtMs));
  if (
    atMs < input.lastProgress.atMs ||
    (input.visible && atMs > input.visible.atMs)
  ) {
    return null;
  }
  return atMs;
}

function readLastEvidenceAtMs(input: {
  asOfMs: number;
  head: FoundHeadLifecycle | null;
  interaction: WakeTimingInteraction | null;
  lastRecordedAtMs: number;
  trace: SpaceDispatchTraceSnapshot;
}): number {
  const candidates = [
    input.lastRecordedAtMs,
    input.trace.runtimeCoordinatorExecution?.updatedAtMs ?? null,
    parseIsoMs(input.head?.updatedAt),
    input.interaction?.updatedAtMs ?? null,
    ...input.trace.runtimeCoordinatorEvents
      .filter((event) => LIFECYCLE_EVIDENCE_EVENT_TYPES.has(event.eventType))
      .map((event) => event.observedAtMs),
  ].filter((value): value is number => value !== null);
  return Math.min(input.asOfMs, Math.floor(Math.max(...candidates)));
}

function readResultVisibleAtMs(
  trace: SpaceDispatchTraceSnapshot
): number | null {
  if (trace.finalVisibleMessage) {
    return parseIsoMs(trace.finalVisibleMessage.createdAt);
  }
  return trace.replySignal?.factSource === "space_signal_by_published_signal_id"
    ? parseIsoMs(trace.replySignal.createdAt)
    : null;
}

// Service lifecycle times are bounded by Core receipt, matching how
// RuntimeCoordinator records its own local progress.
function readEarliestLifecycleAtMs(
  events: readonly RuntimeCoordinatorEvent[],
  eventType: RuntimeCoordinatorEvent["eventType"]
): number | null {
  return readEarliest(
    events
      .filter((event) => event.eventType === eventType)
      .map((event) => {
        const reportedAtMs =
          parseRuntimeCoordinatorEventPayload(event)?.lifecycleAtMs;
        return isTimestamp(reportedAtMs)
          ? Math.min(reportedAtMs, event.observedAtMs)
          : event.observedAtMs;
      })
  );
}

function readEarliestRunningAtMs(
  events: readonly RuntimeCoordinatorEvent[]
): number | null {
  return readEarliest(
    events
      .filter(
        (event) =>
          event.eventType === "lifecycle_running" ||
          event.eventType === "lifecycle_completed_local"
      )
      .map((event) => parseRuntimeCoordinatorEventPayload(event)?.runningAtMs)
      .filter(isTimestamp)
  );
}

function readEarliest(values: readonly number[]): number | null {
  return values.length > 0 ? Math.min(...values) : null;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function readFoundHeadLifecycle(
  trace: SpaceDispatchTraceSnapshot
): FoundHeadLifecycle | null {
  const head = trace.runtimeCoordinatorHeadLifecycle;
  return head?.readStatus === "found" ? head : null;
}

function toSegment(draft: SegmentDraft, asOfMs: number): WakeTimingSegment {
  return {
    kind: draft.kind,
    startedAt: toIso(draft.startedAtMs),
    endedAt: draft.endedAtMs === null ? null : toIso(draft.endedAtMs),
    durationMs: (draft.endedAtMs ?? asOfMs) - draft.startedAtMs,
    reasonCode: draft.reasonCode,
  };
}

function mergeSegments(
  segments: readonly WakeTimingSegment[]
): WakeTimingSegment[] {
  const merged: WakeTimingSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.endedAt !== null &&
      previous.kind === segment.kind &&
      previous.reasonCode === segment.reasonCode
    ) {
      merged[merged.length - 1] = {
        ...previous,
        endedAt: segment.endedAt,
        durationMs: previous.durationMs + segment.durationMs,
      };
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

function sumSegments(segments: readonly WakeTimingSegment[]): WakeTimingTotals {
  const byKind = Object.fromEntries(
    WAKE_TIMING_SEGMENT_KINDS.map((kind) => [kind, 0])
  ) as WakeTimingTotals["byKind"];
  let endToEndMs = 0;
  for (const segment of segments) {
    byKind[segment.kind] += segment.durationMs;
    endToEndMs += segment.durationMs;
  }
  return { endToEndMs, byKind };
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(valueMs: number): string {
  return new Date(valueMs).toISOString();
}
