import type { z } from "zod/v4";

type Schemas = typeof import("../schemas/ai-usage");
export type AiUsageObservation = z.infer<Schemas["aiUsageObservationSchema"]>;
export type AiUsageRecord = z.infer<Schemas["aiUsageRecordSchema"]>;
export type AiUsageQuery = z.infer<Schemas["aiUsageQuerySchema"]>;
export type AiUsageSummary = z.infer<Schemas["aiUsageSummarySchema"]>;
export type AiUsageQueryResponse = z.infer<
  Schemas["aiUsageQueryResponseSchema"]
>;
