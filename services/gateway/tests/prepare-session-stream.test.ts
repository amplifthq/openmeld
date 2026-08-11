import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { decodeEventData } from "./test-support/ws-stream";

const TEST_EXECUTION_CONTEXT = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

type AuthRpcMock = {
  ping: ReturnType<typeof vi.fn>;
  resolveRequestAuth: ReturnType<typeof vi.fn>;
  resolveProfile: ReturnType<typeof vi.fn>;
};

type AcceptableWebSocket = WebSocket & {
  accept(): void;
};

type AcceptableWebSocketPair = [WebSocket, AcceptableWebSocket];

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

function createWebSocketPair(): AcceptableWebSocketPair {
  const WebSocketPairConstructor = (
    globalThis as typeof globalThis & {
      WebSocketPair: new () => AcceptableWebSocketPair;
    }
  ).WebSocketPair;
  return new WebSocketPairConstructor();
}

describe("gateway prepare session stream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("forwards the upstream snapshot sent during websocket accept", async () => {
    const upstreamFetch = vi.fn(() => {
      const [upstreamClient, upstreamServer] = createWebSocketPair();
      upstreamServer.accept();
      const acceptableUpstreamClient = upstreamClient as AcceptableWebSocket;
      const acceptUpstreamClient = acceptableUpstreamClient.accept.bind(
        acceptableUpstreamClient
      );
      Object.defineProperty(acceptableUpstreamClient, "accept", {
        configurable: true,
        value: vi.fn(() => {
          acceptUpstreamClient();
          upstreamServer.send("prepare-snapshot-frame");
        }),
      });

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
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    const response = await app.fetch(
      new Request("http://local/v1/prepare/sessions/prep-123/stream?role=web", {
        headers: { Upgrade: "websocket" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(101);
    const clientSocket = response.webSocket;
    expect(clientSocket).toBeTruthy();
    if (!clientSocket) {
      throw new Error("Missing client websocket");
    }
    clientSocket.accept();

    await expect(waitForRawWebSocketMessage(clientSocket)).resolves.toBe(
      "prepare-snapshot-frame"
    );
  });

  it("buffers terminal frames sent before the upstream websocket is attached", async () => {
    const RealWebSocketPair = (
      globalThis as typeof globalThis & {
        WebSocketPair: new () => AcceptableWebSocketPair;
      }
    ).WebSocketPair;
    const [realLocalClient, realLocalServer] = new RealWebSocketPair();
    const serverMessageListeners: Array<(event: MessageEvent) => void> = [];
    const localServerSocket = {
      accept: vi.fn(() => realLocalServer.accept()),
      close: vi.fn((code?: number, reason?: string) =>
        realLocalServer.close(code, reason)
      ),
      send: vi.fn((payload: string | ArrayBuffer) =>
        realLocalServer.send(payload)
      ),
      addEventListener: vi.fn(
        (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions
        ) => {
          realLocalServer.addEventListener(
            type,
            listener as EventListener,
            options
          );
          if (type === "message" && typeof listener === "function") {
            serverMessageListeners.push(
              listener as (event: MessageEvent) => void
            );
          }
        }
      ),
      removeEventListener: vi.fn(
        (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | EventListenerOptions
        ) =>
          realLocalServer.removeEventListener(
            type,
            listener as EventListener,
            options
          )
      ),
    } as unknown as AcceptableWebSocket;

    const FakeWebSocketPair = class extends Array<
      WebSocket | AcceptableWebSocket
    > {
      constructor() {
        super(realLocalClient, localServerSocket);
      }
    } as unknown as new () => [WebSocket, AcceptableWebSocket];

    vi.stubGlobal("WebSocketPair", FakeWebSocketPair);

    let resolveUpstreamResponse!: (response: Response) => void;
    const upstreamFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveUpstreamResponse = resolve;
        })
    );

    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    const responsePromise = app.fetch(
      new Request(
        "http://local/v1/prepare/sessions/prep-123/stream?role=terminal",
        {
          headers: {
            Upgrade: "websocket",
            "x-openmeld-prepare-token": "preptok_test",
          },
        }
      ),
      env,
      TEST_EXECUTION_CONTEXT
    );

    await vi.waitFor(() => {
      expect(upstreamFetch).toHaveBeenCalledTimes(1);
      expect(serverMessageListeners).toHaveLength(1);
    });

    serverMessageListeners[0]?.({
      data: "terminal-step-frame",
    } as MessageEvent);

    const [upstreamClient, upstreamServer] = new RealWebSocketPair();
    upstreamServer.accept();
    const upstreamMessagePromise = waitForRawWebSocketMessage(upstreamServer);
    resolveUpstreamResponse(
      new Response(null, {
        status: 101,
        webSocket: upstreamClient,
      })
    );

    const response = await responsePromise;

    expect(response.status).toBe(101);
    await expect(upstreamMessagePromise).resolves.toBe("terminal-step-frame");
  });
});

function waitForRawWebSocketMessage(
  socket: WebSocket,
  timeoutMs = 2000
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      cleanup();
      resolve(decodeEventData(event.data));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before receiving message"));
    };
    const onError = () => {
      cleanup();
      reject(new Error("WebSocket error before receiving message"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
  });
}
