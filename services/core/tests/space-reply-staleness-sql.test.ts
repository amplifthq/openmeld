import { runInDurableObject } from "cloudflare:test";
import type { SignalEnvelope } from "@openmeld/protocol";
import type { SpaceThreadContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  countPublicTextSignalsAfterDispatchAnchor,
  insertSignalRecord,
  readAgentReplyObservationState,
} from "../src/space/infrastructure/sql/space-signal-repo";
import {
  insertSpaceThread,
  insertSpaceThreadSignalPlacement,
  listSpaceThreadSignalPlacementsAfter,
} from "../src/space/infrastructure/sql/space-thread-repo";
import type { Space } from "../src/space/transport/do/space";
import { env } from "../test-support/worker-env";

function createSpaceShard(): DurableObjectStub<Space> {
  const spaceEnv = env as unknown as {
    OPENMELD_SPACES: DurableObjectNamespace<Space>;
  };
  return spaceEnv.OPENMELD_SPACES.get(spaceEnv.OPENMELD_SPACES.newUniqueId());
}

function createTextSignal(input: {
  id: string;
  profileId: string;
  profileKind?: "agent" | "human" | "system";
  transient?: boolean;
  ts: number;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.id,
    spaceId: "space-reply-staleness-sql",
    ts: input.ts,
    type: "signal.text",
    profile: {
      kind: input.profileKind ?? "human",
      profileId: input.profileId,
      profileName: "Room participant",
    },
    data: {
      text: input.id,
      ...(input.transient ? { meta: { transient: true } } : {}),
    },
  };
}

describe("reply staleness SQL", () => {
  it("keeps a main Wake on the main timeline when its source becomes a thread root", async () => {
    const shard = createSpaceShard();
    await runInDurableObject(shard, (instance, state) => {
      const resolveScope = (id: string) =>
        (
          instance as unknown as {
            resolveThreadContextForSignal(
              id: string
            ): SpaceThreadContext | null;
          }
        ).resolveThreadContextForSignal(id);
      const source = createTextSignal({
        id: "wake-main",
        profileId: "human",
        ts: 1000,
      });
      insertSignalRecord(state.storage.sql, source);
      expect(resolveScope(source.id)).toBeNull();
      const thread = {
        threadId: "thr_11111111-1111-4111-8111-111111111111",
        spaceId: source.spaceId,
        rootSignalId: source.id,
        createdByProfileId: "human",
        createdAt: new Date(2000).toISOString(),
        updatedAt: new Date(2000).toISOString(),
      };
      insertSpaceThread(state.storage.sql, thread);
      insertSpaceThreadSignalPlacement(state.storage.sql, {
        signalId: source.id,
        threadId: thread.threadId,
        placement: "root",
        createdAt: thread.createdAt,
      });
      const laterMain = createTextSignal({
        id: "later-main",
        profileId: "human",
        ts: 3000,
      });
      insertSignalRecord(state.storage.sql, laterMain);
      expect(resolveScope(source.id)).toBeNull();
      expect(
        readAgentReplyObservationState(state.storage.sql, {
          sourceSignalId: source.id,
          observedThroughSignalId: laterMain.id,
          threadId: resolveScope(source.id)?.threadId ?? null,
        })
      ).toBe("current");
      expect(
        listSpaceThreadSignalPlacementsAfter(state.storage.sql, {
          afterSignalId: source.id,
          threadId: thread.threadId,
          limit: 20,
        })
      ).toEqual([]);
      expect(
        readAgentReplyObservationState(state.storage.sql, {
          sourceSignalId: source.id,
          observedThroughSignalId: source.id,
          threadId: thread.threadId,
        })
      ).toBe("current");

      const threadWake = createTextSignal({
        id: "wake-in-thread",
        profileId: "human",
        ts: 4000,
      });
      insertSignalRecord(state.storage.sql, threadWake);
      insertSpaceThreadSignalPlacement(state.storage.sql, {
        signalId: threadWake.id,
        threadId: thread.threadId,
        placement: "thread",
        createdAt: new Date(4000).toISOString(),
      });
      expect(resolveScope(threadWake.id)).toMatchObject({
        rootSignalId: source.id,
        threadId: thread.threadId,
      });
    });
  });

  it("counts only newer public text from profiles other than the dispatch target", async () => {
    const shard = createSpaceShard();
    const targetProfileId = "agt_11111111-1111-4111-8111-111111111111";
    const signals = [
      createTextSignal({
        id: "staleness-anchor",
        profileId: "22222222-2222-4222-8222-222222222222",
        ts: 1000,
      }),
      createTextSignal({
        id: "staleness-target-message",
        profileId: targetProfileId,
        profileKind: "agent",
        ts: 1001,
      }),
      createTextSignal({
        id: "staleness-public-message-1",
        profileId: "33333333-3333-4333-8333-333333333333",
        ts: 1002,
      }),
      createTextSignal({
        id: "staleness-transient-message",
        profileId: "44444444-4444-4444-8444-444444444444",
        transient: true,
        ts: 1003,
      }),
      createTextSignal({
        id: "staleness-system-message",
        profileId: "openmeld-system",
        profileKind: "system",
        ts: 1004,
      }),
      createTextSignal({
        id: "staleness-public-message-2",
        profileId: "55555555-5555-4555-8555-555555555555",
        ts: 1005,
      }),
    ];

    const count = await runInDurableObject(shard, (_instance, state) => {
      for (const signal of signals) {
        insertSignalRecord(state.storage.sql, signal);
      }
      return countPublicTextSignalsAfterDispatchAnchor(state.storage.sql, {
        dispatchId: "dispatch-staleness",
        afterSignalId: "staleness-anchor",
        afterTimestampMs: 1000,
        excludeProfileId: targetProfileId,
      });
    });

    expect(count).toBe(2);
  });

  it("falls back to dispatch creation time when the signal anchor was removed", async () => {
    const shard = createSpaceShard();
    const targetProfileId = "agt_66666666-6666-4666-8666-666666666666";
    const signals = [
      createTextSignal({
        id: "staleness-fallback-before-dispatch",
        profileId: "77777777-7777-4777-8777-777777777777",
        ts: 900,
      }),
      createTextSignal({
        id: "staleness-fallback-anchor",
        profileId: "88888888-8888-4888-8888-888888888888",
        ts: 1000,
      }),
      createTextSignal({
        id: "staleness-fallback-new-message",
        profileId: "99999999-9999-4999-8999-999999999999",
        ts: 1001,
      }),
      createTextSignal({
        id: "staleness-fallback-target-message",
        profileId: targetProfileId,
        profileKind: "agent",
        ts: 1002,
      }),
    ];

    const count = await runInDurableObject(shard, (_instance, state) => {
      for (const signal of signals) {
        insertSignalRecord(state.storage.sql, signal);
      }
      state.storage.sql.exec(
        "DELETE FROM space_signals WHERE id = ?",
        "staleness-fallback-anchor"
      );
      return countPublicTextSignalsAfterDispatchAnchor(state.storage.sql, {
        dispatchId: "dispatch-staleness",
        afterSignalId: "staleness-fallback-anchor",
        afterTimestampMs: 1000,
        excludeProfileId: targetProfileId,
      });
    });

    expect(count).toBe(1);
  });
});
