import { runInDurableObject } from "cloudflare:test";
import type {
  AiUsageRecord,
  RemoteAiUsageWrite,
} from "@openmeld/schemas/types";
import { expect, it } from "vitest";
import {
  createMeteredRemoteFetch,
  flushRemoteAiUsage,
} from "../../agent-core/ai-usage";
import { createRemoteAgentSqlStorage } from "../../flue-adapter/storage";
import { env } from "./worker-env";

it.each([
  "outage",
  "retained_legacy_audit",
])("replays a persisted auxiliary usage receipt after %s from workerd SQLite without repeating inference", async (failure) => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const stub = namespace.get(namespace.newUniqueId());
  await runInDurableObject(stub, async (_instance, state) => {
    const storage = createRemoteAgentSqlStorage(state.storage.sql);
    const response = await createMeteredRemoteFetch({
      storage,
      scheduleRetry: () => state.storage.setAlarm(Date.now() + 60_000),
      coreWorker: {
        recordRemoteAiUsage: (input: RemoteAiUsageWrite) => {
          if (input.phase === "settle") {
            throw new Error("Simulated Core outage");
          }
          return Promise.resolve({ status: "accepted" });
        },
      },
      scope: {
        organizationId: "org-1",
        purpose: "session_title",
        spaceId: "space-1",
        agentProfileId: null,
        taskId: null,
        attemptId: null,
      },
      model: "requested",
      // OpenRouter's native usage-accounting response fields.
      fetch: () =>
        Promise.resolve(
          Response.json({
            id: "gen-1",
            model: "actual",
            usage: {
              prompt_tokens: 100,
              completion_tokens: 20,
              total_tokens: 120,
              cost: 0.01,
            },
          })
        ),
    })("https://provider.example/chat/completions");
    await response.text();
    if (failure === "retained_legacy_audit") {
      const pending = await storage.list<AiUsageRecord>({
        prefix: "openmeld:ai-usage:pending:",
      });
      const receipt = [...pending.values()][0];
      if (!receipt) {
        throw new Error("Expected the persisted provider usage receipt");
      }
      // Historical audit format from the removed rollout bridge. New runtime
      // never creates it, but settlement retries must retain it unchanged.
      await storage.put(`openmeld:ai-usage:deferred:${receipt.eventId}`, {
        v: 1,
        reason: "core_receiver_missing",
        record: { ...receipt, status: "pending", tokens: null, cost: null },
      });
    }
    expect(await state.storage.getAlarm()).not.toBeNull();
  });
  const records = await runInDurableObject(stub, async (_instance, state) => {
    const settled: AiUsageRecord[] = [];
    const coreWorker = {
      recordRemoteAiUsage: (input: RemoteAiUsageWrite) => {
        settled.push(input.record);
        return Promise.resolve({ status: "accepted" as const });
      },
    };
    // A fresh adapter has no in-memory copy of the failed receipt or fetch.
    const storage = createRemoteAgentSqlStorage(state.storage.sql);
    const auditBefore = await storage.list({
      prefix: "openmeld:ai-usage:deferred:",
    });
    await flushRemoteAiUsage({ storage, coreWorker });
    await flushRemoteAiUsage({ storage, coreWorker });
    expect(
      await storage.list({ prefix: "openmeld:ai-usage:deferred:" })
    ).toEqual(auditBefore);
    await state.storage.deleteAlarm();
    return settled;
  });
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    purpose: "session_title",
    status: "reported",
    tokens: { total: 120 },
    cost: { nanoUsd: 10_000_000 },
  });
});

it("atomically persists execution and callback metadata under workerd SQLite", async () => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const stub = namespace.get(namespace.newUniqueId());
  const result = await runInDurableObject(stub, async (_instance, state) => {
    const storage = createRemoteAgentSqlStorage(state.storage.sql);
    const first = {
      key: "owner",
      expectedValue: { status: "running" },
      nextValue: { status: "completed" },
    };
    const second = {
      key: "metadata",
      expectedValue: { modelId: null as string | null },
      nextValue: { modelId: "actual/model" },
    };
    await storage.put(first.key, first.expectedValue);
    await storage.put(second.key, second.expectedValue);
    const rejected = await storage.compareAndSetPair(first, {
      ...second,
      expectedValue: { modelId: "stale/model" },
    });
    const before = await storage.get(first.key);
    const accepted = await storage.compareAndSetPair(first, second);
    const duplicate = await storage.compareAndSetPair(first, second);
    return {
      rejected,
      before,
      accepted,
      duplicate,
      owner: await storage.get(first.key),
      metadata: await storage.get(second.key),
    };
  });
  expect(result).toEqual({
    rejected: false,
    before: { status: "running" },
    accepted: true,
    duplicate: false,
    owner: { status: "completed" },
    metadata: { modelId: "actual/model" },
  });
});
