import { z } from "zod/v4";

export const spaceDispatchOutboxRedriveReasonSchema = z.enum([
  "runtime_coordinator_head_waiting_recovery",
]);

export const postSpaceDispatchOutboxRedriveBodySchema = z.strictObject({
  reason: spaceDispatchOutboxRedriveReasonSchema,
  targetProfileId: z.string().min(1),
  targetWakeLifecycleId: z.string().min(1).max(2048),
});

export const postSpaceDispatchOutboxRedriveResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      dispatchId: z.string().min(1),
      ok: z.literal(true),
      status: z.enum(["cancelled", "enqueued", "retry_scheduled", "submitted"]),
      targetProfileId: z.string().min(1),
    }),
    z.strictObject({
      dispatchId: z.string().min(1).nullable(),
      ok: z.literal(false),
      reasonCode: z.string().min(1).max(160),
      status: z.enum([
        "lifecycle_mismatch",
        "method_not_allowed",
        "not_found",
        "queue_unavailable",
        "request_invalid",
        "target_mismatch",
        "unauthorized",
      ]),
      targetProfileId: z.string().min(1).nullable(),
    }),
  ]);
