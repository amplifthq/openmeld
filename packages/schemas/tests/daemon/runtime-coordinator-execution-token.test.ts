import { describe, expect, it } from "vitest";
import {
  buildRuntimeCoordinatorFinalizationCommandId,
  RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
  RUNTIME_COORDINATOR_EXECUTION_TOKEN_MODEL_VERSION,
  RUNTIME_COORDINATOR_EXECUTION_TOKEN_REDACTION_MARKER,
  RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
  RUNTIME_COORDINATOR_TOKEN_AUTHORITY_MODEL_VERSION,
  runtimeCoordinatorExecutionEventSchema,
  runtimeCoordinatorExecutionRecordSchema,
  runtimeCoordinatorExecutionTokenAuthorityRecordSchema,
  runtimeCoordinatorExecutionTokenEchoSchema,
  runtimeCoordinatorExecutionTokenEnvelopeSchema,
  runtimeCoordinatorFinalizationClaimReadSchema,
  runtimeCoordinatorFinalizationCommandSchema,
  runtimeCoordinatorFinalizationOutcomeSchema,
  runtimeCoordinatorSafeEventPayloadJsonSchema,
  runtimeCoordinatorTokenDiagnosticEventSchema,
  runtimeCoordinatorTokenProjectionSchema,
  spaceDispatchTraceRuntimeCoordinatorExecutionSchema,
} from "../../src/index";

const RAW_TOKEN = `rcet_v1_${"a".repeat(43)}`;
const VALIDATION_HASH = `sha256:${"b".repeat(64)}`;
const OTHER_VALIDATION_HASH = `sha256:${"c".repeat(64)}`;
const TOKEN_FINGERPRINT = `etfp_v1_${"d".repeat(32)}`;
const OTHER_TOKEN_FINGERPRINT = `etfp_v1_${"e".repeat(32)}`;

const executionScope = {
  dispatchId: "dispatch-1",
  runtimeCoordinatorExecutionId: "rce-1",
  sourceClientMessageId: "client-message-1",
  spaceId: "space-1",
  targetProfileId: "agt-1",
};

const authorityScope = {
  bindingId: "binding-1",
  agentControllerRef: "builtin:codex",
  openMeldServiceRuntimeId: "runtime-1",
};

const deliveryProvenance = {
  connectionGeneration: 1,
  daemonSessionId: "daemon-session-1",
  leaseEpoch: 2,
};

