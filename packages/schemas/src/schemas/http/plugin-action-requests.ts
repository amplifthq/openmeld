import type { z as Zod } from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { centerAgentConnectorActionExecutionConnectionSchema } from "./center-agent";
import { connectorServiceSchema } from "./connector-connections";
import { pluginActionRecoveryInputSchema } from "./plugin-action-recovery";
import { pluginActionRequestStatusSchema } from "./plugin-action-request-status";

export const pluginActionRequestIntentSchema = z.strictObject({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  actorProfileId: z.string().min(1),
  operationId: z.string().min(1).max(256),
  sourceRequestKey: z.string().nullable(),
  sourceSpaceId: z.string().min(1).nullish(),
  sourceSignalId: z.string().min(1).nullish(),
  sourceNativeDeliveryId: z.string().min(1).nullish(),
  purpose: z.literal("issue_destination").optional(),
  consumer: z.enum(["center_agent", "remote_agent", "local_agent"]).optional(),
  connection: centerAgentConnectorActionExecutionConnectionSchema,
  connectionUpdatedAtMs: z.number().int(),
  accessRevision: z.number().int(),
  service: connectorServiceSchema,
  actionId: z.string().min(1).max(160),
  effect: z.enum(["write", "destructive", "unspecified"]),
  input: z.record(z.string(), z.unknown()),
  recovery: pluginActionRecoveryInputSchema.optional(),
});
export const pluginActionRequestViewSchema =
  pluginActionRequestStatusSchema.extend({
    inboxItemId: z.string().min(1),
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
    sourceSignalId: z.string().nullish(),
    sourceThreadId: z.string().nullish(),
  });
export const listPluginActionRequestsInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  expectedOrganizationId: z.string().min(1),
  spaceId: z.string().min(1),
  sourceSignalIds: z.array(z.string().min(1)).min(1).max(1000).optional(),
});
export const listPluginActionRequestsResponseSchema = z.strictObject({
  requests: z.array(pluginActionRequestViewSchema),
});
export const pluginActionRequestLocationsSchema = z.array(
  z.strictObject({
    sourceSignalId: z.string().min(1),
    threadId: z.string().min(1).nullable(),
  })
);
export const pluginActionRequestContinuationSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  state: z.enum(["pending", "requested", "unavailable"]),
  signalId: z.string().nullable(),
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

/** Older CLI and Web readers use a strict view without message continuation. */
export function projectPluginActionRequestView(
  view: PluginActionRequestView,
  includeMessageContext = false
): PluginActionRequestView {
  if (includeMessageContext) {
    return view;
  }
  const {
    sourceSignalId: _source,
    sourceThreadId: _thread,
    continuation: _continuation,
    ...legacy
  } = view;
  return legacy;
}
