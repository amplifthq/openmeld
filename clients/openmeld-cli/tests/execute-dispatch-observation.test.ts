import type { RuntimeTaskResult } from "@openmeld/local-execution";
import { describe, expect, it } from "vitest";
import { buildRuntimeObservationPayload } from "../src/local-service/dispatch/execute-dispatch-observation";

describe("dispatch runtime observation", () => {
  it("keeps bounded model negotiation diagnostics in local trace evidence", () => {
    const modelNegotiation = {
      checkAttempt: 2 as const,
      configAvailableModelCount: 1,
      configAvailableModelIds: ["default[]"],
      configAvailableModelIdsTruncated: false,
      configCurrentModelId: "default[]",
      currentModelId: "default[]",
      legacyAvailableModelCount: 0,
      legacyAvailableModelIds: [],
      legacyAvailableModelIdsTruncated: false,
      legacyCurrentModelId: "default[]",
      protocol: "acp/v1" as const,
      requestedModelId: "default[]",
      requestedPresentInConfigOptions: true,
      requestedPresentInLegacyModels: false,
      sessionOperation: "load" as const,
      sourceState: "config_options_only" as const,
    };
    const resultPayload = {
      agentId: "cursor",
      attemptId: "attempt-1",
      deduped: false,
      errorCode: "model.inventory_unavailable",
      errorMessage: "Cursor ACP model inventory was unavailable.",
      errorType: "adapter" as const,
      sourceEventId: "source-1",
      status: "failed" as const,
      taskId: "task-1",
    };
    const runtimeResult = {
      dispatchResult: {
        adapterResult: {
          diagnostics: { modelNegotiation },
          errorCode: resultPayload.errorCode,
          errorMessage: resultPayload.errorMessage,
          errorType: resultPayload.errorType,
          status: "failed",
        },
        dispatched: true,
        reason: "dispatched",
      },
      resultPayload,
    } satisfies Pick<RuntimeTaskResult, "dispatchResult" | "resultPayload">;

    expect(
      buildRuntimeObservationPayload({
        continuityObservation: null,
        daemonWorkingDirectory: "/daemon",
        deliveryRecoveryReason: null,
        dispatchId: "dispatch-1",
        providerRuntimeWorkingDirectory: "/project",
        resultPayload,
        runtimeResult,
        runtimeStartedAtMs: 100,
        taskId: "task-1",
      })
    ).toMatchObject({
      dispatchId: "dispatch-1",
      errorCode: "model.inventory_unavailable",
      modelNegotiation,
      result: "failed",
      taskId: "task-1",
    });
  });
});
