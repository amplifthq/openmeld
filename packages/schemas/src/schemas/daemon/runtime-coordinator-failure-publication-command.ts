import { z } from "zod/v4";
import { spaceMentionLabelSchema } from "../http/space-mention-label";
import { MAX_PROFILE_NAME_LENGTH } from "../protocol/constants";
import { targetWakeLifecycleIdentitySchema } from "../protocol/target-wake-lifecycle";
import {
  runtimeTransportRuntimeCoordinatorHeadNoExecutionPublicationCategorySchema,
  runtimeTransportRuntimeCoordinatorHeadNoExecutionReasonCodeSchema,
  runtimeTransportRuntimeCoordinatorHeadNoExecutionRecoveryActionSchema,
} from "./runtime-transport";

export const RUNTIME_COORDINATOR_FAILURE_PUBLICATION_COMMAND_MODEL_VERSION =
  "openmeld.runtime_coordinator.failure_publication_command.v1" as const;

const boundedIdentifierSchema = z.string().trim().min(1).max(2048);
const boundedCommandIdentifierSchema = z.string().trim().min(1).max(4096);
const boundedNullableIdentifierSchema = boundedIdentifierSchema.nullable();
const boundedReasonCodeSchema = z.string().trim().min(1).max(160);
const timestampMsSchema = z.number().int().nonnegative();

export const runtimeCoordinatorFailurePublicationCommandSchema = z.strictObject(
  {
    createdAtMs: timestampMsSchema,
    dispatchId: boundedIdentifierSchema,
    failurePublicationCommandId: boundedCommandIdentifierSchema,
    modelVersion: z.literal(
      RUNTIME_COORDINATOR_FAILURE_PUBLICATION_COMMAND_MODEL_VERSION
    ),
    ownerUserId: boundedIdentifierSchema,
    publicationCategory:
      runtimeTransportRuntimeCoordinatorHeadNoExecutionPublicationCategorySchema,
    publicationIntentId: boundedCommandIdentifierSchema,
    reasonCode:
      runtimeTransportRuntimeCoordinatorHeadNoExecutionReasonCodeSchema,
    spaceId: boundedIdentifierSchema,
    targetProfileMentionLabel: spaceMentionLabelSchema.nullable(),
    targetProfileId: boundedIdentifierSchema,
    targetProfileName: z
      .string()
      .trim()
      .min(1)
      .max(MAX_PROFILE_NAME_LENGTH)
      .nullable(),
    targetWakeLifecycleIdentity: targetWakeLifecycleIdentitySchema,
    targetWakeLifecycleId: boundedCommandIdentifierSchema,
    userRecoveryAction:
      runtimeTransportRuntimeCoordinatorHeadNoExecutionRecoveryActionSchema,
  }
);

export const runtimeCoordinatorFailurePublicationFinalMessageKindSchema =
  z.enum(["failure_notice", "status", "success_reply", "unknown"]);

export const runtimeCoordinatorFailurePublicationOutcomeSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      failurePublicationCommandId: boundedCommandIdentifierSchema,
      finalMessageKind: z.literal("failure_notice"),
      ok: z.literal(true),
      publicationAction: z.enum(["created", "already_visible"]),
      publicationErrorCode: z.null(),
      publishedSignalId: boundedIdentifierSchema,
      status: z.literal("failure_published"),
    }),
    z.strictObject({
      failurePublicationCommandId: boundedCommandIdentifierSchema,
      finalMessageKind:
        runtimeCoordinatorFailurePublicationFinalMessageKindSchema,
      ok: z.literal(true),
      publicationErrorCode: z.null(),
      publishedSignalId: boundedIdentifierSchema,
      status: z.literal("already_final"),
    }),
    z.strictObject({
      failurePublicationCommandId: boundedCommandIdentifierSchema,
      finalMessageKind: z.null(),
      ok: z.literal(false),
      publicationErrorCode: boundedReasonCodeSchema,
      publishedSignalId: boundedNullableIdentifierSchema,
      status: z.literal("failure_publication_failed"),
    }),
  ]);

export const buildRuntimeCoordinatorFailurePublicationCommandId = (input: {
  publicationIntentId: string;
}): string => {
  const publicationIntentId = input.publicationIntentId.trim();
  if (!publicationIntentId) {
    throw new Error(
      "runtime_coordinator.failure_publication_command_intent_id_empty"
    );
  }
  return `rcfpc:no_execution:${publicationIntentId.length}.${publicationIntentId}`;
};
