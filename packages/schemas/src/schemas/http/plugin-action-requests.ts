import type { z as Zod } from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { centerAgentConnectorActionExecutionConnectionSchema } from "./center-agent";
import { connectorServiceSchema } from "./connector-connections";

export const pluginActionRequestIntentSchema = z.strictObject({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  actorProfileId: z.string().min(1),
  operationId: z.string().min(1).max(256),
  sourceRequestKey: z.string().nullable(),
  sourceSpaceId: z.string().min(1).nullish(),
  purpose: z.literal("issue_destination").optional(),
  consumer: z.enum(["center_agent", "remote_agent", "local_agent"]).optional(),
  connection: centerAgentConnectorActionExecutionConnectionSchema,
  connectionUpdatedAtMs: z.number().int(),
  accessRevision: z.number().int(),
  service: connectorServiceSchema,
  actionId: z.string().min(1).max(160),
  effect: z.enum(["write", "destructive", "unspecified"]),
  input: z.record(z.string(), z.unknown()),
});
export const pluginActionRequestViewSchema = z.strictObject({
  requestId: z.string().uuid(),
  inboxItemId: z.string().min(1),
  state: z.enum(["pending", "approved", "rejected", "expired", "revoked"]),
  service: connectorServiceSchema,
  actionId: z.string(),
  effect: z.enum(["write", "destructive", "unspecified"]),
  accountName: z.string(),
  accountScope: z.enum(["member", "shared"]),
  actorProfileId: z.string(),
  inputFieldCount: z.number().int().nonnegative(),
  // Bounded resource identifiers and explicitly reviewed action labels appear
  // only in private detail. Arbitrary input, credentials and message bodies
  // never enter this projection; no input values enter the Inbox preview.
  targets: z
    .array(z.strictObject({ label: z.string(), value: z.string() }))
    .max(12),
  createdAtMs: z.number().int(),
  expiresAtMs: z.number().int(),
});
export const pluginActionRequestCommandSchema = z.discriminatedUnion(
  "operation",
  [
    z.strictObject({
      operation: z.literal("read"),
      requestId: z.string().uuid(),
    }),
    z.strictObject({
      operation: z.literal("reject"),
      requestId: z.string().uuid(),
    }),
    z.strictObject({
      operation: z.literal("approve"),
      requestId: z.string().uuid(),
    }),
  ]
);
export const pluginActionRequestCommandRpcSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  expectedOrganizationId: z.string().min(1),
  command: pluginActionRequestCommandSchema,
});
export type PluginActionRequestIntent = Zod.infer<
  typeof pluginActionRequestIntentSchema
>;
export type PluginActionRequestView = Zod.infer<
  typeof pluginActionRequestViewSchema
>;
export type PluginActionRequestCommand = Zod.infer<
  typeof pluginActionRequestCommandSchema
>;
export type PluginActionRequestCommandRpc = Zod.infer<
  typeof pluginActionRequestCommandRpcSchema
>;
