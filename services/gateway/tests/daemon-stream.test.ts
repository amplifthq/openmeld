import { OPENMELD_HEADER_AGENT_CONTROLLER_REF } from "@openmeld/gateway-contract";
import {
  COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY,
  LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY,
  OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER,
  OPENMELD_RUNTIME_CAPABILITIES_HEADER,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";

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

type TestWebSocketPair = [WebSocket, WebSocket];

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

describe("gateway daemon stream", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects non-websocket requests before contacting Core", async () => {
    const upstreamFetch = vi.fn();
    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    const response = await app.fetch(
      new Request("http://local/v1/daemon/stream"),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(upstreamFetch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "bad_request",
        message: "expected websocket",
        requestId: "req-test",
      },
    });
  });

  it("passes through upstream websocket upgrade without creating a Gateway relay socket", async () => {
    const RealWebSocketPair = (
      globalThis as typeof globalThis & {
        WebSocketPair: new () => TestWebSocketPair;
      }
    ).WebSocketPair;
    const [upstreamClient] = new RealWebSocketPair();
    const upstreamAccept = vi.fn();
    Object.defineProperty(upstreamClient, "accept", {
      configurable: true,
      value: upstreamAccept,
    });
    const upstreamAddEventListener = vi.spyOn(
      upstreamClient,
      "addEventListener"
    );
    const upstreamSend = vi.spyOn(upstreamClient, "send");
    const upstreamResponse = new Response(null, {
      status: 101,
      webSocket: upstreamClient,
    });
    const upstreamFetch = vi.fn(async (_request: Request) => upstreamResponse);

    vi.stubGlobal(
      "WebSocketPair",
      class {
        constructor() {
          throw new Error("Gateway daemon stream must not create a relay pair");
        }
      }
    );

    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    const response = await app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: { Upgrade: "websocket" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(101);
    expect(response.webSocket).toBe(upstreamClient);
    expect(upstreamAccept).not.toHaveBeenCalled();
    expect(upstreamAddEventListener).not.toHaveBeenCalled();
    expect(upstreamSend).not.toHaveBeenCalled();
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const upstreamRequest = upstreamFetch.mock.calls[0]?.[0];
    if (!(upstreamRequest instanceof Request)) {
      throw new Error("Missing upstream request");
    }
    expect(new URL(upstreamRequest.url).pathname).toBe("/v1/daemon/stream");
    expect(upstreamRequest.headers.get("Upgrade")).toBe("websocket");
  });

  it("forwards the recognized Computer file access capability to Core", async () => {
    const upstreamFetch = vi.fn(async (_request: Request) =>
      Response.json(
        {
          ok: false,
          code: "auth.unauthenticated",
          message: "missing owner user id",
          requestId: "req-core-401",
        },
        { status: 401 }
      )
    );
    const env = {
      OPENMELD_CORE_WORKER: { fetch: upstreamFetch },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    await app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: {
          Upgrade: "websocket",
          [OPENMELD_RUNTIME_CAPABILITIES_HEADER]:
            COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY,
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    const upstreamRequest = upstreamFetch.mock.calls[0]?.[0];
    if (!(upstreamRequest instanceof Request)) {
      throw new Error("Missing upstream request");
    }
    expect(
      upstreamRequest.headers.get(OPENMELD_RUNTIME_CAPABILITIES_HEADER)
    ).toBe(COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY);
  });

  it("forwards Local Folder Picker negotiation independently from strict runtime capabilities", async () => {
    const upstreamFetch = vi.fn(async (_request: Request) =>
      Response.json({ ok: false }, { status: 401 })
    );
    const env = {
      OPENMELD_CORE_WORKER: { fetch: upstreamFetch },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    await app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: {
          Upgrade: "websocket",
          [OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER]:
            LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY,
          [OPENMELD_RUNTIME_CAPABILITIES_HEADER]:
            COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY,
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    const upstreamRequest = upstreamFetch.mock.calls[0]?.[0];
    if (!(upstreamRequest instanceof Request)) {
      throw new Error("Missing upstream request");
    }
    expect(
      upstreamRequest.headers.get(
        OPENMELD_LOCAL_FOLDER_PICKER_CAPABILITY_HEADER
      )
    ).toBe(LOCAL_FOLDER_PICKER_RUNTIME_CAPABILITY);
    expect(
      upstreamRequest.headers.get(OPENMELD_RUNTIME_CAPABILITIES_HEADER)
    ).toBe(COMPUTER_FILE_ACCESS_RUNTIME_CAPABILITY);
  });

  it("does not forward an unrecognized runtime capability to Core", async () => {
    const upstreamFetch = vi.fn(async (_request: Request) =>
      Response.json({ ok: false }, { status: 401 })
    );
    const env = {
      OPENMELD_CORE_WORKER: { fetch: upstreamFetch },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    await app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: {
          Upgrade: "websocket",
          [OPENMELD_RUNTIME_CAPABILITIES_HEADER]: "unknown-capability-v1",
        },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    const upstreamRequest = upstreamFetch.mock.calls[0]?.[0];
    if (!(upstreamRequest instanceof Request)) {
      throw new Error("Missing upstream request");
    }
    expect(
      upstreamRequest.headers.get(OPENMELD_RUNTIME_CAPABILITIES_HEADER)
    ).toBeNull();
  });

  it("returns upstream HTTP rejection response when daemon websocket upgrade is denied", async () => {
    const upstreamFetch = vi.fn(async (_request: Request) =>
      Response.json(
        {
          ok: false,
          code: "auth.unauthenticated",
          message: "missing owner user id",
          requestId: "req-core-401",
        },
        { status: 401 }
      )
    );

    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    const request = new Request("http://local/v1/daemon/stream", {
      headers: { Upgrade: "websocket" },
    });
    const response = await app.fetch(request, env, TEST_EXECUTION_CONTEXT);

    expect(response.status).toBe(401);
    expect(response.webSocket).toBeFalsy();
    expect(response.headers.get("x-openmeld-request-id")).toBe("req-test");
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const upstreamRequest = upstreamFetch.mock.calls[0]?.[0];
    if (!(upstreamRequest instanceof Request)) {
      throw new Error("Missing upstream request");
    }
    expect(new URL(upstreamRequest.url).pathname).toBe("/v1/daemon/stream");
    expect(upstreamRequest.headers.get("Upgrade")).toBe("websocket");

    const payload = (await response.json()) as {
      ok: boolean;
      code?: string;
      message?: string;
      requestId?: string;
    };
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("auth.unauthenticated");
    expect(payload.message).toBe("missing owner user id");
    expect(payload.requestId).toBe("req-core-401");
  });

  it("forwards canonical agentControllerRef in daemon websocket handshake headers", async () => {
    const upstreamFetch = vi.fn(async (_request: Request) =>
      Response.json(
        {
          ok: false,
          code: "auth.unauthenticated",
          message: "missing owner user id",
          requestId: "req-core-401",
        },
        { status: 401 }
      )
    );

    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock({
        resolveRequestAuth: vi.fn(async () => ({
          ok: true,
          claims: {
            authenticated: true,
            requestId: "req-test",
            profileId: "agt_12345678-1234-4234-8234-123456789abc",
            profileKind: "agent",
            ownerIds: ["owner-001"],
            authMethod: "session",
          },
        })),
        resolveProfile: vi.fn(async () => ({
          ok: true,
          resolvedProfile: {
            openMeldProfileId: "agt_12345678-1234-4234-8234-123456789abc",
            profileName: "Codex Agent",
            profileKind: "agent",
            ownerUserId: "owner-001",
            ownerName: "Felix",
            agentControllerRef: "builtin:codex",
          },
        })),
      }),
    } as unknown as CloudflareBindings;

    const response = await app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: { Upgrade: "websocket" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const upstreamRequest = upstreamFetch.mock.calls[0]?.[0];
    if (!(upstreamRequest instanceof Request)) {
      throw new Error("Missing upstream request");
    }
    expect(
      upstreamRequest.headers.get(OPENMELD_HEADER_AGENT_CONTROLLER_REF)
    ).toBe("builtin:codex");
  });

  it("aborts the upstream daemon websocket fetch when connect timeout elapses", async () => {
    vi.useFakeTimers();

    let sawAbortSignal = false;
    let upstreamAborted = false;
    const abortEvents: unknown[] = [];
    const upstreamFetch = vi.fn((request: Request) => {
      sawAbortSignal = true;
      request.signal.addEventListener(
        "abort",
        () => {
          upstreamAborted = request.signal.aborted;
          abortEvents.push(request.signal.reason);
        },
        { once: true }
      );
      return new Promise<Response>(() => {
        // Keep the handshake pending so the route's timeout path owns completion.
      });
    });

    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    const responsePromise = app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: { Upgrade: "websocket" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    await vi.advanceTimersByTimeAsync(15_000);

    const response = await responsePromise;

    expect(response.status).toBe(504);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(sawAbortSignal).toBe(true);
    expect(upstreamAborted).toBe(true);
    expect(abortEvents).toHaveLength(1);
    expect(String(abortEvents[0])).toContain("timeout");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "upstream_unreachable",
        requestId: "req-test",
      },
    });
  });

  it("returns HTTP 502 when Core daemon websocket fetch is unreachable", async () => {
    const upstreamFetch = vi.fn(() =>
      Promise.reject(new Error("core unavailable"))
    );
    const env = {
      OPENMELD_CORE_WORKER: {
        fetch: upstreamFetch,
      },
      OPENMELD_AUTH_WORKER: createAuthWorkerMock(),
    } as unknown as CloudflareBindings;

    const response = await app.fetch(
      new Request("http://local/v1/daemon/stream", {
        headers: { Upgrade: "websocket" },
      }),
      env,
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(502);
    expect(response.webSocket).toBeFalsy();
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "upstream_unreachable",
        message: "core unavailable",
        requestId: "req-test",
      },
    });
  });
});
