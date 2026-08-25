import * as z from "zod/v4";
import { agentProfileIdSchema } from "./profile";

export const CORE_READINESS_FACTS_CHANGED_MARKER_KIND =
  "core_readiness_facts_changed" as const;

export const coreReadinessFactsChangedSchema = z.strictObject({
  agentProfileId: agentProfileIdSchema,
  kind: z.literal(CORE_READINESS_FACTS_CHANGED_MARKER_KIND),
});
