import { z } from "zod/v4";
import { runtimeTransportStopCauseSchema } from "../daemon/runtime-transport-stop-cause";
import { coreReadinessFactsChangedSchema } from "../protocol/core-readiness-facts-changed";
import { openMeldRuntimeProfileIdSchema } from "../protocol/profile";
import { trimmedStringFromUnknown } from "../protocol/shared";
import { signalReplyToSchema } from "../protocol/signal-reply-to";

export const signalSystemNoticeTypeSchema = z.enum([
  "stay_silent",
  "policy_blocked",
  "terminal_failure",
  "wake_completed",
  "wake_stopped",
  "execution_recovery_available",
  "execution_recovery_completed",
]);

export const signalSystemNoticeGeneratedBySchema = z.literal("openmeld");

// Distinguishes a failure that happened while the agent was executing (the
// agent never produced a settled outcome) from a failure that happened after
// the agent's outcome was already settled but OpenMeld's own reply
// publication broke. Both kinds can otherwise collide on the same generic
// `dispatch.execution_failed`-style fallback errorCode; this field lets
// clients tell them apart without string-matching `reason`/`reasonCode`.
export const signalSystemNoticeFailureStageSchema = z.enum([
  "execution",
  "publication",
]);

export const signalSystemNoticeDataSchema = z.strictObject({
  noticeType: signalSystemNoticeTypeSchema,
  actorProfileId: openMeldRuntimeProfileIdSchema.optional(),
  actorName: z
    .preprocess(trimmedStringFromUnknown, z.string().min(1))
    .optional(),
  dispatchId: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
  resultRef: z
    .preprocess(trimmedStringFromUnknown, z.string().min(1))
    .optional(),
  recoveryOperationId: z
    .preprocess(trimmedStringFromUnknown, z.string().min(1))
    .optional(),
  coreReadinessFactsChanged: coreReadinessFactsChangedSchema.optional(),
  replyTo: signalReplyToSchema.optional(),
  // Legacy diagnostic supplement. Clients must not classify on this field;
  // use `reasonCode` for machine-readable classification instead.
  reason: z.preprocess(trimmedStringFromUnknown, z.string().min(1)).optional(),
  // Machine-readable public failure/notice code (shared public failure
  // mapping code family, e.g. "runtime_coordinator.delivery_expired"). Never
  // a raw provider error string.
  reasonCode: z
    .preprocess(trimmedStringFromUnknown, z.string().min(1))
    .optional(),
  failureStage: signalSystemNoticeFailureStageSchema.optional(),
  stopCause: runtimeTransportStopCauseSchema.optional(),
  text: z.preprocess(trimmedStringFromUnknown, z.string().min(1)),
  generatedBy: signalSystemNoticeGeneratedBySchema,
});

export const signalSystemNoticeSchema = z.strictObject({
  type: z.literal("signal.system_notice"),
  data: signalSystemNoticeDataSchema,
});
