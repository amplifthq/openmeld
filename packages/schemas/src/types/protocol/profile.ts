import type { z } from "zod/v4";

// Engineering-first tradeoff:
// 1) `typeof import(...)[...]` keeps this module type-only (no runtime value import).
// 2) Inferred types stay hard-linked to schema symbols to avoid drift.
// 3) Schema refactors fail fast at compile time.
type ProfileKindSchema =
  typeof import("../../schemas/protocol/profile")["profileKindSchema"];
type ProfileSchema =
  typeof import("../../schemas/protocol/profile")["profileSchema"];
type ProfileWorkspaceModeSchema =
  typeof import("../../schemas/protocol/profile")["profileWorkspaceModeSchema"];

export type ProfileKind = z.infer<ProfileKindSchema>;
export type Profile = z.infer<ProfileSchema>;
export type ProfileWorkspaceMode = z.infer<ProfileWorkspaceModeSchema>;
