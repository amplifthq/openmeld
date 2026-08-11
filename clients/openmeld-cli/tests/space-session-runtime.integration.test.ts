import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceRuntimeEvent } from "../src/space/runtime/space-runtime-events";
import { SpaceSessionRuntime } from "../src/space/runtime/space-session-runtime";
import type { WsClient } from "../src/transport/ws";

const connectWebSocketMock = vi.fn();

vi.mock("../src/transport/ws", () => {
  return {
    connectWebSocket: (
      ...args: Parameters<typeof connectWebSocketMock>
    ): ReturnType<typeof connectWebSocketMock> => connectWebSocketMock(...args),
  };
});

describe("SpaceSessionRuntime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("loads members, replays history, then drains buffered live events", async () => {
    const harness = createWsHarness();
    connectWebSocketMock.mockResolvedValue(harness.client);

    const events: SpaceRuntimeEvent[] = [];
    const deferredReplayWork: Array<() => void> = [];

    const runtime = new SpaceSessionRuntime({
      wsUrl: "wss://example.com/v1/spaces/ops-room",
      wsHeaders: {
        authorization: "Bearer test",
      },
      helloProfile: {
        kind: "human",
        profileId: "self-profile",
        profileName: "Felix",
      },
      selfProfileId: "self-profile",
      loadMembers: () => {
        return Promise.resolve({
          spaceId: "ops-room",
          generatedAt: "2026-03-13T00:00:00.000Z",
          summary: {
            totalCount: 0,
            humanCount: 0,
            agentCount: 0,
            liveNowCount: 0,
          },
          humans: [],
          agents: [],
        });
      },
      replayHistory: (onEvent) => {
        onEvent(
          createSignalTextEvent({
            id: "history-1",
            ts: 1,
            profileId: "profile-a",
            profileName: "Alpha",
            text: "history",
          })
        );
        return Promise.resolve({ synced: true });
      },
      formatError: (error) => String(error),
      scheduleDeferredWork: (work) => {
        deferredReplayWork.push(work);
      },
    });

    runtime.subscribe((event) => {
      events.push(event);
    });

    const startResult = await runtime.start();
    harness.emit(
      createSignalTextRawEvent({
        id: "live-1",
        ts: 2,
        profileId: "profile-b",
        profileName: "Beta",
        text: "live",
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      "members.updated",
      "connected",
    ]);

    const runDeferredReplayWork = deferredReplayWork[0];
    if (!runDeferredReplayWork) {
      throw new Error("expected deferred replay work");
    }
    runDeferredReplayWork();
    await Promise.resolve();

    expect(events.map((event) => event.type)).toEqual([
      "members.updated",
      "connected",
      "signal.received",
      "history.loaded",
      "signal.received",
    ]);
    expect(events[2]).toMatchObject({
      type: "signal.received",
      source: "history",
    });
    expect(events[4]).toMatchObject({
      type: "signal.received",
      source: "live",
    });

    harness.close(1000, "done");
    await startResult.closed;
  });

  it("emits send confirmation after the echoed self message arrives", async () => {
    const harness = createWsHarness();
    connectWebSocketMock.mockResolvedValue(harness.client);

    const events: SpaceRuntimeEvent[] = [];
    const runtime = new SpaceSessionRuntime({
      wsUrl: "wss://example.com/v1/spaces/ops-room",
      wsHeaders: {},
      helloProfile: {
        kind: "human",
        profileId: "self-profile",
        profileName: "Felix",
      },
      selfProfileId: "self-profile",
      loadMembers: () => Promise.resolve(null),
      replayHistory: () => Promise.resolve({ synced: true }),
      formatError: (error) => String(error),
      scheduleDeferredWork: (work) => {
        work();
      },
    });

    runtime.subscribe((event) => {
      events.push(event);
    });

    await runtime.start();
    expect(
      runtime.sendText({
        text: "hello runtime",
      })
    ).toEqual({
      queued: true,
      clientMessageId: expect.any(String),
    });

    harness.emit(
      createSignalTextRawEvent({
        id: "self-1",
        ts: 3,
        profileId: "self-profile",
        profileName: "Felix",
        text: "hello runtime",
      })
    );

    expect(events.map((event) => event.type)).toContain("send.queued");
    expect(events.map((event) => event.type)).toContain("send.confirmed");
    expect(harness.send).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('"type":"signal.text"')
    );
    expect(harness.send.mock.calls[1]?.[0]).toContain('"text":"hello runtime"');
    expect(harness.send.mock.calls[1]?.[0]).toContain('"clientMessageId":');
  });

  it("confirms a self echo by normalized text when clientMessageId is absent", async () => {
    const harness = createWsHarness();
    connectWebSocketMock.mockResolvedValue(harness.client);

    const events: SpaceRuntimeEvent[] = [];
    const runtime = new SpaceSessionRuntime({
      wsUrl: "wss://example.com/v1/spaces/ops-room",
      wsHeaders: {},
      helloProfile: {
        kind: "human",
        profileId: "self-profile",
        profileName: "Felix",
      },
      selfProfileId: "self-profile",
      loadMembers: () => Promise.resolve(null),
      replayHistory: () => Promise.resolve({ synced: true }),
      formatError: (error) => String(error),
      scheduleDeferredWork: (work) => {
        work();
      },
    });

    runtime.subscribe((event) => {
      events.push(event);
    });

    await runtime.start();
    expect(
      runtime.sendText({
        text: "hello   runtime",
      })
    ).toEqual({
      queued: true,
      clientMessageId: expect.any(String),
    });

    harness.emit(
      createSignalTextRawEvent({
        id: "self-2",
        ts: 4,
        profileId: "self-profile",
        profileName: "Felix",
        text: "hello runtime",
      })
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "send.confirmed",
        clientMessageId: expect.any(String),
        text: "hello runtime",
      })
    );
  });

  it("threads messageEnvelope onto outbound signal.text frames", async () => {
    const harness = createWsHarness();
    connectWebSocketMock.mockResolvedValue(harness.client);

    const runtime = new SpaceSessionRuntime({
      wsUrl: "wss://example.com/v1/spaces/ops-room",
      wsHeaders: {},
      helloProfile: {
        kind: "human",
        profileId: "self-profile",
        profileName: "Felix",
      },
      selfProfileId: "self-profile",
      loadMembers: () => Promise.resolve(null),
      replayHistory: () => Promise.resolve({ synced: true }),
      formatError: (error) => String(error),
      scheduleDeferredWork: (work) => {
        work();
      },
    });

    await runtime.start();
    runtime.sendText({
      text: "@Budget Analyst(wake) hello",
      messageEnvelope: {
        activationTargets: ["agt_11111111-2222-4333-8444-555555555555"],
        referenceTargets: [],
        text: "@Budget Analyst(wake) hello",
      },
    });

    expect(JSON.parse(String(harness.send.mock.calls[1]?.[0] ?? "{}"))).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          messageEnvelope: expect.objectContaining({
            activationTargets: ["agt_11111111-2222-4333-8444-555555555555"],
          }),
        }),
      })
    );
  });

  it("emits send.failed when the server returns an error frame for a pending send", async () => {
    const harness = createWsHarness();
    connectWebSocketMock.mockResolvedValue(harness.client);

    const events: SpaceRuntimeEvent[] = [];
    const runtime = new SpaceSessionRuntime({
      wsUrl: "wss://example.com/v1/spaces/ops-room",
      wsHeaders: {},
      helloProfile: {
        kind: "human",
        profileId: "self-profile",
        profileName: "Felix",
      },
      selfProfileId: "self-profile",
      loadMembers: () => Promise.resolve(null),
      replayHistory: () => Promise.resolve({ synced: true }),
      formatError: (error) => String(error),
      scheduleDeferredWork: (work) => {
        work();
      },
    });

    runtime.subscribe((event) => {
      events.push(event);
    });

    await runtime.start();
    expect(
      runtime.sendText({
        text: "hello runtime",
      })
    ).toEqual({
      queued: true,
      clientMessageId: expect.any(String),
    });

    const sendFrame = JSON.parse(
      String(harness.send.mock.calls[1]?.[0] ?? "{}")
    ) as {
      data?: {
        meta?: {
          clientMessageId?: string;
        };
      };
    };
    const clientMessageId = sendFrame.data?.meta?.clientMessageId;
    if (!clientMessageId) {
      throw new Error("expected clientMessageId in outbound signal");
    }

    harness.emit(
      JSON.stringify({
        error: "internal_error",
        requestId: "req-space-send-1",
        clientMessageId,
      })
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "send.failed",
        clientMessageId,
        text: "hello runtime",
        error: "internal_error (requestId: req-space-send-1)",
      })
    );
  });

  it("falls back to the oldest pending send when a server error frame lacks clientMessageId", async () => {
    const harness = createWsHarness();
    connectWebSocketMock.mockResolvedValue(harness.client);

    const events: SpaceRuntimeEvent[] = [];
    const runtime = new SpaceSessionRuntime({
      wsUrl: "wss://example.com/v1/spaces/ops-room",
      wsHeaders: {},
      helloProfile: {
        kind: "human",
        profileId: "self-profile",
        profileName: "Felix",
      },
      selfProfileId: "self-profile",
      loadMembers: () => Promise.resolve(null),
      replayHistory: () => Promise.resolve({ synced: true }),
      formatError: (error) => String(error),
      scheduleDeferredWork: (work) => {
        work();
      },
    });

    runtime.subscribe((event) => {
      events.push(event);
    });

    await runtime.start();
    expect(
      runtime.sendText({
        text: "first hello",
      })
    ).toEqual({
      queued: true,
      clientMessageId: expect.any(String),
    });
    expect(
      runtime.sendText({
        text: "second hello",
      })
    ).toEqual({
      queued: true,
      clientMessageId: expect.any(String),
    });

    harness.emit(
      JSON.stringify({
        error: "internal_error",
      })
    );

    const failedEvents = events.filter(
      (event): event is Extract<SpaceRuntimeEvent, { type: "send.failed" }> =>
        event.type === "send.failed"
    );
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]).toMatchObject({
      text: "first hello",
      error: "internal_error",
    });
  });

  it("marks history as unsynced when the live buffer overflows", async () => {
    const harness = createWsHarness();
    connectWebSocketMock.mockResolvedValue(harness.client);

    const events: SpaceRuntimeEvent[] = [];
    const deferredReplayWork: Array<() => void> = [];

    const runtime = new SpaceSessionRuntime({
      wsUrl: "wss://example.com/v1/spaces/ops-room",
      wsHeaders: {},
      helloProfile: {
        kind: "human",
        profileId: "self-profile",
        profileName: "Felix",
      },
      selfProfileId: "self-profile",
      loadMembers: () => Promise.resolve(null),
      replayHistory: () => Promise.resolve({ synced: true }),
      formatError: (error) => String(error),
      bufferedLiveEventLimit: 1,
      scheduleDeferredWork: (work) => {
        deferredReplayWork.push(work);
      },
    });

    runtime.subscribe((event) => {
      events.push(event);
    });

    await runtime.start();
    harness.emit(
      createSignalTextRawEvent({
        id: "live-1",
        ts: 1,
        profileId: "profile-a",
        profileName: "Alpha",
        text: "one",
      })
    );
    harness.emit(
      createSignalTextRawEvent({
        id: "live-2",
        ts: 2,
        profileId: "profile-b",
        profileName: "Beta",
        text: "two",
      })
    );

    const runDeferredReplayWork = deferredReplayWork[0];
    if (!runDeferredReplayWork) {
      throw new Error("expected deferred replay work");
    }
    runDeferredReplayWork();
    await Promise.resolve();

    expect(events).toContainEqual({
      type: "history.loaded",
      synced: false,
      reason: "live_buffer_overflow",
    });
  });

  it("does not emit history loaded after stop during replay", async () => {
    const harness = createWsHarness();
    connectWebSocketMock.mockResolvedValue(harness.client);

    const events: SpaceRuntimeEvent[] = [];
    const replayResolvers: Array<() => void> = [];

    const runtime = new SpaceSessionRuntime({
      wsUrl: "wss://example.com/v1/spaces/ops-room",
      wsHeaders: {},
      helloProfile: {
        kind: "human",
        profileId: "self-profile",
        profileName: "Felix",
      },
      selfProfileId: "self-profile",
      loadMembers: () => Promise.resolve(null),
      replayHistory: async () => {
        await new Promise<void>((resolve) => {
          replayResolvers.push(resolve);
        });
        return { synced: true };
      },
      formatError: (error) => String(error),
      scheduleDeferredWork: (work) => {
        work();
      },
    });

    runtime.subscribe((event) => {
      events.push(event);
    });

    await runtime.start();
    runtime.stop("SIGINT");

    const finishReplay = replayResolvers[0];
    if (!finishReplay) {
      throw new Error("expected replay resolver");
    }
    finishReplay();
    await Promise.resolve();

    expect(events.map((event) => event.type)).not.toContain("history.loaded");
  });
});

