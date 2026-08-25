import * as z from "zod/v4";

export const OPENMELD_DAEMON_MENTION_DISPATCH_RESULT_SCHEMA_VERSION =
  2 as const;

export const openMeldDaemonMentionDispatchStatusSchema = z.enum([
  "dispatch_ready",
  "blocked",
  "failed",
]);

export const openMeldDaemonMentionDispatchRuleSourceSchema = z.enum([
  "system",
  "space",
  "profile",
  "registry",
]);

const openMeldDaemonMentionDispatchResultCommonPayloadSchema = z.strictObject({
  sourceEventId: z.string().min(1),
  dispatchId: z.string().min(1),
  targetProfileId: z.string().min(1),
  ruleSource: openMeldDaemonMentionDispatchRuleSourceSchema,
  ruleId: z.string().min(1),
  ruleReason: z.string().min(1),
});

const openMeldDaemonMentionDispatchReadyPayloadSchema =
  openMeldDaemonMentionDispatchResultCommonPayloadSchema.extend({
    status: z.literal("dispatch_ready"),
  });

const openMeldDaemonMentionDispatchBlockedPayloadSchema =
  openMeldDaemonMentionDispatchResultCommonPayloadSchema.extend({
    status: z.literal("blocked"),
    errorCode: z.string().min(1),
  });

const openMeldDaemonMentionDispatchFailedPayloadSchema =
  openMeldDaemonMentionDispatchResultCommonPayloadSchema.extend({
    status: z.literal("failed"),
    errorCode: z.string().min(1),
  });

export const openMeldDaemonMentionDispatchResultPayloadSchema =
  z.discriminatedUnion("status", [
    openMeldDaemonMentionDispatchReadyPayloadSchema,
    openMeldDaemonMentionDispatchBlockedPayloadSchema,
    openMeldDaemonMentionDispatchFailedPayloadSchema,
  ]);

export const openMeldDaemonMentionDispatchResultEnvelopeSchema = z.strictObject(
  {
    v: z.literal(OPENMELD_DAEMON_MENTION_DISPATCH_RESULT_SCHEMA_VERSION),
    code: z.literal("service.mention_dispatch_result"),
    payload: openMeldDaemonMentionDispatchResultPayloadSchema,
  }
);
