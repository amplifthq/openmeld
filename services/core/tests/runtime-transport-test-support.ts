import { runInDurableObject } from "cloudflare:test";
import type { RuntimeTransportHub } from "../src/runtime-transport/transport/do/runtime-transport-hub";

type RuntimeTransportInternalState = {
  state: {
    pendingDispatches: Map<string, unknown>;
    completedDispatchResults: Map<string, unknown>;
  };
};

/**
 * Quiesce a RuntimeTransport shard at a @cloudflare/vitest-plugin per-file
 * storage boundary. Delivered dispatches and RuntimeCoordinator records
 * schedule a housekeeping alarm; an actor with a scheduled alarm stays active
 * across the end-of-file storage stack pop, which leaves SQLite WAL sidecar
 * files behind and fails the pool's "only .sqlite files" assertion.
 */
export async function quiesceRuntimeTransportShard(
  shard: DurableObjectStub<RuntimeTransportHub>
): Promise<void> {
  await runInDurableObject(shard, async (instance, state) => {
    const internal = instance as unknown as RuntimeTransportInternalState;
    internal.state.pendingDispatches.clear();
    internal.state.completedDispatchResults.clear();
    await state.storage.deleteAll();
    await state.storage.deleteAlarm();
    await state.storage.sync();
  });
}