function createWsHarness(): {
  client: WsClient;
  emit: (raw: string) => void;
  close: (code: number, reason: string) => void;
  send: ReturnType<typeof vi.fn>;
} {
  let onMessageHandler: ((data: string) => void) | null = null;
  let onCloseHandler: ((code: number, reason: string) => void) | null = null;
  let resolveClosed: (() => void) | null = null;
  const send = vi.fn();
  const close = vi.fn();
  const terminate = vi.fn();
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  return {
    client: {
      send,
      close,
      terminate,
      onMessage: (handler) => {
        onMessageHandler = handler;
      },
      onClose: (handler) => {
        onCloseHandler = handler;
      },
      onError: vi.fn(),
      waitUntilClosed: () => closed,
    },
    emit: (raw) => {
      if (!onMessageHandler) {
        throw new Error("missing onMessage handler");
      }
      onMessageHandler(raw);
    },
    close: (code, reason) => {
      if (!(onCloseHandler && resolveClosed)) {
        throw new Error("missing onClose handler");
      }
      onCloseHandler(code, reason);
      resolveClosed();
    },
    send,
  };
}

function createSignalTextEvent(input: {
  id: string;
  ts: number;
  profileId: string;
  profileName: string;
  text: string;
}) {
  return {
    v: 1 as const,
    id: input.id,
    spaceId: "ops-room",
    ts: input.ts,
    profile: {
      kind: "human" as const,
      profileId: input.profileId,
      profileName: input.profileName,
    },
    type: "signal.text" as const,
    data: {
      text: input.text,
    },
  };
}

function createSignalTextRawEvent(input: {
  id: string;
  ts: number;
  profileId: string;
  profileName: string;
  text: string;
}): string {
  return JSON.stringify(createSignalTextEvent(input));
}
