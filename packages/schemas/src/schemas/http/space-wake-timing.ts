import * as z from "zod/v4";

export const WAKE_TIMING_MODEL_VERSION = "openmeld.wake_timing.v1" as const;

/** Platform-observed boundaries of one Wake target, in canonical order. */
export const WAKE_TIMING_MILESTONE_NAMES = [
  "request_received",
  "queued",
  "execution_created",
  "accepted_on_computer",
  "agent_started",
  "agent_finished",
  "result_accepted",
  "result_visible",
] as const;

export const WAKE_TIMING_SEGMENT_KINDS = [
  "routing",
  "queue",
  "delivery",
  "startup",
  "agent_run",
  "waiting_for_input",
  "result_delivery",
  "publishing",
  "not_recorded",
] as const;

const WAKE_TIMING_SEGMENT_MAX_ITEMS = 16;

export const wakeTimingMilestoneNameSchema = z.enum(
  WAKE_TIMING_MILESTONE_NAMES
);

export const wakeTimingSegmentKindSchema = z.enum(WAKE_TIMING_SEGMENT_KINDS);

export const wakeTimingStateSchema = z.enum([
  "in_progress",
  "settled",
  "ended",
]);

const isoDateTimeSchema = z.iso.datetime({ offset: true });
const durationMsSchema = z.int().nonnegative();

export const wakeTimingMilestoneSchema = z.strictObject({
  name: wakeTimingMilestoneNameSchema,
  at: isoDateTimeSchema.nullable(),
});

export const wakeTimingSegmentSchema = z.strictObject({
  kind: wakeTimingSegmentKindSchema,
  startedAt: isoDateTimeSchema,
  // Null only for the segment still open at `asOf`.
  endedAt: isoDateTimeSchema.nullable(),
  durationMs: durationMsSchema,
  reasonCode: z.string().trim().min(1).max(160).nullable(),
});

export const wakeTimingTotalsByKindSchema = z.strictObject({
  routing: durationMsSchema,
  queue: durationMsSchema,
  delivery: durationMsSchema,
  startup: durationMsSchema,
  agent_run: durationMsSchema,
  waiting_for_input: durationMsSchema,
  result_delivery: durationMsSchema,
  publishing: durationMsSchema,
  not_recorded: durationMsSchema,
});

export const wakeTimingTotalsSchema = z.strictObject({
  endToEndMs: durationMsSchema,
  byKind: wakeTimingTotalsByKindSchema,
});

/**
 * One Wake target's elapsed time, partitioned into contiguous segments from
 * OpenMeld's own observations. Segments never overlap, so `byKind` always sums
 * to `endToEndMs`; time without covering evidence is `not_recorded`.
 */
export const wakeTimingSchema = z
  .strictObject({
    modelVersion: z.literal(WAKE_TIMING_MODEL_VERSION),
    factSource: z.literal("platform_observed"),
    state: wakeTimingStateSchema,
    asOf: isoDateTimeSchema,
    lastEvidenceAt: isoDateTimeSchema,
    milestones: z
      .array(wakeTimingMilestoneSchema)
      .length(WAKE_TIMING_MILESTONE_NAMES.length),
    segments: z
      .array(wakeTimingSegmentSchema)
      .max(WAKE_TIMING_SEGMENT_MAX_ITEMS),
    totals: wakeTimingTotalsSchema,
  })
  .superRefine((value, context) => {
    validateWakeTimingMilestones(value, context);
    validateWakeTimingSegments(value, context);
    validateWakeTimingTotals(value, context);
  });

type WakeTimingValue = z.infer<typeof wakeTimingSchema>;

function validateWakeTimingMilestones(
  value: WakeTimingValue,
  context: z.RefinementCtx
): void {
  let previousAtMs = Number.NEGATIVE_INFINITY;
  for (const [index, milestone] of value.milestones.entries()) {
    if (milestone.name !== WAKE_TIMING_MILESTONE_NAMES[index]) {
      context.addIssue({
        code: "custom",
        message: "timing milestones must follow the canonical order",
        path: ["milestones", index, "name"],
      });
    }
    if (milestone.at === null) {
      continue;
    }
    const atMs = Date.parse(milestone.at);
    if (atMs < previousAtMs) {
      context.addIssue({
        code: "custom",
        message: "recorded timing milestones must not move backward",
        path: ["milestones", index, "at"],
      });
    }
    previousAtMs = atMs;
  }
}

function validateWakeTimingSegments(
  value: WakeTimingValue,
  context: z.RefinementCtx
): void {
  const asOfMs = Date.parse(value.asOf);
  for (const [index, segment] of value.segments.entries()) {
    const isLast = index === value.segments.length - 1;
    if (
      segment.endedAt === null &&
      !(isLast && value.state === "in_progress")
    ) {
      context.addIssue({
        code: "custom",
        message: "only the last segment of in-progress timing may be open",
        path: ["segments", index, "endedAt"],
      });
    }
    const startedAtMs = Date.parse(segment.startedAt);
    const endedAtMs =
      segment.endedAt === null ? asOfMs : Date.parse(segment.endedAt);
    if (segment.durationMs !== endedAtMs - startedAtMs) {
      context.addIssue({
        code: "custom",
        message: "segment duration must match its start and end",
        path: ["segments", index, "durationMs"],
      });
    }
    const next = value.segments[index + 1];
    if (next && next.startedAt !== segment.endedAt) {
      context.addIssue({
        code: "custom",
        message: "timing segments must be contiguous and must not overlap",
        path: ["segments", index + 1, "startedAt"],
      });
    }
  }
  const last = value.segments.at(-1);
  if (value.state === "in_progress" && last && last.endedAt !== null) {
    context.addIssue({
      code: "custom",
      message: "in-progress timing must end with an open segment",
      path: ["segments", value.segments.length - 1, "endedAt"],
    });
  }
}

function validateWakeTimingTotals(
  value: WakeTimingValue,
  context: z.RefinementCtx
): void {
  let endToEndMs = 0;
  for (const kind of WAKE_TIMING_SEGMENT_KINDS) {
    const kindMs = value.segments
      .filter((segment) => segment.kind === kind)
      .reduce((sum, segment) => sum + segment.durationMs, 0);
    endToEndMs += kindMs;
    if (value.totals.byKind[kind] !== kindMs) {
      context.addIssue({
        code: "custom",
        message: "timing totals must equal the sum of their segments",
        path: ["totals", "byKind", kind],
      });
    }
  }
  if (value.totals.endToEndMs !== endToEndMs) {
    context.addIssue({
      code: "custom",
      message: "end-to-end time must equal the sum of all segments",
      path: ["totals", "endToEndMs"],
    });
  }
}
