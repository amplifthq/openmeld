import type { SignalEnvelope } from "@openmeld/protocol";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { createCoreRpcHttpError } from "../src/rpc/errors";
import {
  rpcAddSpaceMembers,
  rpcClearSpacePassword,
  rpcCreateSpace,
  rpcDeleteSpace,
  rpcGetSpaceClaimTimeLiveness,
  rpcGetSpaceMembers,
  rpcGetSpaceMeta,
  rpcListSignals,
  rpcListSpaceThreadSignals,
  rpcPostSignal,
  rpcPostStatusSignal,
  rpcPostSystemNoticeSignal,
  rpcPostTransientSignal,
  rpcRemoveSpaceMembers,
  rpcUpsertSpacePassword,
} from "../src/rpc/methods";
import {
  OPENMELD_HEADER_OWNER_USER_ID,
  OPENMELD_HEADER_PROFILE_ID,
} from "../src/shared/context/openmeld-context";
import type { Space } from "../src/space/transport/do/space";

const DEFAULT_CONTEXT: OpenMeldRequestContext = {
  activeOrganizationId: "org-1",
  actorContext: {
    requestId: "req-1",
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    profileKind: "human",
    profileName: "Mira",
    ownerUserId: "owner-1",
    callerPrincipalId: "owner-1",
    agentControllerRef: "builtin:codex",
  },
  agentControllerConversationId: "thread-ctx-1",
};
const SYSTEM_CONTEXT: OpenMeldRequestContext = {
  actorContext: {
    requestId: "req-system-1",
    openMeldProfileId: "openmeld-system",
    profileKind: "system",
    profileName: "OpenMeld System",
  },
};
const DEFAULT_ACTOR_CONTEXT = DEFAULT_CONTEXT.actorContext;
const SECOND_HUMAN_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";
const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const UNIQUE_SPACE_ID =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PARSED_SPACE_ID =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TEST_REPLY_TO = {
  signalId: "sig-reply-1",
  profileId: DEFAULT_ACTOR_CONTEXT.openMeldProfileId,
  profileKind: "human" as const,
  profileName: "Mira",
  previewText: "Earlier question",
};
const MEMBERS_TABLE_QUERY_PATTERN = /\bFROM\s+members\b/i;

function createRpcMethodsDbMock(): D1Database {
  return {
    prepare: vi.fn((query: string) => {
      const statement = {
        bind: vi.fn(() => statement),
        first: vi.fn(() => {
          if (MEMBERS_TABLE_QUERY_PATTERN.test(query)) {
            return Promise.resolve({ id: "member-owner", role: "owner" });
          }
          return Promise.resolve(null);
        }),
        all: vi.fn(() => Promise.resolve({ results: [] })),
        run: vi.fn(() => Promise.resolve({ success: true })),
      };
      return statement;
    }),
  } as unknown as D1Database;
}

