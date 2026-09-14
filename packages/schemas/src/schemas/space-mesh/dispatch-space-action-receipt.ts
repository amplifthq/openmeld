import * as z from "zod/v4";

export const dispatchSpaceActionClosedReasonCodeSchema = z.enum([
  "space_action.context_expired",
  "space_action.context_mismatch",
]);

// These receipts describe only evidence available to the local action recorder.
// A saved proposal is not Coordinator acceptance or Space publication.
export const dispatchSpaceActionReceiptSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("proposal_saved_locally"),
    actionType: z.enum(["post_message", "post_status", "stay_silent"]),
    attemptId: z.string().min(1),
    contextId: z.string().min(1),
    dispatchId: z.string().min(1),
    recordedAtMs: z.number().int().nonnegative(),
    contextState: z.enum(["active", "expired"]),
    coordinatorAcceptance: z.literal("unconfirmed"),
    publication: z.literal("unconfirmed"),
  }),
  z.strictObject({
    status: z.literal("rejected_closed"),
    reasonCode: dispatchSpaceActionClosedReasonCodeSchema,
    coordinatorAcceptance: z.literal("unconfirmed"),
    publication: z.literal("unconfirmed"),
  }),
  z.strictObject({
    status: z.literal("outcome_unknown"),
    reasonCode: z.literal("space_action.recording_outcome_unknown"),
    coordinatorAcceptance: z.literal("unconfirmed"),
    publication: z.literal("unconfirmed"),
  }),
]);

export const dispatchSpaceActionToolResultSchema = z.strictObject({
  receipt: dispatchSpaceActionReceiptSchema,
});
