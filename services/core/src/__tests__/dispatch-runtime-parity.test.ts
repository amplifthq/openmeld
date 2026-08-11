import type { OpenMeldDaemonTaskResultPayload } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  buildIdempotencyKey as buildRuntimeIdempotencyKey,
  DATA_PLANE_DEFAULTS,
  shouldBypassDedupeForDeliveryRecoveryReason,
  shouldDedupeWithinWindow as shouldRuntimeDedupeWithinWindow,
} from "../../../../runtime/local-execution/src/data-plane-contract";
import { resolveRuntimeTaskResultDeliverySemantic } from "../../../../runtime/local-execution/src/runtime-task-lifecycle-contract";
import { resolveDispatchDeliveryRecoveryReason } from "../dispatch/rules/dispatch-attempt-claim-policy";
import { buildIdempotencyKey } from "../dispatch/rules/dispatch-idempotency";
import {
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
} from "../dispatch/rules/dispatch-lifecycle-contract";
import {
  computeDispatchRetryDelaySeconds,
  DISPATCH_IDEMPOTENCY_WINDOW_MS,
  DISPATCH_MAX_ATTEMPTS,
  DISPATCH_RETRY_BACKOFF_SECONDS,
  DISPATCH_RETRY_JITTER_RATIO,
  DISPATCH_UNKNOWN_ERROR_MAX_ATTEMPTS,
  shouldDedupeWithinWindow,
  shouldRetryDispatchAttempt,
  shouldRetryUnknownDispatchAttempt,
} from "../dispatch/rules/dispatch-runtime-constants";
import { resolveCoreRuntimeTaskResultDeliveryContract } from "../dispatch/rules/runtime-task-result-transition-contract";

const EXPECTED_RUNTIME_RESULT_DELIVERY_PARITY: Record<
  OpenMeldDaemonTaskResultPayload["status"],
  {
    attemptTransitionKind: string | null;
    coreKind: "success_like" | "failed_requires_classification";
    ledgerTransitionKind: string | null;
    runtimeKind: "success_like" | "failed_requires_classification";
    successLike: boolean;
  }
> = {
  failed: {
    attemptTransitionKind: null,
    coreKind: "failed_requires_classification",
    ledgerTransitionKind: null,
    runtimeKind: "failed_requires_classification",
    successLike: false,
  },
  partial_success: {
    attemptTransitionKind: "settle_attempt_succeeded",
    coreKind: "success_like",
    ledgerTransitionKind: "settle_dispatch_succeeded",
    runtimeKind: "success_like",
    successLike: true,
  },
  success: {
    attemptTransitionKind: "settle_attempt_succeeded",
    coreKind: "success_like",
    ledgerTransitionKind: "settle_dispatch_succeeded",
    runtimeKind: "success_like",
    successLike: true,
  },
};

