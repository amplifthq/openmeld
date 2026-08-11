import { describe, expect, it } from "vitest";
import {
  resolveCoreRuntimeTaskResultDeliveryContract,
  resolveCoreRuntimeTaskResultSettledAttemptState,
  resolveCoreRuntimeTaskResultSettledDispatchState,
} from "../dispatch/rules/runtime-task-result-transition-contract";

describe("runtime task result transition contract", () => {
  it("treats success-like runtime statuses as dispatch success transitions", () => {
    for (const payloadStatus of ["success", "partial_success"] as const) {
      expect(
        resolveCoreRuntimeTaskResultDeliveryContract({
          payloadStatus,
        })
      ).toEqual({
        kind: "success_like",
        successLike: true,
        dispatchState: "succeeded",
        attemptState: "succeeded",
        ledgerTransitionKind: "settle_dispatch_succeeded",
        attemptTransitionKind: "settle_attempt_succeeded",
      });
      expect(
        resolveCoreRuntimeTaskResultSettledDispatchState({
          payloadStatus,
        })
      ).toBe("succeeded");
      expect(
        resolveCoreRuntimeTaskResultSettledAttemptState({
          payloadStatus,
        })
      ).toBe("succeeded");
    }
  });

  it("keeps failed runtime payloads on the error-classification path", () => {
    expect(
      resolveCoreRuntimeTaskResultDeliveryContract({
        payloadStatus: "failed",
      })
    ).toEqual({
      kind: "failed_requires_classification",
      successLike: false,
      dispatchState: null,
      attemptState: null,
      ledgerTransitionKind: null,
      attemptTransitionKind: null,
    });
    expect(
      resolveCoreRuntimeTaskResultSettledDispatchState({
        payloadStatus: "failed",
      })
    ).toBeNull();
    expect(
      resolveCoreRuntimeTaskResultSettledAttemptState({
        payloadStatus: "failed",
      })
    ).toBeNull();
  });
});
