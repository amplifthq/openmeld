import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { runtimeCoordinatorExecutionTokenEchoSchema } from "../daemon/runtime-coordinator-execution-token";
import { openConnectorRuntimeActionListSchema } from "../runtime/openconnector-runtime";
import {
  centerAgentConnectorActionExecutionConnectionSchema,
  centerAgentConnectorActionOperationStatusSchema,
  connectorActionVerificationEvidenceSchema,
  connectorActionVerificationReferenceSchema,
} from "./center-agent";
import { connectorActionReplayPermissionSchema } from "./connector-action-replay";
import { connectorServiceSchema } from "./connector-connections";

const selectedAccountSchema =
  centerAgentConnectorActionExecutionConnectionSchema.extend({
    permission: z.enum(["read", "write"]),
  });
const selection = {
  service: connectorServiceSchema,
  account: z.enum(["personal", "shared"]),
};
export const pluginActionRequestSchema = z.strictObject({
  executionTokenEcho: runtimeCoordinatorExecutionTokenEchoSchema.optional(),
  includeRecoveryReceipt: z.literal(true).optional(),
  dispatchId: z.string().trim().min(1).max(256).optional(),
  action: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("list") }),
    z.strictObject({
      operation: z.literal("connect"),
      service: connectorServiceSchema,
      account: z.enum(["personal", "shared", "choose"]),
    }),
    z.strictObject({ operation: z.literal("actions"), ...selection }),
    z.strictObject({
      operation: z.literal("execute"),
      ...selection,
      actionId: z.string().trim().min(1).max(160),
      input: z.record(z.string(), z.unknown()),
      operationId: z.string().trim().min(1).max(256),
      confirmationToken: z.string().uuid().optional(),
      replay: z.boolean().optional(),
      verificationOf: connectorActionVerificationReferenceSchema.optional(),
    }),
  ]),
});
export const pluginActionRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  expectedOrganizationId: z.string().trim().min(1),
  request: pluginActionRequestSchema,
});
export const pluginActionResponseSchema = z.discriminatedUnion("kind", [
  // Only the new explicit connect operation emits this variant; existing
  // published CLI operations retain their exact response discriminants.
  z.strictObject({
    kind: z.literal("connection_guidance"),
    service: connectorServiceSchema,
    scope: z.enum(["member", "shared", "choose"]),
    url: z.string().url(),
    replyText: z.string().min(1),
    canContinueInConversation: z.boolean(),
    message: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("connections"),
    connections: z.array(selectedAccountSchema),
  }),
  z.strictObject({
    kind: z.literal("actions"),
    connection: selectedAccountSchema,
    actions: openConnectorRuntimeActionListSchema,
  }),
  z.strictObject({
    kind: z.literal("confirmation_required"),
    connection: selectedAccountSchema,
    actionId: z.string(),
    operationId: z.string(),
    confirmationToken: z.string().uuid(),
    expiresAtMs: z.number(),
    message: z.string(),
  }),
  z.strictObject({
    kind: z.literal("execution"),
    verificationOf: connectorActionVerificationEvidenceSchema.optional(),
    connection: centerAgentConnectorActionExecutionConnectionSchema,
    actionId: z.string(),
    operationId: z.string(),
    status: centerAgentConnectorActionOperationStatusSchema,
    replayed: z.boolean(),
    replay: connectorActionReplayPermissionSchema.optional(),
    executionConfirmation: z
      .enum(["executed", "not_executed", "unknown"])
      .optional(),
    data: z.unknown().optional(),
    error: z.string().optional(),
    providerExecutionId: z.string().nullable(),
  }),
]);
