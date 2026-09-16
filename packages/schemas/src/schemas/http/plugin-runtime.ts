import * as z from "../../lazy-zod";
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
