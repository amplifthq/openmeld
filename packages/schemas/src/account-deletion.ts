import * as z from "zod/v4";
import { fileRootSchema } from "./schemas/http/file-root";

const organization = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string(),
});
export const accountDeletionPreviewSchema = z.strictObject({
  confirmationToken: z.string(),
  deleteOrganizations: z.array(organization),
  retainOrganizations: z.array(organization),
  blockingOrganizations: z.array(organization),
  blockingSpaces: z.array(
    z.strictObject({ spaceId: z.string(), name: z.string() })
  ),
  requiresPassword: z.boolean(),
  requiresSignIn: z.boolean(),
});
export const requestAccountDeletionSchema = z.strictObject({
  confirmation: z.literal("DELETE"),
  confirmationToken: z.string().min(1),
  password: z.string().max(1024).optional(),
});
export const accountDeletionAcceptedSchema = z.strictObject({
  ok: z.literal(true),
  status: z.literal("deleting"),
});
export const accountDeletionConnectionSchema = z.strictObject({
  connectionName: z.string().min(1).max(64),
  service: z.string().min(1),
});
export const accountDeletionConnectionCleanupSchema =
  accountDeletionConnectionSchema.extend({ userId: z.string().min(1) });
export const accountDeletionPendingConnectionsSchema = z.array(
  accountDeletionConnectionSchema.extend({ cleanupId: z.string().min(1) })
);
export const accountDeletionPlanSchema = z.strictObject({
  deleteOrganizationIds: z.array(z.string()),
  // Includes historical private roots, even after Organization departure.
  privateOrganizationIds: z.array(z.string()),
  profileIds: z.array(z.string()),
  connections: z.array(accountDeletionConnectionSchema).default([]),
});
export const accountDeletionCleanupInputSchema = z.strictObject({
  userId: z.string().min(1),
  privateRootIndex: z.number().int().nonnegative().default(0),
});
export const accountDeletionCleanupResultSchema = z.strictObject({
  complete: z.boolean(),
  privateRootIndex: z.number().int().nonnegative(),
});
export type AccountDeletionConnection = z.infer<
  typeof accountDeletionConnectionSchema
>;
export const accountDeletionConversationSchema = z.strictObject({
  runtimeConversationId: z.string().min(1),
  organizationId: z.string().min(1),
  spaceId: z.string().min(1),
  deleteSharedComputer: z.boolean(),
});
export type AccountDeletionConversation = z.infer<
  typeof accountDeletionConversationSchema
>;
export const accountDeletionSpaceSchema = z.strictObject({
  userId: z.string().min(1),
  spaceId: z.string().min(1),
});
export type AccountDeletionSpace = z.infer<typeof accountDeletionSpaceSchema>;
export const accountDeletionFileRootSchema = z.strictObject({
  userId: z.string().min(1),
  root: fileRootSchema,
});
export type AccountDeletionFileRoot = z.infer<
  typeof accountDeletionFileRootSchema
>;
export type AccountDeletionPreview = z.infer<
  typeof accountDeletionPreviewSchema
>;
export type AccountDeletionPlan = z.infer<typeof accountDeletionPlanSchema>;
export type AccountDeletionCleanupInput = z.infer<
  typeof accountDeletionCleanupInputSchema
>;
export type AccountDeletionCleanupResult = z.infer<
  typeof accountDeletionCleanupResultSchema
>;
