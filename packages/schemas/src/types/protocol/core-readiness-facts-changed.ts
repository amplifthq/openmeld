import type { z } from "zod/v4";

type CoreReadinessFactsChangedSchema =
  typeof import("../../schemas/protocol/core-readiness-facts-changed")["coreReadinessFactsChangedSchema"];

export type CoreReadinessFactsChangedMarker =
  z.infer<CoreReadinessFactsChangedSchema>;
