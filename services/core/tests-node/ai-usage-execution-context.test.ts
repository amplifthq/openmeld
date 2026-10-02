import type { AiUsageQueryResponse } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enrichAiUsageExecutions } from "../src/usage/ai-usage-execution-context";

const owner = vi.hoisted(() => ({
  local: vi.fn(),
  remote: vi.fn(),
  terminal: vi.fn(),
}));
vi.mock(
  "../src/runtime-transport/infrastructure/d1/runtime-coordinator-execution-repo",
  () => ({ readRuntimeCoordinatorExecutionProjectionByDispatch: owner.local })
);
vi.mock(
  "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo",
  () => ({ readRemoteAgentNativeDeliveryByExecution: owner.remote })
);
vi.mock(
  "../src/agent-task-coordination/infrastructure/d1/agent-task-coordination-repo",
  () => ({ readAgentTaskTerminalOutcome: owner.terminal })
);

beforeEach(() => {
  vi.resetAllMocks();
});

function usage(runtime: "local" | "remote"): AiUsageQueryResponse {
  return {
    fromMs: 0,
    toMs: 1000,
    models: [],
    breakdown: {
      groupBy: "task",
      sortBy: "tokens",
      limit: 20,
      hasMore: false,
      groups: [
        {
          runtime,
          taskId: "task-1",
          agentProfileId: "agent-1",
          spaceId: "space-1",
          requests: 2,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          reportedCostNanoUsd: 100,
          estimatedCostNanoUsd: 0,
          missingTokenRequests: 0,
          missingCostRequests: 0,
          pendingRequests: 0,
          collectionFailedRequests: 0,
          unavailableRequests: 0,
          observedExecutionAttempts: 1,
          observedExecutionRetries: 0,
          requestsWithoutAttemptId: 0,
          firstObservedAtMs: 100,
          lastObservedAtMs: 200,
          models: ["model-1"],
          purposes: ["agent"],
          dispatchIds: ["dispatch-1"],
          dispatchIdsTruncated: false,
        },
      ],
    },
  };
}

describe("AI usage execution context", () => {
  it("keeps paid consumption when its canonical Local execution failed", async () => {
    owner.local.mockResolvedValue({
      status: "failed_terminal",
      terminalOutcome: { kind: "failed_terminal" },
      updatedAtMs: 300,
    });
    const result = await enrichAiUsageExecutions({
      db: {} as D1Database,
      organizationId: "org-1",
      usage: usage("local"),
    });
    expect(result.breakdown?.groups[0]).toMatchObject({
      totalTokens: 120,
      reportedCostNanoUsd: 100,
      executions: [
        {
          source: "runtime_coordinator",
          status: "failed_terminal",
          outcome: "failed_terminal",
          updatedAtMs: 300,
        },
      ],
    });
    expect(owner.local).toHaveBeenCalledWith({
      db: {},
      dispatchId: "dispatch-1",
      spaceId: "space-1",
      targetProfileId: "agent-1",
    });
  });

  it("uses the recorded Remote terminal outcome and rejects cross-organization attribution", async () => {
    owner.remote.mockResolvedValue({
      organizationId: "org-1",
      deliveryId: "delivery-1",
      status: "completed",
      updatedAtMs: 300,
    });
    owner.terminal.mockResolvedValue({ outcome: { status: "stopped" } });
    const result = await enrichAiUsageExecutions({
      db: {} as D1Database,
      organizationId: "org-1",
      usage: usage("remote"),
    });
    expect(result.breakdown?.groups[0]?.executions).toMatchObject([
      { status: "completed", outcome: "stopped" },
    ]);
    owner.remote.mockResolvedValue({ organizationId: "org-other" });
    await expect(
      enrichAiUsageExecutions({
        db: {} as D1Database,
        organizationId: "org-1",
        usage: usage("remote"),
      })
    ).rejects.toThrow("Organization does not match");
  });

  it("reports missing execution evidence without inferring success from usage", async () => {
    owner.local.mockResolvedValue(null);
    const result = await enrichAiUsageExecutions({
      db: {} as D1Database,
      organizationId: "org-1",
      usage: usage("local"),
    });
    expect(result.breakdown?.groups[0]?.executions).toMatchObject([
      { status: null, outcome: null },
    ]);
  });
});
