import type { z } from "zod/v4";

type ResultArchiveModeSchema =
  typeof import("../../schemas/space-mesh/result-archive-policy")["resultArchiveModeSchema"];
type ResultArchivePolicySchema =
  typeof import("../../schemas/space-mesh/result-archive-policy")["resultArchivePolicySchema"];

export type ResultArchiveMode = z.infer<ResultArchiveModeSchema>;
export type ResultArchivePolicy = z.infer<ResultArchivePolicySchema>;
