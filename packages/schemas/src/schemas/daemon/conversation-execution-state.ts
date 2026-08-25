import * as z from "zod/v4";
import { profileWorkingDirectorySchema } from "../protocol/profile";
import { agentControllerConversationRefSchema } from "./conversation-contract";
import { conversationBootstrapReasonSchema } from "./conversation-lifecycle";

const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });

export const bootstrapTemplateFactsSchema = z.strictObject({
  templateVersion: z.string().min(1),
  contentFingerprint: z.string().min(1),
});

export const conversationExecutionStateSchema = z.strictObject({
  agentContextLookupKey: z.string().min(1),
  activeContextId: z.string().min(1).nullable(),
  lastResolvedAgentControllerConversation:
    agentControllerConversationRefSchema.optional(),
  lastRuntimeWorkspacePath: profileWorkingDirectorySchema.optional(),
  runtimeWorkspaceFingerprint: z.string().min(1),
  bootstrapLastAppliedAt: ISO_DATE_TIME_SCHEMA.optional(),
  bootstrapLastActivatedAt: ISO_DATE_TIME_SCHEMA.optional(),
  dispatchesSinceBootstrapApplied: z.number().int().min(0),
  lastAppliedTemplateVersion: z.string().min(1).optional(),
  lastAppliedContentFingerprint: z.string().min(1).optional(),
  pendingBootstrapReason: conversationBootstrapReasonSchema.optional(),
  updatedAt: ISO_DATE_TIME_SCHEMA,
});
