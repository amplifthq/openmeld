import type { z } from "zod/v4";

// Engineering-first tradeoff:
// 1) `typeof import(...)[...]` keeps this module type-only (no runtime value import).
// 2) Inferred types stay hard-linked to schema symbols to avoid drift.
// 3) Schema refactors fail fast at compile time.
type HelloSchema = typeof import("../../schemas/protocol/hello")["helloSchema"];
type HelloAckSchema =
  typeof import("../../schemas/protocol/hello")["helloAckSchema"];

export type Hello = z.infer<HelloSchema>;
export type HelloAck = z.infer<HelloAckSchema>;
