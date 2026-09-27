import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { connectorServiceSchema } from "./connector-connections";

const id = z.string().trim().min(1).max(512);
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
export const pluginChannelSourceProofSchema = z.strictObject({
  provider: z.enum(["slack", "feishu", "lark"]),
  messageId: id,
  providerUserId: id,
  fingerprint: sha,
  revision: id.nullable(),
});
export const pluginChannelSelectionSchema = z.strictObject({
  sourceDeliveryId: id,
  organizationId: id,
  requesterUserId: id,
  requesterProfileId: id,
  targetProfileId: id,
  service: connectorServiceSchema,
  scope: z.enum(["member", "shared"]),
  connectionName: id,
  connectionUpdatedAtMs: z.number().int().nonnegative(),
  continuationTriggerId: id,
});
const pluginChannelIntentSchema = z.strictObject({
  service: connectorServiceSchema,
  scope: z.enum(["member", "shared", "choose"]),
  expiresAtMs: z.number().int().nonnegative(),
});
// Private metadata on the existing native delivery. It does not own scheduling,
// execution outcomes, membership, credentials or a second retry state machine.
export const pluginChannelDeliveryMetadataSchema = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      v: z.literal(1),
      kind: z.literal("source"),
      proof: pluginChannelSourceProofSchema,
      intent: pluginChannelIntentSchema.optional(),
      selection: pluginChannelSelectionSchema.optional(),
    }),
    z.strictObject({
      v: z.literal(1),
      kind: z.literal("continuation"),
      proof: pluginChannelSourceProofSchema,
      executionSelection: pluginChannelSelectionSchema,
      intent: pluginChannelIntentSchema.optional(),
      selection: pluginChannelSelectionSchema.optional(),
    }),
  ]
);
export const pluginChannelRequestBodySchema = z.strictObject({ requestId: id });
export const pluginChannelContinueBodySchema =
  pluginChannelRequestBodySchema.extend({
    scope: z.enum(["member", "shared"]),
  });
export const pluginChannelRequestRpcInputSchema =
  pluginChannelRequestBodySchema.extend({
    context: openMeldRequestContextSchema,
    expectedOrganizationId: id,
  });
export const pluginChannelContinueRpcInputSchema =
  pluginChannelRequestRpcInputSchema.extend({
    scope: z.enum(["member", "shared"]),
  });
export const pluginChannelRequestPreviewSchema = z.strictObject({
  requestId: id,
  service: connectorServiceSchema,
  scope: z.enum(["member", "shared", "choose"]),
  provider: z.enum(["slack", "feishu", "lark"]),
  targetProfileName: z.string().min(1),
  expiresAtMs: z.number().int().nonnegative(),
  selection: z.enum(["member", "shared"]).nullable(),
});
export const pluginChannelContinueResponseSchema = z.strictObject({
  status: z.literal("requested"),
  requestId: id,
  targetProfileId: id,
  provider: z.enum(["slack", "feishu", "lark"]),
});
export type PluginChannelSourceProof = zod.infer<
  typeof pluginChannelSourceProofSchema
>;
export type PluginChannelSelection = zod.infer<
  typeof pluginChannelSelectionSchema
>;
export type PluginChannelDeliveryMetadata = zod.infer<
  typeof pluginChannelDeliveryMetadataSchema
>;
export type PluginChannelRequestPreview = zod.infer<
  typeof pluginChannelRequestPreviewSchema
>;
export type PluginChannelContinueResponse = zod.infer<
  typeof pluginChannelContinueResponseSchema
>;
