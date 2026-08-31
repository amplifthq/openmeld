import * as z from "zod/v4";

export const agentProfileWorkRecoveryActionKindSchema = z.enum([
  "continue_interrupted_work",
  "approve_queued_work",
  "skip_interrupted_work",
]);
