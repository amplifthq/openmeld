import type { z } from "zod/v4";

type EvalSpaceSignalMetricsInputSchema =
  typeof import("../schemas/eval-report")["evalSpaceSignalMetricsInputSchema"];
type EvalSpaceSignalMetricsSchema =
  typeof import("../schemas/eval-report")["evalSpaceSignalMetricsSchema"];
type OrganizationWeeklyEvalMetricsSchema =
  typeof import("../schemas/eval-report")["organizationWeeklyEvalMetricsSchema"];

export type EvalSpaceSignalMetricsInput =
  z.infer<EvalSpaceSignalMetricsInputSchema>;
export type EvalSpaceSignalMetrics = z.infer<EvalSpaceSignalMetricsSchema>;
export type OrganizationWeeklyEvalMetrics =
  z.infer<OrganizationWeeklyEvalMetricsSchema>;
