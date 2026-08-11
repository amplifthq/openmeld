import {
  OPENMELD_HEADER_AGENT_CONTROLLER_REF,
  OPENMELD_HEADER_SPACE_PASSWORD,
} from "@openmeld/gateway-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { waitForJsonMessage } from "./test-support/ws-stream";

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

type AcceptableWebSocket = WebSocket & {
  accept(): void;
};

type AcceptableWebSocketPair = [WebSocket, AcceptableWebSocket];

const createWebSocketPair = (): AcceptableWebSocketPair => {
  const WebSocketPairConstructor = (
    globalThis as typeof globalThis & {
      WebSocketPair: new () => AcceptableWebSocketPair;
    }
  ).WebSocketPair;
  return new WebSocketPairConstructor();
};

type AuthRpcMock = {
  ping: ReturnType<typeof vi.fn>;
  resolveRequestAuth: ReturnType<typeof vi.fn>;
  resolveProfile: ReturnType<typeof vi.fn>;
};

function createAuthWorkerMock(input?: Partial<AuthRpcMock>) {
  return {
    ping: vi.fn(async () => ({ ok: true })),
    resolveRequestAuth: vi.fn(async () => ({
      ok: true,
      claims: {
        authenticated: true,
        requestId: "req-test",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        ownerIds: [],
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
    ...(input ?? {}),
  };
}

describe("gateway websocket stream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proxies websocket frames through OPENMELD_CORE_WORKER.fetch", async () => {
    let resolveUpstreamSocket: ((socket: AcceptableWebSocket) => void) | null =
      null;
    const upstreamSocketReady = new Promise<AcceptableWebSocket>((resolve) => {
      resolveUpstreamSocket = resolve;
    });

    const upstreamFetch = vi.fn((_request: Request) => {
      const [upstreamClient, upstreamServer] = createWebSocketPair();
      upstreamServer.accept();
      resolveUpstreamSocket?.(upstreamServer);

      return Promise.resolve(
        new Response(null, {
          status: 101,
          webSocket: upstreamClient,
        })
      );
    });

    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
        createSpace: vi.fn(async () => ({ spaceId: "unused" })),
        deleteSpace: vi.fn(async () => ({ spaceId: "unused", deleted: true })),
        listSignals: vi.fn(async () => []),
        postSignal: vi.fn(async () => ({})),
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    const request = new Request("http://local/v1/spaces/demo/stream", {
      headers: { Upgrade: "websocket" },
    });

    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(101);

    const clientSocket = response.webSocket;
    expect(clientSocket).toBeTruthy();
    if (!clientSocket) {
      throw new Error("Missing client websocket");
    }
    clientSocket.accept();

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [upstreamRequest] = upstreamFetch.mock.calls[0] as [Request];
    expect(new URL(upstreamRequest.url).pathname).toBe(
      "/v1/spaces/demo/stream"
    );
    expect(upstreamRequest.headers.get("Upgrade")).toBe("websocket");
    expect(upstreamRequest.headers.get("x-openmeld-request-id")).toBeTruthy();
    expect(upstreamRequest.headers.get("x-openmeld-profile-kind")).toBe(
      "human"
    );
    expect(upstreamRequest.headers.get("x-openmeld-owner-user-id")).toBe(
      "owner-001"
    );
    const upstreamServerSocket = await upstreamSocketReady;

    const helloSeenByUpstream = waitForJsonMessage(
      upstreamServerSocket,
      (data) => data.type === "hello"
    );
    clientSocket.send(
      JSON.stringify({
        type: "hello",
        profile: {
          kind: "agent",
          profileId: "codex-a",
          profileName: "Codex A",
          owner: "Felix",
        },
      })
    );
    const hello = await helloSeenByUpstream;
    expect((hello.profile as { profileId?: string }).profileId).toBe(
      "11111111-1111-4111-8111-111111111111"
    );
    expect((hello.profile as { profileName?: string }).profileName).toBe(
      "Mira"
    );
    expect((hello.profile as { kind?: string }).kind).toBe("human");

    const ackSeenByClient = waitForJsonMessage(
      clientSocket,
      (data) => data.type === "system.hello.ack"
    );
    upstreamServerSocket.send(
      JSON.stringify({
        type: "system.hello.ack",
        profile: { kind: "system", profileId: "core" },
      })
    );
    const ack = await ackSeenByClient;
    expect((ack.profile as { profileId?: string }).profileId).toBe("core");

    const signalSeenByUpstream = waitForJsonMessage(
      upstreamServerSocket,
      (data) => data.type === "signal.text"
    );
    clientSocket.send(
      JSON.stringify({ type: "signal.text", data: { text: "sync now" } })
    );
    const signal = await signalSeenByUpstream;
    expect((signal.data as { text?: string }).text).toBe("sync now");

    const upstreamSignalSeenByClient = waitForJsonMessage(
      clientSocket,
      (data) =>
        data.type === "signal.text" &&
        (data.data as { text?: string }).text === "upstream reply"
    );
    upstreamServerSocket.send(
      JSON.stringify({
        type: "signal.text",
        data: { text: "upstream reply" },
      })
    );
    const upstreamSignal = await upstreamSignalSeenByClient;
    expect((upstreamSignal.data as { text?: string }).text).toBe(
      "upstream reply"
    );

    clientSocket.close(1000, "done");
    upstreamServerSocket.close(1000, "done");
  });

  it("forwards x-openmeld-space-password header to upstream websocket request", async () => {
    const upstreamFetch = vi.fn((_request: Request) => {
      const [upstreamClient, upstreamServer] = createWebSocketPair();
      upstreamServer.accept();
      return Promise.resolve(
        new Response(null, {
          status: 101,
          webSocket: upstreamClient,
        })
      );
    });

    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
        createSpace: vi.fn(async () => ({ spaceId: "unused" })),
        deleteSpace: vi.fn(async () => ({ spaceId: "unused", deleted: true })),
        listSignals: vi.fn(async () => []),
        postSignal: vi.fn(async () => ({})),
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    const request = new Request("http://local/v1/spaces/demo/stream", {
      headers: {
        Upgrade: "websocket",
        [OPENMELD_HEADER_SPACE_PASSWORD]: "ws-pass",
      },
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(101);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [upstreamRequest] = upstreamFetch.mock.calls[0] as [Request];
    expect(upstreamRequest.headers.get(OPENMELD_HEADER_SPACE_PASSWORD)).toBe(
      "ws-pass"
    );

    response.webSocket?.accept();
    response.webSocket?.close(1000, "done");
  });

  it("returns upstream HTTP error directly when websocket upstream is rejected", async () => {
    const upstreamFetch = vi.fn(() => {
      return Promise.resolve(
        Response.json(
          {
            ok: false,
            error: {
              code: "space.password_required",
              message: "space password required",
              requestId: "req-core-1",
            },
          },
          {
            status: 401,
          }
        )
      );
    });
    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
        createSpace: vi.fn(async () => ({ spaceId: "unused" })),
        deleteSpace: vi.fn(async () => ({ spaceId: "unused", deleted: true })),
        listSignals: vi.fn(async () => []),
        postSignal: vi.fn(async () => ({})),
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    const request = new Request("http://local/v1/spaces/demo/stream", {
      headers: { Upgrade: "websocket" },
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(401);
    expect(response.webSocket).toBeFalsy();
    expect(response.headers.get("x-openmeld-request-id")).toBe("req-test");

    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("space.password_required");
    expect(payload.error?.message).toBe("space password required");
  });

  it("returns upstream HTTP error when websocket rejection response is returned synchronously", async () => {
    const upstreamFetch = vi.fn(() => {
      return Response.json(
        {
          ok: false,
          error: {
            code: "space.password_required",
            message: "space password required",
            requestId: "req-core-1",
          },
        },
        {
          status: 401,
        }
      );
    });
    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
        createSpace: vi.fn(async () => ({ spaceId: "unused" })),
        deleteSpace: vi.fn(async () => ({ spaceId: "unused", deleted: true })),
        listSignals: vi.fn(async () => []),
        postSignal: vi.fn(async () => ({})),
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    const request = new Request("http://local/v1/spaces/demo/stream", {
      headers: { Upgrade: "websocket" },
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(401);
    expect(response.webSocket).toBeFalsy();
    expect(response.headers.get("x-openmeld-request-id")).toBe("req-test");

    const payload = (await response.json()) as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("space.password_required");
    expect(payload.error?.message).toBe("space password required");
  });

  it("overrides hello with resolved agent profile and owner", async () => {
    let resolveUpstreamSocket: ((socket: AcceptableWebSocket) => void) | null =
      null;
    const upstreamSocketReady = new Promise<AcceptableWebSocket>((resolve) => {
      resolveUpstreamSocket = resolve;
    });

    const upstreamFetch = vi.fn((_request: Request) => {
      const [upstreamClient, upstreamServer] = createWebSocketPair();
      upstreamServer.accept();
      resolveUpstreamSocket?.(upstreamServer);

      return Promise.resolve(
        new Response(null, {
          status: 101,
          webSocket: upstreamClient,
        })
      );
    });

    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
        createSpace: vi.fn(async () => ({ spaceId: "unused" })),
        deleteSpace: vi.fn(async () => ({ spaceId: "unused", deleted: true })),
        listSignals: vi.fn(async () => []),
        postSignal: vi.fn(async () => ({})),
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock({
        resolveProfile: vi.fn(async () => ({
          ok: true,
          resolvedProfile: {
            openMeldProfileId: "agt_34567890-3456-4456-8456-34567890abcd",
            profileName: "Research Bot",
            profileKind: "agent",
            ownerUserId: "owner-123",
            ownerName: "felix",
            agentControllerRef: "builtin:codex",
          },
        })),
      }),
    } as unknown as CloudflareBindings;

    const request = new Request("http://local/v1/spaces/demo/stream", {
      headers: { Upgrade: "websocket" },
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(101);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const [upstreamRequest] = upstreamFetch.mock.calls[0] as [Request];
    expect(
      upstreamRequest.headers.get(OPENMELD_HEADER_AGENT_CONTROLLER_REF)
    ).toBe("builtin:codex");

    const clientSocket = response.webSocket;
    expect(clientSocket).toBeTruthy();
    if (!clientSocket) {
      throw new Error("Missing client websocket");
    }
    clientSocket.accept();

    const upstreamServerSocket = await upstreamSocketReady;
    const helloSeenByUpstream = waitForJsonMessage(
      upstreamServerSocket,
      (data) => data.type === "hello"
    );

    clientSocket.send(
      JSON.stringify({
        type: "hello",
        profile: {
          kind: "human",
          profileId: "forged-id",
          profileName: "forged-name",
          owner: "forged-owner",
        },
      })
    );

    const hello = await helloSeenByUpstream;
    expect((hello.profile as { kind?: string }).kind).toBe("agent");
    expect((hello.profile as { profileId?: string }).profileId).toBe(
      "agt_34567890-3456-4456-8456-34567890abcd"
    );
    expect((hello.profile as { profileName?: string }).profileName).toBe(
      "Research Bot"
    );
    expect((hello.profile as { owner?: string }).owner).toBe("owner-123");
    expect((hello.profile as { ownerName?: string }).ownerName).toBe("felix");
    expect(
      (hello.profile as { agentControllerRef?: string }).agentControllerRef
    ).toBe("builtin:codex");

    clientSocket.close(1000, "done");
    upstreamServerSocket.close(1000, "done");
  });

  it("returns 401 for forged profile headers when websocket handshake is unauthenticated", async () => {
    const coreFetch = vi.fn();
    const authWorker = createAuthWorkerMock({
      resolveRequestAuth: vi.fn(async () => ({
        ok: true,
        claims: {
          authenticated: false,
          requestId: "req-auth-401",
          ownerIds: [],
          authMethod: "none",
        },
      })),
    });
    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: coreFetch,
        createSpace: vi.fn(async () => ({ spaceId: "unused" })),
        deleteSpace: vi.fn(async () => ({ spaceId: "unused", deleted: true })),
        listSignals: vi.fn(async () => []),
        postSignal: vi.fn(async () => ({})),
      },
      OPENMELD_AUTH_WORKER: authWorker,
    } as unknown as CloudflareBindings;

    const request = new Request("http://local/v1/spaces/demo/stream", {
      headers: {
        Upgrade: "websocket",
        "x-openmeld-profile-id": "forged-profile",
        "x-openmeld-profile-kind": "agent",
      },
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(401);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("auth.unauthenticated");
    expect(payload.error?.requestId).toBe("req-auth-401");
    expect(authWorker.resolveProfile).not.toHaveBeenCalled();
    expect(coreFetch).not.toHaveBeenCalled();
  });

  it("returns 404 when websocket explicit profile cannot be resolved", async () => {
    const coreFetch = vi.fn();
    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: coreFetch,
        createSpace: vi.fn(async () => ({ spaceId: "unused" })),
        deleteSpace: vi.fn(async () => ({ spaceId: "unused", deleted: true })),
        listSignals: vi.fn(async () => []),
        postSignal: vi.fn(async () => ({})),
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock({
        resolveProfile: vi.fn(async () => ({
          ok: false,
          code: "profile.not_found",
          message: "profile not found",
        })),
      }),
    } as unknown as CloudflareBindings;

    const request = new Request("http://local/v1/spaces/demo/stream", {
      headers: {
        Upgrade: "websocket",
        "x-openmeld-profile-id": "agt_45678901-4567-4567-8567-45678901abcd",
      },
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(404);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("profile.not_found");
    expect(payload.error?.requestId).toBe("req-test");
    expect(coreFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when websocket explicit profile input is invalid", async () => {
    const coreFetch = vi.fn();
    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: coreFetch,
        createSpace: vi.fn(async () => ({ spaceId: "unused" })),
        deleteSpace: vi.fn(async () => ({ spaceId: "unused", deleted: true })),
        listSignals: vi.fn(async () => []),
        postSignal: vi.fn(async () => ({})),
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock({
        resolveProfile: vi.fn(async () => ({
          ok: false,
          code: "profile.invalid_input",
          message: "profileId must be a UUID or agt_<UUID>",
        })),
      }),
    } as unknown as CloudflareBindings;

    const request = new Request("http://local/v1/spaces/demo/stream", {
      headers: {
        Upgrade: "websocket",
        "x-openmeld-profile-id": "not-a-valid-profile-id",
      },
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string; requestId?: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("profile.invalid_input");
    expect(payload.error?.message).toBe(
      "profileId must be a UUID or agt_<UUID>"
    );
    expect(payload.error?.requestId).toBe("req-test");
    expect(coreFetch).not.toHaveBeenCalled();
  });

  it("accepts mixed-case Upgrade header values", async () => {
    const upstreamFetch = vi.fn((_request: Request) => {
      const [upstreamClient, upstreamServer] = createWebSocketPair();
      upstreamServer.accept();
      return Promise.resolve(
        new Response(null, {
          status: 101,
          webSocket: upstreamClient,
        })
      );
    });

    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
        createSpace: vi.fn(async () => ({ spaceId: "unused" })),
        deleteSpace: vi.fn(async () => ({ spaceId: "unused", deleted: true })),
        listSignals: vi.fn(async () => []),
        postSignal: vi.fn(async () => ({})),
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    const request = new Request("http://local/v1/spaces/demo/stream", {
      headers: { Upgrade: "WebSocket" },
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(101);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);

    response.webSocket?.accept();
    response.webSocket?.close(1000, "done");
  });

  it("returns error frame to client when upstream sends binary frame", async () => {
    let resolveUpstreamSocket: ((socket: AcceptableWebSocket) => void) | null =
      null;
    const upstreamSocketReady = new Promise<AcceptableWebSocket>((resolve) => {
      resolveUpstreamSocket = resolve;
    });

    const auditSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    const upstreamFetch = vi.fn((_request: Request) => {
      const [upstreamClient, upstreamServer] = createWebSocketPair();
      upstreamServer.accept();
      resolveUpstreamSocket?.(upstreamServer);

      return Promise.resolve(
        new Response(null, {
          status: 101,
          webSocket: upstreamClient,
        })
      );
    });

    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
        createSpace: vi.fn(async () => ({ spaceId: "unused" })),
        deleteSpace: vi.fn(async () => ({ spaceId: "unused", deleted: true })),
        listSignals: vi.fn(async () => []),
        postSignal: vi.fn(async () => ({})),
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    const request = new Request("http://local/v1/spaces/demo/stream", {
      headers: { Upgrade: "websocket" },
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);
    expect(response.status).toBe(101);

    const clientSocket = response.webSocket;
    if (!clientSocket) {
      throw new Error("Missing client websocket");
    }
    clientSocket.accept();
    const upstreamServerSocket = await upstreamSocketReady;

    const helloSeenByUpstream = waitForJsonMessage(
      upstreamServerSocket,
      (data) => data.type === "hello"
    );
    clientSocket.send(
      JSON.stringify({
        type: "hello",
        profile: {
          kind: "agent",
          profileId: "codex-a",
          profileName: "Codex A",
        },
      })
    );
    const hello = await helloSeenByUpstream;
    expect((hello.profile as { profileId?: string }).profileId).toBe(
      "11111111-1111-4111-8111-111111111111"
    );

    const ackSeenByClient = waitForJsonMessage(
      clientSocket,
      (data) => data.type === "system.hello.ack"
    );
    upstreamServerSocket.send(
      JSON.stringify({
        type: "system.hello.ack",
        profile: { kind: "system", profileId: "core" },
      })
    );
    await ackSeenByClient;

    const sawClientMessage = await waitForAnyMessage(clientSocket, 150);
    expect(sawClientMessage).toBe(false);

    const binaryErrorFrameSeenByClient = waitForJsonMessage(
      clientSocket,
      (data) =>
        data.type === "system.error" &&
        (data.error as { code?: string }).code === "invalid_payload"
    );
    upstreamServerSocket.send(new Uint8Array([1, 2, 3]).buffer);
    const binaryErrorFrame = await binaryErrorFrameSeenByClient;
    expect((binaryErrorFrame.error as { message?: string }).message).toContain(
      "binary frames are not supported"
    );

    expect(
      auditSpy.mock.calls.some((call) => {
        const entry = parseAuditLogEntry(call[0]);
        return (
          entry.event === "ws.reject" &&
          entry.errorCode === "upstream_binary_frame_ignored"
        );
      })
    ).toBe(true);

    clientSocket.close(1000, "done");
    upstreamServerSocket.close(1000, "done");
  });
});

function waitForAnyMessage(
  socket: WebSocket,
  timeoutMs: number
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const onMessage = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(false);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
    };
    socket.addEventListener("message", onMessage);
  });
}

function parseAuditLogEntry(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
