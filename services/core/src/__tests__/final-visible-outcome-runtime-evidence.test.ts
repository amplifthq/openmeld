import {
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS,
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../lib/bindings";
import { emitCoreFinalVisibleOutcomeRuntimeEvidence } from "../shared/observability/final-visible-outcome-evidence";

describe("final visible outcome runtime evidence", () => {
  it("projects final visible outcome identifiers into Cloudflare Analytics Engine", () => {
    const writeDataPoint = vi.fn();
    const env = {
      OPENMELD_OBSERVABILITY: { writeDataPoint },
      OPENMELD_WORKER_ENVIRONMENT: "test",
    } as unknown as CoreBindings;
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    try {
      emitCoreFinalVisibleOutcomeRuntimeEvidence(env, {
        clientMessageId: "client-message-1",
        dispatchId: "dispatch-1",
        latestAttemptId: "attempt-1",
        publishedSignalId: "sig-final-1",
        reasonCode: "space.reply_published",
        replySignalId: "sig-final-1",
        resultRef: "dispatch-result-dispatch-1",
        runtimeCoordinatorExecutionId: "rce-dispatch-1",
        runtimeKind: "durable_object",
        sourceSignalId: "sig-source-1",
        spaceId: "space-1",
        status: "succeeded",
        targetProfileId: "agent-1",
      });

      expect(consoleInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "core.openmeld.space.final_visible_outcome_observed",
          publishedSignalId: "sig-final-1",
          replySignalId: "sig-final-1",
          resultRef: "dispatch-result-dispatch-1",
          runtimeCoordinatorExecutionId: "rce-dispatch-1",
        })
      );
      const point = writeDataPoint.mock.calls[0]?.[0] as
        | { blobs: string[]; doubles: number[] }
        | undefined;
      expect(readAnalyticsBlob(point, "clientMessageId")).toBe(
        "client-message-1"
      );
      expect(readAnalyticsBlob(point, "runtimeCoordinatorExecutionId")).toBe(
        "rce-dispatch-1"
      );
      expect(readAnalyticsBlob(point, "latestAttemptId")).toBe("attempt-1");
      expect(readAnalyticsBlob(point, "resultRef")).toBe(
        "dispatch-result-dispatch-1"
      );
      expect(readAnalyticsBlob(point, "publishedSignalId")).toBe("sig-final-1");
      expect(readAnalyticsBlob(point, "replySignalId")).toBe("sig-final-1");
      expect(point?.doubles).toHaveLength(
        OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES.length
      );
    } finally {
      consoleInfo.mockRestore();
    }
  });
});

function readAnalyticsBlob(
  point: { blobs: string[] } | undefined,
  key: (typeof OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS)[number]
): string {
  const index = OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.indexOf(key);
  if (index < 0) {
    throw new Error(`Unknown Analytics Engine blob key: ${key}`);
  }
  return point?.blobs[index] ?? "";
}
