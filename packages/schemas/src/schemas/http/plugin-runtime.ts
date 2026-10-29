import * as z from "../../lazy-zod";
import { agentExecutionConfirmationSchema } from "../runtime/agent-failure";
import { openConnectorRuntimeActionListSchema } from "../runtime/openconnector-runtime";
import { connectorActionReplayPermissionSchema } from "./connector-action-replay";
import {
  connectorConnectionNameSchema,
  connectorServiceSchema,
} from "./connector-connections";

// Narrow read projection from OpenConnector's Linear run_query GraphQL envelope.
// Resource IDs must still match the exact approved destination at the caller.
const linearIssuePreviewResourceSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
});
export const linearIssuePreviewNamesSchema = z.object({
  data: z.object({
    team: linearIssuePreviewResourceSchema.nullish(),
    project: linearIssuePreviewResourceSchema.nullish(),
  }),
});

export const pluginActionEffectSchema = z.enum([
  "read",
  "write",
  "destructive",
  "unspecified",
]);
// Model-visible receipt for an already attempted action, not new authority.
export const connectorActionOutcomeUnknownSchema = z.strictObject({
  status: z.literal("outcome_unknown"),
  actionId: z.string().trim().min(1),
  operationId: z.string().trim().min(1),
  executionConfirmation: agentExecutionConfirmationSchema,
  providerExecutionId: z.string().nullable(),
  // Absent on older receipts: absence never permits replay.
  replay: connectorActionReplayPermissionSchema.optional(),
  message: z.string().min(1),
});
export const pluginRuntimeRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("list"),
    service: connectorServiceSchema,
    actionId: z.string().trim().min(1).optional(),
  }),
  z.strictObject({
    operation: z.literal("execute"),
    service: connectorServiceSchema,
    actionId: z.string().trim().min(1),
    connectionName: connectorConnectionNameSchema,
    input: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().trim().min(1),
    authorizedEffect: pluginActionEffectSchema,
  }),
]);
export const pluginRuntimeResponseSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("catalog"),
    actions: openConnectorRuntimeActionListSchema,
  }),
  z.strictObject({
    status: z.literal("completed"),
    data: z.unknown(),
    outputSchema: z.unknown(),
    providerExecutionId: z.string(),
  }),
  z.strictObject({
    status: z.enum(["failed", "outcome_unknown", "pending"]),
    error: z.string(),
    providerExecutionId: z.string().nullable(),
  }),
]);
