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
    "byok",
    "free",
  ] as const)("uses only the authorized %s key and never persists it or retries on provider rejection", async (source) => {
    const writes: RemoteAiUsageWrite[] = [];
    const coreWorker = {
      recordRemoteAiUsage: (write: RemoteAiUsageWrite) => {
        writes.push(structuredClone(write));
        return Promise.resolve({
          status: "accepted",
          providerAuthorization: {
            source,
            apiKey: "sk-or-authorized-test-key",
          },
        });
      },
    };
    const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer sk-or-authorized-test-key"
      );
      expect(new Headers(init?.headers).has("cf-aig-byok-alias")).toBe(false);
      expect(new Headers(init?.headers).get("HTTP-Referer")).toBe(
        "https://openmeld.ai"
      );
      expect(new Headers(init?.headers).get("X-OpenRouter-Title")).toBe(
        "OpenMeld"
      );
      expect(new Headers(init?.headers).has("X-Title")).toBe(false);
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "requested",
        messages: [{ role: "user", content: "Hello" }],
        metadata: {
          openmeld_organization_id: "org-1",
          openmeld_funding_source: source,
          openmeld_purpose: "agent",
        },
      });
      expect(new Headers(init?.headers).has("Content-Length")).toBe(false);
      expect(init?.redirect).toBe("manual");
      return Promise.resolve(
        Response.json(
          { error: { code: 403, message: "Key limit exceeded" } },
          { status: 403 }
        )
      );
    });
    const request = createMeteredRemoteFetch({
      coreWorker,
      fetch,
      scope,
      model: "requested",
    });
    const url = "https://openrouter.ai/api/v1/chat/completions";
    const options = {
      method: "POST",
      body: JSON.stringify({
        model: "requested",
        messages: [{ role: "user", content: "Hello" }],
        metadata: { openmeld_organization_id: "untrusted-org" },
      }),
      headers: {
        Authorization: "Bearer old-official-key",
        "cf-aig-byok-alias": "official",
        "HTTP-Referer": "https://old.example",
        "X-Title": "Old app",
        "Content-Length": "1",
      },
    };
    // Both Fetch signatures must carry the same trusted tenant attribution.
    const response =
      source === "byok"
        ? await request(new Request(url, options))
        : await request(url, options);
    expect(response.status).toBe(403);
    expect(fetch).toHaveBeenCalledOnce();
    expect(writes[0]?.providerAuthorizationVersion).toBe(2);
    // An unreviewed model cannot be estimated; Core decides per funding source.
    expect(writes[0]?.creditHold).toEqual({
      status: "unavailable",
      reason: "unknown_model_price",
    });
    expect(writes[1]?.record.fundingSource).toBe(source);
    expect(JSON.stringify(writes)).not.toContain("sk-or-authorized-test-key");
    await expect(
      request("https://untrusted.example/chat/completions")
    ).rejects.toThrow("destination");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("rejects a legacy allowance-only response before sending any provider request", async () => {
    const fetch = vi.fn();
    const request = createMeteredRemoteFetch({
      coreWorker: { recordRemoteAiUsage: async () => ({ status: "accepted" }) },
      fetch,
      scope,
      model: "requested",
    });
    await expect(
      request("https://openrouter.ai/api/v1/chat/completions")
    ).rejects.toThrow("authorization is unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    "fresh_owner",
    "previously_metered",
  ])("fails closed after a missing receiver for %s", async (owner) => {
    const storage = new InMemoryDurableObjectStorage();
    let status = "accepted";
    const coreWorker = {
      recordRemoteAiUsage: () => {
        if (status === "missing") {
          throw new Error(
            'The RPC receiver does not implement the method "recordRemoteAiUsage".'
          );
        }
        return Promise.resolve({
          status,
          providerAuthorization: {
            source: "byok" as const,
            apiKey: "sk-or-test-provider-key",
          },
        });
      },
    };
    const fetch = vi.fn(async () => Response.json(providerResponse));
    const request = createMeteredRemoteFetch({
      coreWorker,
      storage,
      scope,
      model: "requested",
      fetch,
    });
    if (owner === "previously_metered") {
      await (
        await request("https://openrouter.ai/api/v1/chat/completions")
      ).text();
      status = "limit_reached";
      await expect(
        request("https://openrouter.ai/api/v1/chat/completions")
      ).rejects.toThrow("included AI credits");
    }
    const calls = fetch.mock.calls.length;
    status = "missing";
    await expect(
      request("https://openrouter.ai/api/v1/chat/completions")
    ).rejects.toThrow("recordRemoteAiUsage is unavailable");
    expect(fetch).toHaveBeenCalledTimes(calls);
    expect(
      (await storage.list({ prefix: "openmeld:ai-usage:deferred:" })).size
    ).toBe(0);
  });
  it.each([
    "before_response",
    "after_response",
  ])("keeps an admitted in-flight request when Core recovers %s", async (upgrade) => {
    const storage = new InMemoryDurableObjectStorage();
    let unavailable = false;
    const records: AiUsageRecord[] = [];
    const coreWorker = {
      recordRemoteAiUsage: ({ phase, record }: RemoteAiUsageWrite) => {
        if (unavailable) {
          throw new Error(
            'The RPC receiver does not implement the method "recordRemoteAiUsage".'
          );
        }
        if (phase === "settle") {
          records.push(record);
        }
        return Promise.resolve({
          status: "accepted" as const,
          providerAuthorization: {
            source: "byok" as const,
            apiKey: "sk-or-test-provider-key",
          },
        });
      },
    };
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const fetch = vi.fn(async () => {
      started.resolve();
      await finish.promise;
      return Response.json(providerResponse);
    });
    const request = createMeteredRemoteFetch({
      coreWorker,
      scope,
      model: "requested",
      fetch,
      storage,
    });
    const result = request("https://openrouter.ai/api/v1/chat/completions");
    // Catch the initial regression without waiting forever for provider entry.
    await Promise.race([started.promise, result.then(() => undefined)]);
    unavailable = true;
    if (upgrade === "before_response") {
      unavailable = false;
    }
    finish.resolve();
    expect(await (await result).json()).toEqual(providerResponse);
    unavailable = false;
    await flushRemoteAiUsage({ coreWorker, storage });
    await flushRemoteAiUsage({ coreWorker, storage });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      status: "reported",
      tokens: { total: 120 },
      cost: { nanoUsd: 12_345 },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    "transport",
    "timeout",
    "forbidden",
    "different_method",
    "invalid_response",
    "no_storage",
    "missing_binding",
    "missing_result",
  ])("does not bypass admission for %s", async (failure) => {
    const storage = new InMemoryDurableObjectStorage();
    const fetch = vi.fn();
    const errors: Record<string, string> = {
      transport: "network down",
      timeout: "RPC timed out",
      forbidden: "403 Forbidden",
      different_method:
        'The RPC receiver does not implement the method "anotherMethod".',
    };
    let coreWorker: unknown = {
      recordRemoteAiUsage: () =>
        Promise.reject(
          new Error(
            errors[failure] ??
              'The RPC receiver does not implement the method "recordRemoteAiUsage".'
          )
        ),
    };
    if (failure === "missing_binding") {
      coreWorker = undefined;
    }
    if (failure === "missing_result") {
      coreWorker = {};
    }
    if (failure === "invalid_response") {
      coreWorker = {
        recordRemoteAiUsage: async () => ({ status: "deferred" }),
      };
    }
    const request = createMeteredRemoteFetch({
      coreWorker,
      storage: failure === "no_storage" ? undefined : storage,
      scope,
      model: "requested",
      fetch,
    });
    await expect(
      request("https://openrouter.ai/api/v1/chat/completions")
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "request_failed",
    "stream_interrupted",
    "provider_missing",
  ])("keeps %s distinct from zero consumption", async (scenario) => {
    const records: AiUsageRecord[] = [];
    const coreWorker = {
      recordRemoteAiUsage: ({ record }: RemoteAiUsageWrite) => {
        records.push(record);
        return Promise.resolve({
          status: "accepted",
          providerAuthorization: {
            source: "byok" as const,
            apiKey: "sk-or-test-provider-key",
          },
        });
      },
    };
    const fetch = vi.fn(() => {
      if (scenario === "request_failed") {
        throw new Error("connection lost");
      }
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              if (scenario === "stream_interrupted") {
                controller.error(new Error("connection lost"));
              } else {
                controller.close();
              }
            },
          }),
          { headers: { "content-type": "text/event-stream" } }
        )
      );
    });
    const run = async () =>
      (
        await createMeteredRemoteFetch({
          coreWorker,
          scope,
          model: "requested",
          fetch,
        })("https://openrouter.ai/api/v1/chat/completions")
      ).text();
    if (scenario === "provider_missing") {
      await run();
    } else {
      await expect(run()).rejects.toThrow("connection lost");
    }
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({
      status:
        scenario === "provider_missing" ? "unavailable" : "collection_failed",
      tokens: null,
      cost: null,
      ...(scenario === "provider_missing"
        ? {}
        : { collectionFailure: scenario }),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("records interruption when the consumer cancels before native usage arrives", async () => {
    const records: AiUsageRecord[] = [];
    const cancelled = vi.fn();
    const response = await createMeteredRemoteFetch({
      coreWorker: {
        recordRemoteAiUsage: ({ record }: RemoteAiUsageWrite) => {
          records.push(record);
          return Promise.resolve({
            status: "accepted",
            providerAuthorization: {
              source: "byok" as const,
              apiKey: "sk-or-test-provider-key",
            },
          });
        },
      },
      scope,
      model: "requested",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('data: {"choices":[]}\n\n')
              );
            },
            cancel: cancelled,
          }),
          { headers: { "content-type": "text/event-stream" } }
        ),
    })("https://openrouter.ai/api/v1/chat/completions");
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Missing response stream");
    }
    await reader.read();
    await reader.cancel();
    expect(records[1]).toMatchObject({
      status: "collection_failed",
      collectionFailure: "stream_interrupted",
      tokens: null,
      cost: null,
    });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it.each([
    "json",
    "sse",
  ])("records native %s usage without another provider request", async (format) => {
    const records: AiUsageRecord[] = [];
    const coreWorker = {
      recordRemoteAiUsage: (input: RemoteAiUsageWrite) => {
        records.push(input.record);
        return Promise.resolve({
          status: "accepted" as const,
          providerAuthorization: {
            source: "byok" as const,
            apiKey: "sk-or-test-provider-key",
          },
        });
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
    })("https://openrouter.ai/api/v1/chat/completions");
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
      request("https://openrouter.ai/api/v1/chat/completions")
    ).rejects.toThrow("included AI credits");
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
        return Promise.resolve({
          status: "accepted" as const,
          providerAuthorization: {
            source: "byok" as const,
            apiKey: "sk-or-test-provider-key",
          },
        });
      },
    };
    const fetch = vi.fn(async () => Response.json(providerResponse));
    const scheduleRetry = vi.fn(async () => undefined);
    await createMeteredRemoteFetch({
      coreWorker,
      scope,
      model: "requested",
      fetch,
      storage,
      scheduleRetry,
    })("https://openrouter.ai/api/v1/chat/completions");
    expect(settled).toHaveLength(0);
    expect(scheduleRetry).toHaveBeenCalledOnce();
    unavailable = false;
    await flushRemoteAiUsage({ coreWorker, storage });
    await flushRemoteAiUsage({ coreWorker, storage });
    expect(settled).toHaveLength(1);
    expect(settled[0]?.cost?.nanoUsd).toBe(12_345);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
