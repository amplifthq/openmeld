import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "./profile-identity";
import { runtimeCoordinatorExecutionTokenEchoSchema } from "./runtime-coordinator-execution-token";
import { daemonServiceLaneSchema } from "./service-contract";

export const SESSION_HISTORY_RUNTIME_CAPABILITY = "session-history-v2";
export const SESSION_HISTORY_CAPABILITY_HEADER = "x-openmeld-session-history";
const id = z.string().trim().min(1).max(512);
export const sessionHistoryConnectionSchema = z.strictObject({
  projectId: id,
  bindingGeneration: id,
});
export const sessionHistoryPolicyInputSchema = z.strictObject({
  enabled: z.boolean(),
  connections: z.array(sessionHistoryConnectionSchema).max(128),
});
export const sessionHistoryPolicySchema =
  sessionHistoryPolicyInputSchema.extend({
    revision: z.number().int().positive(),
    updatedAtMs: z.number().int().nonnegative(),
  });
export const sessionHistoryReadSchema = z.strictObject({
  operation: z.literal("read_session"),
  projectId: id,
  sessionId: id,
  offset: z.number().int().min(0).max(100_000).default(0),
  limit: z.number().int().min(1).max(50).default(20),
});
export const sessionHistoryOperationSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("read_settings") }),
  z.strictObject({
    operation: z.literal("update_settings"),
    expectedRevision: z.number().int().positive(),
    policy: sessionHistoryPolicyInputSchema,
  }),
  z.strictObject({ operation: z.literal("read_audit") }),
  sessionHistoryReadSchema,
]);
// Core constructs this from authenticated execution evidence, never message text.
export const sessionHistoryRequesterSchema = z.strictObject({
  requestRootId: id,
  ownerUserId: id,
  requesterUserId: id,
  readerProfileId: id.nullable(),
  delegatorProfileId: id.nullable(),
  spaceId: id.nullable(),
  audience: z.enum(["owner_private", "space", "externally_shared"]),
});
export const sessionHistoryAuditSchema = z.strictObject({
  requestId: id,
  atMs: z.number().int().nonnegative(),
  requester: sessionHistoryRequesterSchema,
  projectId: id,
  sessionId: id,
  offset: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  outcome: z.enum(["allowed", "denied", "failed"]),
});
export const sessionHistoryPageSchema = z.strictObject({
  kind: z.literal("session"),
  sessionId: id,
  requester: sessionHistoryRequesterSchema,
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(8000),
        truncated: z.boolean(),
      })
    )
    .max(50),
  nextOffset: z.number().int().nonnegative().nullable(),
  omittedNonMessageItems: z.boolean(),
});
export const sessionHistoryResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("settings"),
    policy: sessionHistoryPolicySchema,
    connections: z
      .array(sessionHistoryConnectionSchema.extend({ projectSlug: id }))
      .max(512),
  }),
  z.strictObject({
    kind: z.literal("audit"),
    entries: z.array(sessionHistoryAuditSchema).max(200),
  }),
  sessionHistoryPageSchema,
  z.strictObject({
    kind: z.literal("error"),
    code: z.enum(["denied", "changed", "unavailable", "unsupported", "failed"]),
    message: z.string().max(512),
  }),
]);
export const sessionHistoryRpcInputSchema = z.strictObject({
  execution: z
    .strictObject({
      dispatchId: id,
      executionTokenEcho: runtimeCoordinatorExecutionTokenEchoSchema,
    })
    .optional(),
  context: openMeldRequestContextSchema,
  organizationId: id,
  deviceId: id,
  runtimeLane: daemonServiceLaneSchema,
  request: sessionHistoryOperationSchema,
});
export const sessionHistoryServiceRequestSchema = z.strictObject({
  organizationId: id,
  expectedDeviceId: id,
  requester: sessionHistoryRequesterSchema,
  request: sessionHistoryOperationSchema,
});
export const sessionHistoryRequestFrameSchema = z.strictObject({
  v: z.literal(1),
  code: z.literal("daemon.session_history.request"),
  payload: z.strictObject({
    requestId: id,
    request: sessionHistoryServiceRequestSchema,
  }),
});
export const sessionHistoryResultFrameSchema = z.strictObject({
  v: z.literal(1),
  code: z.literal("daemon.session_history.request_result"),
  payload: z.strictObject({
    requestId: id,
    result: sessionHistoryResultSchema,
  }),
});
export const runtimeTransportSessionHistoryRequestSchema = z.strictObject({
  v: z.literal(1),
  ownerUserId: id,
  deviceId: id,
  lane: daemonServiceLaneSchema,
  requestId: id,
  request: sessionHistoryServiceRequestSchema,
});
export const sessionHistoryAgentRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  computerId: id,
  request: sessionHistoryReadSchema,
});