function createBindingsMock() {
  const uniqueId = {
    toString: () => UNIQUE_SPACE_ID,
  } as unknown as DurableObjectId;
  const parsedId = {
    toString: () => PARSED_SPACE_ID,
  } as unknown as DurableObjectId;
  const stub = {
    fetch: vi.fn(
      async (_request: Request) =>
        new Response("unexpected fetch", { status: 500 })
    ),
    rpcListSignals: vi.fn(async () => ({ signals: [], nextCursor: null })),
    rpcListSignalsResult: vi.fn(async () => ({
      ok: true as const,
      value: { signals: [], nextCursor: null },
    })),
    rpcListThreadSignalsResult: vi.fn(async () => ({
      ok: true as const,
      value: { placements: [], signals: [] },
    })),
    rpcPostSignal: vi.fn(),
    rpcPostStatusSignal: vi.fn(),
    rpcPostSystemNoticeSignal: vi.fn(),
    rpcPostTransientSignal: vi.fn(async () => undefined),
    rpcGetMeta: vi.fn(async () => ({ spaceId: "space-1" })),
    rpcPatchMeta: vi.fn(async () => ({ spaceId: "space-1" })),
    rpcPatchMetaWithPasswordAtomic: vi.fn(async () => ({
      spaceId: "space-1",
      passwordProtected: true,
    })),
    rpcDelete: vi.fn(async () => ({ spaceId: "space-1", deleted: true })),
    rpcGetCursor: vi.fn(),
    rpcPatchCursor: vi.fn(),
    rpcGetMembers: vi.fn(async () => ({
      spaceId: "space-1",
      generatedAt: "2026-03-06T00:00:00.000Z",
      summary: {
        totalCount: 1,
        humanCount: 1,
        agentCount: 0,
        liveNowCount: 0,
      },
      humans: [
        {
          profileId: DEFAULT_ACTOR_CONTEXT.openMeldProfileId,
          profileName: "Mira",
          profileKind: "human",
          status: "active",
          memberSource: "joined_directly",
          memberSourceLabel: "Joined directly",
          addedAt: "2026-03-06T00:00:00.000Z",
          removedAt: null,
          createdAt: "2026-03-06T00:00:00.000Z",
          updatedAt: "2026-03-06T00:00:00.000Z",
          addedByProfileId: null,
          addedByOwnerUserId: null,
          addedByDisplayName: null,
          removedByProfileId: null,
          removedByOwnerUserId: null,
          removalReason: null,
          firstEnteredAt: "2026-03-06T00:00:00.000Z",
          lastEnteredAt: "2026-03-06T00:00:00.000Z",
          lastSeenAt: "2026-03-06T00:00:00.000Z",
          lastSeenLabel: "Seen just now",
          liveNow: false,
          ownerUserId: "owner-1",
          ownerName: "Mira",
        },
      ],
      agents: [],
    })),
    rpcGetClaimTimeLiveness: vi.fn(async () => ({
      diagnosticPointer: {
        evaluatedAtMs: 1000,
        livenessContractVersion: "space_claim_time_liveness.v1",
        relation: "wake",
        spaceId: SPACE_ID,
        targetProfileId: AGENT_PROFILE_ID,
      },
      status: "valid" as const,
    })),
    rpcPostMembers: vi.fn(async () => ({
      addedMemberIds: [SECOND_HUMAN_PROFILE_ID],
      alreadyMemberIds: [],
      items: [
        {
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileName: "New Member",
          profileKind: "human",
          status: "active",
          memberSource: "added_by_member",
          memberSourceLabel: "Added by Mira",
          addedAt: "2026-03-06T00:00:00.000Z",
          removedAt: null,
          createdAt: "2026-03-06T00:00:00.000Z",
          updatedAt: "2026-03-06T00:00:00.000Z",
          addedByProfileId: DEFAULT_ACTOR_CONTEXT.openMeldProfileId,
          addedByOwnerUserId: "owner-1",
          addedByDisplayName: "Mira",
          removedByProfileId: null,
          removedByOwnerUserId: null,
          removalReason: null,
          firstEnteredAt: null,
          lastEnteredAt: null,
          lastSeenAt: null,
          lastSeenLabel: null,
          liveNow: false,
          ownerUserId: "owner-2",
          ownerName: "New Member",
        },
      ],
    })),
    rpcRemoveMembers: vi.fn(async () => ({
      removedMemberIds: [SECOND_HUMAN_PROFILE_ID],
      alreadyAbsentMemberIds: [],
    })),
    rpcUpsertPassword: vi.fn(async () => ({
      spaceId: "space-1",
      passwordProtected: true,
    })),
    rpcClearPassword: vi.fn(async () => ({
      spaceId: "space-1",
      passwordProtected: false,
    })),
  };

  const namespace = {
    idFromName: vi.fn(),
    newUniqueId: vi.fn(() => uniqueId),
    idFromString: vi.fn(() => parsedId),
    get: vi.fn(() => stub as unknown as DurableObjectStub<Space>),
    getByName: vi.fn(),
  } as unknown as DurableObjectNamespace<Space>;

  return {
    env: {
      OPENMELD_DB: createRpcMethodsDbMock(),
      OPENMELD_SPACES: namespace,
    } as CoreBindings,
    namespace,
    stub,
  };
}

