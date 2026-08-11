import type { z } from "zod/v4";

// Engineering-first tradeoff:
// 1) `typeof import(...)[...]` keeps this module type-only (no runtime value import).
// 2) Inferred types stay hard-linked to schema symbols to avoid drift.
// 3) Schema refactors fail fast at compile time.
type ProfileSpaceCreatorKindSchema =
  typeof import("../../schemas/http/profile-space-history")["profileSpaceCreatorKindSchema"];
type ProfileSpaceHistoryStatusSchema =
  typeof import("../../schemas/http/profile-space-history")["profileSpaceHistoryStatusSchema"];
type ProfileSpaceHistoryRecordSchema =
  typeof import("../../schemas/http/profile-space-history")["profileSpaceHistoryRecordSchema"];
type ListProfileSpaceHistoryQuerySchema =
  typeof import("../../schemas/http/profile-space-history")["listProfileSpaceHistoryQuerySchema"];
type ListProfileSpaceHistoryResponseSchema =
  typeof import("../../schemas/http/profile-space-history")["listProfileSpaceHistoryResponseSchema"];
type UpsertProfileSpaceHistoryBodySchema =
  typeof import("../../schemas/http/profile-space-history")["upsertProfileSpaceHistoryBodySchema"];
type UpsertProfileSpaceHistoryResponseSchema =
  typeof import("../../schemas/http/profile-space-history")["upsertProfileSpaceHistoryResponseSchema"];
type PatchProfileSpaceHistoryStatusBodySchema =
  typeof import("../../schemas/http/profile-space-history")["patchProfileSpaceHistoryStatusBodySchema"];
type PatchProfileSpaceHistoryStatusResponseSchema =
  typeof import("../../schemas/http/profile-space-history")["patchProfileSpaceHistoryStatusResponseSchema"];

export type ProfileSpaceCreatorKind = z.infer<ProfileSpaceCreatorKindSchema>;
export type ProfileSpaceHistoryStatus =
  z.infer<ProfileSpaceHistoryStatusSchema>;
export type ProfileSpaceHistoryRecord =
  z.infer<ProfileSpaceHistoryRecordSchema>;
export type ListProfileSpaceHistoryQuery =
  z.infer<ListProfileSpaceHistoryQuerySchema>;
export type ListProfileSpaceHistoryResponse =
  z.infer<ListProfileSpaceHistoryResponseSchema>;
export type UpsertProfileSpaceHistoryBody =
  z.infer<UpsertProfileSpaceHistoryBodySchema>;
export type UpsertProfileSpaceHistoryResponse =
  z.infer<UpsertProfileSpaceHistoryResponseSchema>;
export type PatchProfileSpaceHistoryStatusBody =
  z.infer<PatchProfileSpaceHistoryStatusBodySchema>;
export type PatchProfileSpaceHistoryStatusResponse =
  z.infer<PatchProfileSpaceHistoryStatusResponseSchema>;
