import { RUNTIME_COORDINATOR_EXECUTION_MODEL_VERSION } from "@openmeld/schemas";
import type { RuntimeCoordinatorExecutionTokenAuthorityRecord } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  buildRuntimeCoordinatorCancelledExecutionRecord,
  settleRuntimeCoordinatorAuthorityForCancellationAccepted,
} from "../runtime-transport/application/runtime-coordinator-authority";
import {
  constantTimeStringEqual,
  createRuntimeCoordinatorTokenFingerprint,
  createRuntimeCoordinatorTokenValidationHash,
  findRuntimeCoordinatorTokenRunByValidationHash,
  generateRuntimeCoordinatorExecutionToken,
  issueRuntimeCoordinatorExecutionToken,
  pruneRuntimeCoordinatorTokenHistory,
  REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN,
  type RuntimeCoordinatorTokenScope,
  redactRuntimeCoordinatorExecutionTokenSecrets,
  resolveRuntimeCoordinatorTokenAwareExecutionDecision,
  retireRuntimeCoordinatorTokenRun,
  stringifyRuntimeCoordinatorEventPayload,
  validateRuntimeCoordinatorExecutionToken,
  validateRuntimeCoordinatorExecutionTokenAgainstAuthority,
} from "../runtime-transport/application/runtime-coordinator-execution-token";
import { writeRuntimeCoordinatorExecutionEventFromParts } from "../runtime-transport/infrastructure/d1/runtime-coordinator-execution-repo";

const RUNTIME_COORDINATOR_TOKEN_AUTHORITY_MODEL_VERSION =
  "openmeld.runtime_coordinator.token_authority.v1";
const GENERATED_TOKEN_PATTERN = /^rcet_v1_[a-f0-9]{64}$/;
const TOKEN_VALIDATION_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const TOKEN_FINGERPRINT_PATTERN = /^etfp_v1_[a-f0-9]{32}$/;

const EXECUTION_TOKEN = `rcet_v1_${"a".repeat(64)}`;
const OTHER_EXECUTION_TOKEN = `rcet_v1_${"b".repeat(64)}`;

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

const tokenScope: RuntimeCoordinatorTokenScope = {
  authorityScope,
  executionScope,
  runId: "run-1",
};