describe("runtime coordinator execution token schemas", () => {
  it("exports the shared redaction marker for schema and Core helpers", () => {
    expect(RUNTIME_COORDINATOR_EXECUTION_TOKEN_REDACTION_MARKER).toBe(
      "[REDACTED_EXECUTION_TOKEN]"
    );
  });

  it("allows raw executionToken only on daemon delivery and daemon echo boundaries", () => {
    expect(
      runtimeCoordinatorExecutionTokenEnvelopeSchema.safeParse({
        authorityScope,
        deliveryIdempotencyKey: "rce-1::run-1",
        deliveryProvenance,
        executionScope,
        executionToken: RAW_TOKEN,
        expiresAtMs: null,
        issuedAtMs: 1_700_000_000_000,
        modelVersion: RUNTIME_COORDINATOR_EXECUTION_TOKEN_MODEL_VERSION,
        runId: "run-1",
        tokenFingerprint: TOKEN_FINGERPRINT,
        tokenStatus: "active",
      }).success
    ).toBe(true);

    expect(
      runtimeCoordinatorExecutionTokenEchoSchema.safeParse({
        executionToken: RAW_TOKEN,
        runId: "run-1",
        runtimeCoordinatorExecutionId: "rce-1",
        tokenFingerprint: TOKEN_FINGERPRINT,
      }).success
    ).toBe(true);

    expect(
      runtimeCoordinatorTokenProjectionSchema.safeParse({
        deliveryIdempotencyKey: "rce-1::run-1",
        executionToken: RAW_TOKEN,
        expiresAtMs: null,
        issuedAtMs: 1_700_000_000_000,
        modelVersion: RUNTIME_COORDINATOR_EXECUTION_TOKEN_MODEL_VERSION,
        reasonCode: "execution_token_issued",
        retiredAtMs: null,
        retentionExpiresAtMs: null,
        runId: "run-1",
        tokenFingerprint: TOKEN_FINGERPRINT,
        tokenStatus: "active",
      }).success
    ).toBe(false);

    expect(
      runtimeCoordinatorTokenDiagnosticEventSchema.safeParse({
        executionToken: RAW_TOKEN,
        ignoredEventSummary: "ignored stale result",
        modelVersion: "openmeld.runtime_coordinator.token_diagnostic.v1",
        observedAtMs: 1_700_000_000_100,
        reasonCode: "execution_token_mismatch",
        runId: "run-1",
        runtimeCoordinatorExecutionId: "rce-1",
        tokenFingerprint: TOKEN_FINGERPRINT,
        tokenStatus: "active",
      }).success
    ).toBe(false);
  });

  it("accepts a RuntimeCoordinator-owned finalization command and publication outcome without token secrets", () => {
    const finalizationCommandId = buildRuntimeCoordinatorFinalizationCommandId({
      executionTokenRunId: "run-1",
      runtimeCoordinatorExecutionId: "rce-1",
    });
    const command = {
      acceptedResult: {
        acceptedAtMs: 1_700_000_000_100,
        attemptId: "attempt-1",
        daemonSessionId: "daemon-session-1",
        dispatchId: "dispatch-1",
        executionTokenFingerprint: TOKEN_FINGERPRINT,
        executionTokenRunId: "run-1",
        leaseEpoch: 2,
        runtimeCoordinatorExecutionId: "rce-1",
        submittedConnectionGeneration: 1,
        targetProfileId: "agt-1",
        taskId: "task-1",
        taskResult: {
          v: 4,
          code: "service.task_result",
          payload: {
            agentId: "agt-1",
            attemptId: "attempt-1",
            deduped: false,
            output: "done",
            sourceEventId: "signal-1",
            status: "success",
            taskId: "task-1",
          },
        },
      },
      createdAtMs: 1_700_000_000_110,
      dispatchFact: {
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        dispatchOwner: {
          id: "owner-1",
          kind: "owner_account",
        },
        enqueuedAtMs: 1_700_000_000_000,
        idempotencyKey: "dispatch-idempotency-1",
        sourceClientMessageId: "client-message-1",
        sourceEventId: "signal-1",
        spaceId: "space-1",
        targetProfileId: "agt-1",
        taskId: "task-1",
      },
      dispatchId: "dispatch-1",
      executionTokenRunId: "run-1",
      finalizationCommandId,
      modelVersion: RUNTIME_COORDINATOR_FINALIZATION_COMMAND_MODEL_VERSION,
      publicationIdempotencyKey: "publication:rce-1:run-1",
      resultIdempotencyKey: "dispatch-1::attempt-1",
      runtimeCoordinatorExecutionId: "rce-1",
      spaceId: "space-1",
      targetOwnerUserId: "owner-1",
      targetProfileId: "agt-1",
      targetProfileMentionLabel: null,
      targetProfileName: null,
    };

    expect(
      runtimeCoordinatorFinalizationCommandSchema.safeParse(command).success
    ).toBe(true);
    expect(
      runtimeCoordinatorFinalizationCommandSchema.safeParse({
        ...command,
        rawExecutionToken: RAW_TOKEN,
      }).success
    ).toBe(false);
    expect(
      runtimeCoordinatorFinalizationOutcomeSchema.safeParse({
        finalMessageKind: "success_reply",
        finalizationCommandId,
        ok: true,
        publicationErrorCode: null,
        publishedSignalId: "signal-final-1",
        publishState: "reply_published",
        status: "finalized",
      }).success
    ).toBe(true);
    expect(
      runtimeCoordinatorFinalizationOutcomeSchema.safeParse({
        finalMessageKind: "unknown",
        finalizationCommandId,
        ok: true,
        publicationErrorCode: null,
        publishedSignalId: "signal-final-1",
        publishState: "reply_published",
        status: "finalized",
      }).success
    ).toBe(false);
    expect(
      runtimeCoordinatorFinalizationOutcomeSchema.safeParse({
        finalizationCommandId,
        ok: false,
        publicationErrorCode: "daemon.result.finalization_unavailable",
        publishedSignalId: null,
        publishState: "reply_publication_failed",
        status: "retry_later",
      }).success
    ).toBe(true);
    expect(
      runtimeCoordinatorFinalizationClaimReadSchema.safeParse({
        outcome: {
          finalMessageKind: "success_reply",
          finalizationCommandId,
          ok: true,
          publicationErrorCode: null,
          publishedSignalId: "signal-final-1",
          publishState: "reply_published",
          status: "already_final",
        },
        status: "finalization_visible",
      }).success
    ).toBe(true);
    expect(
      runtimeCoordinatorFinalizationClaimReadSchema.safeParse({
        publishedSignalId: "signal-wake-stopped-1",
        status: "wake_stopped_visible",
      }).success
    ).toBe(true);
    expect(
      runtimeCoordinatorFinalizationClaimReadSchema.safeParse({
        outcome: {
          finalizationCommandId,
          ok: true,
          publicationErrorCode: null,
          publishedSignalId: "signal-final-1",
          publishState: "reply_published",
          status: "already_final",
        },
        publishedSignalId: "signal-wake-stopped-1",
        status: "wake_stopped_visible",
      }).success
    ).toBe(false);
  });

  it("keeps validation hash inside authority storage only", () => {
    const authorityRecord = createAuthorityRecord();

    expect(
      runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
        authorityRecord
      ).success
    ).toBe(true);

    expect(
      runtimeCoordinatorExecutionRecordSchema.safeParse({
        ...createRuntimeCoordinatorExecutionProjection(),
        tokenValidationHash: VALIDATION_HASH,
      }).success
    ).toBe(false);

    expect(
      spaceDispatchTraceRuntimeCoordinatorExecutionSchema.safeParse({
        ...createRuntimeCoordinatorExecutionProjection(),
        factSource: "runtime_coordinator_projection",
        tokenValidationHash: VALIDATION_HASH,
      }).success
    ).toBe(false);
  });

  it("enforces active and retired run secret retention boundaries", () => {
    const activeWithoutSecret = createAuthorityRecord({
      runsById: {
        "run-1": {
          ...createActiveRun(),
          tokenSecretRefOrSealedToken: null,
        },
      },
    });
    expect(
      runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
        activeWithoutSecret
      ).success
    ).toBe(false);

    const retiredWithSecret = createAuthorityRecord({
      currentRunId: null,
      runsById: {
        "run-1": {
          ...createActiveRun(),
          retiredAtMs: 1_700_000_010_000,
          retiredReasonCode: "execution_token_superseded",
          tokenSecretRefOrSealedToken: "sealed-token",
          tokenStatus: "superseded" as const,
        },
      },
    });
    expect(
      runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
        retiredWithSecret
      ).success
    ).toBe(false);

    const retiredWithoutSecret = createAuthorityRecord({
      currentRunId: null,
      runsById: {
        "run-1": {
          ...createActiveRun(),
          retentionExpiresAtMs: 1_700_000_020_000,
          retiredAtMs: 1_700_000_010_000,
          retiredReasonCode: "execution_token_superseded",
          tokenSecretRefOrSealedToken: null,
          tokenStatus: "superseded" as const,
        },
      },
    });
    expect(
      runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
        retiredWithoutSecret
      ).success
    ).toBe(true);

    const retiredWithMismatchedReason = createAuthorityRecord({
      currentRunId: null,
      runsById: {
        "run-1": createRetiredRun({
          retiredReasonCode: "execution_token_expired",
          tokenStatus: "superseded" as const,
        }),
      },
    });
    expect(
      runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
        retiredWithMismatchedReason
      ).success
    ).toBe(false);
  });

  it("rejects authority records with multiple active runs or retained history above the configured cap", () => {
    const multipleActiveRuns = createAuthorityRecord({
      currentRunId: "run-2",
      runsById: {
        "run-1": createActiveRun(),
        "run-2": createActiveRun({
          deliveryIdempotencyKey: "rce-1::run-2",
          runId: "run-2",
          tokenFingerprint: OTHER_TOKEN_FINGERPRINT,
          tokenValidationHash: OTHER_VALIDATION_HASH,
        }),
      },
      tokenValidationHashIndex: {
        [VALIDATION_HASH]: "run-1",
        [OTHER_VALIDATION_HASH]: "run-2",
      },
    });
    expect(
      runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
        multipleActiveRuns
      ).success
    ).toBe(false);

    const overRetiredHistoryLimit = createAuthorityRecord({
      currentRunId: null,
      retention: {
        lastPrunedAtMs: null,
        lateResultWindowMs: 86_400_000,
        maxRetiredRuns: 1,
      },
      runsById: {
        "run-1": createRetiredRun(),
        "run-2": createRetiredRun({
          deliveryIdempotencyKey: "rce-1::run-2",
          retiredAtMs: 1_700_000_011_000,
          runId: "run-2",
          tokenFingerprint: OTHER_TOKEN_FINGERPRINT,
          tokenValidationHash: OTHER_VALIDATION_HASH,
        }),
      },
      tokenValidationHashIndex: {
        [VALIDATION_HASH]: "run-1",
        [OTHER_VALIDATION_HASH]: "run-2",
      },
    });
    expect(
      runtimeCoordinatorExecutionTokenAuthorityRecordSchema.safeParse(
        overRetiredHistoryLimit
      ).success
    ).toBe(false);
  });

  it("rejects token secrets in coordinator events that flow into D1 and trace", () => {
    expect(
      runtimeCoordinatorSafeEventPayloadJsonSchema.safeParse(
        JSON.stringify({
          tokenFingerprint: TOKEN_FINGERPRINT,
          tokenStatus: "active",
        })
      ).success
    ).toBe(true);

    expect(
      runtimeCoordinatorExecutionEventSchema.safeParse({
        eventId: "event-1",
        eventType: "execution_token_issued",
        idempotencyKey: "rce-1::run-1",
        observedAtMs: 1_700_000_000_000,
        payloadJson: JSON.stringify({
          executionToken: RAW_TOKEN,
          tokenFingerprint: TOKEN_FINGERPRINT,
        }),
        reasonCode: "execution_token_issued",
        runtimeCoordinatorExecutionId: "rce-1",
        statusAfter: "delivery_accepted",
      }).success
    ).toBe(false);

    expect(
      runtimeCoordinatorExecutionEventSchema.safeParse({
        eventId: "event-2",
        eventType: "execution_token_validation_failed",
        idempotencyKey: "rce-1::run-1::late",
        observedAtMs: 1_700_000_000_100,
        payloadJson: JSON.stringify({
          nested: {
            tokenValidationHash: VALIDATION_HASH,
          },
        }),
        reasonCode: "execution_token_mismatch",
        runtimeCoordinatorExecutionId: "rce-1",
        statusAfter: null,
      }).success
    ).toBe(false);

    expect(
      runtimeCoordinatorExecutionEventSchema.safeParse({
        eventId: "event-3",
        eventType: "execution_token_validation_failed",
        idempotencyKey: "rce-1::run-1::late-redacted",
        observedAtMs: 1_700_000_000_200,
        payloadJson: JSON.stringify({
          executionTokenRedacted:
            RUNTIME_COORDINATOR_EXECUTION_TOKEN_REDACTION_MARKER,
          tokenValidationHashRedacted:
            RUNTIME_COORDINATOR_EXECUTION_TOKEN_REDACTION_MARKER,
        }),
        reasonCode: "execution_token_mismatch",
        runtimeCoordinatorExecutionId: "rce-1",
        statusAfter: null,
      }).success
    ).toBe(true);

    expect(
      runtimeCoordinatorSafeEventPayloadJsonSchema.safeParse(
        JSON.stringify({
          debugValue: RAW_TOKEN,
        })
      ).success
    ).toBe(false);

    expect(
      runtimeCoordinatorSafeEventPayloadJsonSchema.safeParse(
        JSON.stringify({
          debugValue: VALIDATION_HASH,
        })
      ).success
    ).toBe(false);

    expect(
      runtimeCoordinatorSafeEventPayloadJsonSchema.safeParse(
        JSON.stringify({
          executionCredentialProof: "authority-only-material",
        })
      ).success
    ).toBe(false);

    expect(
      runtimeCoordinatorSafeEventPayloadJsonSchema.safeParse(
        JSON.stringify({
          tokenVerifierDigest: "authority-only-material",
        })
      ).success
    ).toBe(false);

    expect(
      runtimeCoordinatorSafeEventPayloadJsonSchema.safeParse(
        JSON.stringify({
          tokenVerifierDigestRedacted: "authority-only-material",
        })
      ).success
    ).toBe(false);
  });
});

