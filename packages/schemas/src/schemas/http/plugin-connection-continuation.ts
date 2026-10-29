import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { spaceThreadContextSchema } from "../space-mesh/space-thread";
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

// An internal Space projection over a completed RuntimeCoordinator execution.
// D1 request provenance alone never establishes workstation completion.
export const pluginConnectionLocalSourceRequestSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  spaceId: identity,
  sourceSignalId: identity,
  password: z.string().optional(),
});
export const pluginConnectionLocalSourceResponseSchema = z.strictObject({
  executionId: identity,
  bindingId: identity,
  dispatchId: identity,
  targetProfileId: identity,
  sourceSignalId: identity,
  requesterProfileId: identity,
  requesterDisplayName: z.string(),
  createdAtMs: z.number().int().nonnegative(),
  completedAtMs: z.number().int().nonnegative(),
  threadContext: spaceThreadContextSchema.nullable(),
});
export type PluginConnectionLocalSourceRequest = zod.infer<
  typeof pluginConnectionLocalSourceRequestSchema
>;

// Internal, read-only provenance from the RuntimeCoordinator owner. This does
// not establish completion, authorize a Plugin, or expose the delivery payload.
export const pluginConnectionExecutionSourceRequestSchema = z.strictObject({
  ownerUserId: identity,
  executionId: identity,
  spaceId: identity,
  dispatchId: identity,
  targetProfileId: identity,
});
export const pluginConnectionExecutionSourceSchema =
  pluginConnectionExecutionSourceRequestSchema.extend({
    bindingId: identity,
    sourceSignalId: identity,
    requesterProfileId: identity,
    sourceEnvelopeDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAtMs: z.number().int().nonnegative(),
    threadContext: spaceThreadContextSchema.nullable(),
  });
export const pluginConnectionExecutionSourceResponseSchema = z.strictObject({
  source: pluginConnectionExecutionSourceSchema.nullable(),
});
export type PluginConnectionExecutionSourceRequest = zod.infer<
  typeof pluginConnectionExecutionSourceRequestSchema
>;
export type PluginConnectionExecutionSource = zod.infer<
  typeof pluginConnectionExecutionSourceSchema
>;

const messageGuardSchema = z.strictObject({
  signalId: identity,
  revision: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
});

// Host-owned payload of an existing Message/Wake, never public message metadata
// or a client-supplied grant. This is not another task or permission owner.
export const pluginConnectionContinuationBindingSchema = z.strictObject({
  v: z.literal(1),
  organizationId: identity,
  spaceId: identity,
  sourceDispatchId: identity,
  approvedActionRequestId: z.string().uuid().optional(),
  source: messageGuardSchema,
  reply: messageGuardSchema,
  requesterUserId: identity,
  requesterProfileId: identity,
  targetProfileId: identity,
  service: connectorServiceSchema,
  scope: z.enum(["member", "shared"]),
  connectionName: identity,
  connectionUpdatedAtMs: z.number().int().nonnegative(),
  continuationTextDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  threadContext: spaceThreadContextSchema.nullable(),
});

export const readPluginConnectionContinuationBindingRequestSchema =
  z.strictObject({
    organizationId: identity,
    spaceId: identity,
    signalId: identity,
    targetProfileId: identity,
    requesterUserId: identity,
  });
export const readPluginConnectionContinuationBindingResponseSchema =
  z.strictObject({
    binding: pluginConnectionContinuationBindingSchema.nullable(),
  });
export type PluginConnectionContinuationBinding = zod.infer<
  typeof pluginConnectionContinuationBindingSchema
>;
export type ReadPluginConnectionContinuationBindingRequest = zod.infer<
  typeof readPluginConnectionContinuationBindingRequestSchema
>;

export type PluginConnectionContinuationBody = zod.infer<
  typeof pluginConnectionContinuationBodySchema
>;
export type PluginConnectionContinuationResponse = zod.infer<
  typeof pluginConnectionContinuationResponseSchema
>;
