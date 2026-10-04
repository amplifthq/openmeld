import * as z from "zod/v4";
import {
  connectorConnectionNameSchema,
  connectorServiceSchema,
} from "./connector-connections";

// A task constraint on existing Plugin permission, never permission by itself.
export const pluginDelegationRequestSchema = z.strictObject({
  targetProfileId: z.string().min(1),
  service: connectorServiceSchema,
  connectionName: connectorConnectionNameSchema,
  actionId: z.string().trim().min(1).max(160),
  input: z.record(z.string(), z.unknown()),
  effect: z.enum(["read", "write"]),
  expiresAtMs: z.int().positive(),
});

export const pluginDelegationAuthorizationSchema = pluginDelegationRequestSchema
  .omit({ input: true })
  .extend({
    requestSignature: z.string().regex(/^[a-f0-9]{64}$/u),
    connectionUpdatedAtMs: z.int().nonnegative(),
    connectionOwnerUserId: z.string().min(1),
    connectionScope: z.enum(["member", "shared"]),
  });
