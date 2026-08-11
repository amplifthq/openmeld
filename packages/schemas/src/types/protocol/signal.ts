import type { z } from "zod/v4";

// Engineering-first tradeoff:
// 1) `typeof import(...)[...]` keeps this module type-only (no runtime value import).
// 2) Inferred types stay hard-linked to schema symbols to avoid drift.
// 3) Schema refactors fail fast at compile time.
type SignalTextDataSchema =
  typeof import("../../schemas/protocol/signal")["signalTextDataSchema"];
type CenterAgentTaskReferenceSchema =
  typeof import("../../schemas/protocol/signal")["centerAgentTaskReferenceSchema"];
type SignalTextReplyToSchema =
  typeof import("../../schemas/protocol/signal")["signalTextReplyToSchema"];
type SignalStatusDataSchema =
  typeof import("../../schemas/protocol/signal")["signalStatusDataSchema"];
type SignalStatusSchema =
  typeof import("../../schemas/protocol/signal")["signalStatusSchema"];
type SignalTextSchema =
  typeof import("../../schemas/protocol/signal")["signalTextSchema"];

export type SignalStatus = z.infer<SignalStatusSchema>;
export type CenterAgentTaskReference = z.infer<CenterAgentTaskReferenceSchema>;
export type SignalStatusData = z.infer<SignalStatusDataSchema>;
export type SignalTextData = z.infer<SignalTextDataSchema>;
export type SignalTextReplyTo = z.infer<SignalTextReplyToSchema>;
export type SignalText = z.infer<SignalTextSchema>;
