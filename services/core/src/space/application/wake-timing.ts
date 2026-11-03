import {
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
type MilestoneTime = { atMs: number | null; name: WakeTimingMilestoneName };
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

const SEGMENT_KIND_AFTER_MILESTONE = {
  request_received: "routing",
  queued: "queue",
  execution_created: "delivery",
  accepted_on_computer: "startup",
  agent_started: "agent_run",
  agent_finished: "result_delivery",
  result_accepted: "publishing",
  result_visible: null,
} as const satisfies Record<
  WakeTimingMilestoneName,
  WakeTimingSegmentKind | null
>;

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
const AGENT_STARTED_MILESTONE_INDEX =
  WAKE_TIMING_MILESTONE_NAMES.indexOf("agent_started");
const HEAD_QUEUED_REASON_CODE = "runtime_coordinator.head_queued";
const INTERACTION_WAITING_REASON_CODE =
  "runtime_coordinator.interaction_waiting";

export type ProjectWakeTimingInput = {
  asOfMs: number;
  /** Core time at which the Agent's still-unanswered request reached Core. */
  pendingInteractionRequestedAtMs: number | null;
  requestReceivedAtMs: number | null;
  summaryStatus: WakeTraceWaterfallSummaryStatus;
  trace: SpaceDispatchTraceSnapshot | null;
};

/**
 * Partitions one workstation Wake target's elapsed time using only facts
 * OpenMeld observed. Each interval belongs to exactly one segment; an interval
 * whose boundaries were not recorded stays `not_recorded` instead of being
 * attributed to the Agent or to OpenMeld.
 */
export function projectWakeTiming(
  input: ProjectWakeTimingInput
): WakeTiming | null {
  const asOfMs = Math.floor(input.asOfMs);
  const milestones = clampMilestoneTimes(readMilestoneTimes(input), asOfMs);
  const recorded = milestones.flatMap((milestone, index) =>
    milestone.atMs === null
      ? []
      : [{ atMs: milestone.atMs, index, name: milestone.name }]
  );
  const last = recorded.at(-1);
  if (!last) {
    return null;
  }
  const head = readFoundHeadLifecycle(input.trace);
  const terminalAtMs = readTerminalAtMs(input.trace, head, asOfMs);
  let state: WakeTiming["state"] = "in_progress";
  if (last.name === "result_visible") {
    state = "settled";
  } else if (TERMINAL_SUMMARY_STATUSES.has(input.summaryStatus)) {
    state = "ended";
  }
  const drafts = [
    ...buildRecordedSegments({
      head,
      recorded,
      terminalAtMs,
      trace: input.trace,
    }),
    ...buildTailSegments({
      asOfMs,
      head,
      last,
      pendingInteractionRequestedAtMs: input.pendingInteractionRequestedAtMs,
      state,
      terminalAtMs,
      trace: input.trace,
    }),
  ];
  const segments = drafts
    .map((draft) => toSegment(draft, asOfMs))
    .filter((segment) => segment.endedAt === null || segment.durationMs > 0);

  return {
    modelVersion: WAKE_TIMING_MODEL_VERSION,
    factSource: "platform_observed",
    state,
    asOf: toIso(asOfMs),
    lastEvidenceAt: toIso(
      readLastEvidenceAtMs({ asOfMs, head, last, trace: input.trace })
    ),
    milestones: milestones.map((milestone) => ({
      name: milestone.name,
      at: milestone.atMs === null ? null : toIso(milestone.atMs),
    })),
    segments,
    totals: sumSegments(segments),
  };
}

function readMilestoneTimes(input: ProjectWakeTimingInput): MilestoneTime[] {
  const trace = input.trace;
  const head = readFoundHeadLifecycle(trace);
  const events = trace?.runtimeCoordinatorEvents ?? [];
  const finalVisibleAt =
    trace?.finalVisibleMessage?.createdAt ??
    trace?.replySignal?.createdAt ??
    null;
  const times: Record<WakeTimingMilestoneName, number | null> = {
    request_received: input.requestReceivedAtMs,
    queued:
      parseIsoMs(head?.createdAt) ?? parseIsoMs(trace?.dispatch.firstSeenAt),
    execution_created:
      parseIsoMs(head?.executionLinkedAt) ??
      trace?.runtimeCoordinatorExecution?.createdAtMs ??
      null,
    accepted_on_computer: readEarliestEventAtMs(
      events,
      "lifecycle_accepted_local"
    ),
    // Event observation times are replaced by keepalives; only the recorded
    // first running time is working-start evidence.
    agent_started: readEarliestRunningAtMs(events),
    agent_finished:
      readEarliestEventAtMs(events, "lifecycle_completed_local") ??
      readEarliestEventAtMs(events, "result_received"),
    result_accepted:
      readEarliestEventAtMs(events, "result_accepted") ??
      parseIsoMs(trace?.resultInbox?.acceptedAt),
    result_visible: parseIsoMs(finalVisibleAt),
  };
  return WAKE_TIMING_MILESTONE_NAMES.map((name) => ({
    atMs: times[name],
    name,
  }));
}

// Service-reported and Core-observed times can disagree slightly; a later
// boundary is never placed before an earlier one or after `asOf`.
function clampMilestoneTimes(
  milestones: readonly MilestoneTime[],
  asOfMs: number
): MilestoneTime[] {
  let floorMs = Number.NEGATIVE_INFINITY;
  return milestones.map((milestone) => {
    if (milestone.atMs === null) {
      return milestone;
    }
    const atMs = Math.min(
      asOfMs,
      Math.max(floorMs, Math.floor(milestone.atMs))
    );
    floorMs = atMs;
    return { ...milestone, atMs };
  });
}

function buildRecordedSegments(input: {
  head: FoundHeadLifecycle | null;
  recorded: readonly RecordedMilestone[];
  terminalAtMs: number | null;
  trace: SpaceDispatchTraceSnapshot | null;
}): SegmentDraft[] {
  const drafts: SegmentDraft[] = [];
  for (const [index, to] of input.recorded.entries()) {
    const from = input.recorded[index - 1];
    if (!from) {
      continue;
    }
    const kind = SEGMENT_KIND_AFTER_MILESTONE[from.name];
    if (kind && to.index === from.index + 1) {
      drafts.push({
        endedAtMs: to.atMs,
        kind,
        reasonCode:
          kind === "startup"
            ? readRecordedStartupReasonCode(input.trace)
            : null,
        startedAtMs: from.atMs,
      });
      continue;
    }
    drafts.push(
      ...buildEndedBeforeFinishSegments({
        from,
        head: input.head,
        terminalAtMs: input.terminalAtMs,
        to,
        trace: input.trace,
      })
    );
  }
  return drafts;
}

// A Wake that ended before its Agent finished (no-execution failure, expired
// device wait, stop, or runtime loss) stays in its last stage until the
// recorded terminal decision, then OpenMeld posts the outcome. Any other gap
// between non-adjacent boundaries has no covering evidence.
function buildEndedBeforeFinishSegments(input: {
  from: RecordedMilestone;
  head: FoundHeadLifecycle | null;
  terminalAtMs: number | null;
  to: RecordedMilestone;
  trace: SpaceDispatchTraceSnapshot | null;
}): SegmentDraft[] {
  const kind = SEGMENT_KIND_AFTER_MILESTONE[input.from.name];
  const terminalAtMs = input.terminalAtMs;
  if (
    !kind ||
    input.to.name !== "result_visible" ||
    input.from.index > AGENT_STARTED_MILESTONE_INDEX ||
    input.trace?.runtimeCoordinatorExecution?.terminalOutcome?.kind ===
      "reply_published" ||
    terminalAtMs === null ||
    terminalAtMs < input.from.atMs ||
    terminalAtMs > input.to.atMs
  ) {
    return [
      {
        endedAtMs: input.to.atMs,
        kind: "not_recorded",
        reasonCode: null,
        startedAtMs: input.from.atMs,
      },
    ];
  }
  return [
    {
      endedAtMs: terminalAtMs,
      kind,
      reasonCode: readTailReasonCode({
        head: input.head,
        kind,
        open: false,
        trace: input.trace,
      }),
      startedAtMs: input.from.atMs,
    },
    {
      endedAtMs: input.to.atMs,
      kind: "publishing",
      reasonCode: null,
      startedAtMs: terminalAtMs,
    },
  ];
}

function buildTailSegments(input: {
  asOfMs: number;
  head: FoundHeadLifecycle | null;
  last: RecordedMilestone;
  pendingInteractionRequestedAtMs: number | null;
  state: WakeTiming["state"];
  terminalAtMs: number | null;
  trace: SpaceDispatchTraceSnapshot | null;
}): SegmentDraft[] {
  const kind = SEGMENT_KIND_AFTER_MILESTONE[input.last.name];
  if (!kind || input.state === "settled") {
    return [];
  }
  if (input.state === "ended") {
    const endedAtMs = input.terminalAtMs;
    if (endedAtMs === null || endedAtMs <= input.last.atMs) {
      return [];
    }
    return [
      {
        endedAtMs,
        kind,
        reasonCode: readTailReasonCode({
          head: input.head,
          kind,
          open: false,
          trace: input.trace,
        }),
        startedAtMs: input.last.atMs,
      },
    ];
  }
  const current: SegmentDraft = {
    endedAtMs: null,
    kind,
    reasonCode: readTailReasonCode({
      head: input.head,
      kind,
      open: true,
      trace: input.trace,
    }),
    startedAtMs: input.last.atMs,
  };
  if (
    input.pendingInteractionRequestedAtMs === null ||
    !(kind === "startup" || kind === "agent_run")
  ) {
    return [current];
  }
  const inputWaitStartedAtMs = Math.min(
    input.asOfMs,
    Math.max(input.last.atMs, Math.floor(input.pendingInteractionRequestedAtMs))
  );
  return [
    { ...current, endedAtMs: inputWaitStartedAtMs },
    {
      endedAtMs: null,
      kind: "waiting_for_input",
      reasonCode: INTERACTION_WAITING_REASON_CODE,
      startedAtMs: inputWaitStartedAtMs,
    },
  ];
}

function readTailReasonCode(input: {
  head: FoundHeadLifecycle | null;
  kind: WakeTimingSegmentKind;
  open: boolean;
  trace: SpaceDispatchTraceSnapshot | null;
}): string | null {
  switch (input.kind) {
    case "queue":
      return (
        input.head?.waitingBoundary?.reasonCode ??
        input.head?.noExecutionDecision?.reasonCode ??
        (input.head?.status === "queued" ? HEAD_QUEUED_REASON_CODE : null)
      );
    case "startup":
      return input.open
        ? (resolveRuntimeCoordinatorConversationOccupancyWaitReasonCode(
            input.trace
          ) ??
            resolveLocalQueuePayloadReasonCode(
              readLatestLocalQueue(input.trace)
            ))
        : readRecordedStartupReasonCode(input.trace);
    case "agent_run":
      return input.open
        ? resolveRuntimeCoordinatorConversationOccupancyWaitReasonCode(
            input.trace
          )
        : null;
    default:
      return null;
  }
}

// A finished startup keeps the wait the Service reported while the task was
// queued; the later frame that left the queue has no wait reason.
function readRecordedStartupReasonCode(
  trace: SpaceDispatchTraceSnapshot | null
): string | null {
  const payloads = (trace?.runtimeCoordinatorEvents ?? [])
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
  trace: SpaceDispatchTraceSnapshot | null
): Record<string, unknown> | null {
  const event = (trace?.runtimeCoordinatorEvents ?? [])
    .filter((candidate) => candidate.eventType === "lifecycle_accepted_local")
    .at(-1);
  return event
    ? readPayloadObject(
        parseRuntimeCoordinatorEventPayload(event),
        "localQueue"
      )
    : null;
}

function readTerminalAtMs(
  trace: SpaceDispatchTraceSnapshot | null,
  head: FoundHeadLifecycle | null,
  asOfMs: number
): number | null {
  const terminalAtMs =
    trace?.runtimeCoordinatorExecution?.terminalOutcome?.observedAtMs ??
    parseIsoMs(head?.noExecutionDecision?.decidedAt) ??
    parseIsoMs(head?.publicationIntent?.readyAt) ??
    null;
  return terminalAtMs === null
    ? null
    : Math.min(asOfMs, Math.floor(terminalAtMs));
}

function readLastEvidenceAtMs(input: {
  asOfMs: number;
  head: FoundHeadLifecycle | null;
  last: RecordedMilestone;
  trace: SpaceDispatchTraceSnapshot | null;
}): number {
  const candidates = [
    input.last.atMs,
    input.trace?.runtimeCoordinatorExecution?.updatedAtMs ?? null,
    parseIsoMs(input.head?.updatedAt),
    ...(input.trace?.runtimeCoordinatorEvents ?? [])
      .filter((event) => LIFECYCLE_EVIDENCE_EVENT_TYPES.has(event.eventType))
      .map((event) => event.observedAtMs),
  ].filter((value): value is number => value !== null);
  return Math.min(input.asOfMs, Math.floor(Math.max(...candidates)));
}

function readEarliestEventAtMs(
  events: readonly RuntimeCoordinatorEvent[],
  eventType: RuntimeCoordinatorEvent["eventType"]
): number | null {
  return readEarliest(
    events
      .filter((event) => event.eventType === eventType)
      .map((event) => event.observedAtMs)
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
      .filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value) && value >= 0
      )
  );
}

function readEarliest(values: readonly number[]): number | null {
  return values.length > 0 ? Math.min(...values) : null;
}

function readFoundHeadLifecycle(
  trace: SpaceDispatchTraceSnapshot | null
): FoundHeadLifecycle | null {
  const head = trace?.runtimeCoordinatorHeadLifecycle ?? null;
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
