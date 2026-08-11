import type { z } from "zod/v4";

// Engineering-first tradeoff:
// 1) `typeof import(...)[...]` keeps this module type-only (no runtime value import).
// 2) Inferred types stay hard-linked to schema symbols to avoid drift.
// 3) Schema refactors fail fast at compile time.
type SpacePasswordSchema =
  typeof import("../../schemas/http/space-password")["spacePasswordSchema"];
type CreateSpacePasswordBodySchema =
  typeof import("../../schemas/http/space-password")["createSpacePasswordBodySchema"];
type UpsertSpacePasswordBodySchema =
  typeof import("../../schemas/http/space-password")["upsertSpacePasswordBodySchema"];
type SpacePasswordStateSchema =
  typeof import("../../schemas/http/space-password")["spacePasswordStateSchema"];

export type SpacePassword = z.infer<SpacePasswordSchema>;
export type CreateSpacePasswordBody = z.infer<CreateSpacePasswordBodySchema>;
export type UpsertSpacePasswordBody = z.infer<UpsertSpacePasswordBodySchema>;
export type SpacePasswordState = z.infer<SpacePasswordStateSchema>;
