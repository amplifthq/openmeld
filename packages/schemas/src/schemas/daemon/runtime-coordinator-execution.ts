import * as z from "zod/v4";
import { runtimeExecutionAuthorityOpenMeldServiceRuntimeIdSchema } from "./execution-identity";
import { runtimeCoordinatorSafeEventPayloadJsonSchema } from "./runtime-coordinator-execution-token";
import { runtimeTransportAdmissionEvidenceSchema } from "./runtime-transport-admission-evidence";

export const RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION =
  "openmeld.runtime_coordinator.execution.v1" as const;
export const RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION =
  "openmeld.runtime_coordinator.creation_diagnostic.v1" as const;

const boundedIdentifierSchema = z.string().trim().min(1).max(512);
const boundedReasonCodeSchema = z.string().trim().min(1).max(160);
const sourceClientMessageIdSchema = z.string().trim().min(1).max(200);
const nullableSourceClientMessageIdSchema =
  sourceClientMessageIdSchema.nullable();
const nullableIdentifierSchema = boundedIdentifierSchema.nullable();
const nullablePositiveIntegerSchema = z.number().int().positive().nullable();

export const runtimeCoordinatorExecutionStatusSchema = z.enum([
  "created",
  "delivery_pending",
  "delivery_accepted",
  "delivery_rejected",
  "cancellation_requested",
  "accepted_local",
  "running",
  "completed_local",
  "result_received",
  "result_accepted",
  "reply_published",
  "cancelled",
  "failed_retryable",
  "failed_terminal",
  "state_unknown",
]);

export const runtimeCoordinatorExecutionEventTypeSchema = z.enum([
  "execution_created",
  "delivery_accepted",
  "delivery_rejected",
  "cancellation_requested",
  "cancellation_delivery_accepted",
  "cancellation_delivery_rejected",
  "cancellation_control_accepted",
  "cancellation_control_rejected",
  "lifecycle_accepted_local",
  "lifecycle_running",
  "lifecycle_completed_local",
  "result_received",
  "result_accepted",
  "result_duplicate",
  "result_stale_lease",
  "result_stale_attempt",
  "result_connection_generation_mismatch",
  "result_identity_echo_mismatch",
  "result_late_diagnostic",
  "execution_token_issued",
  "execution_token_validation_failed",
  "execution_token_superseded",
  "execution_token_expired",
  "execution_token_revoked",
  "execution_token_terminal_late",
  "token_history_retained",
  "token_history_pruned",
  "runtime_coordinator_execution_id_missing",
  "runtime_coordinator_execution_id_mismatch",
  "runtime_evidence_observed",
  "runtime_evidence_identity_echo_mismatch",
  "owner_conflict_current_token",
  "owner_conflict_stale_token",
  "owner_conflict_missing_token",
  "runtime_coordinator_decision_recorded",
  "runtime_coordinator_redelivery_commanded",
  "runtime_coordinator_owner_conflict_terminal",
  "runtime_coordinator_reclaim_blocked",
  "runtime_coordinator_retry_blocked",
  "runtime_coordinator_timeout_terminal",
  "reply_published",
  "reply_publication_failed",
  "coordinator_pending_state_missing",
  "runtime_connection_lost",
]);

export const runtimeCoordinatorTerminalOutcomeSchema = z.strictObject({
  kind: z.enum([
    "reply_published",
    "failed_retryable",
    "failed_terminal",
    "cancelled",
    "timed_out",
  ]),
  reasonCode: boundedReasonCodeSchema.nullable(),
  observedAtMs: z.number().int().nonnegative(),
});

export const runtimeCoordinatorCancellationStatusSchema = z.enum([
  "not_requested",
  "requested",
  "delivery_pending",
  "delivery_rejected",
  "local_control_accepted",
  "local_control_rejected",
  "unsupported",
  "cancelled",
]);

