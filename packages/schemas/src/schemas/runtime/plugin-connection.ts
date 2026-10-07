import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { connectorConnectionSchema } from "../http/connector-connections";
import { pluginActionRpcInputSchema } from "../http/plugin-actions";
import { cloudComputerSchema } from "./cloud-computer";
import { remoteAgentExecutionAccessRequestSchema } from "./remote-agent-execution-access";

const identity = z.string().min(1).max(512);
export const pluginConnectionAuthorizationSchema = z.strictObject({
  connection: connectorConnectionSchema.omit({
    canDisconnect: true,
    ownerDisplayName: true,
  }),
  permission: z.enum(["read", "write"]),
});
/** Internal service-bound authorization. Never returned to an Agent or written into Computer files. */
export const pluginConnectionGrantSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/u),
  service: identity,
  organizationId: identity,
  requesterUserId: identity,
  connectionName: identity,
  connectionUpdatedAtMs: z.number(),
  connectionScope: z.enum(["member", "shared"]),
  expiresAtMs: z.number().int().positive(),
  authority: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("remote"),
      authorization: remoteAgentExecutionAccessRequestSchema,
      scopeKey: z.string().min(1).max(2048),
    }),
    z.strictObject({
      kind: z.literal("local"),
      request: pluginActionRpcInputSchema,
    }),
  ]),
});
export const pluginComputerConnectionRequestSchema = z.strictObject({
  computer: cloudComputerSchema,
  grant: pluginConnectionGrantSchema,
});
export const pluginConnectionDescribeRequestSchema = z.strictObject({
  service: identity,
  connectionName: identity,
});
export type PluginConnectionGrant = zod.infer<
  typeof pluginConnectionGrantSchema
>;
