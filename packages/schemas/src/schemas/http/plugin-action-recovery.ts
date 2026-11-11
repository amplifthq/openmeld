import type { z as Zod } from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";

// Exact provider arguments belong to the private, expiring Plugin request,
// never to the public continuation Message or the operation/audit ledger.
export const pluginActionRecoveryInputSchema = z.strictObject({
  input: z
    .record(z.string(), z.unknown())
    .refine(
      (input) =>
        new TextEncoder().encode(JSON.stringify(input)).byteLength <=
        256 * 1024,
      "A recoverable action input cannot exceed 256 KiB."
    ),
  githubActor: z.enum(["organization", "requester"]).optional(),
  issueDestinationAuthority: z.literal("explicit_request").optional(),
});
export const readApprovedPluginActionInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
});
export const approvedPluginActionSchema = z.strictObject({
  requestId: z.string().uuid(),
  operationId: z.string().min(1).max(256),
  service: z.string().min(1),
  actionId: z.enum(["linear.create_linear_issue", "github.create_issue"]),
  connectionPreference: z.enum(["requester", "shared"]),
  recovery: pluginActionRecoveryInputSchema,
});
export const readApprovedPluginActionResponseSchema = z.strictObject({
  action: approvedPluginActionSchema.nullable(),
});
export type PluginActionRecoveryInput = Zod.infer<
  typeof pluginActionRecoveryInputSchema
>;
export type ReadApprovedPluginActionInput = Zod.infer<
  typeof readApprovedPluginActionInputSchema
>;
export type ReadApprovedPluginActionResponse = Zod.infer<
  typeof readApprovedPluginActionResponseSchema
>;