describe("rpc methods (direct DO path)", () => {
  it("trims cursor and forwards list request to direct DO RPC", async () => {
    const { env, stub } = createBindingsMock();

    await rpcListSignals(env, {
      spaceId: SPACE_ID,
      cursor: "   cursor-abc   ",
      context: DEFAULT_CONTEXT,
    });

    expect(stub.rpcListSignalsResult).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: SPACE_ID,
        cursor: "cursor-abc",
      })
    );
  });

  it("forwards a bounded thread read to the Space DO", async () => {
    const { env, stub } = createBindingsMock();

    await rpcListSpaceThreadSignals(env, {
      afterSignalId: "  sig-observed  ",
      context: DEFAULT_CONTEXT,
      limit: 20,
      spaceId: SPACE_ID,
      threadId: "thread-1",
    });

    expect(stub.rpcListThreadSignalsResult).toHaveBeenCalledWith(
      expect.objectContaining({
        afterSignalId: "sig-observed",
        limit: 20,
        spaceId: SPACE_ID,
        threadId: "thread-1",
      })
    );
  });

  it("returns structured 404 when spaceId format is invalid", async () => {
    const { env, stub } = createBindingsMock();

    await expect(
      rpcGetSpaceMeta(env, {
        spaceId: "x".repeat(33),
        context: DEFAULT_CONTEXT,
      })
    ).rejects.toMatchObject({
      cause: {
        status: 404,
        code: "invalid_space_id",
        message: "invalid space id: expected 64-char hex id",
      },
    });

    expect(stub.rpcGetMeta).not.toHaveBeenCalled();
  });

  it("returns structured 404 when spaceId is blank after trim", async () => {
    const { env, stub } = createBindingsMock();

    await expect(
      rpcGetSpaceMeta(env, {
        spaceId: "   ",
        context: DEFAULT_CONTEXT,
      })
    ).rejects.toMatchObject({
      cause: {
        status: 404,
        code: "invalid_space_id",
        message: "invalid space id: expected 64-char hex id",
      },
    });

    expect(stub.rpcGetMeta).not.toHaveBeenCalled();
  });

  it("returns structured 404 when spaceId is not found", async () => {
    const { env, namespace, stub } = createBindingsMock();
    namespace.idFromString = vi.fn(() => {
      throw new Error("not found");
    });

    await expect(
      rpcGetSpaceMeta(env, {
        spaceId: "a".repeat(64),
        context: DEFAULT_CONTEXT,
      })
    ).rejects.toMatchObject({
      cause: {
        status: 404,
        code: "space.not_found",
        message: "space not found",
      },
    });

    expect(stub.rpcGetMeta).not.toHaveBeenCalled();
  });

  it("creates space with context-derived creator and initializeIfAbsent", async () => {
    const { env, namespace, stub } = createBindingsMock();
    stub.rpcPatchMeta = vi.fn(async () => ({
      spaceId: UNIQUE_SPACE_ID,
      guide: "hello",
    }));

    const result = await rpcCreateSpace(env, {
      name: "  welcome-to-openmeld  ",
      guide: "  hello  ",
      visibility: "private",
      context: DEFAULT_CONTEXT,
    });

    expect(namespace.idFromName).not.toHaveBeenCalled();
    expect(namespace.newUniqueId).toHaveBeenCalledTimes(1);
    expect(stub.rpcPatchMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: UNIQUE_SPACE_ID,
        name: "welcome-to-openmeld",
        guide: "hello",
        initializeIfAbsent: true,
        creator: expect.objectContaining({
          profileId: DEFAULT_ACTOR_CONTEXT.openMeldProfileId,
          kind: DEFAULT_ACTOR_CONTEXT.profileKind,
        }),
      })
    );
    expect(result).toEqual({
      spaceId: UNIQUE_SPACE_ID,
      meta: {
        spaceId: UNIQUE_SPACE_ID,
        guide: "hello",
      },
    });
  });

  it("creates space with password and marks meta as password protected", async () => {
    const { env, stub } = createBindingsMock();
    stub.rpcPatchMetaWithPasswordAtomic = vi.fn(async () => ({
      spaceId: UNIQUE_SPACE_ID,
      guide: "hello",
      passwordProtected: true,
    }));

    const result = await rpcCreateSpace(env, {
      guide: "hello",
      visibility: "private",
      password: "  12@ABC  ",
      context: DEFAULT_CONTEXT,
    });

    expect(stub.rpcPatchMetaWithPasswordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: UNIQUE_SPACE_ID,
        guide: "hello",
        password: "12@ABC",
      })
    );
    expect(stub.rpcPatchMeta).not.toHaveBeenCalled();
    expect(stub.rpcUpsertPassword).not.toHaveBeenCalled();
    expect(result).toEqual({
      spaceId: UNIQUE_SPACE_ID,
      meta: {
        spaceId: UNIQUE_SPACE_ID,
        guide: "hello",
        passwordProtected: true,
      },
    });
  });

  it("fails atomic create when password proof generation fails", async () => {
    const { env, stub } = createBindingsMock();
    stub.rpcPatchMetaWithPasswordAtomic = vi.fn(() => {
      throw createCoreRpcHttpError({
        status: 400,
        reason: "space password must be at least 6 characters",
        code: "space.password_too_short",
      });
    });

    await expect(
      rpcCreateSpace(env, {
        guide: "hello",
        visibility: "private",
        password: "12345",
        context: DEFAULT_CONTEXT,
      })
    ).rejects.toMatchObject({
      cause: {
        status: 400,
        code: "space.password_too_short",
      },
    });

    expect(stub.rpcPatchMetaWithPasswordAtomic).toHaveBeenCalledTimes(1);
    expect(stub.rpcPatchMeta).not.toHaveBeenCalled();
    expect(stub.rpcUpsertPassword).not.toHaveBeenCalled();
  });

  it("rejects create when password type is invalid", async () => {
    const { env, stub } = createBindingsMock();

    await expect(
      rpcCreateSpace(env, {
        guide: "hello",
        visibility: "private",
        password: 12_345 as unknown as string,
        context: DEFAULT_CONTEXT,
      })
    ).rejects.toMatchObject({
      cause: {
        status: 400,
        code: "invalid_create_payload",
        message: "Invalid password",
      },
    });

    expect(stub.rpcPatchMeta).not.toHaveBeenCalled();
    expect(stub.rpcPatchMetaWithPasswordAtomic).not.toHaveBeenCalled();
    expect(stub.rpcUpsertPassword).not.toHaveBeenCalled();
  });

  it("rejects create payload with unknown field", async () => {
    const { env, stub } = createBindingsMock();

    await expect(
      rpcCreateSpace(env, {
        context: DEFAULT_CONTEXT,
        unknownField: "not-allowed",
      } as unknown as Parameters<typeof rpcCreateSpace>[1])
    ).rejects.toMatchObject({
      cause: {
        status: 400,
        code: "invalid_create_payload",
      },
    });

    expect(stub.rpcPatchMeta).not.toHaveBeenCalled();
    expect(stub.rpcPatchMetaWithPasswordAtomic).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated create requests", async () => {
    const { env, stub } = createBindingsMock();

    await expect(rpcCreateSpace(env, {})).rejects.toMatchObject({
      cause: {
        status: 401,
        code: "auth.unauthenticated",
        message: "authentication required",
      },
    });

    expect(stub.rpcPatchMeta).not.toHaveBeenCalled();
    expect(stub.rpcPatchMetaWithPasswordAtomic).not.toHaveBeenCalled();
  });

  it("rejects legacy flat context on direct DO RPC calls", async () => {
    const { env, stub } = createBindingsMock();

    await expect(
      rpcGetSpaceMembers(env, {
        spaceId: SPACE_ID,
        context: {
          requestId: "  req-compat-1  ",
          profileId: `  ${DEFAULT_ACTOR_CONTEXT.openMeldProfileId}  `,
          profileKind: "agent",
          profileHandle: "  mira-agent  ",
          profileName: "  Mira Agent  ",
          profile: `  ${AGENT_PROFILE_ID}  `,
          ownerUserId: "  owner-compat-1  ",
          ownerName: "  Mira Owner  ",
          agentControllerRef: "  builtin:codex  ",
          agentControllerConversationId: "  thread-ctx-compat-1  ",
          dispatchChainId: "  chain-compat-1  ",
          autoRelayDepth: 2.9,
          visitedProfileIds: [
            `  ${DEFAULT_ACTOR_CONTEXT.openMeldProfileId}  `,
            "   ",
            `  ${AGENT_PROFILE_ID}  `,
          ],
          visitedProfileIdsHash: "  stable32:compat1  ",
        } as unknown as OpenMeldRequestContext,
      })
    ).rejects.toMatchObject({
      cause: {
        status: 401,
        code: "auth.unauthenticated",
        message: "authentication required",
      },
    });

    expect(stub.rpcGetMembers).not.toHaveBeenCalled();
  });

  it("rejects direct DO RPC context with invalid profile kind", async () => {
    const { env, stub } = createBindingsMock();

    await expect(
      rpcGetSpaceMembers(env, {
        spaceId: SPACE_ID,
        context: {
          ...DEFAULT_CONTEXT,
          actorContext: {
            ...DEFAULT_ACTOR_CONTEXT,
            profileKind: "invalid-kind",
          },
        } as unknown as OpenMeldRequestContext,
      })
    ).rejects.toMatchObject({
      cause: {
        status: 401,
        code: "auth.unauthenticated",
        message: "authentication required",
      },
    });

    expect(stub.rpcGetMembers).not.toHaveBeenCalled();
  });

  it("forwards delete request to direct DO RPC", async () => {
    const { env, stub } = createBindingsMock();

    const result = await rpcDeleteSpace(env, {
      spaceId: SPACE_ID,
      approvedAgentCreatorProfileId: "agt-space-creator-1",
      context: DEFAULT_CONTEXT,
    });

    expect(stub.rpcDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: SPACE_ID,
        approvedAgentCreatorProfileId: "agt-space-creator-1",
      })
    );
    expect(result).toEqual({
      spaceId: "space-1",
      deleted: true,
    });
  });

  it("preserves controller context fields on post signal", async () => {
    const { env, stub } = createBindingsMock();
    stub.rpcPostSignal = vi.fn(async () => ({
      v: 1,
      id: "sig-1",
      spaceId: SPACE_ID,
      ts: Date.now(),
      profile: {
        kind: "agent",
        profileId: AGENT_PROFILE_ID,
        profileName: "agent-1",
      },
      type: "signal.text",
      data: { text: "hello" },
    }));

    await rpcPostSignal(env, {
      spaceId: SPACE_ID,
      profile: {
        kind: "agent",
        profileId: AGENT_PROFILE_ID,
        profileName: "agent-1",
      },
      text: "hello",
      authoringPolicy: "system_emitted",
      context: DEFAULT_CONTEXT,
    });

    expect(stub.rpcPostSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        authoringPolicy: "system_emitted",
        context: expect.objectContaining({
          actorContext: expect.objectContaining({
            agentControllerRef: "builtin:codex",
          }),
          agentControllerConversationId: "thread-ctx-1",
        }),
      })
    );
  });

  it("allows a canonical Space File to be sent without a text note", async () => {
    const { env, stub } = createBindingsMock();
    const files = [
      {
        fileId: "44444444-4444-4444-8444-444444444444",
        revision: 1,
        name: "brief.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
      },
    ];
    stub.rpcPostSignal = vi.fn(async () => ({
      v: 1,
      id: "sig-file-only",
      spaceId: SPACE_ID,
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: DEFAULT_ACTOR_CONTEXT.openMeldProfileId,
        profileName: "Mira",
      },
      type: "signal.text",
      data: { text: "", files },
    }));

    await rpcPostSignal(env, {
      spaceId: SPACE_ID,
      profile: {
        kind: "human",
        profileId: DEFAULT_ACTOR_CONTEXT.openMeldProfileId,
        profileName: "Mira",
      },
      text: "",
      files,
      authoringPolicy: "user_authored",
      context: DEFAULT_CONTEXT,
    });

    expect(stub.rpcPostSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        files,
        text: "",
      })
    );
  });

  it("forwards signal meta on post signal", async () => {
    const { env, stub } = createBindingsMock();
    stub.rpcPostSignal = vi.fn(async () => ({
      v: 1,
      id: "sig-1",
      spaceId: SPACE_ID,
      ts: Date.now(),
      profile: {
        kind: "agent",
        profileId: AGENT_PROFILE_ID,
        profileName: "agent-1",
      },
      type: "signal.text",
      data: { text: "hello" },
    }));

    await rpcPostSignal(env, {
      spaceId: SPACE_ID,
      profile: {
        kind: "agent",
        profileId: AGENT_PROFILE_ID,
        profileName: "agent-1",
      },
      text: "hello",
      authoringPolicy: "system_emitted",
      meta: {
        purpose: "space_membership_join_notice",
        targetProfileId: "agent-1",
        targetProfileKind: "agent",
        targetProfileName: "Demo Bot",
        addedByProfileId: "human-1",
        addedByDisplayName: "Mira",
      },
      context: DEFAULT_CONTEXT,
    });

    expect(stub.rpcPostSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId: "agent-1",
          targetProfileKind: "agent",
          targetProfileName: "Demo Bot",
          addedByProfileId: "human-1",
          addedByDisplayName: "Mira",
        },
      })
    );
  });

  it("forwards signal replyTo on post signal", async () => {
    const { env, stub } = createBindingsMock();
    stub.rpcPostSignal = vi.fn(async () => ({
      v: 1,
      id: "sig-1",
      spaceId: SPACE_ID,
      ts: Date.now(),
      profile: {
        kind: "agent",
        profileId: AGENT_PROFILE_ID,
        profileName: "agent-1",
      },
      type: "signal.text",
      data: { text: "hello", replyTo: TEST_REPLY_TO },
    }));

    await rpcPostSignal(env, {
      spaceId: SPACE_ID,
      profile: {
        kind: "agent",
        profileId: AGENT_PROFILE_ID,
        profileName: "agent-1",
      },
      text: "hello",
      authoringPolicy: "system_emitted",
      replyTo: TEST_REPLY_TO,
      context: DEFAULT_CONTEXT,
    });

    expect(stub.rpcPostSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: TEST_REPLY_TO,
      })
    );
  });

  it("requires authenticated context for post system notice signal", async () => {
    const { env, stub } = createBindingsMock();

    await expect(
      rpcPostSystemNoticeSignal(env, {
        spaceId: SPACE_ID,
        profile: {
          kind: "agent",
          profileId: AGENT_PROFILE_ID,
          profileName: "agent-1",
        },
        data: {
          noticeType: "stay_silent",
          actorProfileId: DEFAULT_ACTOR_CONTEXT.openMeldProfileId,
          dispatchId: "dispatch-1",
          generatedBy: "openmeld",
          reason: "Handled privately.",
          text: "agent chose to stay silent: Handled privately.",
        },
      })
    ).rejects.toMatchObject({
      cause: {
        status: 401,
        code: "auth.unauthenticated",
      },
    });

    expect(stub.rpcPostSystemNoticeSignal).not.toHaveBeenCalled();
    expect(stub.fetch).not.toHaveBeenCalled();
  });

  it("forwards authenticated context on post status and system notice signal RPCs", async () => {
    const { env, stub } = createBindingsMock();
    const statusSignal = {
      v: 1,
      id: "sig-status-1",
      spaceId: SPACE_ID,
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: DEFAULT_ACTOR_CONTEXT.openMeldProfileId,
        profileName: DEFAULT_ACTOR_CONTEXT.profileName,
      },
      type: "signal.status",
      data: {
        actorProfileId: DEFAULT_ACTOR_CONTEXT.openMeldProfileId,
        dispatchId: "dispatch-status-1",
        generatedBy: "openmeld",
        status: "done",
        text: "done",
      },
    };
    const systemNoticeSignal = {
      v: 1,
      id: "sig-activity-1",
      spaceId: SPACE_ID,
      ts: Date.now(),
      profile: {
        kind: "human",
        profileId: DEFAULT_ACTOR_CONTEXT.openMeldProfileId,
        profileName: DEFAULT_ACTOR_CONTEXT.profileName,
      },
      type: "signal.system_notice",
      data: {
        noticeType: "stay_silent",
        actorProfileId: DEFAULT_ACTOR_CONTEXT.openMeldProfileId,
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        reason: "Handled privately.",
        text: "private",
      },
    };
    stub.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(statusSignal), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(systemNoticeSignal), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      );

    await rpcPostStatusSignal(env, {
      spaceId: SPACE_ID,
      profile: {
        kind: "agent",
        profileId: AGENT_PROFILE_ID,
        profileName: "spoofed-agent",
      },
      data: {
        actorProfileId: DEFAULT_ACTOR_CONTEXT.openMeldProfileId,
        dispatchId: "dispatch-status-1",
        generatedBy: "openmeld",
        status: "done",
        text: "done",
      },
      context: DEFAULT_CONTEXT,
    });
    await rpcPostSystemNoticeSignal(env, {
      spaceId: SPACE_ID,
      profile: {
        kind: "agent",
        profileId: AGENT_PROFILE_ID,
        profileName: "spoofed-agent",
      },
      data: {
        noticeType: "stay_silent",
        actorProfileId: DEFAULT_ACTOR_CONTEXT.openMeldProfileId,
        dispatchId: "dispatch-1",
        generatedBy: "openmeld",
        reason: "Handled privately.",
        text: "private",
      },
      context: DEFAULT_CONTEXT,
    });

    expect(stub.fetch).toHaveBeenCalledTimes(2);

    const [statusRequest] = stub.fetch.mock.calls[0] ?? [];
    expect(statusRequest).toBeInstanceOf(Request);
    if (!(statusRequest instanceof Request)) {
      throw new Error("expected first fetch call to receive a Request");
    }
    expect(new URL(statusRequest.url).pathname).toBe("/rpc/signals/status");
    expect(statusRequest.headers.get(OPENMELD_HEADER_PROFILE_ID)).toBe(
      DEFAULT_ACTOR_CONTEXT.openMeldProfileId
    );
    expect(statusRequest.headers.get(OPENMELD_HEADER_OWNER_USER_ID)).toBe(
      DEFAULT_ACTOR_CONTEXT.ownerUserId
    );
    await expect(statusRequest.clone().json()).resolves.toMatchObject({
      data: {
        dispatchId: "dispatch-status-1",
      },
      profile: {
        profileId: AGENT_PROFILE_ID,
      },
    });

    const [systemNoticeRequest] = stub.fetch.mock.calls[1] ?? [];
    expect(systemNoticeRequest).toBeInstanceOf(Request);
    if (!(systemNoticeRequest instanceof Request)) {
      throw new Error("expected second fetch call to receive a Request");
    }
    expect(new URL(systemNoticeRequest.url).pathname).toBe(
      "/rpc/signals/system-notice"
    );
    expect(systemNoticeRequest.headers.get(OPENMELD_HEADER_PROFILE_ID)).toBe(
      DEFAULT_ACTOR_CONTEXT.openMeldProfileId
    );
    expect(systemNoticeRequest.headers.get(OPENMELD_HEADER_OWNER_USER_ID)).toBe(
      DEFAULT_ACTOR_CONTEXT.ownerUserId
    );
    await expect(systemNoticeRequest.clone().json()).resolves.toMatchObject({
      data: {
        dispatchId: "dispatch-1",
      },
      profile: {
        profileId: AGENT_PROFILE_ID,
      },
    });
  });

  it("accepts the internal OpenMeld system context for post signal and system notice RPCs", async () => {
    const { env, stub } = createBindingsMock();
    const textSignal = {
      v: 1,
      id: "sig-system-text-1",
      spaceId: SPACE_ID,
      ts: Date.now(),
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.text",
      data: {
        text: "Authentication failed in OpenClaw.",
      },
    };
    stub.rpcPostSignal = vi.fn(async () => textSignal as SignalEnvelope);
    const systemNoticeSignal = {
      v: 1,
      id: "sig-system-notice-1",
      spaceId: SPACE_ID,
      ts: Date.now(),
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      type: "signal.system_notice",
      data: {
        noticeType: "terminal_failure",
        actorProfileId: AGENT_PROFILE_ID,
        actorName: "OpenClaw Demo",
        dispatchId: "dispatch-openclaw-auth-1",
        generatedBy: "openmeld",
        reason: "Authentication failed in OpenClaw.",
        text: "OpenClaw Demo couldn't reply: Authentication failed in OpenClaw.",
      },
    };
    stub.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(systemNoticeSignal), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await rpcPostSignal(env, {
      spaceId: SPACE_ID,
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      text: "Authentication failed in OpenClaw.",
      authoringPolicy: "system_emitted",
      context: SYSTEM_CONTEXT,
    });
    await rpcPostSystemNoticeSignal(env, {
      spaceId: SPACE_ID,
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld System",
      },
      data: {
        noticeType: "terminal_failure",
        actorProfileId: AGENT_PROFILE_ID,
        actorName: "OpenClaw Demo",
        dispatchId: "dispatch-openclaw-auth-1",
        generatedBy: "openmeld",
        reason: "Authentication failed in OpenClaw.",
        text: "OpenClaw Demo couldn't reply: Authentication failed in OpenClaw.",
      },
      context: SYSTEM_CONTEXT,
    });

    expect(stub.rpcPostSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        context: SYSTEM_CONTEXT,
        profile: expect.objectContaining({
          kind: "system",
          profileId: "openmeld-system",
        }),
        text: "Authentication failed in OpenClaw.",
      })
    );

    expect(stub.fetch).toHaveBeenCalledTimes(1);
    const [noticeRequest] = stub.fetch.mock.calls[0] ?? [];
    expect(noticeRequest).toBeInstanceOf(Request);
    if (!(noticeRequest instanceof Request)) {
      throw new Error("expected system notice request");
    }
    expect(noticeRequest.headers.get(OPENMELD_HEADER_PROFILE_ID)).toBe(
      "openmeld-system"
    );
  });

  it("forwards signal replyTo on transient post signal", async () => {
    const { env, stub } = createBindingsMock();

    await rpcPostTransientSignal(env, {
      spaceId: SPACE_ID,
      profile: {
        kind: "agent",
        profileId: AGENT_PROFILE_ID,
        profileName: "agent-1",
      },
      text: "hello",
      replyTo: TEST_REPLY_TO,
    });

    expect(stub.rpcPostTransientSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        replyTo: TEST_REPLY_TO,
      })
    );
  });

  it("preserves ownerName when forwarding RPC auth context", async () => {
    const { env, stub } = createBindingsMock();

    await rpcGetSpaceMembers(env, {
      spaceId: SPACE_ID,
      context: {
        ...DEFAULT_CONTEXT,
        actorContext: {
          ...DEFAULT_ACTOR_CONTEXT,
          profileKind: "agent",
          ownerName: "Mira Owner",
        },
      },
    });

    expect(stub.rpcGetMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: SPACE_ID,
        context: {
          ...DEFAULT_CONTEXT,
          actorContext: {
            ...DEFAULT_ACTOR_CONTEXT,
            profileKind: "agent",
            ownerName: "Mira Owner",
          },
        },
      })
    );
  });

  it("forwards password upsert request to direct DO RPC", async () => {
    const { env, stub } = createBindingsMock();
    const result = await rpcUpsertSpacePassword(env, {
      spaceId: SPACE_ID,
      password: "abc123",
      context: DEFAULT_CONTEXT,
    });

    expect(stub.rpcUpsertPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: SPACE_ID,
        password: "abc123",
      })
    );
    expect(result).toEqual({
      spaceId: "space-1",
      passwordProtected: true,
    });
  });

  it("forwards password clear request to direct DO RPC", async () => {
    const { env, stub } = createBindingsMock();
    const result = await rpcClearSpacePassword(env, {
      spaceId: SPACE_ID,
      context: DEFAULT_CONTEXT,
    });

    expect(stub.rpcClearPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: SPACE_ID,
      })
    );
    expect(result).toEqual({
      spaceId: "space-1",
      passwordProtected: false,
    });
  });

  it("forwards get members request to direct DO RPC", async () => {
    const { env, stub } = createBindingsMock();

    const result = await rpcGetSpaceMembers(env, {
      spaceId: SPACE_ID,
      context: DEFAULT_CONTEXT,
    });

    expect(stub.rpcGetMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: SPACE_ID,
        context: DEFAULT_CONTEXT,
      })
    );
    expect(result.summary.totalCount).toBe(1);
    expect(result.humans[0]?.profileId).toBe(
      DEFAULT_ACTOR_CONTEXT.openMeldProfileId
    );
  });

  it("forwards claim-time liveness to the Space-owned RPC instead of the members snapshot", async () => {
    const { env, stub } = createBindingsMock();

    const result = await rpcGetSpaceClaimTimeLiveness(env, {
      nowMs: 1000,
      relation: "wake",
      sourceClientMessageId: "message-1",
      sourceSignalId: "signal-1",
      spaceId: SPACE_ID,
      targetProfileId: AGENT_PROFILE_ID,
      context: DEFAULT_CONTEXT,
    });

    expect(stub.rpcGetClaimTimeLiveness).toHaveBeenCalledWith({
      nowMs: 1000,
      relation: "wake",
      sourceClientMessageId: "message-1",
      sourceSignalId: "signal-1",
      spaceId: SPACE_ID,
      targetProfileId: AGENT_PROFILE_ID,
    });
    expect(stub.rpcGetMembers).not.toHaveBeenCalled();
    expect(result.status).toBe("valid");
  });

  it("forwards add members request to direct DO RPC", async () => {
    const { env, stub } = createBindingsMock();

    const result = await rpcAddSpaceMembers(env, {
      spaceId: SPACE_ID,
      members: [
        {
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileName: "New Member",
          profileKind: "human",
          ownerUserId: null,
          ownerName: null,
          agentControllerRef: null,
        },
      ],
      context: DEFAULT_CONTEXT,
    });

    expect(stub.rpcPostMembers).toHaveBeenCalledWith({
      spaceId: SPACE_ID,
      members: [
        {
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileName: "New Member",
          profileKind: "human",
          ownerUserId: null,
          ownerName: null,
          agentControllerRef: null,
        },
      ],
      context: DEFAULT_CONTEXT,
    });
    expect(result.addedMemberIds).toEqual([SECOND_HUMAN_PROFILE_ID]);
  });

  it("forwards remove members request to direct DO RPC", async () => {
    const { env, stub } = createBindingsMock();

    const result = await rpcRemoveSpaceMembers(env, {
      spaceId: SPACE_ID,
      memberProfileIds: [SECOND_HUMAN_PROFILE_ID],
      context: DEFAULT_CONTEXT,
    });

    expect(stub.rpcRemoveMembers).toHaveBeenCalledWith({
      spaceId: SPACE_ID,
      memberProfileIds: [SECOND_HUMAN_PROFILE_ID],
      context: DEFAULT_CONTEXT,
    });
    expect(result.removedMemberIds).toEqual([SECOND_HUMAN_PROFILE_ID]);
    expect(result.alreadyAbsentMemberIds).toEqual([]);
  });
});
