import type { z } from "zod/v4";

type QuerySpaceDeletionTombstonesBodySchema =
  typeof import("../../schemas/http/space-deletion-tombstone")["querySpaceDeletionTombstonesBodySchema"];
type QuerySpaceDeletionTombstonesResponseSchema =
  typeof import("../../schemas/http/space-deletion-tombstone")["querySpaceDeletionTombstonesResponseSchema"];
type SpaceDeletionTombstoneRecordSchema =
  typeof import("../../schemas/http/space-deletion-tombstone")["spaceDeletionTombstoneRecordSchema"];
type UpsertSpaceDeletionTombstoneBodySchema =
  typeof import("../../schemas/http/space-deletion-tombstone")["upsertSpaceDeletionTombstoneBodySchema"];
type UpsertSpaceDeletionTombstoneResponseSchema =
  typeof import("../../schemas/http/space-deletion-tombstone")["upsertSpaceDeletionTombstoneResponseSchema"];

export type SpaceDeletionTombstoneRecord =
  z.infer<SpaceDeletionTombstoneRecordSchema>;
export type UpsertSpaceDeletionTombstoneBody =
  z.infer<UpsertSpaceDeletionTombstoneBodySchema>;
export type UpsertSpaceDeletionTombstoneResponse =
  z.infer<UpsertSpaceDeletionTombstoneResponseSchema>;
export type QuerySpaceDeletionTombstonesBody =
  z.infer<QuerySpaceDeletionTombstonesBodySchema>;
export type QuerySpaceDeletionTombstonesResponse =
  z.infer<QuerySpaceDeletionTombstonesResponseSchema>;
