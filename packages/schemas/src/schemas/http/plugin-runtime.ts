import * as z from "../../lazy-zod";
import { agentExecutionConfirmationSchema } from "../runtime/agent-failure";
import { openConnectorRuntimeActionListSchema } from "../runtime/openconnector-runtime";
import {
  connectorConnectionNameSchema,
  connectorServiceSchema,
} from "./connector-connections";

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
  replay: z
    .discriminatedUnion("allowed", [
      z.strictObject({
        allowed: z.literal(true),
        remainingWindowMs: z.int().positive(),
        maxAttempts: z.literal(1),
      }),
      z.strictObject({
        allowed: z.literal(false),
        reason: z.enum([
          "window_unverified",
          "window_expired",
          "already_replayed",
        ]),
      }),
    ])
    .optional(),
  message: z.string().min(1),
});
export const pluginRuntimeRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("list"),
    service: connectorServiceSchema,
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
