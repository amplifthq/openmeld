import { z } from "zod/v4";

const reference = z.string().trim().min(1).max(2048);
export const executionContextAccessSchema = z.enum([
  "space_context",
  "read_only",
  "workspace",
]);
const workspace = z.enum(["current", "isolated"]);
const preferences = {
  access: executionContextAccessSchema.optional(),
  workspace: workspace.optional(),
};
export const executionContextSelectionSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("auto"), ...preferences }),
  z.strictObject({ mode: z.literal("new"), ...preferences }),
  z.strictObject({ mode: z.literal("resume"), sourceWakeId: reference }),
  z.strictObject({
    mode: z.literal("fork"),
    sourceWakeId: reference,
    ...preferences,
  }),
]);

export const executionContextScopeSchema = z.strictObject({
  organizationId: reference,
  requesterProfileId: reference,
  spaceId: reference,
  targetProfileId: reference,
  threadId: reference.nullable(),
});

// Created by Core from an authorized Space message, never supplied by a client.
export const executionContextRequestSchema = z.strictObject({
  required: z.boolean().optional(),
  scope: executionContextScopeSchema,
  selection: executionContextSelectionSchema,
});

export const executionContextAssignmentSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().uuid(),
  scope: executionContextScopeSchema,
  access: executionContextAccessSchema,
  workspace,
  forkSource: z
    .strictObject({
      contextId: z.string().uuid(),
      sourceWakeId: reference,
      nativeConversationId: reference,
      completedHistoryId: reference,
      runtimeWorkspaceFingerprint: reference,
      workspace,
    })
    .optional(),
});

export const executionContextCompletionSchema = z.strictObject({
  contextId: z.string().uuid(),
  nativeConversationId: reference,
  runtimeWorkspaceFingerprint: reference,
  completedHistoryId: reference.optional(),
});

export const executionContextTaskSchema =
  executionContextAssignmentSchema.extend({
    nativeConversationId: reference.nullable(),
    runtimeWorkspaceFingerprint: reference.nullable(),
  });
