import type {
  AiUsageRecord,
  RemoteAiUsageWrite,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  createMeteredRemoteFetch,
  flushRemoteAiUsage,
} from "../agent-core/ai-usage";
import { InMemoryDurableObjectStorage } from "./storage";

const scope = {
  organizationId: "org-1",
  purpose: "agent" as const,
  agentProfileId: "agent-1",
  spaceId: "space-1",
  taskId: "task-1",
  attemptId: "attempt-1",
};
// Native response fields from OpenRouter's usage-accounting contract, not the
// normalized OpenMeld model. Cache and reasoning are subsets, not extra tokens.
const providerResponse = {
  id: "gen-provider-1",
  model: "openai/actual-model",
  usage: {
    prompt_tokens: 100,
    completion_tokens: 20,
    total_tokens: 120,
    cost: 0.000_012_345,
    prompt_tokens_details: { cached_tokens: 60 },
    completion_tokens_details: { reasoning_tokens: 5 },
  },
};

describe("Remote AI consumption at the provider boundary", () => {
  it.each([
    "json",
    "sse",
  ])("records native %s usage without another provider request", async (format) => {
    const records: AiUsageRecord[] = [];
    const coreWorker = {
      recordRemoteAiUsage: (input: RemoteAiUsageWrite) => {
        records.push(input.record);
        return Promise.resolve({ status: "accepted" as const });
      },
    };
    const body =
      format === "json"
        ? JSON.stringify(providerResponse)
        : `data: ${JSON.stringify(providerResponse)}\n\ndata: [DONE]\n\n`;
    const fetch = vi.fn(
      async () =>
        new Response(body, {
          headers: {
            "content-type":
              format === "json" ? "application/json" : "text/event-stream",
          },
        })
    );
    const response = await createMeteredRemoteFetch({
      coreWorker,
      scope,
      model: "requested",
      fetch,
    })("https://provider.example/chat/completions");
    expect(await response.text()).toBe(body);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      status: "pending",
      cost: null,
      tokens: null,
    });
    expect(records[1]).toMatchObject({
      eventId: records[0]?.eventId,
      status: "reported",
      model: "openai/actual-model",
      providerRequestId: "gen-provider-1",
      cost: { nanoUsd: 12_345, kind: "provider_reported" },
      tokens: {
        input: 100,
        output: 20,
        total: 120,
        cacheRead: 60,
        reasoning: 5,
      },
    });
  });

  it("blocks before calling the provider when the optional allowance is exhausted", async () => {
    const fetch = vi.fn();
    const request = createMeteredRemoteFetch({
      coreWorker: {
        recordRemoteAiUsage: async () => ({ status: "limit_reached" }),
      },
      scope,
      model: "requested",
      fetch,
    });
    await expect(
      request("https://provider.example/chat/completions")
    ).rejects.toThrow("daily AI allowance");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a failed settlement durable and retries the same event without repeating inference", async () => {
    const storage = new InMemoryDurableObjectStorage();
    let unavailable = true;
    const settled: AiUsageRecord[] = [];
    const coreWorker = {
      recordRemoteAiUsage: (input: RemoteAiUsageWrite) => {
        if (input.phase === "settle") {
          if (unavailable) {
            throw new Error("Core unavailable");
          }
          settled.push(input.record);
        }
        return Promise.resolve({ status: "accepted" as const });
      },
    };
    const fetch = vi.fn(async () => Response.json(providerResponse));
    await createMeteredRemoteFetch({
      coreWorker,
      scope,
      model: "requested",
      fetch,
      storage,
    })("https://provider.example/chat/completions");
    expect(settled).toHaveLength(0);
    unavailable = false;
    await flushRemoteAiUsage({ coreWorker, storage });
    await flushRemoteAiUsage({ coreWorker, storage });
    expect(settled).toHaveLength(1);
    expect(settled[0]?.cost?.nanoUsd).toBe(12_345);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
