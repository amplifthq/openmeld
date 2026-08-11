import { z } from "zod/v4";

export const agentControllerPermissionModeSchema = z.enum([
  "claude-code:default",
  "claude-code:acceptEdits",
  "claude-code:plan",
  "claude-code:auto",
  "claude-code:dontAsk",
  "claude-code:bypassPermissions",
  "codex:askForApproval",
  "codex:approveForMe",
  "codex:fullAccess",
  "codex:customConfig",
  "cursor:default",
  "cursor:plan",
  "cursor:ask",
  "cursor:autoReview",
  "cursor:force",
]);
