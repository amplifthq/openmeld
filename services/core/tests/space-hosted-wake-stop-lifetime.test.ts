import { env, runInDurableObject } from "cloudflare:test";
import type {
  PostSpaceWakeStopBody,
  PostSpaceWakeStopResponse,
  SpaceDispatchLookupMatch,
} from "@openmeld/schemas/types";
import { expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  markRemoteAgentNativeDeliveryAck,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  createDispatchOutboxRecord,
  deleteDispatchOutboxRecord,
  insertDispatchOutboxRecord,
  markDispatchOutboxCancelled,
  markDispatchOutboxHandedOff,
  readDispatchOutboxRecordByDispatchId,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";
import type { Space } from "../src/space/transport/do/space";

type StopOwner = {
  bindings: CoreBindings;
  requestRemoteAgentNativeDeliveryStop(input: {
    body: PostSpaceWakeStopBody;
    lookupMatch: SpaceDispatchLookupMatch;
  }): Promise<PostSpaceWakeStopResponse | null>;
};

function seed(state: DurableObjectState, agentControllerRef: string) {
  const now = Date.now();
  const spaceId = state.id.toString();
  upsertSpaceMetaRecord(state.storage.sql, {
    v: 1,
    spaceId,
    organizationId: "org-stop-review",
    visibility: "private",
    accessMode: "public",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  });
  const record = createDispatchOutboxRecord({
    bindingState: "bound",
    bindingEnabled: true,
    agentControllerRef,
    dispatchPolicy: "mention_only",
    ruleId: "stop-review",
    ruleReason: "test",
    ruleSource: "system",
    sourceSignalSnapshot: {
      profileId: "22222222-2222-4222-8222-222222222222",
      profileKind: "human",
      text: "Start work",
    },
    senderProfileId: "22222222-2222-4222-8222-222222222222",
    spaceId,
    sourceEventId: `source-${spaceId}`,
    targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
    nowMs: now - 60_000,
  });
  insertDispatchOutboxRecord(state.storage.sql, record);
  const query = {
    spaceId,
    dispatchId: record.dispatchId,
    targetProfileId: record.targetProfileId,
  };
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
  return { record, query, selection };
}

function newSpace() {
  const namespace = (env as unknown as CoreBindings)
    .OPENMELD_SPACES as DurableObjectNamespace<Space>;
  return namespace.get(namespace.newUniqueId());
}

it("upgrades a v47 Space without treating retained work as never admitted", async () => {
  await runInDurableObject(newSpace(), (_instance, state) => {
    const { record } = seed(state, "hosted:remote-agent");
    state.storage.sql.exec(
      "ALTER TABLE openMeldDaemon_outbox DROP COLUMN native_admission_started_at_ms"
    );
    state.storage.sql.exec("DELETE FROM schema_migrations WHERE version >= 47");
    state.storage.sql.exec(
      "INSERT INTO schema_migrations(version, checksum, applied_at) VALUES (47, 'space-sql-schema-v47', ?)",
      Date.now()
    );
    ensureSpaceSqlSchema(state.storage.sql);
    ensureSpaceSqlSchema(state.storage.sql);
    const retained = state.storage.sql
      .exec<{ exposure: number | null; payload_json: string }>(
        "SELECT native_admission_started_at_ms AS exposure, payload_json FROM openMeldDaemon_outbox WHERE dispatch_id = ?",
        record.dispatchId
      )
      .toArray()[0];
    expect(retained).toEqual({
      exposure: null,
      payload_json: record.payloadJson,
    });
    state.storage.sql.exec(
      "DELETE FROM openMeldDaemon_outbox WHERE dispatch_id = ?",
      record.dispatchId
    );
    const newer = seed(state, "hosted:center-agent").record;
    expect(
      state.storage.sql
        .exec<{ exposure: number | null }>(
          "SELECT native_admission_started_at_ms AS exposure FROM openMeldDaemon_outbox WHERE dispatch_id = ?",
          newer.dispatchId
        )
        .toArray()[0]?.exposure
    ).toBe(0);
  });
});

it.each([
  "hosted:remote-agent",
  "hosted:center-agent",
])("repairs an unadmitted %s stopped notice after SQL failure without another Stop click", async (controller) => {
  const shard = newSpace();
  await runInDurableObject(shard, async (instance, state) => {
    const { query, selection } = seed(state, controller);
    const internal = instance as unknown as StopOwner;
    const emptyDb = {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    } as unknown as D1Database;
    Object.defineProperty(instance, "bindings", {
      configurable: true,
      value: {
        ...internal.bindings,
        OPENMELD_LOCAL_STATE_DB: emptyDb,
        OPENMELD_DB: emptyDb,
      },
    });
    state.storage.sql.exec(`CREATE TRIGGER fail_stopped_notice BEFORE INSERT ON space_signals
        BEGIN SELECT RAISE(ABORT, 'review_stop_notice_write_failed'); END;`);
    await expect(
      internal.requestRemoteAgentNativeDeliveryStop(selection)
    ).rejects.toThrow("review_stop_notice_write_failed");
    state.storage.sql.exec("DROP TRIGGER fail_stopped_notice");
    expect(await instance.rpcReadWakeStopIntent(query)).toEqual({
      status: "requested",
    });
    expect(await state.storage.getAlarm()).not.toBeNull();
    await instance.alarm();
    await instance.alarm();
    expect(
      await instance.rpcReadFinalReplyClaimOutcome({
        ...query,
        profileId: query.targetProfileId,
      })
    ).toMatchObject({ outcome: "stopped" });
    const notices = state.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM space_signals WHERE type = 'signal.system_notice'"
      )
      .toArray();
    expect(notices[0]?.count).toBe(1);
    await state.storage.deleteAlarm();
  });
});

