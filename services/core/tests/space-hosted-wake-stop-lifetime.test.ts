import { runInDurableObject } from "cloudflare:test";
import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { AGENT_REPLY_FINAL_PURPOSE } from "@openmeld/schemas";
import type {
  PostSpaceWakeStopBody,
  PostSpaceWakeStopResponse,
  RemoteAgentWorkerCancellationRequest,
  RemoteAgentWorkerCancellationResponse,
  SpaceDispatchLookupMatch,
  WakeProgressItem,
} from "@openmeld/schemas/types";
import { expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  markRemoteAgentNativeDeliveryAck,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
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
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import type { Space } from "../src/space/transport/do/space";
import { env } from "../test-support/worker-env";
import { createWorkerPostgresFixture } from "./postgresql.test-support";

type StopOwner = {
  bindings: CoreBindings;
  buildWakeProgressItemFromOutboxEvidence(input: {
    clientMessageId: null;
    includeWakeStopEligibility: true;
    outboxRecord: NonNullable<
      ReturnType<typeof readDispatchOutboxRecordByDispatchId>
    >;
    sourceSignal: null;
    targetLabel: string;
    terminalFailureNotices: [];
  }): Promise<WakeProgressItem>;
  requestRemoteAgentNativeDeliveryStop(input: {
    body: PostSpaceWakeStopBody;
    lookupMatch: SpaceDispatchLookupMatch;
  }): Promise<PostSpaceWakeStopResponse | null>;
};

function seed(
  state: DurableObjectState,
  agentControllerRef: string,
  suffix = ""
) {
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
    sourceEventId: `source-${spaceId}${suffix}`,
    targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
    nowMs: now - 60_000,
  });
  insertSignalRecord(state.storage.sql, {
    v: 1,
    id: record.sourceEventId,
    spaceId,
    ts: now - 60_000,
    type: "signal.text",
    profile: {
      kind: "human",
      profileId: "22222222-2222-4222-8222-222222222222",
    },
    data: { text: "Start work" },
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
    const nativeSetAlarm = state.storage.setAlarm.bind(state.storage);
    vi.spyOn(state.storage, "setAlarm").mockImplementation((time) =>
      nativeSetAlarm(Math.max(Number(time), Date.now() + 3_600_000))
    );
    const { query, selection } = seed(state, controller);
    const internal = instance as unknown as StopOwner;
    const fixture = await createWorkerPostgresFixture(env);
    Object.defineProperty(instance, "bindings", {
      configurable: true,
      value: {
        ...internal.bindings,
        OPENMELD_POSTGRESQL: fixture.binding,
      },
    });
    state.storage.sql.exec(`CREATE TRIGGER fail_stopped_notice BEFORE INSERT ON space_signals
        BEGIN SELECT RAISE(ABORT, 'review_stop_notice_write_failed'); END;`);
    await expect(
      internal.requestRemoteAgentNativeDeliveryStop(selection)
    ).resolves.toMatchObject({
      ok: true,
      status: "cancellation_requested",
      cancellationState: { status: "requested" },
    });
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
    const outbox = readDispatchOutboxRecordByDispatchId(
      state.storage.sql,
      query.dispatchId
    );
    if (!outbox) {
      throw new Error("Missing retained Stop intent");
    }
    expect(
      await internal.buildWakeProgressItemFromOutboxEvidence({
        clientMessageId: null,
        includeWakeStopEligibility: true,
        outboxRecord: outbox,
        sourceSignal: null,
        targetLabel: "Agent",
        terminalFailureNotices: [],
      })
    ).toMatchObject({
      phase: "stopped",
      terminal: true,
      wakeStopEligibility: null,
    });
    await state.storage.deleteAlarm();
  });
});

function cancellationResponse(
  identity: RemoteAgentWorkerCancellationRequest,
  status: "cancellation_requested" | "not_stoppable" | "already_cancelled",
  executionStatus: "cancellation_requested" | "completed" | "aborted"
): RemoteAgentWorkerCancellationResponse {
  return {
    status,
    execution: {
      v: 1,
      organizationId: identity.organizationId,
      spaceId: identity.spaceId,
      submissionId: identity.submissionId,
      idempotencyKey: identity.idempotencyKey,
      acceptedAtMs: Date.now(),
      cancellationReason: null,
      completedAtMs:
        executionStatus === "cancellation_requested" ? null : Date.now(),
      lastProgressAtMs: Date.now(),
      lastProgressKind: "cancellation_requested",
      status: executionStatus,
    },
  };
}

