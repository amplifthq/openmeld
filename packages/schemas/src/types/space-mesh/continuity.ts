import type { z } from "zod/v4";

type ContinuitySchema =
  typeof import("../../schemas/space-mesh/continuity")["continuitySchema"];

export type Continuity = z.infer<ContinuitySchema>;
