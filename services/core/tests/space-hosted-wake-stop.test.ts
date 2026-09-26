import { env, runInDurableObject } from "cloudflare:test";
import type {
  PostSpaceWakeStopBody,
  PostSpaceWakeStopResponse,
  SpaceDispatchLookupMatch,
  SpaceWakeStopIntentQuery,
  WakeProgressItem,
} from "@openmeld/schemas/types";
import { expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  createDispatchOutboxRecord,
  insertDispatchOutboxRecord,
  readDispatchOutboxRecordByDispatchId,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import type { Space } from "../src/space/transport/do/space";

it.each([
  ["hosted:remote-agent", "new"],
  ["hosted:center-agent", "new"],
  ["hosted:remote-agent", "admitted"],
  ["hosted:center-agent", "admitted"],
  ["hosted:remote-agent", "legacy"],
  ["hosted:center-agent", "legacy"],
])("retains %s Stop with %s admission evidence without a Local owner", async (agentControllerRef, admission) => {
  const bindings = env as unknown as {
    OPENMELD_SPACES: DurableObjectNamespace<Space>;
  };
  const shard = bindings.OPENMELD_SPACES.get(
    bindings.OPENMELD_SPACES.newUniqueId()
  );
  const query = await runInDurableObject(shard, async (instance, state) => {
    upsertSpaceMetaRecord(state.storage.sql, {
      v: 1,
      spaceId: state.id.toString(),
      organizationId: "org-stop",
      visibility: "private",
      accessMode: "public",
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
    });
    const record = createDispatchOutboxRecord({
      bindingState: "bound",
      bindingEnabled: true,
      agentControllerRef,
      dispatchPolicy: "mention_only",
      ruleId: "stop-test",
      ruleReason: "test",
      ruleSource: "system",
      sourceSignalSnapshot: {
        profileId: "human",
        profileKind: "human",
        profileMentionLabel: "Human",
        text: "Start work",
      },
      senderProfileId: "human",
      spaceId: state.id.toString(),
      sourceEventId: "source-stop",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
      nowMs: 1000,
    });
    insertDispatchOutboxRecord(state.storage.sql, record);
    const query: SpaceWakeStopIntentQuery = {
      dispatchId: record.dispatchId,
      spaceId: record.spaceId,
      targetProfileId: record.targetProfileId,
    };
    expect(await instance.rpcReadWakeStopIntent(query)).toEqual({
      status: "not_requested",
    });
    if (admission === "admitted") {
      expect(await instance.rpcAuthorizeNativeWakeAdmission(query)).toEqual({
        status: "not_requested",
      });
    } else if (admission === "legacy") {
      state.storage.sql.exec(
        "UPDATE openMeldDaemon_outbox SET native_admission_started_at_ms = NULL WHERE dispatch_id = ?",
        record.dispatchId
      );
    }
    const ownerRead = vi.fn(() => {
      throw new Error("Local owner must not be read");
    });
    // D1 external read says no Worker admission is registered yet. Space SQL is
    // real, so a dropped Stop intent or a mismatched selector fails this test.
    const db = {
      prepare: () => ({ bind: () => ({ first: () => Promise.resolve(null) }) }),
    } as unknown as D1Database;
    const internal = instance as unknown as {
      bindings: CoreBindings;
      requestRemoteAgentNativeDeliveryStop: (input: {
        body: PostSpaceWakeStopBody;
        lookupMatch: SpaceDispatchLookupMatch;
      }) => Promise<PostSpaceWakeStopResponse | null>;
      readWakeProgressPreAgentWakeStopEligibility: (input: {
        clientMessageId: null;
        lookupMatch: null;
        outboxRecord: ReturnType<typeof readDispatchOutboxRecordByDispatchId>;
        trace: null;
      }) => Promise<WakeProgressItem["wakeStopEligibility"]>;
    };
    Object.defineProperty(instance, "bindings", {
      value: {
        ...internal.bindings,
        OPENMELD_LOCAL_STATE_DB: db,
        OPENMELD_DB: db,
        OPENMELD_AUTH_WORKER: { resolveProfileById: ownerRead },
      },
      configurable: true,
    });
    expect(
      await internal.readWakeProgressPreAgentWakeStopEligibility({
        clientMessageId: null,
        lookupMatch: null,
        trace: null,
        outboxRecord: readDispatchOutboxRecordByDispatchId(
          state.storage.sql,
          record.dispatchId
        ),
      })
    ).toMatchObject({ status: "eligible", reliability: "native_cancel" });
    const selection = {
      body: {
        target: {
          by: "source_signal" as const,
          sourceSignalId: record.sourceEventId,
          targetProfileId: record.targetProfileId,
        },
      },
      lookupMatch: {
        dispatchId: record.dispatchId,
        targetProfileId: record.targetProfileId,
        sourceSignalId: record.sourceEventId,
      } as SpaceDispatchLookupMatch,
    };
    expect(
      await internal.requestRemoteAgentNativeDeliveryStop(selection)
    ).toMatchObject({
      status: admission === "new" ? "cancelled" : "cancellation_requested",
      stopMode: "remote_agent_native_delivery",
    });
    expect(
      await internal.requestRemoteAgentNativeDeliveryStop(selection)
    ).toMatchObject({
      status:
        admission === "new" ? "already_cancelled" : "cancellation_requested",
    });
    // A new unexposed task is settled durably; missing legacy/current Worker
    // evidence is never promoted to a fictional execution-terminal result.
    expect(
      await instance.rpcReadFinalReplyClaimOutcome({
        dispatchId: query.dispatchId,
        profileId: query.targetProfileId,
        spaceId: query.spaceId,
      })
    ).toMatchObject({ outcome: admission === "new" ? "stopped" : null });
    expect(await instance.rpcAuthorizeNativeWakeAdmission(query)).toEqual({
      status: "requested",
    });
    expect(() =>
      instance.rpcReadWakeStopIntent({ ...query, dispatchId: "" })
    ).toThrow();
    expect(ownerRead).not.toHaveBeenCalled();
    return query;
  });
  expect(await shard.rpcReadWakeStopIntent(query)).toEqual({
    status: "requested",
  });
  expect(await shard.rpcAuthorizeNativeWakeAdmission(query)).toEqual({
    status: "requested",
  });
  expect(
    await shard.rpcReadWakeStopIntent({
      ...query,
      targetProfileId: "another-agent",
    })
  ).toEqual({ status: "not_found" });
});