describe("dispatch runtime parity", () => {
  it("keeps retry attempt budget parity with legacy formulas", () => {
    const legacyShouldRetryDispatchAttempt = (attempt: number): boolean =>
      attempt < DISPATCH_MAX_ATTEMPTS;
    const legacyShouldRetryUnknownDispatchAttempt = (
      attempt: number
    ): boolean => attempt < DISPATCH_UNKNOWN_ERROR_MAX_ATTEMPTS;

    for (const attempt of [1, 2, 3, 6, 7, 8]) {
      expect(shouldRetryDispatchAttempt(attempt)).toBe(
        legacyShouldRetryDispatchAttempt(attempt)
      );
      expect(shouldRetryUnknownDispatchAttempt(attempt)).toBe(
        legacyShouldRetryUnknownDispatchAttempt(attempt)
      );
    }
  });

  it("keeps retry delay parity with legacy jitter formula", () => {
    const legacyComputeDispatchRetryDelaySeconds = (input: {
      attempt: number;
      random?: () => number;
    }): number => {
      const attemptIndex = Math.max(1, input.attempt) - 1;
      const delayBaseSeconds =
        DISPATCH_RETRY_BACKOFF_SECONDS[
          Math.min(attemptIndex, DISPATCH_RETRY_BACKOFF_SECONDS.length - 1)
        ] ??
        DISPATCH_RETRY_BACKOFF_SECONDS.at(-1) ??
        120;
      const random = input.random ?? Math.random;
      const normalizedRandom = Math.min(1, Math.max(0, random()));
      const maxJitterSeconds = delayBaseSeconds * DISPATCH_RETRY_JITTER_RATIO;
      const jitterSeconds = (normalizedRandom * 2 - 1) * maxJitterSeconds;
      return Math.max(1, Math.round(delayBaseSeconds + jitterSeconds));
    };

    const samples = [
      {
        attempt: 1,
        random: () => 0,
      },
      {
        attempt: 2,
        random: () => 0.5,
      },
      {
        attempt: 3,
        random: () => 1,
      },
      {
        attempt: 9,
        random: () => 0.25,
      },
    ] as const;

    for (const sample of samples) {
      expect(computeDispatchRetryDelaySeconds(sample)).toBe(
        legacyComputeDispatchRetryDelaySeconds(sample)
      );
    }
  });

  it("keeps dedupe half-open window parity", () => {
    const samples = [
      {
        firstSeenAtMs: 100,
        nowMs: 100,
      },
      {
        firstSeenAtMs: 100,
        nowMs: 86_400_099,
      },
      {
        firstSeenAtMs: 100,
        nowMs: 86_400_100,
      },
    ] as const;

    for (const sample of samples) {
      expect(shouldDedupeWithinWindow(sample)).toBe(
        shouldRuntimeDedupeWithinWindow(sample)
      );
    }
  });

  it("keeps idempotency key structure aligned with runtime data-plane contract", () => {
    const samples = [
      {
        sourceEventId: "evt-1",
        targetProfileId: "agt-1",
      },
      {
        sourceEventId: "source-event-with-length",
        targetProfileId: "agent-profile-with-length",
      },
    ] as const;

    for (const sample of samples) {
      expect(buildIdempotencyKey(sample)).toBe(
        buildRuntimeIdempotencyKey(sample)
      );
    }
  });

  it("keeps the dedupe window constant aligned with runtime defaults", () => {
    expect(DISPATCH_IDEMPOTENCY_WINDOW_MS).toBe(
      DATA_PLANE_DEFAULTS.dedupeWindowMs
    );
  });
  it("keeps recovery dedupe-bypass semantics aligned with runtime", () => {
    const recoveryReasons = ["connection_replaced", "route_lost"] as const;

    for (const requestedRecoveryReason of recoveryReasons) {
      expect(
        resolveDispatchDeliveryRecoveryReason({
          requestedRecoveryReason,
          existingStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedRetryable,
          latestAttempt: {
            errorCode: null,
            status: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.failedRetryable,
          },
        })
      ).toBe(requestedRecoveryReason);
      expect(
        shouldBypassDedupeForDeliveryRecoveryReason(requestedRecoveryReason)
      ).toBe(true);
    }
  });

  it("keeps runtime task result delivery semantics aligned across core and runtime", () => {
    for (const [payloadStatus, expected] of Object.entries(
      EXPECTED_RUNTIME_RESULT_DELIVERY_PARITY
    ) as [
      OpenMeldDaemonTaskResultPayload["status"],
      (typeof EXPECTED_RUNTIME_RESULT_DELIVERY_PARITY)[OpenMeldDaemonTaskResultPayload["status"]],
    ][]) {
      const runtimeSemantic = resolveRuntimeTaskResultDeliverySemantic({
        payloadStatus,
      });
      const coreContract = resolveCoreRuntimeTaskResultDeliveryContract({
        payloadStatus,
      });

      expect(runtimeSemantic.kind).toBe(expected.runtimeKind);
      expect(runtimeSemantic.successLike).toBe(expected.successLike);
      expect(coreContract.kind).toBe(expected.coreKind);
      expect(coreContract.successLike).toBe(expected.successLike);
      expect(coreContract.ledgerTransitionKind).toBe(
        expected.ledgerTransitionKind
      );
      expect(coreContract.attemptTransitionKind).toBe(
        expected.attemptTransitionKind
      );
    }
  });
});
