import type { z } from "zod/v4";

type DispatchBriefSchema =
  typeof import("../../schemas/space-mesh/dispatch-brief")["dispatchBriefSchema"];

export type DispatchBrief = z.infer<DispatchBriefSchema>;
