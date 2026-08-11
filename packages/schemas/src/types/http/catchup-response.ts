import type { z } from "zod/v4";

// Engineering-first tradeoff:
// 1) `typeof import(...)[...]` keeps this module type-only (no runtime value import).
// 2) Inferred types stay hard-linked to schema symbols to avoid drift.
// 3) Schema refactors fail fast at compile time.
type CatchupResponseSchema =
  typeof import("../../schemas/http/catchup-response")["catchupResponseSchema"];

export type CatchupResponse = z.infer<CatchupResponseSchema>;
