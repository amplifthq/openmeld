import {
  remoteAgentTurnEnvelopeSchema,
  remoteAgentTurnEnvelopeTriggerSchema,
  remoteAgentWorkerSubmitTurnRequestV2Schema,
} from "@openmeld/schemas";

const trigger = remoteAgentTurnEnvelopeTriggerSchema.options.find(
  (
    option
  ): option is Extract<typeof option, { shape: { summaryOnly: unknown } }> =>
    "summaryOnly" in option.shape
);
if (!trigger) {
  throw new Error("Missing task continuation trigger schema");
}
// The strict task_continuation shape before e050cded8 had these same fields,
// except summaryOnly. Retain the real enclosing schema and validation path.
export const legacySummaryReceiverRequestSchema =
  remoteAgentWorkerSubmitTurnRequestV2Schema.safeExtend({
    turnEnvelope: remoteAgentTurnEnvelopeSchema.safeExtend({
      trigger: trigger.omit({ summaryOnly: true }),
    }),
  });
