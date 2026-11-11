import type { z } from "zod/v4";

type WakeTimingMilestoneNameSchema =
  typeof import("../../schemas/http/space-wake-timing")["wakeTimingMilestoneNameSchema"];
type WakeTimingSegmentKindSchema =
  typeof import("../../schemas/http/space-wake-timing")["wakeTimingSegmentKindSchema"];
type WakeTimingStateSchema =
  typeof import("../../schemas/http/space-wake-timing")["wakeTimingStateSchema"];
type WakeTimingMilestoneSchema =
  typeof import("../../schemas/http/space-wake-timing")["wakeTimingMilestoneSchema"];
type WakeTimingSegmentSchema =
  typeof import("../../schemas/http/space-wake-timing")["wakeTimingSegmentSchema"];
type WakeTimingTotalsSchema =
  typeof import("../../schemas/http/space-wake-timing")["wakeTimingTotalsSchema"];
type WakeTimingSchema =
  typeof import("../../schemas/http/space-wake-timing")["wakeTimingSchema"];

export type WakeTimingMilestoneName = z.infer<WakeTimingMilestoneNameSchema>;
export type WakeTimingSegmentKind = z.infer<WakeTimingSegmentKindSchema>;
export type WakeTimingState = z.infer<WakeTimingStateSchema>;
export type WakeTimingMilestone = z.infer<WakeTimingMilestoneSchema>;
export type WakeTimingSegment = z.infer<WakeTimingSegmentSchema>;
export type WakeTimingTotals = z.infer<WakeTimingTotalsSchema>;
export type WakeTiming = z.infer<WakeTimingSchema>;