const createAuthorityRecord = (overrides: Record<string, unknown> = {}) => ({
  authorityScope,
  currentRunId: "run-1",
  executionScope,
  modelVersion: RUNTIME_COORDINATOR_TOKEN_AUTHORITY_MODEL_VERSION,
  retention: {
    lastPrunedAtMs: null,
    lateResultWindowMs: 86_400_000,
    maxRetiredRuns: 10,
  },
  runtimeCoordinatorExecutionId: "rce-1",
  runsById: {
    "run-1": createActiveRun(),
  },
  terminalOutcome: null,
  tokenValidationHashIndex: {
    [VALIDATION_HASH]: "run-1",
  },
  ...overrides,
});

const createActiveRun = (overrides: Record<string, unknown> = {}) => ({
  deliveryIdempotencyKey: "rce-1::run-1",
  deliveryProvenance,
  expiresAtMs: null,
  issuedAtMs: 1_700_000_000_000,
  retentionExpiresAtMs: null,
  retiredAtMs: null,
  retiredReasonCode: null,
  runId: "run-1",
  supersededByRunId: null,
  supersedesRunId: null,
  tokenFingerprint: TOKEN_FINGERPRINT,
  tokenSecretRefOrSealedToken: "sealed-token",
  tokenStatus: "active" as const,
  tokenValidationHash: VALIDATION_HASH,
  ...overrides,
});

