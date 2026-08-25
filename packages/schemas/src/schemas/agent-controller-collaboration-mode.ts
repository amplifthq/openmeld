import * as z from "zod/v4";

export const agentControllerCollaborationModeSchema = z.enum([
  "codex:default",
  "codex:plan",
]);