async function admitTestDelivery(
  db: PostgresDatabase,
  record: ReturnType<typeof seed>["record"]
) {
  await upsertRemoteAgentNativeDeliveryRecord({
    db,
    nowMs: Date.now(),
    organizationId: "org-stop-review",
    spaceId: record.spaceId,
    profileId: record.targetProfileId,
    bindingId: "binding-review",
    triggerMessageId: record.sourceEventId,
    dispatchId: record.dispatchId,
    attemptId: null,
    idempotencyKey: record.idempotencyKey,
    status: "submitted",
  });
  await markRemoteAgentNativeDeliveryAck({
    db,
    nowMs: Date.now(),
    idempotencyKey: record.idempotencyKey,
    accepted: true,
    submissionId: record.dispatchId,
    workerRequestId: null,
  });
}

it.each([
  "not_found",
  "not_stoppable",
  "identity_mismatch",
  "terminal_identity_mismatch",
  "unconfirmed_abort",
  "transport_failure",
  "probe_failure",
] as const)("acknowledges persisted Stop honestly after %s", async (scenario) => {
  await runInDurableObject(newSpace(), async (instance, state) => {
    const nativeSetAlarm = state.storage.setAlarm.bind(state.storage);
    vi.spyOn(state.storage, "setAlarm").mockImplementation((time) =>
      nativeSetAlarm(Math.max(Number(time), Date.now() + 3_600_000))
    );
    const { record, query, selection } = seed(state, "hosted:remote-agent");
    const internal = instance as unknown as StopOwner;
    const fixture = await createWorkerPostgresFixture(env);
    const db = fixture.db;
    if (!db) {
      throw new Error("Missing test PostgreSQL binding");
    }
    await instance.rpcAuthorizeNativeWakeAdmission(query);
    await admitTestDelivery(db, record);
    const cancelExecution = vi.fn(
      (
        identity: RemoteAgentWorkerCancellationRequest
      ): Promise<RemoteAgentWorkerCancellationResponse> => {
        if (scenario === "transport_failure") {
          return Promise.reject(new Error("test_cancel_unavailable"));
        }
        if (scenario === "not_found") {
          return Promise.resolve({ status: "not_found" });
        }
        if (scenario === "identity_mismatch") {
          return Promise.resolve({
            status: "identity_mismatch",
            reasonCode: "remote_agent.execution_identity_mismatch",
          });
        }
        if (scenario === "not_stoppable") {
          return Promise.resolve(
            cancellationResponse(identity, "not_stoppable", "completed")
          );
        }
        if (scenario === "terminal_identity_mismatch") {
          return Promise.resolve(
            cancellationResponse(
              { ...identity, submissionId: "unrelated-submission" },
              "already_cancelled",
              "aborted"
            )
          );
        }
        if (scenario === "unconfirmed_abort") {
          return Promise.resolve(
            cancellationResponse(
              identity,
              "already_cancelled",
              "cancellation_requested"
            )
          );
        }
        return Promise.resolve(
          cancellationResponse(
            identity,
            "cancellation_requested",
            "cancellation_requested"
          )
        );
      }
    );
    Object.defineProperty(instance, "bindings", {
      configurable: true,
      value: {
        ...internal.bindings,
        OPENMELD_POSTGRESQL: fixture.binding,
        OPENMELD_DAEMON_DISPATCH_QUEUE: {
          send: vi.fn(() => {
            if (scenario === "probe_failure") {
              return Promise.reject(new Error("test_probe_unavailable"));
            }
            return Promise.resolve();
          }),
        },
        OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
      },
    });
    const result =
      await internal.requestRemoteAgentNativeDeliveryStop(selection);
    expect(result).toMatchObject({
      ok: true,
      status:
        scenario === "not_stoppable" ? "cancelled" : "cancellation_requested",
    });
    expect(cancelExecution).toHaveBeenCalledOnce();
    expect(await instance.rpcReadWakeStopIntent(query)).toEqual({
      status: "requested",
    });
    expect(
      await instance.rpcReadFinalReplyClaimOutcome({
        ...query,
        profileId: query.targetProfileId,
      })
    ).toMatchObject({
      outcome: scenario === "not_stoppable" ? "stopped" : null,
    });
    await state.storage.deleteAlarm();
  });
});