describe("runtime coordinator execution token helper", () => {
  it("generates an opaque execution token with enough entropy material", () => {
    const token = generateRuntimeCoordinatorExecutionToken({
      randomBytes: (byteLength) =>
        Uint8Array.from({ length: byteLength }, (_, index) => index),
    });

    expect(token).toMatch(GENERATED_TOKEN_PATTERN);
    expect(token).not.toContain("dispatch-1");
    expect(token).not.toContain("rce-1");
  });

  it("issues one active authority run and reuses it for duplicate accepted delivery", async () => {
    const issued = await issueRuntimeCoordinatorExecutionToken({
      authorityScope,
      deliveryProvenance: {
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 2,
      },
      executionScope,
      nowMs: 1_700_000_000_000,
      randomBytes: (byteLength) => new Uint8Array(byteLength).fill(1),
      runId: "run-1",
    });

    expect(issued.reusedExistingRun).toBe(false);
    expect(issued.envelope.executionToken).toMatch(GENERATED_TOKEN_PATTERN);
    expect(issued.envelope.deliveryIdempotencyKey).toBe("rce-1:run-1");
    expect(issued.authority.currentRunId).toBe("run-1");
    expect(issued.authority.runsById["run-1"]).toMatchObject({
      runId: "run-1",
      tokenFingerprint: issued.envelope.tokenFingerprint,
      tokenSecretRefOrSealedToken: issued.envelope.executionToken,
      tokenStatus: "active",
    });

    const replay = await issueRuntimeCoordinatorExecutionToken({
      authorityScope,
      deliveryProvenance: {
        connectionGeneration: 2,
        daemonSessionId: "daemon-session-2",
        leaseEpoch: 3,
      },
      existingAuthority: issued.authority,
      executionScope,
      nowMs: 1_700_000_000_100,
      randomBytes: (byteLength) => new Uint8Array(byteLength).fill(2),
      runId: "run-2",
    });

    expect(replay.reusedExistingRun).toBe(true);
    expect(replay.envelope.runId).toBe("run-1");
    expect(replay.envelope.executionToken).toBe(issued.envelope.executionToken);
    expect(replay.authority).toEqual(issued.authority);
  });

  it("models duplicate delivery as reuse of the DO authority token only", async () => {
    const issued = await issueRuntimeCoordinatorExecutionToken({
      authorityScope,
      deliveryProvenance: {
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 2,
      },
      executionScope,
      nowMs: 1_700_000_000_000,
      randomBytes: (byteLength) => new Uint8Array(byteLength).fill(1),
      runId: "run-1",
    });

    const decision = resolveRuntimeCoordinatorTokenAwareExecutionDecision({
      authority: issued.authority,
      eventKind: "duplicate_delivery",
      trigger: "queue",
    });

    expect(decision).toMatchObject({
      kind: "reuse_active_delivery",
      mayReconstructTokenFromFingerprintOrHash: false,
      mayUseD1TokenProjection: false,
      queueOrAlarmRole: "trigger_only",
      reasonCode:
        "runtime_coordinator.duplicate_delivery_reuses_authority_token",
      runId: "run-1",
      usesFinalClaimAuthority: false,
      usesLegacyClaimLeaseAuthority: false,
    });

    const activeRun = issued.authority.runsById["run-1"];
    if (!activeRun) {
      throw new Error("expected active run");
    }
    const authorityWithoutResendSecret = {
      ...issued.authority,
      runsById: {
        ...issued.authority.runsById,
        "run-1": {
          ...activeRun,
          tokenSecretRefOrSealedToken: null,
        },
      },
    };

    expect(
      resolveRuntimeCoordinatorTokenAwareExecutionDecision({
        authority: authorityWithoutResendSecret,
        eventKind: "duplicate_delivery",
        trigger: "queue",
      })
    ).toMatchObject({
      kind: "reject_missing_authority_secret",
      reasonCode: "runtime_coordinator.active_token_secret_unavailable",
      usesFinalClaimAuthority: false,
      usesLegacyClaimLeaseAuthority: false,
    });
    await expect(
      issueRuntimeCoordinatorExecutionToken({
        authorityScope,
        deliveryProvenance: {
          connectionGeneration: 2,
          daemonSessionId: "daemon-session-2",
          leaseEpoch: 3,
        },
        existingAuthority: authorityWithoutResendSecret,
        executionScope,
        nowMs: 1_700_000_000_100,
      })
    ).rejects.toThrow("runtime_coordinator.token_authority_invalid");
  });

  it("keeps a superseded token reason immutable when a later timeout observes the old run", async () => {
    const issued = await issueRuntimeCoordinatorExecutionToken({
      authorityScope,
      deliveryProvenance: {
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 2,
      },
      executionScope,
      nowMs: 1_700_000_000_000,
      randomBytes: (byteLength) => new Uint8Array(byteLength).fill(1),
      runId: "run-1",
    });
    const supersededAuthority = retireRuntimeCoordinatorTokenRun({
      authority: issued.authority,
      reasonCode: "execution_token_superseded",
      retiredAtMs: 1_700_000_010_000,
      retentionExpiresAtMs: 1_700_000_020_000,
      runId: "run-1",
      tokenStatus: "superseded",
    });

    expect(
      resolveRuntimeCoordinatorTokenAwareExecutionDecision({
        authority: supersededAuthority,
        eventKind: "timeout",
        observedRunId: "run-1",
        trigger: "alarm",
      })
    ).toMatchObject({
      kind: "record_stale_diagnostic",
      queueOrAlarmRole: "trigger_only",
      reasonCode: "execution_token_superseded",
      runId: "run-1",
      tokenStatus: "superseded",
      usesFinalClaimAuthority: false,
      usesLegacyClaimLeaseAuthority: false,
    });

    expect(() =>
      retireRuntimeCoordinatorTokenRun({
        authority: supersededAuthority,
        reasonCode: "execution_token_expired",
        retiredAtMs: 1_700_000_030_000,
        retentionExpiresAtMs: 1_700_000_040_000,
        runId: "run-1",
        tokenStatus: "expired",
      })
    ).toThrow("runtime_coordinator.token_run_already_retired");
  });

  it("marks queue and alarm retry decisions as RuntimeCoordinator trigger-only", () => {
    for (const eventKind of ["retry", "reclaim", "timeout"] as const) {
      expect(
        resolveRuntimeCoordinatorTokenAwareExecutionDecision({
          authority: null,
          eventKind,
          trigger: eventKind === "timeout" ? "alarm" : "queue",
        })
      ).toMatchObject({
        coordinatorAction: "decide_retry_timeout_or_reclaim",
        kind: "runtime_coordinator_decision_required",
        queueOrAlarmRole: "trigger_only",
        reasonCode: "runtime_coordinator.queue_or_alarm_trigger_only",
        usesFinalClaimAuthority: false,
        usesLegacyClaimLeaseAuthority: false,
      });
    }
  });

  it("classifies owner conflict by current, stale, and missing token boundary", async () => {
    const issued = await issueRuntimeCoordinatorExecutionToken({
      authorityScope,
      deliveryProvenance: {
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 2,
      },
      executionScope,
      nowMs: 1_700_000_000_000,
      randomBytes: (byteLength) => new Uint8Array(byteLength).fill(1),
      runId: "run-1",
    });
    const currentRun = issued.authority.runsById["run-1"];
    if (!currentRun) {
      throw new Error("expected current run");
    }
    const supersededAuthority = retireRuntimeCoordinatorTokenRun({
      authority: issued.authority,
      reasonCode: "execution_token_superseded",
      retiredAtMs: 1_700_000_010_000,
      retentionExpiresAtMs: 1_700_000_020_000,
      runId: "run-1",
      tokenStatus: "superseded",
    });

    expect(
      resolveRuntimeCoordinatorTokenAwareExecutionDecision({
        authority: issued.authority,
        eventKind: "owner_conflict",
        observedRun: currentRun,
        ownerConflictTokenClass: "current",
        trigger: "daemon",
      })
    ).toMatchObject({
      kind: "record_current_owner_conflict",
      ownerConflictTokenClass: "current",
      reasonCode: "runtime_coordinator.owner_conflict_current_token",
      runId: "run-1",
      usesFinalClaimAuthority: false,
      usesLegacyClaimLeaseAuthority: false,
    });

    expect(
      resolveRuntimeCoordinatorTokenAwareExecutionDecision({
        authority: supersededAuthority,
        eventKind: "owner_conflict",
        observedRunId: "run-1",
        trigger: "daemon",
      })
    ).toMatchObject({
      kind: "record_stale_diagnostic",
      ownerConflictTokenClass: "stale",
      reasonCode: "execution_token_superseded",
      runId: "run-1",
      tokenStatus: "superseded",
    });

    expect(
      resolveRuntimeCoordinatorTokenAwareExecutionDecision({
        authority: issued.authority,
        eventKind: "owner_conflict",
        ownerConflictTokenClass: "missing",
        trigger: "daemon",
      })
    ).toMatchObject({
      kind: "record_contract_diagnostic",
      ownerConflictTokenClass: "missing",
      reasonCode: "runtime_coordinator.owner_conflict_token_missing",
    });
  });

  it("fails closed when an existing token authority belongs to another execution scope", async () => {
    const issued = await issueRuntimeCoordinatorExecutionToken({
      authorityScope,
      deliveryProvenance: {
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 2,
      },
      executionScope,
      nowMs: 1_700_000_000_000,
      randomBytes: (byteLength) => new Uint8Array(byteLength).fill(1),
      runId: "run-1",
    });

    await expect(
      issueRuntimeCoordinatorExecutionToken({
        authorityScope,
        deliveryProvenance: {
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 2,
        },
        existingAuthority: issued.authority,
        executionScope: {
          ...executionScope,
          targetProfileId: "agt-2",
        },
        nowMs: 1_700_000_000_100,
      })
    ).rejects.toThrow("runtime_coordinator.execution_token_scope_mismatch");
  });

  it("hashes, fingerprints, and validates tokens through constant-time comparison", async () => {
    const validationHash = await createRuntimeCoordinatorTokenValidationHash({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const fingerprint = await createRuntimeCoordinatorTokenFingerprint({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });

    expect(validationHash).toMatch(TOKEN_VALIDATION_HASH_PATTERN);
    expect(fingerprint).toMatch(TOKEN_FINGERPRINT_PATTERN);
    expect(fingerprint).not.toBe(validationHash);
    expect(fingerprint).not.toContain(EXECUTION_TOKEN);

    await expect(
      validateRuntimeCoordinatorExecutionToken({
        executionToken: EXECUTION_TOKEN,
        expectedValidationHash: validationHash,
        scope: tokenScope,
      })
    ).resolves.toEqual({
      computedValidationHash: validationHash,
      valid: true,
    });

    await expect(
      validateRuntimeCoordinatorExecutionToken({
        executionToken: OTHER_EXECUTION_TOKEN,
        expectedValidationHash: validationHash,
        scope: tokenScope,
      })
    ).resolves.toMatchObject({
      valid: false,
    });

    expect(constantTimeStringEqual(validationHash, validationHash)).toBe(true);
    expect(constantTimeStringEqual(validationHash, `${validationHash}0`)).toBe(
      false
    );
  });

  it("validates active token echoes against DO authority history", async () => {
    const issued = await issueRuntimeCoordinatorExecutionToken({
      authorityScope,
      deliveryProvenance: {
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 2,
      },
      executionScope,
      nowMs: 1_700_000_000_000,
      randomBytes: (byteLength) => new Uint8Array(byteLength).fill(1),
      runId: "run-1",
    });

    await expect(
      validateRuntimeCoordinatorExecutionTokenAgainstAuthority({
        authority: issued.authority,
        executionTokenEcho: {
          executionToken: issued.envelope.executionToken,
          runId: issued.envelope.runId,
          runtimeCoordinatorExecutionId:
            issued.envelope.executionScope.runtimeCoordinatorExecutionId,
          tokenFingerprint: issued.envelope.tokenFingerprint,
        },
        expectedAuthorityScope: authorityScope,
        expectedExecutionScope: executionScope,
        nowMs: 1_700_000_000_100,
      })
    ).resolves.toMatchObject({
      ok: true,
      run: expect.objectContaining({
        runId: "run-1",
        tokenStatus: "active",
      }),
    });
  });

  it("classifies missing, unknown, scope-mismatched, and expired token echoes without advancing authority", async () => {
    const issued = await issueRuntimeCoordinatorExecutionToken({
      authorityScope,
      deliveryProvenance: {
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 2,
      },
      executionScope,
      expiresAtMs: 1_700_000_000_500,
      nowMs: 1_700_000_000_000,
      randomBytes: (byteLength) => new Uint8Array(byteLength).fill(1),
      runId: "run-1",
    });
    const echo = {
      executionToken: issued.envelope.executionToken,
      runId: issued.envelope.runId,
      runtimeCoordinatorExecutionId:
        issued.envelope.executionScope.runtimeCoordinatorExecutionId,
      tokenFingerprint: issued.envelope.tokenFingerprint,
    };

    await expect(
      validateRuntimeCoordinatorExecutionTokenAgainstAuthority({
        authority: issued.authority,
        nowMs: 1_700_000_000_100,
      })
    ).resolves.toMatchObject({
      ok: false,
      reasonCode: "execution_token_missing",
    });

    await expect(
      validateRuntimeCoordinatorExecutionTokenAgainstAuthority({
        authority: issued.authority,
        executionTokenEcho: {
          ...echo,
          executionToken: OTHER_EXECUTION_TOKEN,
        },
        expectedAuthorityScope: authorityScope,
        expectedExecutionScope: executionScope,
        nowMs: 1_700_000_000_100,
      })
    ).resolves.toMatchObject({
      ok: false,
      reasonCode: "execution_token_unknown",
      run: null,
      tokenStatus: null,
    });

    await expect(
      validateRuntimeCoordinatorExecutionTokenAgainstAuthority({
        authority: issued.authority,
        executionTokenEcho: echo,
        expectedAuthorityScope: {
          ...authorityScope,
          openMeldServiceRuntimeId: "runtime-2",
        },
        expectedExecutionScope: executionScope,
        nowMs: 1_700_000_000_100,
      })
    ).resolves.toMatchObject({
      ok: false,
      reasonCode: "execution_token_scope_mismatch",
    });

    await expect(
      validateRuntimeCoordinatorExecutionTokenAgainstAuthority({
        authority: issued.authority,
        executionTokenEcho: echo,
        expectedAuthorityScope: authorityScope,
        expectedExecutionScope: executionScope,
        nowMs: 1_700_000_000_500,
      })
    ).resolves.toMatchObject({
      ok: false,
      reasonCode: "execution_token_expired",
      tokenStatus: "expired",
    });
  });

  it("classifies retired token echoes from DO token history instead of projection state", async () => {
    const issued = await issueRuntimeCoordinatorExecutionToken({
      authorityScope,
      deliveryProvenance: {
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 2,
      },
      executionScope,
      nowMs: 1_700_000_000_000,
      randomBytes: (byteLength) => new Uint8Array(byteLength).fill(1),
      runId: "run-1",
    });
    const retired = retireRuntimeCoordinatorTokenRun({
      authority: issued.authority,
      reasonCode: "execution_token_superseded",
      retiredAtMs: 1_700_000_001_000,
      retentionExpiresAtMs: 1_700_000_011_000,
      runId: "run-1",
      tokenStatus: "superseded",
    });

    await expect(
      validateRuntimeCoordinatorExecutionTokenAgainstAuthority({
        authority: retired,
        executionTokenEcho: {
          executionToken: issued.envelope.executionToken,
          runId: issued.envelope.runId,
          runtimeCoordinatorExecutionId:
            issued.envelope.executionScope.runtimeCoordinatorExecutionId,
          tokenFingerprint: issued.envelope.tokenFingerprint,
        },
        expectedAuthorityScope: authorityScope,
        expectedExecutionScope: executionScope,
        nowMs: 1_700_000_002_000,
      })
    ).resolves.toMatchObject({
      ok: false,
      reasonCode: "execution_token_superseded",
      run: expect.objectContaining({
        runId: "run-1",
        tokenStatus: "superseded",
      }),
      tokenStatus: "superseded",
    });
  });

  it("redacts raw tokens and validation material from event payloads", async () => {
    const validationHash = await createRuntimeCoordinatorTokenValidationHash({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const fingerprint = await createRuntimeCoordinatorTokenFingerprint({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });

    const redacted = redactRuntimeCoordinatorExecutionTokenSecrets({
      executionToken: EXECUTION_TOKEN,
      nested: {
        tokenFingerprint: fingerprint,
        tokenValidationHash: validationHash,
      },
      tokenSecretRefOrSealedToken: "sealed-token",
    });

    expect(redacted).toEqual({
      executionTokenRedacted: REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN,
      nested: {
        tokenFingerprint: fingerprint,
        tokenValidationHashRedacted:
          REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN,
      },
      tokenSecretRefOrSealedTokenRedacted:
        REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN,
    });

    const serialized = stringifyRuntimeCoordinatorEventPayload({
      allowed: {
        reasonCode: "execution_token_issued",
        tokenFingerprint: fingerprint,
      },
      executionToken: EXECUTION_TOKEN,
      tokenValidationHash: validationHash,
    });

    expect(serialized).not.toContain(EXECUTION_TOKEN);
    expect(serialized).not.toContain(validationHash);
    expect(serialized).toContain(fingerprint);
    expect(serialized).toContain(REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN);
  });

  it("redacts token-like secrets even when diagnostics use alternate field names or generic fields", async () => {
    const validationHash = await createRuntimeCoordinatorTokenValidationHash({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });

    const redacted = redactRuntimeCoordinatorExecutionTokenSecrets({
      debugValue: EXECUTION_TOKEN,
      executionCredentialProof: validationHash,
      nested: {
        tokenVerifierDigest: "authority-only-material",
      },
      tokenStatus: "active",
    });

    expect(redacted).toEqual({
      debugValue: REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN,
      executionCredentialProofRedacted:
        REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN,
      nested: {
        tokenVerifierDigestRedacted:
          REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN,
      },
      tokenStatus: "active",
    });

    const serialized = stringifyRuntimeCoordinatorEventPayload({
      debugValue: validationHash,
      tokenVerifierDigest: "authority-only-material",
    });

    expect(serialized).not.toContain(validationHash);
    expect(serialized).not.toContain("authority-only-material");
    expect(serialized).toContain(REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN);
  });

  it("retains active run secrets, removes retired run secrets, and prunes expired token history", async () => {
    const validationHash = await createRuntimeCoordinatorTokenValidationHash({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const fingerprint = await createRuntimeCoordinatorTokenFingerprint({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const authority = createAuthorityRecord({
      fingerprint,
      validationHash,
    });

    expect(authority.runsById["run-1"]?.tokenSecretRefOrSealedToken).toBe(
      "sealed-token"
    );

    const retired = retireRuntimeCoordinatorTokenRun({
      authority,
      reasonCode: "execution_token_superseded",
      retiredAtMs: 1_700_000_010_000,
      retentionExpiresAtMs: 1_700_000_020_000,
      runId: "run-1",
      tokenStatus: "superseded",
    });

    expect(retired.currentRunId).toBe(null);
    expect(retired.runsById["run-1"]?.tokenSecretRefOrSealedToken).toBe(null);
    expect(
      findRuntimeCoordinatorTokenRunByValidationHash({
        authority: retired,
        tokenValidationHash: validationHash,
      })?.tokenStatus
    ).toBe("superseded");

    const beforeWindow = pruneRuntimeCoordinatorTokenHistory({
      authority: retired,
      nowMs: 1_700_000_019_999,
    });
    expect(beforeWindow.prunedRunIds).toEqual([]);
    expect(beforeWindow.authority.runsById["run-1"]).toBeDefined();

    const afterWindow = pruneRuntimeCoordinatorTokenHistory({
      authority: retired,
      nowMs: 1_700_000_020_000,
    });
    expect(afterWindow.prunedRunIds).toEqual(["run-1"]);
    expect(afterWindow.authority.runsById["run-1"]).toBeUndefined();
    expect(
      findRuntimeCoordinatorTokenRunByValidationHash({
        authority: afterWindow.authority,
        tokenValidationHash: validationHash,
      })
    ).toBe(null);
  });

  it("settles cancellation authority only after local control accepts Stop", async () => {
    const validationHash = await createRuntimeCoordinatorTokenValidationHash({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const fingerprint = await createRuntimeCoordinatorTokenFingerprint({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const authority = createAuthorityRecord({
      fingerprint,
      validationHash,
    });

    const settled = settleRuntimeCoordinatorAuthorityForCancellationAccepted({
      authority,
      nowMs: 1_700_000_010_000,
      reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
    });

    expect(settled.currentRunId).toBe(null);
    expect(settled.terminalOutcome).toEqual({
      finalizedAtMs: 1_700_000_010_000,
      reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
      replySignalId: null,
      status: "cancelled",
    });
    expect(settled.runsById["run-1"]).toMatchObject({
      retiredAtMs: 1_700_000_010_000,
      retiredReasonCode: "execution_token_revoked",
      tokenSecretRefOrSealedToken: null,
      tokenStatus: "revoked",
    });
  });

  it("builds cancelled execution projections without failed_terminal status", () => {
    const cancelled = buildRuntimeCoordinatorCancelledExecutionRecord({
      nowMs: 1_700_000_010_000,
      reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
      record: {
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
        bindingId: "binding-1",
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
        sourceClientMessageId: "client-message-1",
        spaceId: "space-1",
        status: "cancellation_requested",
        targetProfileId: "agt-1",
        terminalOutcome: null,
        updatedAtMs: 1_700_000_001_000,
      },
    });

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.status).not.toBe("failed_terminal");
    expect(cancelled.terminalOutcome).toEqual({
      kind: "cancelled",
      observedAtMs: 1_700_000_010_000,
      reasonCode: "runtime_coordinator.wake_stop_local_control_accepted",
    });
  });

  it("does not allow an already retired run to be retired again with a different reason", async () => {
    const validationHash = await createRuntimeCoordinatorTokenValidationHash({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const fingerprint = await createRuntimeCoordinatorTokenFingerprint({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const authority = createAuthorityRecord({
      fingerprint,
      validationHash,
    });
    const retired = retireRuntimeCoordinatorTokenRun({
      authority,
      reasonCode: "execution_token_superseded",
      retiredAtMs: 1_700_000_010_000,
      retentionExpiresAtMs: 1_700_000_020_000,
      runId: "run-1",
      tokenStatus: "superseded",
    });

    expect(() =>
      retireRuntimeCoordinatorTokenRun({
        authority: retired,
        reasonCode: "execution_token_expired",
        retiredAtMs: 1_700_000_011_000,
        retentionExpiresAtMs: 1_700_000_021_000,
        runId: "run-1",
        tokenStatus: "expired",
      })
    ).toThrow("runtime_coordinator.token_run_already_retired");
    expect(retired.runsById["run-1"]?.tokenStatus).toBe("superseded");
    expect(retired.runsById["run-1"]?.retiredReasonCode).toBe(
      "execution_token_superseded"
    );
  });

  it("requires retired token status and reason to describe the same outcome", async () => {
    const validationHash = await createRuntimeCoordinatorTokenValidationHash({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const fingerprint = await createRuntimeCoordinatorTokenFingerprint({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const authority = createAuthorityRecord({
      fingerprint,
      validationHash,
    });

    expect(() =>
      retireRuntimeCoordinatorTokenRun({
        authority,
        reasonCode: "execution_token_superseded",
        retiredAtMs: 1_700_000_010_000,
        retentionExpiresAtMs: 1_700_000_020_000,
        runId: "run-1",
        tokenStatus: "expired",
      })
    ).toThrow("runtime_coordinator.token_retired_reason_mismatch");
  });

  it("rejects authority records with more than one active run", async () => {
    const validationHash = await createRuntimeCoordinatorTokenValidationHash({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const otherValidationHash =
      await createRuntimeCoordinatorTokenValidationHash({
        executionToken: OTHER_EXECUTION_TOKEN,
        scope: {
          ...tokenScope,
          runId: "run-2",
        },
      });
    const fingerprint = await createRuntimeCoordinatorTokenFingerprint({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const otherFingerprint = await createRuntimeCoordinatorTokenFingerprint({
      executionToken: OTHER_EXECUTION_TOKEN,
      scope: {
        ...tokenScope,
        runId: "run-2",
      },
    });
    const authority = createAuthorityRecord({
      fingerprint,
      validationHash,
    });
    const activeRun = authority.runsById["run-1"];
    if (!activeRun) {
      throw new Error("test_authority_active_run_missing");
    }

    expect(() =>
      pruneRuntimeCoordinatorTokenHistory({
        authority: {
          ...authority,
          currentRunId: "run-2",
          runsById: {
            ...authority.runsById,
            "run-2": {
              ...activeRun,
              deliveryIdempotencyKey: "rce-1::run-2",
              runId: "run-2",
              tokenFingerprint: otherFingerprint,
              tokenValidationHash: otherValidationHash,
            },
          },
          tokenValidationHashIndex: {
            ...authority.tokenValidationHashIndex,
            [otherValidationHash]: "run-2",
          },
        },
        nowMs: 1_700_000_000_000,
      })
    ).toThrow("runtime_coordinator.token_authority_invalid");
  });

  it("rejects authority records when retained token history exceeds the configured cap", async () => {
    const validationHash = await createRuntimeCoordinatorTokenValidationHash({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const otherValidationHash =
      await createRuntimeCoordinatorTokenValidationHash({
        executionToken: OTHER_EXECUTION_TOKEN,
        scope: {
          ...tokenScope,
          runId: "run-2",
        },
      });
    const fingerprint = await createRuntimeCoordinatorTokenFingerprint({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const otherFingerprint = await createRuntimeCoordinatorTokenFingerprint({
      executionToken: OTHER_EXECUTION_TOKEN,
      scope: {
        ...tokenScope,
        runId: "run-2",
      },
    });
    const authority = createAuthorityRecord({
      fingerprint,
      validationHash,
    });
    const activeRun = authority.runsById["run-1"];
    if (!activeRun) {
      throw new Error("test_authority_active_run_missing");
    }

    expect(() =>
      pruneRuntimeCoordinatorTokenHistory({
        authority: {
          ...authority,
          currentRunId: null,
          retention: {
            ...authority.retention,
            maxRetiredRuns: 1,
          },
          runsById: {
            "run-1": {
              ...activeRun,
              retentionExpiresAtMs: 1_700_000_020_000,
              retiredAtMs: 1_700_000_010_000,
              retiredReasonCode: "execution_token_superseded",
              tokenSecretRefOrSealedToken: null,
              tokenStatus: "superseded",
            },
            "run-2": {
              ...activeRun,
              deliveryIdempotencyKey: "rce-1::run-2",
              retentionExpiresAtMs: 1_700_000_020_000,
              retiredAtMs: 1_700_000_011_000,
              retiredReasonCode: "execution_token_superseded",
              runId: "run-2",
              tokenFingerprint: otherFingerprint,
              tokenSecretRefOrSealedToken: null,
              tokenStatus: "superseded",
              tokenValidationHash: otherValidationHash,
            },
          },
          tokenValidationHashIndex: {
            [validationHash]: "run-1",
            [otherValidationHash]: "run-2",
          },
        },
        nowMs: 1_700_000_015_000,
      })
    ).toThrow("runtime_coordinator.token_authority_invalid");
  });

  it("redacts coordinator event payloads before writing D1 projection rows", async () => {
    const validationHash = await createRuntimeCoordinatorTokenValidationHash({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const fingerprint = await createRuntimeCoordinatorTokenFingerprint({
      executionToken: EXECUTION_TOKEN,
      scope: tokenScope,
    });
    const capturedParams: unknown[][] = [];
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn((...params: unknown[]) => {
          capturedParams.push(params);
          return {
            run: vi.fn(async () => ({ meta: { changes: 1 } })),
          };
        }),
      })),
    } as unknown as D1Database;

    await writeRuntimeCoordinatorExecutionEventFromParts({
      db,
      eventType: "result_received",
      idempotencyKey: "rce-1::run-1",
      observedAtMs: 1_700_000_000_000,
      payload: {
        executionToken: EXECUTION_TOKEN,
        tokenFingerprint: fingerprint,
        tokenValidationHash: validationHash,
      },
      reasonCode: "execution_token_issued",
      runtimeCoordinatorExecutionId: "rce-1",
      statusAfter: "delivery_accepted",
    });

    const payloadJson = String(capturedParams[0]?.[7]);
    expect(payloadJson).not.toContain(EXECUTION_TOKEN);
    expect(payloadJson).not.toContain(validationHash);
    expect(payloadJson).toContain(fingerprint);
    expect(payloadJson).toContain(REDACTED_RUNTIME_COORDINATOR_EXECUTION_TOKEN);
  });
});

const createAuthorityRecord = (input: {
  fingerprint: string;
  validationHash: string;
}): RuntimeCoordinatorExecutionTokenAuthorityRecord => ({
  authorityScope,
  currentRunId: "run-1",
  executionScope,
  modelVersion: RUNTIME_COORDINATOR_TOKEN_AUTHORITY_MODEL_VERSION,
  retention: {
    lastPrunedAtMs: null,
    lateResultWindowMs: 10_000,
    maxRetiredRuns: 10,
  },
  runtimeCoordinatorExecutionId: "rce-1",
  runsById: {
    "run-1": {
      deliveryIdempotencyKey: "rce-1::run-1",
      deliveryProvenance: {
        connectionGeneration: 1,
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 2,
      },
      expiresAtMs: null,
      issuedAtMs: 1_700_000_000_000,
      retentionExpiresAtMs: null,
      retiredAtMs: null,
      retiredReasonCode: null,
      runId: "run-1",
      supersededByRunId: null,
      supersedesRunId: null,
      tokenFingerprint: input.fingerprint,
      tokenSecretRefOrSealedToken: "sealed-token",
      tokenStatus: "active",
      tokenValidationHash: input.validationHash,
    },
  },
  terminalOutcome: null,
  tokenValidationHashIndex: {
    [input.validationHash]: "run-1",
  },
});
