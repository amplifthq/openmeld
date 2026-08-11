import type { z } from "zod/v4";

type SpaceNoteSchema =
  typeof import("../../schemas/space-mesh/space-note")["spaceNoteSchema"];

export type SpaceNote = z.infer<SpaceNoteSchema>;