it.each([
  "hosted:remote-agent",
  "hosted:center-agent",
])("recovers a legacy %s Stop when native evidence arrives after the request", async (controller) => {
  await runInDurableObject(newSpace(), async (instance, state) => {
    const nativeSetAlarm = state.storage.setAlarm.bind(state.storage);
    vi.spyOn(state.storage, "setAlarm").mockImplementation((time) =>
      nativeSetAlarm(Math.max(Number(time), Date.now() + 3_600_000))
    );
    const { record, query, selection } = seed(state, controller);
    const internal = instance as unknown as StopOwner;
    const fixture = await createWorkerPostgresFixture(env);
    const db = fixture.db;
    if (!db) {
      throw new Error("Missing test PostgreSQL binding");
    }
    state.storage.sql.exec(
      "UPDATE openMeldDaemon_outbox SET native_admission_started_at_ms = NULL WHERE dispatch_id = ?",
      record.dispatchId
    );
    const submitConversationTurn = vi.fn();
    const cancelExecution = vi.fn(
      async (identity: RemoteAgentWorkerCancellationRequest) =>
        cancellationResponse(identity, "already_cancelled", "aborted")
    );
    Object.defineProperty(instance, "bindings", {
      configurable: true,
      value: {
        ...internal.bindings,
        OPENMELD_POSTGRESQL: fixture.binding,
        OPENMELD_DAEMON_DISPATCH_QUEUE: { send: vi.fn(async () => undefined) },
        OPENMELD_REMOTE_AGENT_WORKER: {
          cancelExecution,
          submitConversationTurn,
        },
      },
    });
    expect(
      await internal.requestRemoteAgentNativeDeliveryStop(selection)
    ).toMatchObject({ status: "cancellation_requested" });
    await instance.alarm();
    expect(
      await instance.rpcReadFinalReplyClaimOutcome({
        ...query,
        profileId: query.targetProfileId,
      })
    ).toMatchObject({ outcome: null });
    expect(await state.storage.getAlarm()).not.toBeNull();
    expect(cancelExecution).not.toHaveBeenCalled();
    await admitTestDelivery(db, record);
    await instance.alarm();
    await instance.alarm();
    expect(
      await instance.rpcReadFinalReplyClaimOutcome({
        ...query,
        profileId: query.targetProfileId,
      })
    ).toMatchObject({ outcome: "stopped" });
    expect(cancelExecution).toHaveBeenCalledOnce();
    expect(submitConversationTurn).not.toHaveBeenCalled();
    await state.storage.deleteAlarm();
  });
});

it("does not let unresolved legacy Stops starve later cancellation recovery", async () => {
  await runInDurableObject(newSpace(), async (instance, state) => {
    const nativeSetAlarm = state.storage.setAlarm.bind(state.storage);
    vi.spyOn(state.storage, "setAlarm").mockImplementation((time) =>
      nativeSetAlarm(Math.max(Number(time), Date.now() + 3_600_000))
    );
    const internal = instance as unknown as StopOwner;
    const fixture = await createWorkerPostgresFixture(env);
    const db = fixture.db;
    if (!db) {
      throw new Error("Missing test PostgreSQL binding");
    }
    const records = Array.from(
      { length: 9 },
      (_, index) => seed(state, "hosted:remote-agent", `-fair-${index}`).record
    ).sort((a, b) => a.dispatchId.localeCompare(b.dispatchId));
    const last = records.at(-1);
    if (!last) {
      throw new Error("Missing final cancellation fixture");
    }
    for (const record of records) {
      state.storage.sql.exec(
        "UPDATE openMeldDaemon_outbox SET status = 'cancelled', native_admission_started_at_ms = NULL WHERE dispatch_id = ?",
        record.dispatchId
      );
    }
    await admitTestDelivery(db, last);
    const submitConversationTurn = vi.fn();
    const cancelExecution = vi.fn(
      async (identity: RemoteAgentWorkerCancellationRequest) =>
        cancellationResponse(identity, "already_cancelled", "aborted")
    );
    Object.defineProperty(instance, "bindings", {
      configurable: true,
      value: {
        ...internal.bindings,
        OPENMELD_POSTGRESQL: fixture.binding,
        OPENMELD_DAEMON_DISPATCH_QUEUE: { send: vi.fn(async () => undefined) },
        OPENMELD_REMOTE_AGENT_WORKER: {
          cancelExecution,
          submitConversationTurn,
        },
      },
    });
    await instance.alarm();
    expect(cancelExecution).not.toHaveBeenCalled();
    await instance.alarm();
    expect(cancelExecution).toHaveBeenCalledOnce();
    expect(
      await instance.rpcReadFinalReplyClaimOutcome({
        spaceId: last.spaceId,
        dispatchId: last.dispatchId,
        profileId: last.targetProfileId,
      })
    ).toMatchObject({ outcome: "stopped" });
    expect(submitConversationTurn).not.toHaveBeenCalled();
    await state.storage.deleteAlarm();
  });
});

