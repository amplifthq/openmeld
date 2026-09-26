import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { connectorServiceSchema } from "./connector-connections";

const identity = z.string().trim().min(1).max(512);

// A human asks to continue an existing request. Neither task text nor an
// execution identity, credential, or destination can be supplied by the client.
export const pluginConnectionContinuationBodySchema = z.strictObject({
  sourceSignalId: identity,
  service: connectorServiceSchema,
  scope: z.enum(["member", "shared"]),
});

export const pluginConnectionContinuationRpcInputSchema =
  pluginConnectionContinuationBodySchema.extend({
    context: openMeldRequestContextSchema,
    spaceId: identity,
    password: z.string().optional(),
  });

export const pluginConnectionContinuationResponseSchema = z.strictObject({
  status: z.literal("requested"),
  sourceSignalId: identity,
  signalId: identity,
  spaceId: identity,
  targetProfileId: identity,
  threadId: identity.nullable(),
});

export type PluginConnectionContinuationBody = zod.infer<
  typeof pluginConnectionContinuationBodySchema
>;
export type PluginConnectionContinuationResponse = zod.infer<
  typeof pluginConnectionContinuationResponseSchema
>;
