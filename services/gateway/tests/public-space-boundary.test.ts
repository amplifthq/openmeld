import { OPENMELD_SPACE_ADDRESSING_VERSION } from "@openmeld/gateway-contract";
import { describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { parseAnonymousSpaceReadRoute } from "../src/lib/anonymous-space-read-routes";
import { PUBLIC_SPACE_BOUNDARY_ROUTES } from "../src/routes/rpc-http.public-space";

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

function makeEnv(input?: {
  coreOverrides?: Record<string, unknown>;
  authOverrides?: Record<string, unknown>;
}): {
  env: CloudflareBindings;
  coreRpc: {
    getSpaceConversationState: ReturnType<typeof vi.fn>;
    getSpaceEntryResolution: ReturnType<typeof vi.fn>;
    getSpaceStatus: ReturnType<typeof vi.fn>;
    getSpaceMembers: ReturnType<typeof vi.fn>;
    getSpaceMemberDirectory: ReturnType<typeof vi.fn>;
    getSpaceViewerMembership: ReturnType<typeof vi.fn>;
    listSignals: ReturnType<typeof vi.fn>;
    listSpaceThreads: ReturnType<typeof vi.fn>;
    getSpaceThread: ReturnType<typeof vi.fn>;
    listSpaceThreadEvents: ReturnType<typeof vi.fn>;
    listSpaceThreadSignals: ReturnType<typeof vi.fn>;
    postSignal: ReturnType<typeof vi.fn>;
    addSpaceMembers: ReturnType<typeof vi.fn>;
    joinOrganizationPublicSpace: ReturnType<typeof vi.fn>;
    addCenterAgentToSpace: ReturnType<typeof vi.fn>;
    addOrganizationDirectoryProfilesToSpace: ReturnType<typeof vi.fn>;
    removeSpaceMembers: ReturnType<typeof vi.fn>;
    leaveSpace: ReturnType<typeof vi.fn>;
  };
  authRpc: {
    resolveRequestAuth: ReturnType<typeof vi.fn>;
    resolveProfile: ReturnType<typeof vi.fn>;
    listProfiles: ReturnType<typeof vi.fn>;
  };
} {
  const coreRpc = {
    getSpaceConversationState: vi.fn(async () => ({
      v: 1 as const,
      spaceId: "demo",
      streams: [],
    })),
    getSpaceEntryResolution: vi.fn(async () => ({
      target: { spaceId: "demo" },
      view: { state: "allowed" as const, experience: "public" as const },
      participation: { state: "self_join_available" as const },
      safeContext: { spaceName: "Demo" },
      recovery: null,
    })),
    getSpaceStatus: vi.fn(async () => ({
      spaceId: "demo",
      generatedAt: "2026-04-02T00:00:00.000Z",
      accessMode: "public",
      passwordProtected: false,
      dispatchPolicy: { mode: "mention_only" },
      publicationMode: "collaboration",
      allowedActions: ["post_message", "post_status", "stay_silent"],
      resultArchivePolicy: { mode: "all_final_results" },
      entryBrief: "default",
      dispatchBrief: "default",
      members: {
        totalCount: 1,
        humanCount: 1,
        agentCount: 0,
        liveNowCount: 1,
        liveHumanCount: 1,
        liveAgentCount: 0,
      },
    })),
    getSpaceMembers: vi.fn(async () => ({
      spaceId: "demo",
      generatedAt: "2026-04-02T00:00:00.000Z",
      summary: {
        totalCount: 1,
        humanCount: 1,
        agentCount: 0,
        liveNowCount: 1,
      },
      humans: [],
      agents: [],
    })),
    getSpaceMemberDirectory: vi.fn(async () => ({
      spaceId: "demo",
      generatedAt: "2026-04-02T00:00:00.000Z",
      members: [],
    })),
    getSpaceViewerMembership: vi.fn(async () => ({
      spaceId: "demo",
      activeMemberProfiles: [],
      preferredOpenProfileId: null,
    })),
    listSignals: vi.fn(async () => ({
      signals: [],
      nextCursor: null,
    })),
    listSpaceThreads: vi.fn(async () => ({
      threads: [],
      previews: [],
    })),
    getSpaceThread: vi.fn(async () => ({
      thread: {
        threadId: "thr_1",
        spaceId: "demo",
        rootSignalId: "sig_1",
        createdByProfileId: "11111111-1111-4111-8111-111111111111",
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
      rootSignal: null,
    })),
    listSpaceThreadEvents: vi.fn(async () => ({ events: [] })),
    listSpaceThreadSignals: vi.fn(async () => ({
      signals: [],
      placements: [],
    })),
    postSignal: vi.fn(async () => ({
      v: 1,
      id: "evt-1",
      spaceId: "demo",
      ts: 1,
      profile: {
        kind: "human",
        profileId: "11111111-1111-4111-8111-111111111111",
      },
      type: "signal.text",
      data: { text: "hello" },
    })),
    addSpaceMembers: vi.fn(async () => ({
      addedMemberIds: [],
      alreadyMemberIds: [],
      items: [],
    })),
    joinOrganizationPublicSpace: vi.fn(async () => ({
      addedMemberIds: ["11111111-1111-4111-8111-111111111111"],
      alreadyMemberIds: [],
      items: [],
    })),
    addCenterAgentToSpace: vi.fn(async () => ({
      addedMemberIds: ["agt_22222222-2222-4222-8222-222222222222"],
      alreadyMemberIds: [],
      items: [],
    })),
    addOrganizationDirectoryProfilesToSpace: vi.fn(async () => ({
      addedMemberIds: ["11111111-1111-4111-8111-111111111111"],
      alreadyMemberIds: [],
      items: [],
    })),
    removeSpaceMembers: vi.fn(async () => ({
      removedMemberIds: [],
      alreadyAbsentMemberIds: [],
    })),
    leaveSpace: vi.fn(async () => ({
      leftProfileId: "11111111-1111-4111-8111-111111111111",
      status: "left",
    })),
  };

  const authRpc = {
    resolveRequestAuth: vi.fn(async () => ({
      ok: true,
      claims: {
        authenticated: true,
        requestId: "req-test",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        ownerIds: ["owner-001"],
        authMethod: "session",
      },
    })),
    resolveProfile: vi.fn(async () => ({
      ok: true,
      resolvedProfile: {
        openMeldProfileId: "11111111-1111-4111-8111-111111111111",
        profileName: "Mira",
        profileKind: "human",
        ownerUserId: "owner-001",
      },
    })),
    listProfiles: vi.fn(async () => ({
      ok: true,
      profiles: [],
    })),
  };

  Object.assign(coreRpc, input?.coreOverrides);
  Object.assign(authRpc, input?.authOverrides);

  return {
    env: {
      OPENMELD_AUTH_WORKER: authRpc,
      OPENMELD_CORE_WORKER: coreRpc,
      OPENMELD_SPACE_PASSWORD_RATE_LIMITER: {
        limit: vi.fn(async () => ({ success: true })),
      } as unknown as RateLimit,
    } as unknown as CloudflareBindings,
    coreRpc,
    authRpc,
  };
}

async function readJsonBody(response: Response): Promise<unknown> {
  return await response.json();
}

describe("public space boundary", () => {
  it("forwards the complete Space entry target through one resolver", async () => {
    const spaceId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const getSpaceEntryResolution = vi.fn(async () => ({
      target: {
        spaceId,
        signalId: "signal-1",
        threadRootSignalId: "thread-1",
      },
      view: { state: "membership_required" as const },
      participation: { state: "owner_add_required" as const },
      safeContext: { spaceName: "Leadership" },
      recovery: { kind: "contact_space_owner" as const },
    }));
    const { env } = makeEnv({
      coreOverrides: { getSpaceEntryResolution },
    });

    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${spaceId}/entry-resolution?signalId=signal-1&threadRootSignalId=thread-1`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(getSpaceEntryResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        signalId: "signal-1",
        spaceId,
        threadRootSignalId: "thread-1",
        spaceAccess: expect.objectContaining({ spaceId }),
      })
    );
  });

  it("forwards bounded thread signal reads through Gateway to Core", async () => {
    const spaceId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const listSpaceThreadSignals = vi.fn(async () => ({
      placements: [],
      signals: [],
    }));
    const { env } = makeEnv({
      coreOverrides: { listSpaceThreadSignals },
    });

    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${spaceId}/threads/thread-1/signals?afterSignalId=sig-observed&limit=20`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(listSpaceThreadSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        afterSignalId: "sig-observed",
        limit: 20,
        spaceId,
        threadId: "thread-1",
      }),
      OPENMELD_SPACE_ADDRESSING_VERSION
    );
  });

  it("rejects incomplete bounded thread signal reads before Core", async () => {
    const spaceId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const listSpaceThreadSignals = vi.fn(async () => ({
      placements: [],
      signals: [],
    }));
    const { env } = makeEnv({
      coreOverrides: { listSpaceThreadSignals },
    });

    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${spaceId}/threads/thread-1/signals?afterSignalId=sig-observed`
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(listSpaceThreadSignals).not.toHaveBeenCalled();
  });

  it("forwards message preview reads through Space authorization", async () => {
    const spaceId = "a".repeat(64);
    const getSpaceLinkPreviews = vi.fn(async () => ({
      signalId: "message-1",
      revision: 0,
      previews: [],
    }));
    const { env } = makeEnv({
      coreOverrides: { getSpaceLinkPreviews },
      authOverrides: {
        resolveRequestAuth: vi.fn(async () => ({
          ok: true,
          claims: {
            authenticated: false,
            requestId: "req-preview",
            ownerIds: [],
            authMethod: "none",
          },
        })),
      },
    });
    const response = await app.fetch(
      new Request(
        `http://local/v1/spaces/${spaceId}/link-previews?signalId=message-1`,
        {
          headers: { "x-openmeld-space-password": "  preview-password  " },
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(getSpaceLinkPreviews).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId,
        signalId: "message-1",
        spaceAccess: expect.objectContaining({
          actor: expect.objectContaining({ kind: "anonymous_viewer" }),
          proof: { kind: "space_password", password: "preview-password" },
        }),
      })
    );
  });

  it("keeps the anonymous read allowlist separate and read-only", () => {
    const spaceId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const allowed = [
      `/v1/spaces/${spaceId}/link-previews?signalId=message-1`,
      `/v1/spaces/${spaceId}/conversation-state`,
      `/v1/spaces/${spaceId}/entry-resolution`,
      `/v1/spaces/${spaceId}/status`,
      `/v1/spaces/${spaceId}/signals`,
      `/v1/spaces/${spaceId}/threads`,
      `/v1/spaces/${spaceId}/threads/thread-1`,
      `/v1/spaces/${spaceId}/threads/thread-1/events`,
      `/v1/spaces/${spaceId}/threads/thread-1/signals`,
    ];

    for (const path of allowed) {
      expect(
        parseAnonymousSpaceReadRoute(new Request(`http://local${path}`))
      ).toEqual({ spaceId });
    }

    const denied = [
      new Request(`http://local/v1/spaces/${spaceId}/members`),
      new Request(`http://local/v1/spaces/${spaceId}/updates`),
      new Request(`http://local/v1/spaces/${spaceId}/active-wake-progress`),
      new Request(`http://local/v1/spaces/${spaceId}/wake-progress`),
      new Request(`http://local/v1/spaces/${spaceId}/result`),
      new Request(`http://local/v1/spaces/${spaceId}/meta`),
      new Request(`http://local/v1/spaces/${spaceId}/contract`),
      new Request(`http://local/v1/spaces/${spaceId}/signals`, {
        method: "POST",
      }),
      new Request(`http://local/v1/spaces/${spaceId}/threads`, {
        method: "POST",
      }),
    ];

    for (const request of denied) {
      expect(parseAnonymousSpaceReadRoute(request)).toBeNull();
    }
  });

  it("uses anonymous_viewer for unauthenticated anonymous read routes only", async () => {
    const spaceId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const { env, coreRpc, authRpc } = makeEnv({
      authOverrides: {
        resolveRequestAuth: vi.fn(async () => ({
          ok: true,
          claims: {
            authenticated: false,
            requestId: "req-anon",
            ownerIds: [],
            authMethod: "none",
          },
        })),
      },
    });

    const statusResponse = await app.fetch(
      new Request(`http://local/v1/spaces/${spaceId}/status`, {
        headers: { "x-openmeld-request-id": "req-anon" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(statusResponse.status).toBe(200);
    expect(coreRpc.getSpaceStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId,
        spaceAccess: expect.objectContaining({
          actor: expect.objectContaining({ kind: "anonymous_viewer" }),
          proof: expect.objectContaining({ kind: "none" }),
        }),
      })
    );
    const entryResolutionResponse = await app.fetch(
      new Request(`http://local/v1/spaces/${spaceId}/entry-resolution`, {
        headers: { "x-openmeld-request-id": "req-anon" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(entryResolutionResponse.status).toBe(200);
    expect(coreRpc.getSpaceEntryResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId,
        spaceAccess: expect.objectContaining({
          actor: expect.objectContaining({ kind: "anonymous_viewer" }),
          proof: expect.objectContaining({ kind: "none" }),
        }),
      })
    );
    const conversationStateResponse = await app.fetch(
      new Request(`http://local/v1/spaces/${spaceId}/conversation-state`, {
        headers: { "x-openmeld-request-id": "req-anon" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(conversationStateResponse.status).toBe(200);
    expect(coreRpc.getSpaceConversationState).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId,
        spaceAccess: expect.objectContaining({
          actor: expect.objectContaining({ kind: "anonymous_viewer" }),
        }),
      })
    );
    expect(authRpc.resolveProfile).not.toHaveBeenCalled();

    await app.fetch(
      new Request(`http://local/v1/spaces/${spaceId}/signals`, {
        headers: {
          "x-openmeld-request-id": "req-anon",
          "x-openmeld-space-password": "  view-password  ",
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(coreRpc.listSignals).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceAccess: expect.objectContaining({
          actor: expect.objectContaining({ kind: "anonymous_viewer" }),
          proof: {
            kind: "space_password",
            password: "view-password",
          },
        }),
      }),
      OPENMELD_SPACE_ADDRESSING_VERSION
    );

    const postResponse = await app.fetch(
      new Request(`http://local/v1/spaces/${spaceId}/signals`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openmeld-request-id": "req-anon",
        },
        body: JSON.stringify({ text: "hello" }),
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(postResponse.status).toBe(401);
    expect(coreRpc.postSignal).not.toHaveBeenCalled();

    const membersResponse = await app.fetch(
      new Request(`http://local/v1/spaces/${spaceId}/members`, {
        headers: { "x-openmeld-request-id": "req-anon" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );
    expect(membersResponse.status).toBe(401);
    expect(coreRpc.getSpaceMembers).not.toHaveBeenCalled();
  });

  it("keeps authenticated public reads viewable when profile resolution fails", async () => {
    const spaceId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const { env, coreRpc, authRpc } = makeEnv({
      authOverrides: {
        resolveProfile: vi.fn(async () => ({
          ok: false,
          code: "profile.not_found",
          message: "profile not found",
        })),
      },
    });

    const response = await app.fetch(
      new Request(`http://local/v1/spaces/${spaceId}/status`, {
        headers: { "x-openmeld-request-id": "req-auth-profile-missing" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(authRpc.resolveProfile).toHaveBeenCalledTimes(1);
    expect(coreRpc.getSpaceStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId,
        spaceAccess: expect.objectContaining({
          actor: expect.objectContaining({ kind: "anonymous_viewer" }),
        }),
      })
    );
  });

  it("uses authenticated actors on anonymous read routes when a session is present", async () => {
    const spaceId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const { env, coreRpc } = makeEnv();

    const response = await app.fetch(
      new Request(`http://local/v1/spaces/${spaceId}/threads`, {
        headers: { "x-openmeld-request-id": "req-auth" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(coreRpc.listSpaceThreads).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId,
        spaceAccess: expect.objectContaining({
          actor: expect.objectContaining({ kind: "authenticated" }),
        }),
      }),
      OPENMELD_SPACE_ADDRESSING_VERSION
    );
  });

  it("keeps public Space message reads compatible with old strict clients", async () => {
    const spaceId =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const threadId = "thr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const messageEnvelope = {
      activationTargets: [],
      referenceTargets: ["agt_22222222-2222-4222-8222-222222222222"],
      text: "Reference context.",
    };
    const signal = {
      v: 1,
      id: "sig-legacy-reader",
      spaceId,
      ts: 1,
      profile: {
        kind: "human",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileName: "Mira",
      },
      type: "signal.text",
      data: {
        messageEnvelope,
        text: messageEnvelope.text,
      },
    };
    const thread = {
      threadId,
      spaceId,
      rootSignalId: signal.id,
      createdByProfileId: signal.profile.profileId,
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
    };
    const placement = {
      threadId,
      signalId: signal.id,
      placement: "root",
      createdAt: "2026-07-19T00:00:00.000Z",
    };
    const { env } = makeEnv({
      coreOverrides: {
        getSpaceThread: vi.fn(async () => ({
          thread,
          rootSignal: signal,
        })),
        listSignals: vi.fn(async () => ({
          signals: [signal],
          nextCursor: null,
        })),
        listSpaceThreadSignals: vi.fn(async () => ({
          signals: [signal],
          placements: [placement],
        })),
        listSpaceThreads: vi.fn(async () => ({
          threads: [thread],
          previews: [
            {
              threadId,
              replyCount: 0,
              signals: [signal],
              placements: [placement],
            },
          ],
        })),
      },
    });
    const [
      signalsResponse,
      threadsResponse,
      threadResponse,
      threadSignalsResponse,
    ] = await Promise.all([
      app.fetch(
        new Request(`http://local/v1/spaces/${spaceId}/signals`),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        new Request(`http://local/v1/spaces/${spaceId}/threads`),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        new Request(`http://local/v1/spaces/${spaceId}/threads/${threadId}`),
        env,
        TEST_EXECUTION_CONTEXT
      ),
      app.fetch(
        new Request(
          `http://local/v1/spaces/${spaceId}/threads/${threadId}/signals`
        ),
        env,
        TEST_EXECUTION_CONTEXT
      ),
    ]);
    expect([
      signalsResponse.status,
      threadsResponse.status,
      threadResponse.status,
      threadSignalsResponse.status,
    ]).toEqual([200, 200, 200, 200]);

    const signalsPayload = (await signalsResponse.json()) as {
      signals: Array<{ data?: { messageEnvelope?: unknown } }>;
    };
    const threadsPayload = (await threadsResponse.json()) as {
      previews: Array<{
        signals: Array<{ data?: { messageEnvelope?: unknown } }>;
      }>;
    };
    const threadPayload = (await threadResponse.json()) as {
      rootSignal?: { data?: { messageEnvelope?: unknown } };
    };
    const threadSignalsPayload = (await threadSignalsResponse.json()) as {
      signals: Array<{ data?: { messageEnvelope?: unknown } }>;
    };
    const envelopes = [
      signalsPayload.signals[0]?.data?.messageEnvelope,
      threadsPayload.previews[0]?.signals[0]?.data?.messageEnvelope,
      threadPayload.rootSignal?.data?.messageEnvelope,
      threadSignalsPayload.signals[0]?.data?.messageEnvelope,
    ];
    for (const envelope of envelopes) {
      expect(envelope).toEqual({
        ...messageEnvelope,
        ccTargets: [],
      });
    }
  });

  it("exposes the approved public space boundary route set", () => {
    expect(PUBLIC_SPACE_BOUNDARY_ROUTES).toEqual([
      { method: "GET", path: "/v1/spaces/:spaceId/link-previews" },
      { method: "GET", path: "/v1/spaces/:spaceId/conversation-state" },
      { method: "GET", path: "/v1/spaces/:spaceId/status" },
      { method: "GET", path: "/v1/spaces/:spaceId/entry-resolution" },
      { method: "GET", path: "/v1/spaces/:spaceId/members" },
      { method: "GET", path: "/v1/spaces/:spaceId/identity-directory" },
      { method: "GET", path: "/v1/spaces/:spaceId/member-directory" },
      { method: "POST", path: "/v1/spaces/:spaceId/members" },
      { method: "POST", path: "/v1/spaces/:spaceId/members/remove" },
      { method: "POST", path: "/v1/spaces/:spaceId/leave" },
      { method: "POST", path: "/v1/spaces/:spaceId/join" },
      { method: "POST", path: "/v1/spaces/:spaceId/center-agent" },
      {
        method: "POST",
        path: "/v1/spaces/:spaceId/organization-directory-profiles",
      },
      { method: "GET", path: "/v1/spaces/:spaceId/signals" },
      { method: "POST", path: "/v1/spaces/:spaceId/signals" },
      { method: "GET", path: "/v1/spaces/:spaceId/threads" },
      { method: "POST", path: "/v1/spaces/:spaceId/threads" },
    ]);

    const routeSet = new Set(
      PUBLIC_SPACE_BOUNDARY_ROUTES.map(
        (entry) => `${entry.method} ${entry.path}`
      )
    );
    expect(routeSet.has("GET /v1/spaces/:spaceId/meta")).toBe(false);
    expect(routeSet.has("PATCH /v1/spaces/:spaceId/meta")).toBe(false);
    expect(routeSet.has("GET /v1/spaces/:spaceId/contract")).toBe(false);
    expect(routeSet.has("PATCH /v1/spaces/:spaceId/contract")).toBe(false);
    expect(routeSet.has("GET /v1/spaces/:spaceId/updates")).toBe(false);
    expect(routeSet.has("GET /v1/spaces/:spaceId/result")).toBe(false);
    expect(routeSet.has("GET /v1/spaces/:spaceId/dispatches/lookup")).toBe(
      false
    );
    expect(routeSet.has("GET /v1/spaces/:spaceId/dispatches/trace")).toBe(
      false
    );
    expect(routeSet.has("GET /v1/spaces/:spaceId/wake-progress")).toBe(false);
    expect(routeSet.has("GET /v1/profiles/:profileId/spaces")).toBe(false);
  });

  it("returns invalid_space_id consistently across all public space routes", async () => {
    const { env, coreRpc } = makeEnv();
    const cases = [
      new Request("http://local/v1/spaces/%20%20%20/conversation-state"),
      new Request("http://local/v1/spaces/%20%20%20/status"),
      new Request("http://local/v1/spaces/%20%20%20/entry-resolution"),
      new Request("http://local/v1/spaces/%20%20%20/members"),
      new Request("http://local/v1/spaces/%20%20%20/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberProfileIds: ["agt_22222222-2222-4222-8222-222222222222"],
        }),
      }),
      new Request("http://local/v1/spaces/%20%20%20/members/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberProfileIds: ["agt_22222222-2222-4222-8222-222222222222"],
        }),
      }),
      new Request("http://local/v1/spaces/%20%20%20/leave", {
        method: "POST",
      }),
      new Request("http://local/v1/spaces/%20%20%20/join", {
        method: "POST",
      }),
      new Request("http://local/v1/spaces/%20%20%20/signals"),
      new Request("http://local/v1/spaces/%20%20%20/signals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      }),
    ];

    for (const request of cases) {
      const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
      expect(response.status).toBe(400);
      expect(response.headers.get("x-openmeld-request-id")).toBe("req-test");
      await expect(readJsonBody(response)).resolves.toMatchObject({
        ok: false,
        error: {
          code: "invalid_space_id",
          message: "Too small: expected string to have >=1 characters",
          requestId: "req-test",
        },
      });
    }

    expect(coreRpc.getSpaceStatus).not.toHaveBeenCalled();
    expect(coreRpc.getSpaceConversationState).not.toHaveBeenCalled();
    expect(coreRpc.getSpaceMembers).not.toHaveBeenCalled();
    expect(coreRpc.addSpaceMembers).not.toHaveBeenCalled();
    expect(coreRpc.removeSpaceMembers).not.toHaveBeenCalled();
    expect(coreRpc.leaveSpace).not.toHaveBeenCalled();
    expect(coreRpc.listSignals).not.toHaveBeenCalled();
    expect(coreRpc.postSignal).not.toHaveBeenCalled();
  });

  it("keeps request-id headers stable on success, bad request, and upstream failure", async () => {
    const successEnv = makeEnv();
    const successResponse = await app.fetch(
      new Request("http://local/v1/spaces/demo/status"),
      successEnv.env,
      TEST_EXECUTION_CONTEXT
    );
    expect(successResponse.status).toBe(200);
    expect(successResponse.headers.get("x-openmeld-request-id")).toBe(
      "req-test"
    );

    const badRequestEnv = makeEnv();
    const badRequestResponse = await app.fetch(
      new Request("http://local/v1/spaces/demo/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberProfileIds: [],
        }),
      }),
      badRequestEnv.env,
      TEST_EXECUTION_CONTEXT
    );
    expect(badRequestResponse.status).toBe(400);
    expect(badRequestResponse.headers.get("x-openmeld-request-id")).toBe(
      "req-test"
    );
    await expect(readJsonBody(badRequestResponse)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "invalid_payload",
        requestId: "req-test",
      },
    });

    const upstreamFailureEnv = makeEnv({
      coreOverrides: {
        listSignals: vi.fn(() => {
          throw new Error("core worker failed unexpectedly");
        }),
      },
    });
    const upstreamFailureResponse = await app.fetch(
      new Request("http://local/v1/spaces/demo/signals"),
      upstreamFailureEnv.env,
      TEST_EXECUTION_CONTEXT
    );
    expect(upstreamFailureResponse.status).toBe(502);
    expect(upstreamFailureResponse.headers.get("x-openmeld-request-id")).toBe(
      "req-test"
    );
    await expect(readJsonBody(upstreamFailureResponse)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "upstream_unreachable",
        requestId: "req-test",
      },
    });
  });

  it("returns upstream_error when a public-space success payload drifts from the shared contract", async () => {
    const routeCases = [
      {
        name: "GET /status",
        request: new Request("http://local/v1/spaces/demo/status"),
        env: makeEnv({
          coreOverrides: {
            getSpaceStatus: vi.fn(async () => ({
              spaceId: "demo",
              members: null,
            })),
          },
        }),
      },
      {
        name: "GET /members",
        request: new Request("http://local/v1/spaces/demo/members"),
        env: makeEnv({
          coreOverrides: {
            getSpaceMembers: vi.fn(async () => ({
              spaceId: "demo",
              generatedAt: "2026-04-02T00:00:00.000Z",
              summary: {
                totalCount: 1,
                humanCount: 1,
                agentCount: 0,
                liveNowCount: 1,
              },
              humans: [],
            })),
          },
        }),
      },
      {
        name: "POST /members",
        request: new Request("http://local/v1/spaces/demo/members", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            memberProfileIds: ["agt_22222222-2222-4222-8222-222222222222"],
          }),
        }),
        env: makeEnv({
          coreOverrides: {
            addSpaceMembers: vi.fn(async () => ({
              addedMembers: [],
            })),
          },
          authOverrides: {
            listProfiles: vi.fn(async () => ({
              ok: true,
              profiles: [
                {
                  openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
                  profileKind: "agent",
                  profileName: "Ops Bot",
                  status: "active",
                  ownerUserId: "owner-001",
                  ownerName: "Mira",
                },
              ],
            })),
          },
        }),
      },
      {
        name: "POST /members/remove",
        request: new Request("http://local/v1/spaces/demo/members/remove", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            memberProfileIds: ["agt_22222222-2222-4222-8222-222222222222"],
          }),
        }),
        env: makeEnv({
          coreOverrides: {
            removeSpaceMembers: vi.fn(async () => ({
              removedMembers: [],
            })),
          },
        }),
      },
      {
        name: "GET /signals",
        request: new Request("http://local/v1/spaces/demo/signals"),
        env: makeEnv({
          coreOverrides: {
            listSignals: vi.fn(async () => ({
              signals: "not-an-array",
              nextCursor: null,
            })),
          },
        }),
      },
      {
        name: "POST /signals",
        request: new Request("http://local/v1/spaces/demo/signals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "hello" }),
        }),
        env: makeEnv({
          coreOverrides: {
            postSignal: vi.fn(async () => ({
              type: "signal.text",
            })),
          },
        }),
      },
    ] as const;

    for (const routeCase of routeCases) {
      const response = await app.fetch(
        routeCase.request,
        routeCase.env.env,
        TEST_EXECUTION_CONTEXT
      );

      expect(response.status, routeCase.name).toBe(502);
      expect(
        response.headers.get("x-openmeld-request-id"),
        routeCase.name
      ).toBe("req-test");
      await expect(readJsonBody(response)).resolves.toMatchObject({
        ok: false,
        error: {
          code: "upstream_error",
          message: "upstream returned invalid response payload",
          requestId: "req-test",
        },
      });
    }
  });

  it("does not leak internal worker fields from auth/profile/core failures", async () => {
    const profileFailureEnv = makeEnv({
      authOverrides: {
        resolveProfile: vi.fn(async () => ({
          ok: false,
          code: "profile.not_found",
          message: "profile not found",
          debug: {
            upstreamService: "auth-worker",
          },
        })),
      },
    });
    const profileFailureResponse = await app.fetch(
      new Request("http://local/v1/spaces/demo/status"),
      profileFailureEnv.env,
      TEST_EXECUTION_CONTEXT
    );
    expect(profileFailureResponse.status).toBe(502);
    await expect(readJsonBody(profileFailureResponse)).resolves.toEqual({
      ok: false,
      error: {
        code: "upstream_unreachable",
        message: "Auth returned an invalid Profile response.",
        requestId: "req-test",
      },
    });

    const coreFailureEnv = makeEnv({
      coreOverrides: {
        getSpaceStatus: vi.fn(() => {
          const error = new Error("space disappeared") as Error & {
            status?: number;
            code?: string;
            internalTraceId?: string;
          };
          error.status = 404;
          error.code = "space.not_found";
          error.internalTraceId = "trace-hidden";
          throw error;
        }),
      },
    });
    const coreFailureResponse = await app.fetch(
      new Request("http://local/v1/spaces/demo/status"),
      coreFailureEnv.env,
      TEST_EXECUTION_CONTEXT
    );
    expect(coreFailureResponse.status).toBe(404);
    await expect(readJsonBody(coreFailureResponse)).resolves.toEqual({
      ok: false,
      error: {
        code: "space.not_found",
        message: "space disappeared",
        requestId: "req-test",
      },
    });
  });
});