it("preserves an already published final answer instead of accepting a contradictory Stop", async () => {
  await runInDurableObject(newSpace(), async (instance, state) => {
    const nativeSetAlarm = state.storage.setAlarm.bind(state.storage);
    vi.spyOn(state.storage, "setAlarm").mockImplementation((time) =>
      nativeSetAlarm(Math.max(Number(time), Date.now() + 3_600_000))
    );
    const { record, query, selection } = seed(state, "hosted:remote-agent");
    const internal = instance as unknown as StopOwner;
    const fixture = await createWorkerPostgresFixture(env);
    const db = fixture.db;
    if (!db) {
      throw new Error("Missing test PostgreSQL binding");
    }
    await admitTestDelivery(db, record);
    const cancelExecution = vi.fn();
    Object.defineProperty(instance, "bindings", {
      configurable: true,
      value: {
        ...internal.bindings,
        OPENMELD_POSTGRESQL: fixture.binding,
        OPENMELD_REMOTE_AGENT_WORKER: { cancelExecution },
      },
    });
    const id = `answer-${record.dispatchId}`;
    insertSignalRecord(state.storage.sql, {
      v: 1,
      id,
      spaceId: record.spaceId,
      ts: Date.now(),
      type: "signal.text",
      profile: { kind: "agent", profileId: record.targetProfileId },
      data: {
        text: "Already completed.",
        meta: {
          purpose: AGENT_REPLY_FINAL_PURPOSE,
          dispatchId: record.dispatchId,
          targetProfileId: record.targetProfileId,
        },
      },
    });
    expect(
      await instance.rpcReadFinalReplyClaimOutcome({
        ...query,
        profileId: query.targetProfileId,
      })
    ).toMatchObject({ signalId: id });
    expect(
      await internal.requestRemoteAgentNativeDeliveryStop(selection)
    ).toMatchObject({ status: "not_stoppable" });
    expect(
      await instance.rpcReadFinalReplyClaimOutcome({
        ...query,
        profileId: query.targetProfileId,
      })
    ).toMatchObject({ signalId: id });
    expect(await instance.rpcReadWakeStopIntent(query)).toEqual({
      status: "not_requested",
    });
    expect(cancelExecution).not.toHaveBeenCalled();
    await state.storage.deleteAlarm();
  });
});

it.each([
  "accepted",
  "submitted",
] as const)("keeps a legacy %s native delivery observable and stoppable after its outbox was retired", async (status) => {
  await runInDurableObject(newSpace(), async (instance, state) => {
    const nativeSetAlarm = state.storage.setAlarm.bind(state.storage);
    vi.spyOn(state.storage, "setAlarm").mockImplementation((time) =>
      nativeSetAlarm(Math.max(Number(time), Date.now() + 3_600_000))
    );
    const { record, query, selection } = seed(state, "hosted:remote-agent");
    const internal = instance as unknown as StopOwner;
    const fixture = await createWorkerPostgresFixture(env);
    const db = fixture.db;
    if (!db) {
      throw new Error("Missing test PostgreSQL binding");
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
        OPENMELD_POSTGRESQL: fixture.binding,
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
