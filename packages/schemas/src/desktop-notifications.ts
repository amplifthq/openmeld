import * as z from "zod/v4";

export const desktopNotificationReferenceSchema = z.strictObject({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  organizationSlug: z.string().min(1).max(200),
  itemId: z.string().min(1),
});
export const desktopNotificationRequestSchema =
  desktopNotificationReferenceSchema.extend({
    soundEnabled: z.boolean(),
  });
export const desktopNotificationTestSchema = z.strictObject({
  userId: z.string().min(1),
  soundEnabled: z.boolean(),
});
export const desktopNotificationContextSchema = z
  .strictObject({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    enabled: z.boolean(),
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
]);
export type DesktopNotificationResult = z.infer<
  typeof desktopNotificationResultSchema
>;
