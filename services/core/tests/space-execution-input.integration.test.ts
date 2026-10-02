import { env, runInDurableObject } from "cloudflare:test";
import type { Profile, SignalEnvelope } from "@openmeld/protocol";
import type {
  RemoteAgentWorkerExecutionInputRequest,
  RemoteAgentWorkerExecutionInputResponse,
  RemoteAgentWorkerSubmitTurnRequestV1,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  markRemoteAgentNativeDeliveryAck,
  persistRemoteAgentWorkerSubmitRequest,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import type { CoreRpcContextInput } from "../src/rpc/methods";
import {
  upsertJoinedSpaceMember,
  upsertSpaceCreatorMember,
} from "../src/space/application/space-members-service";
import type { SignalPublishContext } from "../src/space/application/types";
import {
  listQueuedSpaceExecutionInputs,
  readNextSpaceExecutionInputAlarm,
  readSpaceExecutionInput,
} from "../src/space/infrastructure/sql/space-execution-input-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import type { Space } from "../src/space/transport/do/space";

type InputSpace = {
  bindings: CoreBindings;
  spaceId: string;
  publishExecutionInput(
    signal: SignalEnvelope,
    context: SignalPublishContext,
    queued?: boolean
  ): Promise<void>;
  handleInputQueue(
    body: unknown,
    context: CoreRpcContextInput
  ): Promise<Response>;
  steerQueuedExecutionInput(inputId: string): Promise<void>;
  flushPendingExecutionInputs(): Promise<void>;
  flushQueuedSpaceInputs(): Promise<void>;
  flushPendingDispatchOutbox(): Promise<void>;
  readSpaceCallerContext(): Promise<{
    relationship: "internal" | "external";
    spaceRole: "member";
    audience: "organization";
  }>;
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
    context: CoreRpcContextInput;
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
    upsertJoinedSpaceMember({
      sql: state.storage.sql,
      spaceId,
      ownerUserId: "owner",
      profile: {
        kind: "agent",
        profileId: request.agentProfileId,
        profileName: "Center",
        agentControllerRef: "hosted:center-agent",
      },
    });
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
        context: {
          activeOrganizationId: request.organizationId,
          actorContext: {
            requestId: crypto.randomUUID(),
            openMeldProfileId: profile.profileId,
            profileKind: "human",
            profileName: "Morgan",
            ownerUserId: "owner",
            callerPrincipalId: "owner",
          },
        },
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
  it("atomically hands the first queued message to the normal outbox and replays without another dispatch", async () => {
    await fixture(async ({ instance, state, signal, request }) => {
      if (signal.type !== "signal.text") {
        throw new Error("Expected a text input.");
      }
      await instance.publishExecutionInput(
        signal,
        { authoringPolicy: "user_authored" },
        true
      );
      const second = structuredClone(signal);
      second.id = crypto.randomUUID();
      second.data.meta = {
        ...second.data.meta,
        clientMessageId: crypto.randomUUID(),
      };
      await instance.publishExecutionInput(
        second,
        { authoringPolicy: "user_authored" },
        true
      );
      vi.spyOn(instance, "flushPendingDispatchOutbox").mockResolvedValue();
      vi.spyOn(instance, "readSpaceCallerContext").mockResolvedValue({
        relationship: "internal",
        spaceRole: "member",
        audience: "organization",
      });
      await instance.flushQueuedSpaceInputs();
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toHaveLength(2);
      insertSignalRecord(state.storage.sql, {
        v: 1,
        id: crypto.randomUUID(),
        spaceId: signal.spaceId,
        ts: Date.now(),
        profile: {
          kind: "agent",
          profileId: request.agentProfileId,
          profileName: "Center",
        },
        type: "signal.text",
        data: {
          text: "Done",
          meta: {
            purpose: "agent_reply_final",
            dispatchId: request.dispatchId,
            targetProfileId: request.agentProfileId,
          },
        },
      });
      // A database failure after claiming must roll back both the claim and message.
      state.storage.sql.exec(
        `CREATE TRIGGER fail_queue_handoff BEFORE INSERT ON openMeldDaemon_outbox BEGIN SELECT RAISE(ABORT, 'handoff unavailable'); END`
      );
      await expect(instance.flushQueuedSpaceInputs()).rejects.toThrow(
        "handoff unavailable"
      );
      expect(
        listQueuedSpaceExecutionInputs(state.storage.sql).map(
          (row) => row.state
        )
      ).toEqual(["queued", "queued"]);
      expect(
        state.storage.sql
          .exec("SELECT id FROM space_signals WHERE id = ?", signal.id)
          .toArray()
      ).toEqual([]);
      state.storage.sql.exec("DROP TRIGGER fail_queue_handoff");
      await instance.flushQueuedSpaceInputs();
      await instance.flushQueuedSpaceInputs();
      const dispatches = state.storage.sql
        .exec<{ dispatch_id: string }>(
          "SELECT dispatch_id FROM openMeldDaemon_outbox WHERE source_event_id = ?",
          signal.id
        )
        .toArray();
      expect(dispatches).toHaveLength(1);
      const pending = listQueuedSpaceExecutionInputs(state.storage.sql);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.signal.id).toBe(second.id);
      expect(pending[0]?.afterDispatchId).toBe(dispatches[0]?.dispatch_id);
      const rows = state.storage.sql
        .exec("SELECT id FROM space_signals WHERE id = ?", signal.id)
        .toArray();
      expect(rows).toHaveLength(1);
      const nextDispatch = dispatches[0];
      if (!nextDispatch) {
        throw new Error("Expected one dispatch.");
      }
      insertSignalRecord(state.storage.sql, {
        v: 1,
        id: crypto.randomUUID(),
        spaceId: signal.spaceId,
        ts: Date.now(),
        profile: {
          kind: "agent",
          profileId: request.agentProfileId,
          profileName: "Center",
        },
        type: "signal.text",
        data: {
          text: "Next done",
          meta: {
            purpose: "agent_reply_final",
            dispatchId: nextDispatch.dispatch_id,
            targetProfileId: request.agentProfileId,
          },
        },
      });
      vi.mocked(instance.readSpaceCallerContext).mockResolvedValue({
        relationship: "external",
        spaceRole: "member",
        audience: "organization",
      });
      await instance.flushQueuedSpaceInputs();
      expect(
        listQueuedSpaceExecutionInputs(state.storage.sql)[0]?.blocked
      ).toBe(true);
      expect(
        state.storage.sql
          .exec("SELECT dispatch_id FROM openMeldDaemon_outbox")
          .toArray()
      ).toHaveLength(1);
    });
  });

  it.each([
    "wake_stopped",
    "terminal_failure",
  ] as const)("keeps pending messages after %s instead of starting another Wake", async (noticeType) => {
    await fixture(async ({ instance, state, signal, request }) => {
      await instance.publishExecutionInput(
        signal,
        { authoringPolicy: "user_authored" },
        true
      );
      insertSignalRecord(state.storage.sql, {
        v: 1,
        id: crypto.randomUUID(),
        spaceId: signal.spaceId,
        ts: Date.now(),
        profile: {
          kind: "system",
          profileId: "system",
          profileName: "OpenMeld",
        },
        type: "signal.system_notice",
        data: {
          text: "Request ended",
          noticeType,
          generatedBy: "openmeld",
          actorProfileId: request.agentProfileId,
          dispatchId: request.dispatchId,
        },
      });
      await instance.flushQueuedSpaceInputs();
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toMatchObject([
        { state: "queued", blocked: true },
      ]);
      expect(
        state.storage.sql
          .exec("SELECT dispatch_id FROM openMeldDaemon_outbox")
          .toArray()
      ).toEqual([]);
    });
  });
  it.each([
    "delete_first",
    "steer_first",
  ] as const)("linearizes delete versus native delivery when %s", async (order) => {
    await fixture(async ({ instance, state, signal, context }) => {
      await instance.publishExecutionInput(
        signal,
        { authoringPolicy: "user_authored" },
        true
      );
      if (signal.type !== "signal.text" || !signal.data.meta?.clientMessageId) {
        throw new Error("Missing fixture input");
      }
      const inputId = signal.data.meta.clientMessageId;
      const entered =
        Promise.withResolvers<RemoteAgentWorkerExecutionInputRequest>();
      const completed =
        Promise.withResolvers<RemoteAgentWorkerExecutionInputResponse>();
      const receive = vi.fn(
        (request: RemoteAgentWorkerExecutionInputRequest) => {
          entered.resolve(request);
          return completed.promise;
        }
      );
      instance.bindings = {
        ...instance.bindings,
        OPENMELD_REMOTE_AGENT_WORKER: {
          receiveExecutionInput: receive,
          readExecutionInput: () => Promise.resolve({ status: "not_found" }),
        },
      };
      if (order === "delete_first") {
        const deletion = await instance.handleInputQueue(
          { action: "delete", inputId },
          context
        );
        expect(deletion.status).toBe(200);
        await instance.steerQueuedExecutionInput(inputId);
        expect(receive).not.toHaveBeenCalled();
      } else {
        const delivery = instance.steerQueuedExecutionInput(inputId);
        const request = await entered.promise;
        expect(
          (
            await instance.handleInputQueue(
              { action: "delete", inputId },
              context
            )
          ).status
        ).toBe(409);
        expect(
          (
            await instance.handleInputQueue(
              {
                action: "reorder",
                expectedIds: [inputId],
                orderedIds: [inputId],
              },
              context
            )
          ).status
        ).toBe(409);
        completed.resolve({
          status: "applied",
          receipt: {
            inputId,
            target: request.target,
            receivedAtMs: 1,
            appliedAtMs: 2,
          },
        });
        await delivery;
        expect(receive).toHaveBeenCalledTimes(1);
      }
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toEqual([]);
      expect(
        state.storage.sql.exec("SELECT id FROM space_signals").toArray()
      ).toHaveLength(order === "steer_first" ? 1 : 0);
    });
  });

  it.each([
    "author",
    "target",
    "controller",
  ] as const)("rechecks %s eligibility before claiming a queued input", async (removed) => {
    await fixture(async ({ instance, state, signal, request }) => {
      await instance.publishExecutionInput(
        signal,
        { authoringPolicy: "user_authored" },
        true
      );
      if (signal.type !== "signal.text" || !signal.data.meta?.clientMessageId) {
        throw new Error("Missing fixture input");
      }
      state.storage.sql.exec(
        removed === "controller"
          ? "UPDATE space_members SET controller_ref_snapshot = 'local:codex' WHERE profile_id = ?"
          : "UPDATE space_members SET status = 'removed' WHERE profile_id = ?",
        removed === "author" ? signal.profile.profileId : request.agentProfileId
      );
      const receive = vi.fn(() =>
        Promise.resolve({ status: "not_found" as const })
      );
      instance.bindings = {
        ...instance.bindings,
        OPENMELD_REMOTE_AGENT_WORKER: {
          receiveExecutionInput: receive,
          readExecutionInput: receive,
        },
      };
      const expectedError = {
        author: "Join this Space",
        target: "no longer in the Space",
        controller: "doesn't support queued messages",
      }[removed];
      await expect(
        instance.steerQueuedExecutionInput(signal.data.meta.clientMessageId)
      ).rejects.toThrow(expectedError);
      expect(receive).not.toHaveBeenCalled();
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)[0]?.state).toBe(
        "queued"
      );
    });
  });

  it.each([
    "not_found",
    "rejected",
    "mismatched_receipt",
  ] as const)("does not release an uncertain input after a %s receipt query", async (queryOutcome) => {
    await fixture(async ({ instance, state, signal }) => {
      await instance.publishExecutionInput(
        signal,
        { authoringPolicy: "user_authored" },
        true
      );
      if (signal.type !== "signal.text" || !signal.data.meta?.clientMessageId) {
        throw new Error("Missing fixture input");
      }
      const inputId = signal.data.meta.clientMessageId;
      const receive = vi.fn(() => Promise.reject(new Error("lost receipt")));
      instance.bindings = {
        ...instance.bindings,
        OPENMELD_REMOTE_AGENT_WORKER: {
          receiveExecutionInput: receive,
          readExecutionInput: (
            query
          ): Promise<RemoteAgentWorkerExecutionInputResponse> => {
            if (queryOutcome === "mismatched_receipt") {
              return Promise.resolve({
                status: "applied",
                receipt: {
                  ...query,
                  target: {
                    ...query.target,
                    submissionId: "another-execution",
                  },
                  receivedAtMs: 1,
                  appliedAtMs: 2,
                },
              });
            }
            if (queryOutcome === "rejected") {
              return Promise.resolve({
                status: "rejected",
                reason: "input_conflict",
              });
            }
            return Promise.resolve({ status: "not_found" });
          },
        },
      };
      await Promise.all([
        instance.steerQueuedExecutionInput(inputId),
        instance.steerQueuedExecutionInput(inputId),
      ]);
      vi.mocked(instance.flushPendingExecutionInputs).mockRestore();
      state.storage.sql.exec(
        "UPDATE space_execution_input_outbox SET queue_receipt_due_at_ms = 0"
      );
      await instance.flushPendingExecutionInputs();
      await instance.steerQueuedExecutionInput(inputId);
      expect(receive).toHaveBeenCalledTimes(1);
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)[0]?.state).toBe(
        "unconfirmed"
      );
      expect(
        state.storage.sql.exec("SELECT id FROM space_signals").toArray()
      ).toHaveLength(0);
    });
  });

  it("keeps queued input private to its author until explicit exact-target Steer and never resends an unknown receipt", async () => {
    await fixture(async ({ instance, state, signal, context }) => {
      if (signal.type !== "signal.text") {
        throw new Error("Expected text fixture");
      }
      const inputId = signal.data.meta?.clientMessageId;
      const target = signal.data.meta?.centerAgentExecutionInput;
      if (!(inputId && target)) {
        throw new Error("Missing fixture input target");
      }
      const mutation = {
        action: "enqueue",
        inputId,
        text: signal.data.text,
        target,
      };
      expect(
        (
          await instance.handleInputQueue(
            { ...mutation, authorProfileId: "someone-else" },
            context
          )
        ).status
      ).toBe(400);
      expect(
        (
          await instance.handleInputQueue(mutation, {
            ...context,
            actorContext: { ...context.actorContext, ownerUserId: "intruder" },
          })
        ).status
      ).toBe(403);
      expect((await instance.handleInputQueue(mutation, context)).status).toBe(
        200
      );
      expect(
        (
          await instance.handleInputQueue(mutation, {
            ...context,
            actorContext: { ...context.actorContext, profileKind: "agent" },
          })
        ).status
      ).toBe(403);
      expect((await instance.handleInputQueue(mutation, context)).status).toBe(
        200
      );
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toHaveLength(1);
      expect(readNextSpaceExecutionInputAlarm(state.storage.sql)).toBeNull();
      expect(
        state.storage.sql.exec("SELECT id FROM space_signals").toArray()
      ).toHaveLength(0);
      const receive = vi.fn(
        (_input: RemoteAgentWorkerExecutionInputRequest): Promise<never> => {
          return Promise.reject(new Error("receipt lost after native intake"));
        }
      );
      const read = vi.fn(
        async (query: {
          inputId: string;
          target: RemoteAgentWorkerExecutionInputRequest["target"];
        }) => ({
          status: "applied" as const,
          receipt: { ...query, receivedAtMs: 1, appliedAtMs: 2 },
        })
      );
      instance.bindings = {
        ...instance.bindings,
        OPENMELD_REMOTE_AGENT_WORKER: {
          receiveExecutionInput: receive,
          readExecutionInput: read,
        },
      };
      const steer = { action: "steer", inputId, target: mutation.target };
      expect(
        (
          await instance.handleInputQueue(
            {
              ...steer,
              target: { ...mutation.target, dispatchId: "different-execution" },
            },
            context
          )
        ).status
      ).toBe(409);
      expect(receive).not.toHaveBeenCalled();
      await instance.handleInputQueue(steer, context);
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)[0]?.state).toBe(
        "unconfirmed"
      );
      await instance.handleInputQueue(steer, context);
      expect(
        (
          await instance.handleInputQueue(
            { action: "delete", inputId },
            context
          )
        ).status
      ).toBe(409);
      vi.mocked(instance.flushPendingExecutionInputs).mockRestore();
      state.storage.sql.exec(
        "UPDATE space_execution_input_outbox SET queue_receipt_due_at_ms = 0"
      );
      await instance.flushPendingExecutionInputs();
      expect(receive).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledTimes(1);
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toEqual([]);
      expect(
        state.storage.sql
          .exec("SELECT id FROM space_signals WHERE type = 'signal.text'")
          .toArray()
      ).toHaveLength(1);
      expect(readNextSpaceExecutionInputAlarm(state.storage.sql)).toBeNull();
      expect((await instance.handleInputQueue(mutation, context)).status).toBe(
        200
      );
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toEqual([]);
      expect(receive).toHaveBeenCalledTimes(1);
    });
  });

  it("retains ended or unsupported native targets without starting a replacement Wake", async () => {
    await fixture(async ({ instance, state, signal }) => {
      await instance.publishExecutionInput(
        signal,
        { authoringPolicy: "user_authored" },
        true
      );
      if (signal.type !== "signal.text") {
        throw new Error("Expected text fixture");
      }
      const inputId = signal.data.meta?.clientMessageId;
      if (!inputId) {
        throw new Error("Missing fixture input id");
      }
      instance.bindings = {
        ...instance.bindings,
        OPENMELD_REMOTE_AGENT_WORKER: {
          receiveExecutionInput: async () => ({
            status: "rejected",
            reason: "target_unavailable",
          }),
          readExecutionInput: async () => ({ status: "not_found" }),
        },
      };
      await instance.steerQueuedExecutionInput(inputId);
      expect(
        listQueuedSpaceExecutionInputs(state.storage.sql)[0]
      ).toMatchObject({ state: "queued", blocked: true });
      expect(
        state.storage.sql.exec("SELECT id FROM space_signals").toArray()
      ).toHaveLength(0);
      expect(readNextSpaceExecutionInputAlarm(state.storage.sql)).toBeNull();
    });
  });

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
