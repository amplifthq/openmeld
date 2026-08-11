import {
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../lib/bindings";
import { emitDaemonDispatchRuntimeEvidence } from "../runtime-transport/application/daemon-runtime-evidence";

describe("daemon runtime evidence observability", () => {
  it("carries the known RuntimeCoordinator execution id into Cloudflare evidence", () => {
    const writeDataPoint = vi.fn();
    const env = {
      OPENMELD_OBSERVABILITY: { writeDataPoint },
      OPENMELD_WORKER_ENVIRONMENT: "test",
    } as unknown as CoreBindings;
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    try {
      emitDaemonDispatchRuntimeEvidence({
        env,
        evidence: {
          v: 1,
          runtimeCoordinatorExecutionId: "rce-dispatch-1",
          dispatchId: "dispatch-1",
          attemptId: "attempt-1",
          executionIdentityEcho: {
            echoSource: "daemon_delivery_context",
            core: {
              modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
              spaceId: "space-1",
              dispatchId: "dispatch-1",
              targetProfileId: "agent-1",
              openMeldServiceRuntimeId: {
                source: "runtime_registry_authority",
                value: "runtime-1",
              },
              bindingId: "binding-1",
              agentControllerRef: "builtin:codex",
            },
          },
          daemonSessionId: "daemon-session-1",
          connectionGeneration: 1,
          leaseEpoch: 1,
          phase: "runtime_started",
          evidenceAtMs: 1_700_000_000_000,
          taskId: "task-1",
          spaceId: "space-1",
          sourceSignalId: "sig-source-1",
          sourceClientMessageId: "client-message-1",
          targetProfileId: "agent-1",
          durationMs: 12,
        },
      });

      expect(consoleInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchId: "dispatch-1",
          event: "core.openmeld.daemon.runtime_evidence",
          runtimeCoordinatorExecutionId: "rce-dispatch-1",
        })
      );
      const point = writeDataPoint.mock.calls[0]?.[0] as
        | { blobs: string[] }
        | undefined;
      expect(
        point?.blobs[readAnalyticsBlobIndex("runtimeCoordinatorExecutionId")]
      ).toBe("rce-dispatch-1");
    } finally {
      consoleInfo.mockRestore();
    }
  });
});

function readAnalyticsBlobIndex(
  key: (typeof OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS)[number]
): number {
  const index = OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.indexOf(key);
  if (index < 0) {
    throw new Error(`Unknown Analytics Engine blob key: ${key}`);
  }
  return index;
}