export const runtimeCoordinatorCancellationStateSchema = z.strictObject({
  status: runtimeCoordinatorCancellationStatusSchema,
  reasonCode: boundedReasonCodeSchema.nullable(),
  observedAtMs: z.number().int().nonnegative().nullable(),
});

export const runtimeCoordinatorLegacyPointersSchema = z.strictObject({
  attemptId: nullableIdentifierSchema,
  claimLeaseId: nullableIdentifierSchema,
  daemonSessionId: nullableIdentifierSchema,
  connectionGeneration: nullablePositiveIntegerSchema,
  leaseEpoch: nullablePositiveIntegerSchema,
});

/**
 * Secret-free facts observed at the final Runtime Transport delivery boundary.
 * These fields explain one exact delivery decision; they are not a second
 * readiness projection or execution authority.
 */
export const runtimeCoordinatorDeliveryRouteEvidenceSchema = z.strictObject({
  owner: z.enum(["matching", "unclaimed", "mismatched"]),
  profileLease: z.enum(["matching", "missing", "mismatched"]),
  session: z.enum(["matching", "missing", "connection_replaced"]),
  socket: z.enum(["present", "missing"]),
  acceptingDispatches: z.enum(["accepting", "not_accepting", "unknown"]),
  admissionEvidence: runtimeTransportAdmissionEvidenceSchema.optional(),
  profileRoute: z.enum(["registered", "not_registered", "unknown"]),
});

export const runtimeCoordinatorExecutionRecordSchema = z
  .strictObject({
    runtimeCoordinatorExecutionId: boundedIdentifierSchema,
    modelVersion: z.literal(RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION),
    spaceId: boundedIdentifierSchema,
    dispatchId: boundedIdentifierSchema,
    targetProfileId: boundedIdentifierSchema,
    sourceClientMessageId: nullableSourceClientMessageIdSchema,
    openMeldServiceRuntimeId:
      runtimeExecutionAuthorityOpenMeldServiceRuntimeIdSchema,
    bindingId: boundedIdentifierSchema,
    agentControllerRef: boundedIdentifierSchema,
    status: runtimeCoordinatorExecutionStatusSchema,
    terminalOutcome: runtimeCoordinatorTerminalOutcomeSchema.nullable(),
    createdAtMs: z.number().int().nonnegative(),
    updatedAtMs: z.number().int().nonnegative(),
    legacyPointers: runtimeCoordinatorLegacyPointersSchema,
  })
  .superRefine((record, context) => {
    if (
      record.status === "cancelled" &&
      record.terminalOutcome?.kind !== "cancelled"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "cancelled RuntimeCoordinator executions require a cancelled terminal outcome",
        path: ["terminalOutcome"],
      });
    }

    if (
      record.status === "cancellation_requested" &&
      record.terminalOutcome !== null
    ) {
      context.addIssue({
        code: "custom",
        message:
          "cancellation_requested RuntimeCoordinator executions must not have a terminal outcome",
        path: ["terminalOutcome"],
      });
    }
  });

export const runtimeCoordinatorExecutionEventSchema = z.strictObject({
  eventId: boundedIdentifierSchema,
  runtimeCoordinatorExecutionId: boundedIdentifierSchema,
  eventType: runtimeCoordinatorExecutionEventTypeSchema,
  statusAfter: runtimeCoordinatorExecutionStatusSchema.nullable(),
  reasonCode: boundedReasonCodeSchema.nullable(),
  observedAtMs: z.number().int().nonnegative(),
  idempotencyKey: boundedIdentifierSchema,
  payloadJson: runtimeCoordinatorSafeEventPayloadJsonSchema,
});

export const runtimeCoordinatorExecutionCreationStatusSchema = z.enum([
  "not_created",
]);

export const runtimeCoordinatorExecutionCreationDiagnosticSchema =
  z.strictObject({
    modelVersion: z.literal(
      RUNTIME_COORDINATOR_CREATION_DIAGNOSTIC_MODEL_VERSION
    ),
    spaceId: boundedIdentifierSchema,
    dispatchId: boundedIdentifierSchema,
    targetProfileId: boundedIdentifierSchema,
    sourceClientMessageId: nullableSourceClientMessageIdSchema,
    creationStatus: runtimeCoordinatorExecutionCreationStatusSchema,
    reasonCode: boundedReasonCodeSchema,
    observedAtMs: z.number().int().nonnegative(),
    legacyAttemptId: nullableIdentifierSchema,
  });