it.each([
  "accepted",
  "submitted",
] as const)("keeps a legacy %s native delivery observable and stoppable after its outbox was retired", async (status) => {
  await runInDurableObject(newSpace(), async (instance, state) => {
    const { record, query, selection } = seed(state, "hosted:remote-agent");
    const internal = instance as unknown as StopOwner;
    const db = (env as unknown as CoreBindings).OPENMELD_DB;
    if (!db) {
      throw new Error("Missing test D1 binding");
    }
    const cancelExecution = vi.fn(async (identity) => ({
      status: "cancellation_requested" as const,
      execution: {
        ...identity,
        acceptedAtMs: Date.now(),
        cancellationReason: null,
        completedAtMs: null,
        lastProgressAtMs: Date.now(),
        lastProgressKind: "cancellation_requested",
        status: "cancellation_requested",
      },
    }));
    Object.defineProperty(instance, "bindings", {
      configurable: true,
      value: {
        ...internal.bindings,
        OPENMELD_LOCAL_STATE_DB: db,
        OPENMELD_DB: db,
        OPENMELD_DAEMON_DISPATCH_QUEUE: { send: vi.fn(async () => undefined) },
        OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
      },
    });
    await upsertRemoteAgentNativeDeliveryRecord({
      db,
      nowMs: Date.now(),
      organizationId: "org-stop-review",
      spaceId: record.spaceId,
      profileId: record.targetProfileId,
      bindingId: "binding-review",
      triggerMessageId: record.sourceEventId,
      triggerText: "Start work",
      dispatchId: record.dispatchId,
      attemptId: null,
      idempotencyKey: record.idempotencyKey,
      status: "submitted",
    });
    if (status === "accepted") {
      await markRemoteAgentNativeDeliveryAck({
        db,
        nowMs: Date.now(),
        idempotencyKey: record.idempotencyKey,
        accepted: true,
        submissionId: record.dispatchId,
        workerRequestId: null,
      });
    }
    markDispatchOutboxHandedOff(state.storage.sql, {
      dispatchId: record.dispatchId,
      handedOffAtMs: Date.now() - 30_000,
    });
    // The previously shipped cleanup physically retired these rows. Test
    // upgrade continuity as well as retaining rows in the new redrive policy.
    deleteDispatchOutboxRecord(state.storage.sql, {
      dispatchId: record.dispatchId,
    });
    expect(
      readDispatchOutboxRecordByDispatchId(state.storage.sql, record.dispatchId)
    ).toBeNull();
    expect(await instance.rpcReadWakeStopIntent(query)).toEqual({
      status: "not_requested",
    });
    expect(await instance.rpcAuthorizeNativeWakeAdmission(query)).toEqual({
      status: "not_requested",
    });
    expect(
      await internal.requestRemoteAgentNativeDeliveryStop(selection)
    ).toMatchObject({ status: "cancellation_requested" });
    expect(await instance.rpcReadWakeStopIntent(query)).toEqual({
      status: "requested",
    });
    expect(await instance.rpcAuthorizeNativeWakeAdmission(query)).toEqual({
      status: "requested",
    });
    expect(
      await instance.rpcReadWakeStopIntent({
        ...query,
        targetProfileId: "another-agent",
      })
    ).toEqual({ status: "not_found" });
    expect(cancelExecution).toHaveBeenCalledTimes(
      status === "accepted" ? 1 : 0
    );
    // A stale recovery candidate must never erase a Stop that won meanwhile.
    markDispatchOutboxCancelled(state.storage.sql, {
      dispatchId: record.dispatchId,
    });
    deleteDispatchOutboxRecord(state.storage.sql, {
      dispatchId: record.dispatchId,
    });
    expect(await instance.rpcReadWakeStopIntent(query)).toEqual({
      status: "requested",
    });
    await state.storage.deleteAlarm();
  });
});
