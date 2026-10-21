import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import type { RuntimeCoordinatorFinalizationRetryEntry } from "../src/runtime-transport/application/runtime-coordinator-authority";
import {
  readRuntimeCoordinatorFinalizationRetriesFromStorage,
  removeRuntimeCoordinatorFinalizationRetryFromStorage,
  upsertRuntimeCoordinatorFinalizationRetryEntryInStorage,
} from "../src/runtime-transport/application/runtime-coordinator-storage";
import { env } from "../test-support/worker-env";

function createTransportStub() {
  const transport = (env as unknown as CoreBindings).OPENMELD_RUNTIME_TRANSPORT;
  if (!transport) {
    throw new Error("Test runtime transport binding is required");
  }
  return transport.get(transport.newUniqueId());
}

function retry(id: string): RuntimeCoordinatorFinalizationRetryEntry {
  return {
    attemptCount: 1,
    attemptId: `attempt-${id}`,
    dispatchId: `dispatch-${id}`,
    executionTokenRunId: `run-${id}`,
    finalizationCommandId: id,
    firstFailureAtMs: 100,
    nextReplayAtMs: 200,
    runtimeCoordinatorExecutionId: `execution-${id}`,
    spaceId: "space-storage-test",
    targetProfileId: `agent-${id}`,
    updatedAtMs: 100,
  };
}

describe("finalization retry storage concurrency", () => {
  it("retains both replies when publication retries are registered concurrently", async () => {
    const stub = createTransportStub();
    await runInDurableObject(stub, async (_instance, state) => {
      await Promise.all([
        upsertRuntimeCoordinatorFinalizationRetryEntryInStorage(
          state.storage,
          retry("a")
        ),
        upsertRuntimeCoordinatorFinalizationRetryEntryInStorage(
          state.storage,
          retry("b")
        ),
      ]);
      expect(
        await readRuntimeCoordinatorFinalizationRetriesFromStorage(
          state.storage
        )
      ).toEqual([retry("a"), retry("b")]);
    });
  });

  it("does not erase another reply retry while removing a delivered reply", async () => {
    const stub = createTransportStub();
    await runInDurableObject(stub, async (_instance, state) => {
      await upsertRuntimeCoordinatorFinalizationRetryEntryInStorage(
        state.storage,
        retry("a")
      );
      await Promise.all([
        upsertRuntimeCoordinatorFinalizationRetryEntryInStorage(
          state.storage,
          retry("b")
        ),
        removeRuntimeCoordinatorFinalizationRetryFromStorage(
          state.storage,
          "a"
        ),
      ]);
      expect(
        await readRuntimeCoordinatorFinalizationRetriesFromStorage(
          state.storage
        )
      ).toEqual([retry("b")]);
    });
  });
});
