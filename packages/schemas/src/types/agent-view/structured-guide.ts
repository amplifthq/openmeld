import type { z } from "zod/v4";

// Engineering-first tradeoff:
// 1) `typeof import(...)[...]` keeps this module type-only (no runtime value import).
// 2) Inferred types stay hard-linked to schema symbols to avoid drift.
// 3) Schema refactors fail fast at compile time.
type DualViewGuideInputSchema =
  typeof import("../../schemas/agent-view/structured-guide")["dualViewGuideInputSchema"];
type StructuredGuidePayloadSchema =
  typeof import("../../schemas/agent-view/structured-guide")["structuredGuidePayloadSchema"];
type StructuredGuidePayloadFromInputSchema =
  typeof import("../../schemas/agent-view/structured-guide")["structuredGuidePayloadFromInputSchema"];

export type DualViewGuideInput = z.infer<DualViewGuideInputSchema>;
export type StructuredGuidePayload = z.infer<StructuredGuidePayloadSchema>;
export type StructuredGuidePayloadFromInput =
  z.infer<StructuredGuidePayloadFromInputSchema>;
