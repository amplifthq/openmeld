import { env, runInDurableObject } from "cloudflare:test";
import type { Profile, SignalEnvelope } from "@openmeld/protocol";
import type {
  RemoteAgentWorkerExecutionInputRequest,
  RemoteAgentWorkerSubmitTurnRequestV1,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  markRemoteAgentNativeDeliveryAck,
  persistRemoteAgentWorkerSubmitRequest,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { upsertSpaceCreatorMember } from "../src/space/application/space-members-service";
import type { SignalPublishContext } from "../src/space/application/types";
import {
  readNextSpaceExecutionInputAlarm,
  readSpaceExecutionInput,
} from "../src/space/infrastructure/sql/space-execution-input-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import type { Space } from "../src/space/transport/do/space";

type InputSpace = {
  bindings: CoreBindings;
  spaceId: string;
  publishExecutionInput(
    signal: SignalEnvelope,
    context: SignalPublishContext
  ): Promise<void>;
  flushPendingExecutionInputs(): Promise<void>;
  recordOrganizationMemberHumanActivity(): Promise<void>;
  flushPendingSpaceInboxProjectionOutbox(): Promise<void>;
  syncSpaceBackgroundAlarm(): Promise<void>;
};

async function fixture(
  run: (f: {
    instance: InputSpace;
    state: DurableObjectState;
    signal: SignalEnvelope;
    request: RemoteAgentWorkerSubmitTurnRequestV1;
    post: (signal?: SignalEnvelope) => Promise<void>;
  }) => Promise<void>
) {
  const namespace = env.OPENMELD_SPACES as DurableObjectNamespace<Space>;
  const id = namespace.newUniqueId();
  const spaceId = id.toString();
  const profile: Profile = {
    kind: "human",
    profileId: crypto.randomUUID(),
    profileName: "Morgan",
  };
  const request: RemoteAgentWorkerSubmitTurnRequestV1 = {
    v: 1,
    agentProfileId: `agt_${crypto.randomUUID()}`,
    agentProfileOwnerUserId: "owner",
    author: {
      profileId: profile.profileId,
      profileKind: "human",
      displayName: "Morgan",
    },
    bindingId: crypto.randomUUID(),
    dispatchId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    messages: [{ role: "user", content: "Analyze all customers." }],
    onBehalfOf: null,
    organizationId: crypto.randomUUID(),
    sourceClientMessageId: crypto.randomUUID(),
    spaceId,
    triggerMessageId: crypto.randomUUID(),
    turnEnvelope: {
      sender: {
        kind: "member",
        id: "member",
        displayName: "Morgan",
        ownerUserId: "owner",
        profileId: profile.profileId,
        role: "owner",
        verified: true,
      },
      space: {
        id: spaceId,
        name: "Center chat",
        kind: "dm",
        isCenterAgentDm: true,
      },
      organization: {
        id: "organization",
        name: "Staging",
        personal: true,
        memberCount: 1,
      },
      centerAgent: { profileName: "Center", profileHandle: "center" },
      trigger: { source: "web_dm" },
    },
  };
  await upsertRemoteAgentNativeDeliveryRecord({
    db: env.OPENMELD_DB,
    nowMs: Date.now(),
    organizationId: request.organizationId,
    spaceId,
    profileId: request.agentProfileId,
    bindingId: request.bindingId,
    triggerMessageId: request.triggerMessageId,
    dispatchId: request.dispatchId,
    attemptId: null,
    idempotencyKey: request.idempotencyKey,
    status: "submitted",
  });
  await persistRemoteAgentWorkerSubmitRequest({
    db: env.OPENMELD_DB,
    idempotencyKey: request.idempotencyKey,
    nowMs: Date.now(),
    workerSubmitRequest: request,
  });
  await markRemoteAgentNativeDeliveryAck({
    db: env.OPENMELD_DB,
    idempotencyKey: request.idempotencyKey,
    nowMs: Date.now(),
    submissionId: crypto.randomUUID(),
    accepted: true,
  });
  await runInDurableObject(namespace.get(id), async (object, state) => {
    const instance = object as unknown as InputSpace;
    instance.spaceId = spaceId;
    const creator = { ...profile, ownerUserId: "owner" };
    upsertSpaceMetaRecord(state.storage.sql, {
      v: 1,
      spaceId,
      name: "Center chat",
      organizationId: request.organizationId,
      creator,
      visibility: "private",
      accessMode: "members_only",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    upsertSpaceCreatorMember({ sql: state.storage.sql, spaceId, creator });
    vi.spyOn(
      instance,
      "recordOrganizationMemberHumanActivity"
    ).mockResolvedValue();
    vi.spyOn(
      instance,
      "flushPendingSpaceInboxProjectionOutbox"
    ).mockResolvedValue();
    vi.spyOn(instance, "syncSpaceBackgroundAlarm").mockResolvedValue();
    vi.spyOn(instance, "flushPendingExecutionInputs").mockResolvedValue();
    const signal: SignalEnvelope = {
      v: 1,
      id: crypto.randomUUID(),
      ts: Date.now(),
      spaceId,
      profile,
      type: "signal.text",
      data: {
        text: "Only analyze North America.",
        meta: {
          clientMessageId: crypto.randomUUID(),
          centerAgentExecutionInput: {
            dispatchId: request.dispatchId,
            targetProfileId: request.agentProfileId,
          },
        },
      },
    };
    try {
      await run({
        instance,
        state,
        signal,
        request,
        post: (next = signal) =>
          instance.publishExecutionInput(next, {
            authoringPolicy: "user_authored",
          }),
      });
    } finally {
      await state.storage.deleteAlarm();
      vi.restoreAllMocks();
    }
  });
}

describe("Center Agent execution input in the Space owner", () => {
  it("shows one unconfirmed-input notice without claiming the original execution failed", async () => {
    await fixture(async ({ instance, state, request, post }) => {
      await post();
      vi.mocked(instance.flushPendingExecutionInputs).mockRestore();
      instance.bindings = {
        ...instance.bindings,
        OPENMELD_REMOTE_AGENT_WORKER: {
          receiveExecutionInput: async (input) => ({
            status: "unconfirmed",
            receipt: {
              target: input.target,
              inputId: input.inputId,
              receivedAtMs: 1,
              appliedAtMs: null,
            },
          }),
        },
      };
      await instance.flushPendingExecutionInputs();
      const notices = state.storage.sql
        .exec<{ payload_json: string }>(
          "SELECT payload_json FROM space_signals WHERE type = 'signal.system_notice'"
        )
        .toArray();
      expect(notices).toHaveLength(1);
      const notice = JSON.parse(notices[0]?.payload_json ?? "null");
      expect(notice.data.text).toContain("update wasn't confirmed");
      expect(notice.data.dispatchId).not.toBe(request.dispatchId);
      expect(readNextSpaceExecutionInputAlarm(state.storage.sql)).toBeNull();
      await post();
      expect(
        state.storage.sql
          .exec<{ n: number }>(
            "SELECT count(*) AS n FROM space_signals WHERE type = 'signal.text'"
          )
          .toArray()[0]?.n
      ).toBe(1);
    });
  });

  it("atomically persists one message and one exact target across concurrent retries", async () => {
    await fixture(async ({ state, signal, post }) => {
      await Promise.all([post(), post({ ...signal, id: crypto.randomUUID() })]);
      const rows = state.storage.sql
        .exec<{ n: number }>(
          "SELECT count(*) AS n FROM space_signals WHERE type = 'signal.text'"
        )
        .toArray();
      expect(rows[0]?.n).toBe(1);
      expect(
        state.storage.sql
          .exec<{ n: number }>(
            "SELECT count(*) AS n FROM space_execution_input_outbox"
          )
          .toArray()[0]?.n
      ).toBe(1);
      expect(
        readNextSpaceExecutionInputAlarm(state.storage.sql)
      ).not.toBeNull();
    });
  });

  it("rolls back the visible message if durable intake cannot be saved", async () => {
    await fixture(async ({ state, post }) => {
      state.storage.sql.exec(
        "CREATE TRIGGER fail_input BEFORE INSERT ON space_execution_input_outbox BEGIN SELECT RAISE(ABORT, 'input store unavailable'); END"
      );
      await expect(post()).rejects.toThrow("input store unavailable");
      expect(
        state.storage.sql
          .exec<{ n: number }>("SELECT count(*) AS n FROM space_signals")
          .toArray()[0]?.n
      ).toBe(0);
      expect(readNextSpaceExecutionInputAlarm(state.storage.sql)).toBeNull();
    });
  });

  it("rejects another member and a late new input without creating queued work", async () => {
    await fixture(async ({ state, signal, request, post }) => {
      await expect(
        post({
          ...signal,
          profile: { ...signal.profile, profileId: crypto.randomUUID() },
        })
      ).rejects.toThrow("cannot receive");
      await env.OPENMELD_DB.prepare(
        "UPDATE openMeldRemoteAgent_native_delivery_ledger SET status = 'completed' WHERE idempotency_key = ?"
      )
        .bind(request.idempotencyKey)
        .run();
      await expect(post()).rejects.toThrow("cannot receive");
      expect(readNextSpaceExecutionInputAlarm(state.storage.sql)).toBeNull();
    });
  });

  it("retries the same durable request and retires it only after runtime application", async () => {
    await fixture(async ({ instance, state, signal, post }) => {
      await post();
      vi.mocked(instance.flushPendingExecutionInputs).mockRestore();
      const receive = vi.fn(
        async (input: RemoteAgentWorkerExecutionInputRequest) => ({
          status: "applied" as const,
          receipt: {
            target: input.target,
            inputId: input.inputId,
            receivedAtMs: 1,
            appliedAtMs: 2,
          },
        })
      );
      receive.mockRejectedValueOnce(new Error("lost connection"));
      instance.bindings = {
        ...instance.bindings,
        OPENMELD_REMOTE_AGENT_WORKER: { receiveExecutionInput: receive },
      };
      await instance.flushPendingExecutionInputs();
      expect(
        readNextSpaceExecutionInputAlarm(state.storage.sql)
      ).not.toBeNull();
      state.storage.sql.exec(
        "UPDATE space_execution_input_outbox SET next_attempt_at_ms = 0"
      );
      await instance.flushPendingExecutionInputs();
      expect(receive).toHaveBeenCalledTimes(2);
      expect(receive.mock.calls[0]).toEqual(receive.mock.calls[1]);
      expect(readNextSpaceExecutionInputAlarm(state.storage.sql)).toBeNull();
      if (signal.type !== "signal.text" || !signal.data.meta?.clientMessageId) {
        throw new Error("Missing fixture input id");
      }
      expect(
        readSpaceExecutionInput(
          state.storage.sql,
          signal.data.meta.clientMessageId
        )?.signal.id
      ).toBe(signal.id);
    });
  });
});
