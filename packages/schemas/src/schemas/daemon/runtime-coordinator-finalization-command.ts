import { z } from "zod/v4";
import { openMeldDaemonTaskResultEnvelopeSchema } from "./task-result";

export const RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION =
  "openmeld.runtime_coordinator.finalization_command.v1" as const;
export const RUNTIME_COORDINATOR_PUBLICATION_RETRY_EXHAUSTED_REASON_CODE =
  "runtime_coordinator.publication_retry_exhausted" as const;

const boundedIdentifierSchema = z.string().trim().min(1).max(512);
const boundedNullableIdentifierSchema = boundedIdentifierSchema.nullable();
const boundedReasonCodeSchema = z.string().trim().min(1).max(160);
const boundedLabelSchema = z.string().trim().min(1).max(200);
const nullableBoundedLabelSchema = boundedLabelSchema.nullable();
const timestampMsSchema = z.number().int().nonnegative();

export const runtimeCoordinatorFinalizationDispatchOwnerSchema = z
  .strictObject({
    id: boundedIdentifierSchema,
    kind: z.literal("owner_account"),
  })
  .nullable();

export const runtimeCoordinatorFinalizationDispatchFactSchema = z.strictObject({
  attemptId: boundedIdentifierSchema,
  dispatchId: boundedIdentifierSchema,
  dispatchOwner: runtimeCoordinatorFinalizationDispatchOwnerSchema,
  enqueuedAtMs: timestampMsSchema,
  idempotencyKey: boundedIdentifierSchema,
  sourceClientMessageId: boundedNullableIdentifierSchema,
  sourceEventId: boundedIdentifierSchema,
  spaceId: boundedIdentifierSchema,
  targetProfileId: boundedIdentifierSchema,
  taskId: boundedIdentifierSchema,
});

export const runtimeCoordinatorFinalizationAcceptedResultSchema =
  z.strictObject({
    acceptedAtMs: timestampMsSchema,
    attemptId: boundedIdentifierSchema,
    daemonSessionId: boundedIdentifierSchema,
    dispatchId: boundedIdentifierSchema,
    executionTokenFingerprint: boundedIdentifierSchema,
    executionTokenRunId: boundedIdentifierSchema,
    leaseEpoch: z.number().int().positive(),
    runtimeCoordinatorExecutionId: boundedIdentifierSchema,
    submittedConnectionGeneration: z.number().int().positive(),
    targetProfileId: boundedIdentifierSchema,
    taskId: boundedIdentifierSchema,
    taskResult: openMeldDaemonTaskResultEnvelopeSchema,
  });

export const runtimeCoordinatorFinalizationCommandSchema = z.strictObject({
  acceptedResult: runtimeCoordinatorFinalizationAcceptedResultSchema,
  createdAtMs: timestampMsSchema,
  dispatchFact: runtimeCoordinatorFinalizationDispatchFactSchema,
  dispatchId: boundedIdentifierSchema,
  executionTokenRunId: boundedIdentifierSchema,
  finalizationCommandId: boundedIdentifierSchema,
  modelVersion: z.literal(
    RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION
  ),
  publicationIdempotencyKey: boundedIdentifierSchema,
  resultIdempotencyKey: boundedIdentifierSchema,
  runtimeCoordinatorExecutionId: boundedIdentifierSchema,
  spaceId: boundedIdentifierSchema,
  targetOwnerUserId: boundedIdentifierSchema,
  targetProfileId: boundedIdentifierSchema,
  targetProfileMentionLabel: nullableBoundedLabelSchema,
  targetProfileName: nullableBoundedLabelSchema,
});

export const runtimeCoordinatorFinalizationSuccessOutcomeSchema =
  z.strictObject({
    ok: z.literal(true),
    finalizationCommandId: boundedIdentifierSchema,
    publicationErrorCode: z.null(),
    publishedSignalId: boundedNullableIdentifierSchema,
    publishState: z.enum(["reply_published", "invalid_space_action"]),
    status: z.enum(["already_final", "finalized"]),
  });

export const runtimeCoordinatorFinalizationOutcomeSchema = z.discriminatedUnion(
  "ok",
  [
    runtimeCoordinatorFinalizationSuccessOutcomeSchema,
    z.strictObject({
      ok: z.literal(false),
      finalizationCommandId: boundedIdentifierSchema,
      publicationErrorCode: boundedReasonCodeSchema,
      publishedSignalId: z.null(),
      publishState: z.literal("reply_publication_failed"),
      status: z.literal("retry_later"),
    }),
  ]
);

export const runtimeCoordinatorFinalizationClaimReadSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      outcome: runtimeCoordinatorFinalizationSuccessOutcomeSchema,
      status: z.literal("finalization_visible"),
    }),
    z.strictObject({
      publishedSignalId: boundedIdentifierSchema,
      status: z.literal("wake_stopped_visible"),
    }),
    z.strictObject({
      publishedSignalId: boundedIdentifierSchema,
      status: z.literal("publication_failed_visible"),
    }),
    z.strictObject({
      status: z.literal("unresolved"),
    }),
  ]);

export const buildRuntimeCoordinatorFinalizationCommandId = (input: {
  executionTokenRunId: string;
  runtimeCoordinatorExecutionId: string;
}): string => {
  return [
    "rcfc",
    encodeLengthPrefixedPart(input.runtimeCoordinatorExecutionId),
    encodeLengthPrefixedPart(input.executionTokenRunId),
  ].join(":");
};

const encodeLengthPrefixedPart = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("runtime_coordinator.finalization_command_id_part_empty");
  }
  return `${normalized.length}.${normalized}`;
};
