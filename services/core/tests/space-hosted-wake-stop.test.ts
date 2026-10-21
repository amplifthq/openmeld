import { runInDurableObject } from "cloudflare:test";
import type {
  GetSpaceDispatchLookupResponse,
  GetSpaceWakeProgressResponse,
  PostSpaceWakeStopBody,
  PostSpaceWakeStopResponse,
  SpaceDispatchLookupMatch,
  SpaceDispatchTraceSnapshot,
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
import { env } from "../test-support/worker-env";
import { createWorkerPostgresFixture } from "./postgresql.test-support";

it.each([
  ["submitted", true],
  ["accepted", true],
  ["retry_observed", true],
  ["completed", false],
  ["failed", false],
] as const)("uses native Stop authority for %s before the active projection arrives", async (status, eligible) => {
  const bindings = env as unknown as {
    OPENMELD_SPACES: DurableObjectNamespace<Space>;
  };
  const shard = bindings.OPENMELD_SPACES.get(
    bindings.OPENMELD_SPACES.newUniqueId()
  );
  await runInDurableObject(shard, async (instance, state) => {
    // Native ledger shape captured in the ordinary-Space browser smoke.
    const nativeDelivery: NonNullable<
      SpaceDispatchTraceSnapshot["nativeDelivery"]
    > = {
      factSource: "remote_agent_native_delivery_ledger",
      deliveryId: "delivery",
      dispatchId: "dispatch",
      idempotencyKey: "request:agent",
      bindingId: "binding",
      runtimeFamily: "hosted_center_agent",
      status,
      submissionId: "dispatch",
      destination: {
        conversationKind: "space",
        organizationId: "org-stop",
        spaceId: state.id.toString(),
        targetProfileId: "agent",
      },
      controllerNormalization: {
        factSource: "remote_agent_native_delivery_ledger",
        canonicalAgentControllerRef: "hosted:center-agent",
        reasonCode: "hosted_runtime_family_controller_canonicalized",
        storedAgentControllerRef: "hosted:center-agent",
        storedAgentControllerRefStatus: "canonical",
        bindingUpdatedAt: null,
      },
      createdAt: "2026-10-05T10:08:56.420Z",
      updatedAt: "2026-10-05T10:08:56.420Z",
    };
    const internal = instance as unknown as {
      readWakeProgressPreAgentWakeStopEligibility(input: {
        clientMessageId: null;
        lookupMatch: null;
        outboxRecord: null;
        trace: Pick<SpaceDispatchTraceSnapshot, "nativeDelivery">;
      }): Promise<WakeProgressItem["wakeStopEligibility"]>;
    };
    const result = await internal.readWakeProgressPreAgentWakeStopEligibility({
      clientMessageId: null,
      lookupMatch: null,
      outboxRecord: null,
      trace: { nativeDelivery },
    });
    if (eligible) {
      expect(result).toMatchObject({
        status: "eligible",
        reliability: "native_cancel",
      });
    } else {
      expect(result).toBeNull();
    }
  });
});

it("keeps Hosted Stop when admission finishes during the progress lookup", async () => {
  const bindings = env as unknown as {
    OPENMELD_SPACES: DurableObjectNamespace<Space>;
  };
  const shard = bindings.OPENMELD_SPACES.get(
    bindings.OPENMELD_SPACES.newUniqueId()
  );
  await runInDurableObject(shard, async (instance, state) => {
    const record = createDispatchOutboxRecord({
      bindingState: "bound",
      bindingEnabled: true,
      agentControllerRef: "hosted:center-agent",
      dispatchPolicy: "mention_only",
      ruleId: "stop-test",
      ruleReason: "test",
      ruleSource: "system",
      sourceSignalSnapshot: {
        profileId: "human",
        profileKind: "human",
        profileMentionLabel: "Human",
        text: "Hello",
      },
      senderProfileId: "human",
      spaceId: state.id.toString(),
      sourceEventId: "source-stop-race",
      targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
      nowMs: 1000,
    });
    const lookup: GetSpaceDispatchLookupResponse = {
      query: {
        spaceId: record.spaceId,
        sourceSignalId: record.sourceEventId,
        clientMessageId: null,
        targetProfileId: record.targetProfileId,
      },
      matches: [
        {
          dispatchId: record.dispatchId,
          sourceSignalId: record.sourceEventId,
          targetProfileId: record.targetProfileId,
          status: "dispatching",
          attemptCount: 0,
          latestAttemptId: null,
          latestAttemptStatus: null,
          latestAttemptErrorCode: null,
          latestAttemptErrorMessage: null,
        },
      ],
    };
    // The remote trace response races with the real local admission write.
    // No native runtime record exists yet; the outbox owns early cancellation.
    Object.defineProperties(instance, {
      readSpaceWakeProgressDispatchLookup: {
        value: () => Promise.resolve({ lookup, lookupError: null }),
      },
      readActiveNativeDeliveryProgress: { value: async () => [] },
      readSpaceDispatchTrace: {
        value: () => {
          insertDispatchOutboxRecord(state.storage.sql, record);
          return Promise.resolve(null);
        },
      },
    });
    const progress = await (
      instance as unknown as {
        readSpaceWakeProgress(input: {
          sourceSignalId: string;
          targetProfileId: string;
          includeWakeStopEligibility: boolean;
        }): Promise<GetSpaceWakeProgressResponse>;
      }
    ).readSpaceWakeProgress({
      sourceSignalId: record.sourceEventId,
      targetProfileId: record.targetProfileId,
      includeWakeStopEligibility: true,
    });
    expect(progress.items).toHaveLength(1);
    expect(progress.items[0]?.wakeStopEligibility).toMatchObject({
      status: "eligible",
      reliability: "native_cancel",
    });
  });
});

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
    // Native shared read has no admitted Worker row; Space SQLite owns retained Stop intent.
    const fixture = await createWorkerPostgresFixture(env);
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
        OPENMELD_POSTGRESQL: fixture.binding,
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
    const eligibility =
      await internal.readWakeProgressPreAgentWakeStopEligibility({
        clientMessageId: null,
        lookupMatch: null,
        trace: null,
        outboxRecord: readDispatchOutboxRecordByDispatchId(
          state.storage.sql,
          record.dispatchId
        ),
      });
    if (admission === "new") {
      expect(eligibility).toBeNull();
    } else {
      expect(eligibility).toMatchObject({
        status: "eligible",
        reliability: "native_cancel",
      });
    }
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
