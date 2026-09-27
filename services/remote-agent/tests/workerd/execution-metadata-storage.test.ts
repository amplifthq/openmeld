import { env, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { createRemoteAgentSqlStorage } from "../../flue-adapter/storage";

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
