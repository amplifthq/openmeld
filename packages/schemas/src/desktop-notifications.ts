import * as z from "zod/v4";
import { inboxSourceTargetSchema } from "./schemas/http/inbox";

export const inboxVisibleConversationSchema = z.strictObject({
  kind: z.literal("space"),
  spaceId: z.string().min(1),
  threadRootSignalId: z.string().min(1).nullable(),
});
export type InboxVisibleConversation = z.infer<
  typeof inboxVisibleConversationSchema
>;

export const desktopNotificationReferenceSchema = z.strictObject({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  organizationSlug: z.string().min(1).max(200),
  itemId: z.string().min(1),
});
export const desktopTrayComputerSchema = z.strictObject({
  available: z.boolean(),
  statusLabel: z.string().trim().min(1).max(120),
});
export const desktopNotificationRequestSchema =
  desktopNotificationReferenceSchema.extend({
    soundEnabled: z.boolean(),
  });
export const desktopNotificationActivationSchema =
  desktopNotificationReferenceSchema.extend({
    sourceTarget: inboxSourceTargetSchema,
  });
export type DesktopNotificationActivation = z.infer<
  typeof desktopNotificationActivationSchema
>;
export const desktopNotificationTestSchema = z.strictObject({
  userId: z.string().min(1),
  soundEnabled: z.boolean(),
});
export const desktopInboxAttentionSchema = z.strictObject({
  ordinaryUnreadCount: z.number().int().nonnegative().safe(),
  unreadMentionCount: z.number().int().nonnegative().safe(),
  unreadUrgentUpdateCount: z.number().int().nonnegative().safe(),
  unresolvedActionCount: z.number().int().nonnegative().safe(),
});
export type DesktopInboxAttention = z.infer<typeof desktopInboxAttentionSchema>;
export const desktopNotificationContextSchema = z
  .strictObject({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    organizationSlug: z.string().min(1).max(200).optional(),
    enabled: z.boolean(),
    computer: desktopTrayComputerSchema.optional(),
    inboxRefreshRevision: z.number().int().nonnegative().safe().optional(),
    latestUnreadStatus: z.enum(["loading", "ready", "unavailable"]).optional(),
    unreadCountStatus: z.enum(["loading", "ready", "unavailable"]).optional(),
    navigationKey: z.string().max(200).optional(),
    attention: desktopInboxAttentionSchema.nullable().optional(),
    // Accepted only for compatibility with an older renderer. It is not used
    // as the native attention title because the scalar mixes quiet backlog
    // with important work.
    unreadCount: z.number().int().nonnegative().safe().nullable().optional(),
    visibleConversation: inboxVisibleConversationSchema.nullable(),
  })
  .nullable();
export type DesktopNotificationContext = z.infer<
  typeof desktopNotificationContextSchema
>;
export type DesktopNotificationReference = z.infer<
  typeof desktopNotificationReferenceSchema
>;
export type DesktopNotificationRequest = z.infer<
  typeof desktopNotificationRequestSchema
>;
export type DesktopNotificationTest = z.infer<
  typeof desktopNotificationTestSchema
>;
export const desktopNotificationResultSchema = z.enum([
  "delivered",
  "unavailable",
  "context_changed",
  "ineligible",
  "source_visible",
]);
export type DesktopNotificationResult = z.infer<
  typeof desktopNotificationResultSchema
>;