export const buildRuntimeCoordinatorExecutionId = (input: {
  dispatchId: string;
  spaceId: string;
  targetProfileId: string;
}): string => {
  const spaceId = normalizeRequiredRuntimeCoordinatorIdPart(
    "spaceId",
    input.spaceId
  );
  const dispatchId = normalizeRequiredRuntimeCoordinatorIdPart(
    "dispatchId",
    input.dispatchId
  );
  const targetProfileId = normalizeRequiredRuntimeCoordinatorIdPart(
    "targetProfileId",
    input.targetProfileId
  );
  return [
    "rce_v1",
    encodeLengthPrefixedIdPart(spaceId),
    encodeLengthPrefixedIdPart(dispatchId),
    encodeLengthPrefixedIdPart(targetProfileId),
  ].join("|");
};

/** The parts of an id from buildRuntimeCoordinatorExecutionId, or null. */
export const readRuntimeCoordinatorExecutionIdParts = (
  runtimeCoordinatorExecutionId: string
): { dispatchId: string; spaceId: string; targetProfileId: string } | null => {
  const prefix = "rce_v1|";
  if (!runtimeCoordinatorExecutionId.startsWith(prefix)) {
    return null;
  }
  const parts: string[] = [];
  let position = prefix.length;
  while (parts.length < 3) {
    const separator = runtimeCoordinatorExecutionId.indexOf(":", position);
    const length = Number(
      runtimeCoordinatorExecutionId.slice(position, separator)
    );
    if (separator < 0 || !Number.isSafeInteger(length) || length <= 0) {
      return null;
    }
    const end = separator + 1 + length;
    parts.push(runtimeCoordinatorExecutionId.slice(separator + 1, end));
    position = end + 1;
  }
  const [spaceId = "", dispatchId = "", targetProfileId = ""] = parts;
  // Only an exact round trip is an id this builder made.
  return buildRuntimeCoordinatorExecutionIdOrNull({
    dispatchId,
    spaceId,
    targetProfileId,
  }) === runtimeCoordinatorExecutionId
    ? { dispatchId, spaceId, targetProfileId }
    : null;
};

const buildRuntimeCoordinatorExecutionIdOrNull = (
  input: Parameters<typeof buildRuntimeCoordinatorExecutionId>[0]
): string | null => {
  try {
    return buildRuntimeCoordinatorExecutionId(input);
  } catch {
    return null;
  }
};

export const buildRuntimeCoordinatorExecutionEventId = (input: {
  eventType: z.infer<typeof runtimeCoordinatorExecutionEventTypeSchema>;
  idempotencyKey: string;
  runtimeCoordinatorExecutionId: string;
}): string => {
  const runtimeCoordinatorExecutionId =
    normalizeRequiredRuntimeCoordinatorIdPart(
      "runtimeCoordinatorExecutionId",
      input.runtimeCoordinatorExecutionId
    );
  const idempotencyKey = normalizeRequiredRuntimeCoordinatorIdPart(
    "idempotencyKey",
    input.idempotencyKey
  );
  return [
    "rce_event_v1",
    encodeLengthPrefixedIdPart(runtimeCoordinatorExecutionId),
    encodeLengthPrefixedIdPart(input.eventType),
    encodeLengthPrefixedIdPart(idempotencyKey),
  ].join("|");
};

const encodeLengthPrefixedIdPart = (value: string): string => {
  return `${value.length}:${value}`;
};

const normalizeRequiredRuntimeCoordinatorIdPart = (
  fieldName: string,
  value: string
): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`runtime_coordinator.id_invalid: ${fieldName} is required`);
  }
  return normalized;
};