const createRetiredRun = (overrides: Record<string, unknown> = {}) => ({
  ...createActiveRun(),
  retentionExpiresAtMs: 1_700_000_020_000,
  retiredAtMs: 1_700_000_010_000,
  retiredReasonCode: "execution_token_superseded" as const,
  tokenSecretRefOrSealedToken: null,
  tokenStatus: "superseded" as const,
  ...overrides,
});

const createRuntimeCoordinatorExecutionProjection = () => ({
  bindingId: "binding-1",
  agentControllerRef: "builtin:codex",
  createdAtMs: 1_700_000_000_000,
  dispatchId: "dispatch-1",
  legacyPointers: {
    attemptId: "attempt-1",
    claimLeaseId: null,
    connectionGeneration: 1,
    daemonSessionId: "daemon-session-1",
    leaseEpoch: 2,
  },
  modelVersion: RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION,
  runtimeCoordinatorExecutionId: "rce-1",
  openMeldServiceRuntimeId: {
    source: "runtime_registry_authority" as const,
    value: "runtime-1",
  },
  sourceClientMessageId: "client-message-1",
  spaceId: "space-1",
  status: "delivery_accepted" as const,
  targetProfileId: "agt-1",
  terminalOutcome: null,
  updatedAtMs: 1_700_000_000_000,
});
