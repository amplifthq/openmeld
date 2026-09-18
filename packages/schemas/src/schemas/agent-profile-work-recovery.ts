import * as z from "zod/v4";

export const agentProfileWorkRecoveryActionKindSchema = z.enum([
  "continue_interrupted_work",
  "approve_queued_work",
  "skip_interrupted_work",
  // An occupied native conversation cannot be resumed in place, so the only
  // continuation is a new branch off the source's verified history.
  "fork_interrupted_work",
]);
