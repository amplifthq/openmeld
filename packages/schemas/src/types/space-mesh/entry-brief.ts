import type { z } from "zod/v4";

type EntryBriefSchema =
  typeof import("../../schemas/space-mesh/entry-brief")["entryBriefSchema"];

export type EntryBrief = z.infer<EntryBriefSchema>;
