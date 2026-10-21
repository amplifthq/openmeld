import { env, runInDurableObject } from "cloudflare:test";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
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
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  type CoreRpcContextInput,
  rpcCenterAgentSpaceInputQueue,
} from "../src/rpc/methods";
import {
  upsertJoinedSpaceMember,
  upsertSpaceCreatorMember,
} from "../src/space/application/space-members-service";
import type { SignalPublishContext } from "../src/space/application/types";
import {
  claimQueuedSpaceExecutionInput,
  listQueuedSpaceExecutionInputs,
  readNextSpaceExecutionInputAlarm,
  readSpaceExecutionInput,
} from "../src/space/infrastructure/sql/space-execution-input-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import {
  countPublicTextSignalsAfterDispatchAnchor,
  insertSignalRecord,
} from "../src/space/infrastructure/sql/space-signal-repo";
import {
  insertSpaceThread,
  insertSpaceThreadSignalPlacement,
  readSpaceThreadSignalPlacementBySignalId,
} from "../src/space/infrastructure/sql/space-thread-repo";
import type { Space } from "../src/space/transport/do/space";

type InputSpace = {
  rpcAgentWorkload: Space["rpcAgentWorkload"];
  bindings: CoreBindings;
  spaceId: string;
  publishExecutionInput(
    signal: SignalEnvelope,
    context: SignalPublishContext,
    queued?: boolean
  ): Promise<void>;
  handleInputQueue(
    body: unknown,
    context: CoreRpcContextInput,
    includeRecovery?: boolean,
    includeConversationContext?: boolean
  ): Promise<Response>;
  steerQueuedExecutionInput(inputId: string): Promise<void>;
  flushPendingExecutionInputs(): Promise<void>;
  flushQueuedSpaceInputs(): Promise<void>;
  flushPendingDispatchOutbox(): Promise<void>;
  publishTextSignal(
    signal: SignalEnvelope,
    context: SignalPublishContext
  ): Promise<void>;
  readSpaceCallerContext(): Promise<{
    relationship: "internal" | "external";
    spaceRole: "member";
    audience: "organization";
  }>;
  recordOrganizationMemberHumanActivity(): Promise<void>;
  flushPendingSpaceInboxProjectionOutbox(): Promise<void>;
  syncSpaceBackgroundAlarm(): Promise<void>;
  projectCurrentSpaceIndexSnapshot(eventType: "space.created"): Promise<void>;
};
async function fixture(
  run: (f: {
    instance: InputSpace;
    state: DurableObjectState;
    signal: SignalEnvelope;
    request: RemoteAgentWorkerSubmitTurnRequestV1;
    context: CoreRpcContextInput;
    post: (signal?: SignalEnvelope) => Promise<void>;
  }) => Promise<void>,
  admitted = true
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
    db: getPostgresDatabase(env),
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
    db: getPostgresDatabase(env),
    idempotencyKey: request.idempotencyKey,
    nowMs: Date.now(),
    workerSubmitRequest: request,
  });
  if (admitted) {
    await markRemoteAgentNativeDeliveryAck({
      db: getPostgresDatabase(env),
      idempotencyKey: request.idempotencyKey,
      nowMs: Date.now(),
      submissionId: crypto.randomUUID(),
      accepted: true,
    });
  }
  await runInDurableObject(namespace.get(id), async (object, state) => {
    const background = vi.spyOn(state, "waitUntil");
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
      ...(admitted
        ? {}
        : {
            purpose: "openmeld_dm_space",
            directMessage: {
              pairKey: [profile.profileId, request.agentProfileId]
                .sort()
                .join(":"),
            },
          }),
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
      // Complete work started by this fixture before restoring its mocks or
      // removing the final alarm; otherwise it can reschedule after cleanup.
      while (background.mock.calls.length > 0) {
        await Promise.all(
          background.mock.calls.splice(0).map(([work]) => work)
        );
      }
      await state.storage.deleteAlarm();
      vi.restoreAllMocks();
    }
  });
}
describe("Center Agent execution input in the Space owner", () => {
  it("freezes a queued reply's original Thread and exposes its scope only to opted-in readers", async () => {
    await fixture(async ({ instance, state, signal, request, context }) => {
      if (signal.type !== "signal.text") {
        throw new Error("Expected text");
      }
      const threadContext = {
        threadId: `thr_${crypto.randomUUID()}`,
        rootSignalId: crypto.randomUUID(),
      };
      const createdAt = new Date().toISOString();
      insertSignalRecord(state.storage.sql, {
        ...signal,
        id: threadContext.rootSignalId,
        data: { text: "Root" },
      });
      insertSignalRecord(state.storage.sql, {
        ...signal,
        id: request.triggerMessageId,
        data: { text: "Original Thread request" },
      });
      insertSpaceThread(state.storage.sql, {
        ...threadContext,
        spaceId: signal.spaceId,
        createdByProfileId: signal.profile.profileId,
        createdAt,
        updatedAt: createdAt,
      });
      insertSpaceThreadSignalPlacement(state.storage.sql, {
        threadId: threadContext.threadId,
        signalId: request.triggerMessageId,
        placement: "thread",
        createdAt,
      });
      const mutation = {
        action: "enqueue",
        inputId: "scoped-queued-reply",
        text: "Continue in this Thread",
        target: {
          dispatchId: request.dispatchId,
          targetProfileId: request.agentProfileId,
        },
      };
      const response = await instance.handleInputQueue(
        mutation,
        context,
        false,
        true
      );
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await response.json()).toMatchObject({
        conversationContextIncluded: true,
        items: [{ threadId: threadContext.threadId }],
      });
      expect(
        readSpaceExecutionInput(state.storage.sql, mutation.inputId)?.request
      ).toMatchObject({ threadContext });
      const legacy = (await (
        await instance.handleInputQueue(undefined, context)
      ).json()) as { items: unknown[] };
      expect(legacy).not.toHaveProperty("conversationContextIncluded");
      expect(legacy.items[0]).not.toHaveProperty("threadId");
      expect(
        readSpaceThreadSignalPlacementBySignalId(state.storage.sql, signal.id)
      ).toBeNull();
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
      instance.bindings = {
        ...instance.bindings,
        OPENMELD_REMOTE_AGENT_WORKER: {
          receiveExecutionInput: receive,
          readExecutionInput: () => Promise.resolve({ status: "not_found" }),
        },
      };
      await instance.steerQueuedExecutionInput(mutation.inputId);
      const stored = readSpaceExecutionInput(
        state.storage.sql,
        mutation.inputId
      );
      expect(
        readSpaceThreadSignalPlacementBySignalId(
          state.storage.sql,
          stored?.signal.id ?? ""
        )
      ).toMatchObject({
        threadId: threadContext.threadId,
        placement: "thread",
      });
      expect(receive.mock.calls[0]?.[0]).not.toHaveProperty("threadContext");
    });
  });

  it("rejects Queue intake when the original request is unavailable", async () => {
    await fixture(async ({ instance, state, request, context }) => {
      const response = await instance.handleInputQueue(
        {
          action: "enqueue",
          inputId: "missing-source",
          text: "Follow up",
          target: {
            dispatchId: request.dispatchId,
            targetProfileId: request.agentProfileId,
          },
        },
        context
      );
      expect(response.status).toBe(409);
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toEqual([]);
    });
  });
  it("shares workload counts but only reveals source details to current conversation members", async () => {
    await fixture(async ({ instance, signal, request, context }) => {
      await instance.publishExecutionInput(
        signal,
        { authoringPolicy: "user_authored" },
        true
      );
      await getPostgresDatabase(env).transaction(async (client) => {
        await client.query({
          text: "INSERT INTO \"openmeld\".\"users\" (id, name, email, email_verified, created_at, updated_at) VALUES ('owner', 'Morgan', 'queue@example.test', 1, 1, 1) ON CONFLICT DO NOTHING",
          values: [],
        });
        await client.query({
          text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Queue test\', $2, 1)',
          values: [request.organizationId, request.organizationId],
        });
        await client.query({
          text: "INSERT INTO \"openmeld\".\"members\" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, 'owner', 'owner', 1)",
          values: [crypto.randomUUID(), request.organizationId],
        });
      });
      const input = {
        spaceId: signal.spaceId,
        organizationId: request.organizationId,
        targetProfileId: request.agentProfileId,
        context,
      };
      const member = await instance.rpcAgentWorkload(input);
      expect(member).toMatchObject({
        status: "ready",
        queuedMessageCount: 1,
        items: expect.arrayContaining([
          expect.objectContaining({
            kind: "queued_message",
            text: "Only analyze North America.",
          }),
        ]),
      });
      const otherMember = await instance.rpcAgentWorkload({
        ...input,
        context: {
          ...context,
          actorContext: {
            ...context.actorContext,
            openMeldProfileId: crypto.randomUUID(),
            ownerUserId: "other-member",
            callerPrincipalId: "other-member",
          },
        },
      });
      expect(otherMember).toMatchObject({
        status: "ready",
        queuedMessageCount: 1,
        items: [],
      });
      expect(JSON.stringify(otherMember)).not.toContain(signal.spaceId);
      await getPostgresDatabase(env).query({
        text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1',
        values: [request.organizationId],
      });
      expect(await instance.rpcAgentWorkload(input)).toMatchObject({
        status: "ready",
        queuedMessageCount: 1,
        items: [],
      });
      await expect(
        instance.rpcAgentWorkload({
          ...input,
          organizationId: crypto.randomUUID(),
        })
      ).rejects.toThrow("current Organization scope");
    });
  });
  it("authorizes Center queue tools as the current verified requester and rejects substitution or revocation", async () => {
    await fixture(async ({ instance, state, signal, request }) => {
      await instance.publishExecutionInput(
        signal,
        { authoringPolicy: "user_authored" },
        true
      );
      if (signal.type !== "signal.text" || !signal.data.meta?.clientMessageId) {
        throw new Error("Expected queued text.");
      }
      const organizationId = request.organizationId;
      await getPostgresDatabase(env).transaction(async (client) => {
        await client.query({
          text: "UPDATE \"openmeld\".\"openMeldRemoteAgent_native_delivery_ledger\" SET on_behalf_of_user_id = 'owner', on_behalf_of_profile_id = $1, on_behalf_of_display_name = 'Morgan' WHERE idempotency_key = $2",
          values: [signal.profile.profileId, request.idempotencyKey],
        });
        await client.query({
          text: "INSERT INTO \"openmeld\".\"users\" (id, name, email, email_verified, created_at, updated_at) VALUES ('owner', 'Morgan', 'queue@example.test', 1, 1, 1) ON CONFLICT DO NOTHING",
          values: [],
        });
        await client.query({
          text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Queue test\', $2, 1)',
          values: [organizationId, organizationId],
        });
        await client.query({
          text: "INSERT INTO \"openmeld\".\"members\" (id, organization_id, user_id, role, created_at) VALUES ('member', $1, 'owner', 'owner', 1)",
          values: [organizationId],
        });
        await client.query({
          text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, owner_user_id, created_by_user_id, source, created_at, updated_at) VALUES ($1, 'Morgan', $2, 'human', 1, 'active', 'owner', 'owner', 'auth_bootstrap', 1, 1)",
          values: [signal.profile.profileId, signal.profile.profileId],
        });
        await client.query({
          text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, managed_role, created_at, updated_at) VALUES ($1, 'Center Agent', $2, 'agent', 0, 'active', $3, NULL, 'owner', 'cli_create', 'center_agent', 1, 1)",
          values: [
            request.agentProfileId,
            request.agentProfileId,
            organizationId,
          ],
        });
        await client.query({
          text: 'INSERT INTO "openmeld"."center_agent_designations" (organization_id, agent_profile_id, duty, designated_by, created_at) VALUES ($1, $2, NULL, \'owner\', 1)',
          values: [organizationId, request.agentProfileId],
        });
      });
      await instance.projectCurrentSpaceIndexSnapshot("space.created");
      const delivery = await getPostgresDatabase(env)
        .query<{ submission_id: string }>({
          text: 'SELECT submission_id FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE idempotency_key = $1',
          values: [request.idempotencyKey],
        })
        .then((result) => result.rows[0] ?? null);
      if (!delivery) {
        throw new Error("Missing native delivery fixture");
      }
      const context: CoreRpcContextInput = {
        activeOrganizationId: organizationId,
        agentControllerConversationId: delivery.submission_id,
        actorContext: {
          requestId: "queue-tool-test",
          profileKind: "agent",
          openMeldProfileId: request.agentProfileId,
          callerPrincipalId: request.agentProfileId,
          agentControllerRef: "hosted:center-agent",
        },
      };
      const toolInput = {
        context,
        speakerMember: { memberId: "member", userId: "owner" },
        spaceId: signal.spaceId,
      };
      const coreEnv = {
        ...instance.bindings,
        OPENMELD_SPACES: env.OPENMELD_SPACES,
      } as CoreBindings;
      await expect(
        rpcCenterAgentSpaceInputQueue(coreEnv, {
          ...toolInput,
          speakerMember: { memberId: "member", userId: "other-account" },
        })
      ).rejects.toMatchObject({ status: 403 });
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toHaveLength(1);
      await expect(
        rpcCenterAgentSpaceInputQueue(coreEnv, toolInput)
      ).resolves.toMatchObject({
        items: [{ inputId: signal.data.meta.clientMessageId }],
      });
      await getPostgresDatabase(env).query({
        text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1',
        values: [organizationId],
      });
      await expect(
        rpcCenterAgentSpaceInputQueue(coreEnv, {
          ...toolInput,
          mutation: {
            action: "delete",
            inputId: signal.data.meta.clientMessageId,
          },
        })
      ).rejects.toMatchObject({ status: 403 });
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toHaveLength(1);
    });
  });
  it.each([
    "applied",
    "not_found",
    "revoked",
    "consume",
    "recover",
    "rebind",
    "enqueue",
    "enqueue-by-source",
    "delete-retired-target",
    "claude-applied",
    "claude-enqueue",
    "claude-pending",
    "reconcile-delivered",
    "reconcile-returned",
    "reconcile-undecided-retry",
    "reconcile-undecided-remove",
  ] as const)("settles Local %s through the same durable queue without replaying apply", async (scenario) => {
    const controllerRef = scenario.startsWith("claude-")
      ? "builtin:claude-code"
      : "builtin:codex";
    let result = scenario;
    if (scenario === "claude-applied") {
      result = "applied";
    } else if (
      scenario === "claude-enqueue" ||
      scenario === "enqueue-by-source"
    ) {
      result = "enqueue";
    }
    await fixture(async ({ instance, state, signal, request, context }) => {
      await instance.publishExecutionInput(
        signal,
        { authoringPolicy: "user_authored" },
        true
      );
      if (signal.type !== "signal.text" || !signal.data.meta?.clientMessageId) {
        throw new Error("Expected queued text.");
      }
      const inputId = signal.data.meta.clientMessageId;
      const local = {
        kind: "local",
        inputId,
        authorProfileId: signal.profile.profileId,
        requesterUserId: "owner",
        sourceSignalId: signal.id,
        text: signal.data.text,
        target: {
          ownerUserId: "owner",
          dispatchId: request.dispatchId,
          runtimeCoordinatorExecutionId: `execution-${inputId}`,
          attemptId: "attempt-local",
          runtimeCoordinatorRunId: "run-local",
          targetProfileId: request.agentProfileId,
          spaceId: signal.spaceId,
        },
      };
      state.storage.sql.exec(
        "UPDATE space_execution_input_outbox SET request_json = ? WHERE input_id = ?",
        JSON.stringify(local),
        inputId
      );
      state.storage.sql.exec(
        "UPDATE space_members SET controller_ref_snapshot = ? WHERE profile_id = ?",
        controllerRef,
        request.agentProfileId
      );
      await getPostgresDatabase(env).transaction(async (client) => {
        await client.query({
          text: "INSERT INTO \"openmeld\".\"users\" (id, name, email, email_verified, created_at, updated_at) VALUES ('owner', 'Morgan', 'queue@example.test', 1, 1, 1) ON CONFLICT DO NOTHING",
          values: [],
        });
        await client.query({
          text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Queue test\', $2, 1)',
          values: [request.organizationId, request.organizationId],
        });
        await client.query({
          text: "INSERT INTO \"openmeld\".\"members\" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, 'owner', 'owner', 1)",
          values: [crypto.randomUUID(), request.organizationId],
        });
      });
      const resolveProfileById = vi
        .fn<
          NonNullable<
            NonNullable<
              CoreBindings["OPENMELD_AUTH_WORKER"]
            >["resolveProfileById"]
          >
        >()
        .mockImplementation(({ openMeldProfileId }) =>
          Promise.resolve({
            ok: true,
            profile: {
              profileId: openMeldProfileId ?? "missing-profile",
              profileKind:
                openMeldProfileId === request.agentProfileId
                  ? "agent"
                  : "human",
              profileName: "Queue fixture",
              profileHandle: "queue-fixture",
              ownerUserId: result === "revoked" ? "different-account" : "owner",
              status: "active",
            },
          })
        );
      instance.bindings = {
        ...instance.bindings,
        OPENMELD_AUTH_WORKER: { resolveProfileById },
      };
      const runtimeTransport = await import(
        "../src/dispatch/infrastructure/runtime-transport/runtime-transport-api-client"
      );
      const transport = vi
        .spyOn(runtimeTransport, "callRuntimeTransportApi")
        .mockResolvedValue(
          result === "applied"
            ? {
                inputId,
                status: "applied",
                taskId: "task-local",
                threadId: "thread-local",
                turnId: "turn-local",
              }
            : { inputId, status: "not_found" }
        );
      if (result === "delete-retired-target") {
        state.storage.sql.exec(
          "UPDATE space_members SET status = 'removed' WHERE profile_id = ?",
          request.agentProfileId
        );
        expect(
          (
            await instance.handleInputQueue(
              { action: "delete", inputId },
              context
            )
          ).status
        ).toBe(200);
        expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toEqual([]);
        // Editing may retry removal after an acknowledged write loses its
        // response; it must confirm the tombstone without stopping any run.
        expect(
          (
            await instance.handleInputQueue(
              { action: "delete", inputId },
              context
            )
          ).status
        ).toBe(200);
        expect(transport).not.toHaveBeenCalled();
        return;
      }
      if (
        result === "consume" ||
        result === "enqueue" ||
        result === "recover" ||
        result === "rebind"
      ) {
        vi.spyOn(instance, "flushPendingDispatchOutbox").mockResolvedValue();
        vi.spyOn(instance, "readSpaceCallerContext").mockResolvedValue({
          relationship: "internal",
          spaceRole: "member",
          audience: "organization",
        });
      }
      if (result === "recover") {
        const continuation = structuredClone(signal);
        continuation.id = crypto.randomUUID();
        continuation.data.meta = { clientMessageId: crypto.randomUUID() };
        continuation.data.messageEnvelope = {
          text: continuation.data.text,
          activationTargets: [request.agentProfileId],
          referenceTargets: [],
        };
        const publish = () =>
          instance.publishTextSignal(continuation, {
            authoringPolicy: "user_authored",
            workRecoveryQueueHandoff: {
              previousDispatchId: request.dispatchId,
              targetProfileId: request.agentProfileId,
            },
          });
        state.storage.sql.exec(
          `CREATE TRIGGER fail_recovery_queue BEFORE UPDATE OF queue_after_dispatch_id ON space_execution_input_outbox BEGIN SELECT RAISE(ABORT, 'recovery unavailable'); END`
        );
        await expect(publish()).rejects.toThrow("recovery unavailable");
        expect(
          listQueuedSpaceExecutionInputs(state.storage.sql)[0]?.afterDispatchId
        ).toBe(request.dispatchId);
        expect(
          state.storage.sql
            .exec("SELECT id FROM space_signals WHERE id = ?", continuation.id)
            .toArray()
        ).toEqual([]);
        expect(
          state.storage.sql
            .exec(
              "SELECT dispatch_id FROM openMeldDaemon_outbox WHERE source_event_id = ?",
              continuation.id
            )
            .toArray()
        ).toEqual([]);
        state.storage.sql.exec("DROP TRIGGER fail_recovery_queue");
        await publish();
        await publish();
        const dispatches = state.storage.sql
          .exec<{ dispatch_id: string }>(
            "SELECT dispatch_id FROM openMeldDaemon_outbox WHERE source_event_id = ?",
            continuation.id
          )
          .toArray();
        expect(dispatches).toHaveLength(1);
        const pending = listQueuedSpaceExecutionInputs(state.storage.sql);
        expect(pending).toHaveLength(1);
        expect(pending[0]?.afterDispatchId).toBe(dispatches[0]?.dispatch_id);
        expect(pending[0]?.request.target).toMatchObject({
          dispatchId: request.dispatchId,
        });
        expect(pending[0]?.signal.data.contextSelection).toMatchObject({
          mode: "resume",
        });
        expect(transport).not.toHaveBeenCalled();
        return;
      }
      if (result === "enqueue" || result === "rebind") {
        const runtimeId = crypto.randomUUID();
        if (result === "enqueue") {
          state.storage.sql.exec(
            "DELETE FROM space_execution_input_outbox WHERE input_id = ?",
            inputId
          );
        }
        const parent = structuredClone(signal);
        parent.id = crypto.randomUUID();
        parent.data.meta = { clientMessageId: crypto.randomUUID() };
        parent.data.messageEnvelope = {
          text: parent.data.text,
          activationTargets: [request.agentProfileId],
          referenceTargets: [],
        };
        await instance.publishTextSignal(parent, {
          authoringPolicy: "user_authored",
        });
        const dispatch = state.storage.sql
          .exec<{ dispatch_id: string }>(
            "SELECT dispatch_id FROM openMeldDaemon_outbox WHERE source_event_id = ?",
            parent.id
          )
          .toArray()[0];
        if (!dispatch) {
          throw new Error("Missing ordinary dispatch handoff");
        }
        // Delivery retires the conveyor while the admitted execution is still
        // running. Fresh chats also have no controller display snapshot yet.
        if (scenario !== "enqueue-by-source") {
          state.storage.sql.exec("DELETE FROM openMeldDaemon_outbox");
        }
        state.storage.sql.exec(
          "UPDATE space_members SET controller_ref_snapshot = NULL WHERE profile_id = ?",
          request.agentProfileId
        );
        const projection = await import(
          "../src/runtime-transport/infrastructure/postgresql/runtime-coordinator-execution-repo"
        );
        if (scenario !== "enqueue-by-source") {
          await projection.writeRuntimeCoordinatorExecutionProjection({
            db: getPostgresDatabase(env),
            record: {
              modelVersion: "openmeld.runtime_coordinator.execution.v1",
              runtimeCoordinatorExecutionId:
                local.target.runtimeCoordinatorExecutionId,
              spaceId: signal.spaceId,
              dispatchId: dispatch.dispatch_id,
              targetProfileId: request.agentProfileId,
              sourceClientMessageId: parent.data.meta.clientMessageId ?? null,
              openMeldServiceRuntimeId: {
                source: "runtime_registry_authority",
                value: runtimeId,
              },
              bindingId: "binding-local",
              agentControllerRef: controllerRef,
              status: "running",
              terminalOutcome: null,
              createdAtMs: 1,
              updatedAtMs: 1,
              legacyPointers: {
                attemptId: "attempt-local",
                claimLeaseId: null,
                daemonSessionId: null,
                connectionGeneration: null,
                leaseEpoch: null,
              },
            },
          });
        }
        await getPostgresDatabase(env).query({
          text: "INSERT INTO \"openmeld\".\"openMeldDaemon_runtime_registry_records\" (openmeld_service_runtime_id, owner_kind, owner_id, device_id, lane, created_at_ms, last_registered_at_ms, updated_at_ms) VALUES ($1, 'owner_account', 'owner', $1, 'canary', 1, 1, 1)",
          values: [runtimeId],
        });
        const { spaceId: _spaceId, ...binding } = local.target;
        transport.mockResolvedValue({
          ...binding,
          dispatchId: dispatch.dispatch_id,
        });
        if (result === "rebind") {
          state.storage.sql.exec(
            "UPDATE space_execution_input_outbox SET queue_after_dispatch_id = ? WHERE input_id = ?",
            dispatch.dispatch_id,
            inputId
          );
          transport
            .mockResolvedValueOnce({
              ...binding,
              dispatchId: dispatch.dispatch_id,
              attemptId: "successor-attempt",
              runtimeCoordinatorRunId: "successor-run",
            })
            .mockResolvedValue({
              inputId,
              status: "applied",
              taskId: "successor-task",
              threadId: "successor-thread",
              turnId: "successor-turn",
            });
          const response = await instance.handleInputQueue(
            {
              action: "steer",
              inputId,
              target: {
                dispatchId: dispatch.dispatch_id,
                targetProfileId: request.agentProfileId,
              },
            },
            context
          );
          expect(response.status, await response.text()).toBe(200);
          expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toEqual([]);
          expect(transport).toHaveBeenCalledTimes(2);
          expect(transport.mock.calls[1]?.[0]).toMatchObject({
            body: {
              operation: "apply",
              request: {
                attemptId: "successor-attempt",
                runtimeCoordinatorRunId: "successor-run",
                dispatchId: dispatch.dispatch_id,
              },
            },
          });
          return;
        }
        const mutation = {
          action: "enqueue",
          inputId,
          text: signal.data.text,
          target: {
            ...(scenario === "enqueue-by-source"
              ? { clientMessageId: parent.data.meta.clientMessageId }
              : { dispatchId: dispatch.dispatch_id }),
            targetProfileId: request.agentProfileId,
          },
        };
        const enqueueContext: CoreRpcContextInput = {
          activeOrganizationId: request.organizationId,
          actorContext: {
            requestId: "local-enqueue",
            profileKind: "human",
            openMeldProfileId: signal.profile.profileId,
            ownerUserId: "owner",
            callerPrincipalId: "owner",
          },
        };
        const enqueueResponse = await instance.handleInputQueue(
          mutation,
          enqueueContext
        );
        expect(enqueueResponse.status, await enqueueResponse.text()).toBe(200);
        expect(
          (await instance.handleInputQueue(mutation, enqueueContext)).status
        ).toBe(200);
        expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toHaveLength(
          1
        );
        expect(
          readSpaceExecutionInput(state.storage.sql, inputId)?.request
        ).toMatchObject({
          kind: "local",
          requesterUserId: "owner",
          target: {
            dispatchId: dispatch.dispatch_id,
            ...(scenario === "enqueue-by-source"
              ? {}
              : {
                  attemptId: "attempt-local",
                  runtimeCoordinatorRunId: "run-local",
                }),
          },
        });
        if (scenario === "enqueue-by-source") {
          expect(transport).not.toHaveBeenCalled();
          // No Coordinator record existed at intake. Admission occurs later,
          // and only the explicit Send now operation resolves its binding.
          await projection.writeRuntimeCoordinatorExecutionProjection({
            db: getPostgresDatabase(env),
            record: {
              modelVersion: "openmeld.runtime_coordinator.execution.v1",
              runtimeCoordinatorExecutionId:
                local.target.runtimeCoordinatorExecutionId,
              spaceId: signal.spaceId,
              dispatchId: dispatch.dispatch_id,
              targetProfileId: request.agentProfileId,
              sourceClientMessageId: parent.data.meta.clientMessageId ?? null,
              openMeldServiceRuntimeId: {
                source: "runtime_registry_authority",
                value: runtimeId,
              },
              bindingId: "binding-local",
              agentControllerRef: controllerRef,
              status: "running",
              terminalOutcome: null,
              createdAtMs: 1,
              updatedAtMs: 2,
              legacyPointers: {
                attemptId: "attempt-local",
                claimLeaseId: null,
                daemonSessionId: null,
                connectionGeneration: null,
                leaseEpoch: null,
              },
            },
          });
          transport
            .mockResolvedValueOnce({
              ...binding,
              dispatchId: dispatch.dispatch_id,
            })
            .mockResolvedValue({
              inputId,
              status: "applied",
              taskId: "task-local",
              threadId: "thread-local",
              turnId: "turn-local",
            });
          const steered = await instance.handleInputQueue(
            {
              action: "steer",
              inputId,
              target: {
                dispatchId: dispatch.dispatch_id,
                targetProfileId: request.agentProfileId,
              },
            },
            enqueueContext
          );
          expect(steered.status).toBe(200);
          expect(transport).toHaveBeenCalledTimes(2);
          expect(transport.mock.calls[1]?.[0]).toMatchObject({
            body: {
              operation: "apply",
              request: { dispatchId: dispatch.dispatch_id, inputId },
            },
          });
          expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toEqual([]);
        } else {
          expect(transport).toHaveBeenCalledTimes(1);
          expect(transport.mock.calls[0]?.[0].path).toBe(
            "/runtime-coordinator/execution-input/resolve"
          );
        }
        return;
      }
      if (result === "consume") {
        insertSignalRecord(state.storage.sql, {
          v: 1,
          id: crypto.randomUUID(),
          ts: Date.now(),
          spaceId: signal.spaceId,
          profile: {
            kind: "agent",
            profileId: request.agentProfileId,
            profileName: "Codex",
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
        await instance.flushQueuedSpaceInputs();
        await instance.flushQueuedSpaceInputs();
        expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toEqual([]);
        expect(
          state.storage.sql
            .exec(
              "SELECT dispatch_id FROM openMeldDaemon_outbox WHERE source_event_id = ?",
              signal.id
            )
            .toArray()
        ).toHaveLength(1);
        expect(transport).not.toHaveBeenCalled();
        return;
      }
      if (result === "revoked") {
        await expect(
          instance.steerQueuedExecutionInput(inputId)
        ).rejects.toThrow("no longer have access");
        expect(transport).not.toHaveBeenCalled();
        expect(
          listQueuedSpaceExecutionInputs(state.storage.sql)[0]?.state
        ).toBe("queued");
        return;
      }
      if (result.startsWith("reconcile-")) {
        // The apply response is lost, so Core reads the Execution Host's
        // receipt to decide what happened.
        const readReceipts: Record<string, unknown> = {
          "reconcile-delivered": {
            inputId,
            status: "applied",
            taskId: "task-local",
            threadId: "thread-local",
            turnId: "turn-local",
          },
          "reconcile-returned": {
            inputId,
            taskId: "task-local",
            status: "not_applied",
            reasonCode: "execution_input.target_unavailable",
          },
        };
        const readReceipt = readReceipts[result] ?? {
          inputId,
          status: "not_found",
        };
        transport
          .mockReset()
          .mockResolvedValueOnce(null)
          // An unreachable host is read again instead of giving up.
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(readReceipt);
        state.storage.sql.exec(
          `INSERT INTO space_execution_input_outbox (input_id, request_json, signal_json, attempt_count, queue_state, queue_position, queue_blocked, queue_after_dispatch_id)
          SELECT 'behind', request_json, signal_json, 0, 'queued', queue_position + 1, 0, queue_after_dispatch_id
          FROM space_execution_input_outbox WHERE input_id = ?`,
          inputId
        );
        const head = () =>
          listQueuedSpaceExecutionInputs(state.storage.sql).find(
            (row) => row.inputId === inputId
          );
        await instance.steerQueuedExecutionInput(inputId);
        vi.mocked(instance.flushPendingExecutionInputs).mockRestore();
        for (let read = 0; read < 2; read += 1) {
          expect(head()).toMatchObject({
            state: "unconfirmed",
            delivery: "checking",
          });
          // A message still being checked can't be removed or retried.
          expect(
            (
              await instance.handleInputQueue(
                { action: "delete", inputId },
                context
              )
            ).status
          ).toBe(409);
          state.storage.sql.exec(
            "UPDATE space_execution_input_outbox SET queue_receipt_due_at_ms = 0 WHERE input_id = ?",
            inputId
          );
          await instance.flushPendingExecutionInputs();
        }
        expect(
          transport.mock.calls.map(
            ([call]) => (call.body as { operation?: string }).operation
          )
        ).toEqual(["apply", "read", "read"]);
        if (result === "reconcile-delivered") {
          expect(head()).toBeUndefined();
          expect(
            state.storage.sql
              .exec("SELECT id FROM space_signals WHERE id = ?", signal.id)
              .toArray()
          ).toHaveLength(1);
          return;
        }
        if (result === "reconcile-returned") {
          // Never delivered: sendable again, not paused.
          expect(head()).toMatchObject({ state: "queued", blocked: false });
          expect(head()?.delivery).toBeUndefined();
          return;
        }
        expect(head()).toMatchObject({
          state: "unconfirmed",
          delivery: "undecided",
        });
        expect(readNextSpaceExecutionInputAlarm(state.storage.sql)).toBeNull();
        // The undecided head pauses the input behind it.
        expect(
          claimQueuedSpaceExecutionInput(state.storage.sql, "behind", "steer")
        ).toBe(false);
        const resolved = await instance.handleInputQueue(
          result === "reconcile-undecided-retry"
            ? { action: "retry", inputId }
            : { action: "delete", inputId },
          context
        );
        expect(resolved.status).toBe(200);
        expect(head()).toEqual(
          result === "reconcile-undecided-retry"
            ? expect.objectContaining({ state: "queued", blocked: false })
            : undefined
        );
        expect(
          claimQueuedSpaceExecutionInput(state.storage.sql, "behind", "steer")
        ).toBe(true);
        expect(transport).toHaveBeenCalledTimes(3);
        return;
      }
      if (result === "claude-pending") {
        const applied = {
          inputId,
          status: "applied",
          taskId: "task-local",
          threadId: "thread-local",
          turnId: "turn-local",
        };
        // The apply wait ends before Claude consumes the input; the Execution
        // Host then reports it pending until the native replay arrives.
        transport
          .mockReset()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            inputId,
            taskId: "task-local",
            status: "unconfirmed",
            reasonCode: "execution_input.application_unconfirmed",
            diagnosticCode: "service.execution_input.pending",
          })
          .mockResolvedValueOnce(applied);
        await instance.steerQueuedExecutionInput(inputId);
        vi.mocked(instance.flushPendingExecutionInputs).mockRestore();
        for (const expected of ["unconfirmed", "unconfirmed"]) {
          expect(
            listQueuedSpaceExecutionInputs(state.storage.sql)[0]?.state
          ).toBe(expected);
          expect(readNextSpaceExecutionInputAlarm(state.storage.sql)).not.toBe(
            null
          );
          state.storage.sql.exec(
            "UPDATE space_execution_input_outbox SET queue_receipt_due_at_ms = 0"
          );
          await instance.flushPendingExecutionInputs();
        }
        // Reads may also come from the Space alarm; apply is never repeated.
        expect(
          transport.mock.calls.map(
            ([call]) => (call.body as { operation?: string }).operation
          )
        ).toEqual([
          "apply",
          ...transport.mock.calls.slice(1).map(() => "read"),
        ]);
        expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toEqual([]);
        expect(
          state.storage.sql
            .exec("SELECT id FROM space_signals WHERE id = ?", signal.id)
            .toArray()
        ).toHaveLength(1);
        return;
      }
      await instance.steerQueuedExecutionInput(inputId);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0]?.[0]).toMatchObject({
        body: {
          operation: "apply",
          request: {
            inputId,
            attemptId: "attempt-local",
            runtimeCoordinatorRunId: "run-local",
            source: { requesterUserId: "owner", effect: "steer" },
          },
        },
      });
      if (result === "applied") {
        expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toEqual([]);
        expect(
          state.storage.sql
            .exec("SELECT id FROM space_signals WHERE id = ?", signal.id)
            .toArray()
        ).toHaveLength(1);
        const countUnseen = (dispatchId: string) =>
          countPublicTextSignalsAfterDispatchAnchor(state.storage.sql, {
            dispatchId,
            afterSignalId: "original-wake",
            afterTimestampMs: 0,
            excludeProfileId: request.agentProfileId,
          });
        expect(countUnseen(request.dispatchId)).toBe(0);
        expect(countUnseen("another-dispatch")).toBe(1);
      } else {
        expect(
          listQueuedSpaceExecutionInputs(state.storage.sql)[0]?.state
        ).toBe("unconfirmed");
        state.storage.sql.exec(
          "UPDATE space_execution_input_outbox SET queue_receipt_due_at_ms = 0"
        );
        vi.mocked(instance.flushPendingExecutionInputs).mockRestore();
        await instance.flushPendingExecutionInputs();
        await instance.flushPendingExecutionInputs();
        await instance.steerQueuedExecutionInput(inputId);
        expect(transport).toHaveBeenCalledTimes(2);
        expect(transport.mock.calls[1]?.[0]).toMatchObject({
          body: { operation: "read" },
        });
        expect(
          listQueuedSpaceExecutionInputs(state.storage.sql)[0]?.state
        ).toBe("unconfirmed");
        expect(readNextSpaceExecutionInputAlarm(state.storage.sql)).toBeNull();
        expect(
          state.storage.sql
            .exec("SELECT id FROM space_signals WHERE id = ?", signal.id)
            .toArray()
        ).toEqual([]);
      }
    });
  });
  it("keeps a native startup follow-up queued until Send now binds the admitted submission", async () => {
    await fixture(async ({ instance, state, signal, request }) => {
      if (signal.type !== "signal.text" || !signal.data.meta?.clientMessageId) {
        throw new Error("Missing fixture input");
      }
      const inputId = signal.data.meta.clientMessageId;
      const db = getPostgresDatabase(env);
      await db.query({
        text: "INSERT INTO \"openmeld\".\"users\" (id, name, email, email_verified, created_at, updated_at) VALUES ('owner', 'Morgan', 'queue@example.test', 1, 1, 1) ON CONFLICT DO NOTHING",
        values: [],
      });
      await db.query({
        text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Queue test\', $2, 1)',
        values: [request.organizationId, request.organizationId],
      });
      await db.query({
        text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, is_default, status, organization_id, owner_user_id, created_by_user_id, source, managed_role, created_at, updated_at) VALUES ($1, 'Center Agent', $2, 'agent', 0, 'active', $3, NULL, 'owner', 'cli_create', 'center_agent', 1, 1)",
        values: [
          request.agentProfileId,
          request.agentProfileId,
          request.organizationId,
        ],
      });
      await db.query({
        text: 'INSERT INTO "openmeld"."center_agent_designations" (organization_id, agent_profile_id, duty, designated_by, created_at) VALUES ($1, $2, NULL, \'owner\', 1)',
        values: [request.organizationId, request.agentProfileId],
      });
      const original = {
        ...signal,
        id: request.triggerMessageId,
        data: {
          text: "Original request",
          messageEnvelope: {
            text: "Original request",
            activationTargets: [request.agentProfileId],
            referenceTargets: [],
          },
        },
      };
      await instance.publishTextSignal(original, {
        authoringPolicy: "user_authored",
      });
      const dispatch = state.storage.sql
        .exec<{ dispatch_id: string }>(
          "SELECT dispatch_id FROM openMeldDaemon_outbox WHERE source_event_id = ?",
          original.id
        )
        .toArray()[0];
      if (!dispatch) {
        throw new Error("Expected durable source dispatch");
      }
      request.dispatchId = dispatch.dispatch_id;
      signal.data.meta.centerAgentExecutionInput = {
        dispatchId: request.dispatchId,
        targetProfileId: request.agentProfileId,
      };
      await db.query({
        text: 'DELETE FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE idempotency_key = $1',
        values: [request.idempotencyKey],
      });
      const otherAuthor = structuredClone(signal);
      otherAuthor.profile.profileId = crypto.randomUUID();
      await expect(
        instance.publishExecutionInput(
          otherAuthor,
          { authoringPolicy: "user_authored" },
          true
        )
      ).rejects.toThrow("cannot receive this update");
      await instance.publishExecutionInput(
        signal,
        { authoringPolicy: "user_authored" },
        true
      );
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toHaveLength(1);
      await expect(instance.steerQueuedExecutionInput(inputId)).rejects.toThrow(
        "still queued"
      );
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)[0]?.state).toBe(
        "queued"
      );
      await upsertRemoteAgentNativeDeliveryRecord({
        db,
        nowMs: Date.now(),
        organizationId: request.organizationId,
        spaceId: request.spaceId,
        profileId: request.agentProfileId,
        bindingId: request.bindingId,
        triggerMessageId: request.triggerMessageId,
        dispatchId: request.dispatchId,
        attemptId: null,
        idempotencyKey: request.idempotencyKey,
        status: "submitted",
      });
      await markRemoteAgentNativeDeliveryAck({
        db: getPostgresDatabase(env),
        idempotencyKey: request.idempotencyKey,
        nowMs: Date.now(),
        submissionId: "admitted-submission",
        accepted: true,
      });
      const receive = vi.fn(
        (
          input: RemoteAgentWorkerExecutionInputRequest
        ): Promise<RemoteAgentWorkerExecutionInputResponse> =>
          Promise.resolve({
            status: "applied",
            receipt: {
              target: input.target,
              inputId,
              receivedAtMs: 1,
              appliedAtMs: 2,
            },
          })
      );
      instance.bindings = {
        ...instance.bindings,
        OPENMELD_REMOTE_AGENT_WORKER: {
          receiveExecutionInput: receive,
          readExecutionInput: () => Promise.resolve({ status: "not_found" }),
        },
      };
      await instance.steerQueuedExecutionInput(inputId);
      expect(receive).toHaveBeenCalledTimes(1);
      expect(receive.mock.calls[0]?.[0].target.submissionId).toBe(
        "admitted-submission"
      );
      expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toEqual([]);
    }, false);
  });
  it.each([
    ["consume", false],
    ["steer", false],
    ["consume", true],
    ["steer", true],
  ] as const)("atomically hands off one queued message and targets its successor for %s; Thread=%s", async (nextAction, inThread) => {
    await fixture(async ({ instance, state, signal, request }) => {
      if (signal.type !== "signal.text") {
        throw new Error("Expected a text input.");
      }
      const threadContext = inThread
        ? {
            threadId: `thr_${crypto.randomUUID()}`,
            rootSignalId: crypto.randomUUID(),
          }
        : null;
      if (threadContext) {
        insertSignalRecord(state.storage.sql, {
          ...signal,
          id: threadContext.rootSignalId,
          data: { text: "Root request" },
        });
        insertSpaceThread(state.storage.sql, {
          ...threadContext,
          spaceId: signal.spaceId,
          createdByProfileId: signal.profile.profileId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      await instance.publishExecutionInput(
        signal,
        {
          authoringPolicy: "user_authored",
          ...(threadContext ? { threadContext } : {}),
        },
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
        {
          authoringPolicy: "user_authored",
          ...(threadContext ? { threadContext } : {}),
        },
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
      expect(
        readSpaceThreadSignalPlacementBySignalId(state.storage.sql, signal.id)
          ?.threadId ?? null
      ).toBe(threadContext?.threadId ?? null);
      const nextDispatch = dispatches[0];
      if (!nextDispatch) {
        throw new Error("Expected one dispatch.");
      }
      if (nextAction === "steer") {
        const nextRequest = {
          ...request,
          dispatchId: nextDispatch.dispatch_id,
          idempotencyKey: crypto.randomUUID(),
          triggerMessageId: signal.id,
        };
        await upsertRemoteAgentNativeDeliveryRecord({
          db: getPostgresDatabase(env),
          nowMs: Date.now(),
          organizationId: nextRequest.organizationId,
          spaceId: nextRequest.spaceId,
          profileId: nextRequest.agentProfileId,
          bindingId: nextRequest.bindingId,
          triggerMessageId: nextRequest.triggerMessageId,
          dispatchId: nextRequest.dispatchId,
          attemptId: null,
          idempotencyKey: nextRequest.idempotencyKey,
          status: "submitted",
        });
        await persistRemoteAgentWorkerSubmitRequest({
          db: getPostgresDatabase(env),
          idempotencyKey: nextRequest.idempotencyKey,
          workerSubmitRequest: nextRequest,
          nowMs: Date.now(),
        });
        const nextSubmissionId = crypto.randomUUID();
        await markRemoteAgentNativeDeliveryAck({
          db: getPostgresDatabase(env),
          idempotencyKey: nextRequest.idempotencyKey,
          submissionId: nextSubmissionId,
          accepted: true,
          nowMs: Date.now(),
        });
        const receive = vi.fn(
          async (input: RemoteAgentWorkerExecutionInputRequest) => ({
            status: "applied" as const,
            receipt: {
              inputId: input.inputId,
              target: input.target,
              receivedAtMs: 1,
              appliedAtMs: 2,
            },
          })
        );
        instance.bindings = {
          ...instance.bindings,
          OPENMELD_REMOTE_AGENT_WORKER: {
            receiveExecutionInput: receive,
            readExecutionInput: () => Promise.resolve({ status: "not_found" }),
          },
        };
        const secondInputId = second.data.meta?.clientMessageId;
        if (!secondInputId) {
          throw new Error("Expected the second input identity.");
        }
        await instance.steerQueuedExecutionInput(secondInputId);
        expect(receive).toHaveBeenCalledTimes(1);
        expect(receive.mock.calls[0]?.[0]).not.toHaveProperty("threadContext");
        expect(
          readSpaceThreadSignalPlacementBySignalId(state.storage.sql, second.id)
            ?.threadId ?? null
        ).toBe(threadContext?.threadId ?? null);
        expect(receive.mock.calls[0]?.[0].target).toMatchObject({
          submissionId: nextSubmissionId,
          idempotencyKey: nextRequest.idempotencyKey,
        });
        expect(listQueuedSpaceExecutionInputs(state.storage.sql)).toEqual([]);
        return;
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
      const second = structuredClone(signal);
      if (second.type !== "signal.text") {
        throw new Error("Expected text");
      }
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
    await fixture(async ({ instance, state, signal, context, request }) => {
      if (signal.type !== "signal.text") {
        throw new Error("Expected text fixture");
      }
      insertSignalRecord(state.storage.sql, {
        ...signal,
        id: request.triggerMessageId,
        data: { text: "Original request" },
      });
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
      // The queue works on the first turn without opening Members first.
      state.storage.sql.exec(
        "UPDATE space_members SET controller_ref_snapshot = NULL WHERE profile_id = ?",
        target.targetProfileId
      );
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
      const queuedSignalId = readSpaceExecutionInput(state.storage.sql, inputId)
        ?.signal.id;
      expect(
        state.storage.sql
          .exec(
            "SELECT id FROM space_signals WHERE id = ?",
            queuedSignalId ?? ""
          )
          .toArray()
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
          .exec(
            "SELECT id FROM space_signals WHERE id = ?",
            queuedSignalId ?? ""
          )
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
        .exec<{
          payload_json: string;
        }>(
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
          .exec<{
            n: number;
          }>(
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
        .exec<{
          n: number;
        }>("SELECT count(*) AS n FROM space_signals WHERE type = 'signal.text'")
        .toArray();
      expect(rows[0]?.n).toBe(1);
      expect(
        state.storage.sql
          .exec<{
            n: number;
          }>("SELECT count(*) AS n FROM space_execution_input_outbox")
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
          .exec<{
            n: number;
          }>("SELECT count(*) AS n FROM space_signals")
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
      await getPostgresDatabase(env).query({
        ...{
          text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET status = \'completed\' WHERE idempotency_key = $1',
          values: [],
        },
        values: [request.idempotencyKey],
      });
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
