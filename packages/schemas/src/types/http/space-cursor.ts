import type { z } from "zod/v4";

type PatchCursorLastSeenTsSchema =
  typeof import("../../schemas/http/space-cursor")["patchCursorLastSeenTsSchema"];
type PatchCursorStringSchema =
  typeof import("../../schemas/http/space-cursor")["patchCursorStringSchema"];
type PatchSpaceCursorBodySchema =
  typeof import("../../schemas/http/space-cursor")["patchSpaceCursorBodySchema"];

export type PatchCursorLastSeenTs = z.infer<PatchCursorLastSeenTsSchema>;
export type PatchCursorString = z.infer<PatchCursorStringSchema>;
export type PatchSpaceCursorBody = z.infer<PatchSpaceCursorBodySchema>;
