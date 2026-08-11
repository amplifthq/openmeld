import type { z } from "zod/v4";

type WakeTraceWaterfallStepNameSchema =
  typeof import("../../schemas/http/space-wake-trace-waterfall")["wakeTraceWaterfallStepNameSchema"];
type WakeTraceWaterfallStepStatusSchema =
  typeof import("../../schemas/http/space-wake-trace-waterfall")["wakeTraceWaterfallStepStatusSchema"];
type WakeTraceWaterfallSummaryStatusSchema =
  typeof import("../../schemas/http/space-wake-trace-waterfall")["wakeTraceWaterfallSummaryStatusSchema"];
type WakeTraceWaterfallFactSourceSchema =
  typeof import("../../schemas/http/space-wake-trace-waterfall")["wakeTraceWaterfallFactSourceSchema"];
type WakeTargetExecutionContextResolutionStatusSchema =
  typeof import("../../schemas/http/space-wake-trace-waterfall")["wakeTargetExecutionContextResolutionStatusSchema"];
type WakeTargetExecutionContextFactSourceSchema =
  typeof import("../../schemas/http/space-wake-trace-waterfall")["wakeTargetExecutionContextFactSourceSchema"];
type WakeTargetExecutionContextSchema =
  typeof import("../../schemas/http/space-wake-trace-waterfall")["wakeTargetExecutionContextSchema"];
type WakeTraceWaterfallStepIdsSchema =
  typeof import("../../schemas/http/space-wake-trace-waterfall")["wakeTraceWaterfallStepIdsSchema"];
type WakeTraceWaterfallStepSchema =
  typeof import("../../schemas/http/space-wake-trace-waterfall")["wakeTraceWaterfallStepSchema"];
type WakeTraceWaterfallItemSchema =
  typeof import("../../schemas/http/space-wake-trace-waterfall")["wakeTraceWaterfallItemSchema"];
type GetSpaceWakeTraceWaterfallInputSchema =
  typeof import("../../schemas/http/space-wake-trace-waterfall")["getSpaceWakeTraceWaterfallInputSchema"];
type GetSpaceWakeTraceWaterfallResponseSchema =
  typeof import("../../schemas/http/space-wake-trace-waterfall")["getSpaceWakeTraceWaterfallResponseSchema"];

export type WakeTraceWaterfallStepName =
  z.infer<WakeTraceWaterfallStepNameSchema>;
export type WakeTraceWaterfallStepStatus =
  z.infer<WakeTraceWaterfallStepStatusSchema>;
export type WakeTraceWaterfallSummaryStatus =
  z.infer<WakeTraceWaterfallSummaryStatusSchema>;
export type WakeTraceWaterfallFactSource =
  z.infer<WakeTraceWaterfallFactSourceSchema>;
export type WakeTargetExecutionContextResolutionStatus =
  z.infer<WakeTargetExecutionContextResolutionStatusSchema>;
export type WakeTargetExecutionContextFactSource =
  z.infer<WakeTargetExecutionContextFactSourceSchema>;
export type WakeTargetExecutionContext =
  z.infer<WakeTargetExecutionContextSchema>;
export type WakeTraceWaterfallStepIds =
  z.infer<WakeTraceWaterfallStepIdsSchema>;
export type WakeTraceWaterfallStep = z.infer<WakeTraceWaterfallStepSchema>;
export type WakeTraceWaterfallItem = z.infer<WakeTraceWaterfallItemSchema>;
export type GetSpaceWakeTraceWaterfallInput =
  z.infer<GetSpaceWakeTraceWaterfallInputSchema>;
export type GetSpaceWakeTraceWaterfallResponse =
  z.infer<GetSpaceWakeTraceWaterfallResponseSchema>;
