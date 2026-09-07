import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { RuntimeCoordinatorFinalizationRetryEntry } from "../runtime-transport/application/runtime-coordinator-authority";
import {
  readRuntimeCoordinatorFinalizationRetriesFromStorage,
  removeRuntimeCoordinatorFinalizationRetryFromStorage,
  upsertRuntimeCoordinatorFinalizationRetryEntryInStorage,
} from "../runtime-transport/application/runtime-coordinator-storage";

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
    const stub = env.OPENMELD_RUNTIME_TRANSPORT.get(
      env.OPENMELD_RUNTIME_TRANSPORT.newUniqueId()
    );
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
    const stub = env.OPENMELD_RUNTIME_TRANSPORT.get(
      env.OPENMELD_RUNTIME_TRANSPORT.newUniqueId()
    );
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
