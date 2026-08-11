import { describe, expect, it } from "vitest";
import {
  buildRemoteAgentUsageRecord,
  createRemoteAgentCallbackContext,
  listRemoteAgentUsageRecords,
  putRemoteAgentUsageRecord,
} from "../agent-core/callback-context";
import { normalizeFluePromptUsage } from "../agent-core/usage";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const ACK = {
  accepted: true,
  createdAt: TEST_NOW_MS,
  idempotencyKey: "remote-agent:dispatch_123",
  requestId: "flue_submission_123",
  status: "pending",
  submissionId: "flue_submission_123",
} as const;

describe("remote agent usage records", () => {
  it("normalizes Flue PromptUsage into OpenMeld usage fields", () => {
    expect(
      normalizeFluePromptUsage({
        cacheRead: 3,
        cacheWrite: 4,
        cost: {
          cacheRead: 0.03,
          cacheWrite: 0.04,
          input: 0.01,
          output: 0.02,
          total: 0.1,
        },
        input: 10,
        output: 20,
        totalTokens: 37,
      })
    ).toEqual({
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      cost: {
        cacheRead: 0.03,
        cacheWrite: 0.04,
        input: 0.01,
        output: 0.02,
        total: 0.1,
      },
      inputTokens: 10,
      outputTokens: 20,
      source: "flue_prompt_usage",
      totalTokens: 37,
    });
  });

  it("stores usage in an OpenMeld-owned record keyed by submission", async () => {
    const request = createSubmitTurnRequest();
    const context = createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    });
    const storage = new InMemoryDurableObjectStorage();
    const usage = normalizeFluePromptUsage({
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 12,
      output: 8,
      totalTokens: 20,
    });

    if (!usage) {
      throw new Error("Expected normalized usage");
    }
    await putRemoteAgentUsageRecord(
      storage,
      buildRemoteAgentUsageRecord({
        context,
        modelId: "openrouter/x-ai/grok-4.5",
        nowMs: TEST_NOW_MS,
        usage,
      })
    );

    await expect(
      listRemoteAgentUsageRecords(storage, { spaceId: request.spaceId })
    ).resolves.toEqual([
      expect.objectContaining({
        modelId: "openrouter/x-ai/grok-4.5",
        organizationId: request.organizationId,
        spaceId: request.spaceId,
        submissionId: "flue_submission_123",
        usage: expect.objectContaining({ totalTokens: 20 }),
      }),
    ]);
  });
});
