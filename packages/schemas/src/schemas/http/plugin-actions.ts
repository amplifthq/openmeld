import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { openConnectorRuntimeActionListSchema } from "../runtime/openconnector-runtime";
import {
  centerAgentConnectorActionExecutionConnectionSchema,
  centerAgentConnectorActionOperationStatusSchema,
} from "./center-agent";
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
  dispatchId: z.string().trim().min(1).max(256).optional(),
  action: z.discriminatedUnion("operation", [
    z.strictObject({ operation: z.literal("list") }),
    z.strictObject({ operation: z.literal("actions"), ...selection }),
    z.strictObject({
      operation: z.literal("execute"),
      ...selection,
      actionId: z.string().trim().min(1).max(160),
      input: z.record(z.string(), z.unknown()),
      operationId: z.string().trim().min(1).max(256),
      confirmationToken: z.string().uuid().optional(),
    }),
  ]),
});
export const pluginActionRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  expectedOrganizationId: z.string().trim().min(1),
  request: pluginActionRequestSchema,
});
export const pluginActionResponseSchema = z.discriminatedUnion("kind", [
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
    connection: centerAgentConnectorActionExecutionConnectionSchema,
    actionId: z.string(),
    operationId: z.string(),
    status: centerAgentConnectorActionOperationStatusSchema,
    replayed: z.boolean(),
    data: z.unknown().optional(),
    error: z.string().optional(),
    providerExecutionId: z.string().nullable(),
  }),
]);
