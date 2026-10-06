import * as z from "../../lazy-zod";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { remoteAgentTurnRuntimeEvidenceSchema } from "../runtime/remote-agent-worker";
import {
  centerAgentRoutineDestinationKindSchema,
  centerAgentRoutineRunScheduledForMsSchema,
  centerAgentRoutineRunStatusSchema,
} from "./center-agent-routines";
import { centerAgentVerifiedMemberToolSpeakerSchema } from "./center-agent-speaker";
import {
  centerAgentTurnDiagnosticPublicationStateSchema,
  centerAgentTurnDiagnosticStatusSchema,
} from "./center-agent-turn-diagnostics";

export const CENTER_AGENT_ROUTINE_EVIDENCE_PAGE_LIMIT = 25;
const id = z.string().trim().min(1).max(256);
const timestamp = z.number().int().nonnegative();
const nullableTime = timestamp.nullable();
const authority = {
  context: openMeldRequestContextSchema,
  speakerMember: centerAgentVerifiedMemberToolSpeakerSchema,
};
export const centerAgentListRoutineRunsToolRpcInputSchema = z.strictObject({
  ...authority,
  routineId: id,
  beforeScheduledFor: centerAgentRoutineRunScheduledForMsSchema.optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(CENTER_AGENT_ROUTINE_EVIDENCE_PAGE_LIMIT)
    .optional(),
});
export const centerAgentReadRoutineRunDiagnosticsRpcInputSchema =
  z.strictObject({
    ...authority,
    runId: id,
  });
const failure = z.strictObject({
  status: z.enum(["not_recorded", "recorded"]),
  publicReason: z.string().max(1500).nullable(),
  rawDetails: z.literal("not_included"),
});
export const centerAgentRoutineRunEvidenceSchema = z.strictObject({
  id,
  routineId: id,
  status: centerAgentRoutineRunStatusSchema,
  scheduledFor: centerAgentRoutineRunScheduledForMsSchema,
  startedAtMs: nullableTime,
  finishedAtMs: nullableTime,
  failure,
  destination: z.strictObject({
    kind: centerAgentRoutineDestinationKindSchema.nullable(),
    coverage: z.enum([
      "available",
      "redacted",
      "not_recorded",
      "unsupported_source",
    ]),
    spaceId: id.nullable(),
  }),
  publication: z.strictObject({
    status: z.enum(["recorded", "not_recorded"]),
    signalId: id.nullable(),
  }),
});
export const centerAgentListRoutineRunsToolResponseSchema = z.strictObject({
  organizationId: id,
  routineId: id,
  observedAtMs: timestamp,
  runs: z
    .array(centerAgentRoutineRunEvidenceSchema)
    .max(CENTER_AGENT_ROUTINE_EVIDENCE_PAGE_LIMIT),
  nextBeforeScheduledFor: centerAgentRoutineRunScheduledForMsSchema.nullable(),
  coverage: z.literal("retained_run_history_page"),
});

// Deliberately omit tool/capability names, conversation identities and provider
// payloads from organization-wide diagnostics. These are facts, not grading.
export const centerAgentRoutineRuntimeEvidenceSchema =
  remoteAgentTurnRuntimeEvidenceSchema.pick({
    budgetExhaustedAtMs: true,
    capabilityDescribeCount: true,
    capabilitySearchCount: true,
    firstAssistantTextAtMs: true,
    firstModelEventAtMs: true,
    firstProviderRequestPreparedAtMs: true,
    firstProviderResponseHeadersAtMs: true,
    firstVisibleContentAtMs: true,
    lastModelCompletedAtMs: true,
    modelCallCount: true,
    providerRequestCount: true,
    toolCallCount: true,
    updatedAtMs: true,
  });
export const centerAgentReadRoutineRunDiagnosticsResponseSchema =
  z.strictObject({
    organizationId: id,
    observedAtMs: timestamp,
    run: centerAgentRoutineRunEvidenceSchema,
    executionEngine: z.enum(["legacy", "workflow", "local"]).nullable(),
    continuationRecorded: z.boolean(),
    nativeDelivery: z.strictObject({
      coverage: z.enum(["available", "not_recorded", "unavailable"]),
      currentResultOwnerId: id.nullable(),
      currentResultOwnerRecorded: z.boolean(),
      historyTruncated: z.boolean(),
      deliveries: z
        .array(
          z.strictObject({
            deliveryId: id,
            isCurrentResultOwner: z.boolean(),
            status: centerAgentTurnDiagnosticStatusSchema,
            createdAtMs: timestamp,
            updatedAtMs: timestamp,
            submittedAtMs: nullableTime,
            acceptedAtMs: nullableTime,
            callbackReceivedAtMs: nullableTime,
            completedAtMs: nullableTime,
            failure,
            publicationState:
              centerAgentTurnDiagnosticPublicationStateSchema.nullable(),
            runtimeEvidenceStatus: z.enum([
              "available",
              "not_recorded",
              "unavailable",
            ]),
            runtimeEvidence: centerAgentRoutineRuntimeEvidenceSchema.nullable(),
          })
        )
        .max(8),
    }),
    coverage: z.literal("independent_owner_observations_not_atomic_history"),
  });
