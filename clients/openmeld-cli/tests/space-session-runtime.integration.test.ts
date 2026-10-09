import { afterEach, describe, expect, it, vi } from "vitest";
import {
  rememberSpaceWatchAnchor,
  type SpaceWatchReadState,
} from "../src/space/connect-catchup";
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("keeps the initial history anchor while a replacement socket buffers later messages", async () => {
    vi.useFakeTimers();
    const first = createWsHarness();
    const second = createWsHarness();
    connectWebSocketMock
      .mockReset()
      .mockResolvedValueOnce(first.client)
      .mockResolvedValueOnce(second.client);
    const initial = Promise.withResolvers<{ synced: boolean }>();
    const state: SpaceWatchReadState = {
      anchorSignalId: null,
      hasReconnected: false,
    };
    const seen = new Set<string>();
    const delivered: string[] = [];
    const anchors: Array<string | null> = [];
    const signal = (id: string) =>
      createSignalTextEvent({
        id,
        ts: 1,
        profileId: "other",
        profileName: "Other",
        text: id,
      });
    let finishInitial: () => void = () => undefined;
    const runtime = new SpaceSessionRuntime({
      wsUrl: "wss://example.com/v1/spaces/ops-room",
      wsHeaders: {},
      recoverConnection: true,
      helloProfile: {
        kind: "human",
        profileId: "self-profile",
        profileName: "Felix",
      },
      selfProfileId: "self-profile",
      loadMembers: () => Promise.resolve(null),
      formatError: String,
      scheduleDeferredWork: (work) => work(),
      replayHistory: (onEvent, reconnect) => {
        if (!reconnect) {
          finishInitial = () => {
            onEvent(signal("A"));
            initial.resolve({ synced: true });
          };
          return initial.promise;
        }
        anchors.push(state.anchorSignalId);
        if (state.anchorSignalId === "A") {
          onEvent(signal("B"));
          onEvent(signal("Z"));
        }
        return Promise.resolve({ synced: true });
      },
    });
    runtime.subscribe((event) => {
      if (event.type === "connection.reconnecting") {
        state.hasReconnected = true;
      }
      if (
        event.type === "signal.received" &&
        "id" in event.event &&
        !seen.has(event.event.id)
      ) {
        seen.add(event.event.id);
        delivered.push(event.event.id);
        rememberSpaceWatchAnchor(state, event.event);
      }
    });
    const started = await runtime.start();
    first.close(1006, "interrupted during initial history");
    await vi.advanceTimersByTimeAsync(1000);
    second.emit(JSON.stringify(signal("Z")));
    finishInitial();
    await vi.advanceTimersByTimeAsync(0);
    runtime.stop("SIGINT");
    second.close(1000, "SIGINT");
    await started.closed;
    expect(anchors).toEqual(["A"]);
    expect(delivered).toEqual(["A", "B", "Z"]);
  });

  it.each([
    "unfinished",
    "successful-stability",
  ] as const)("bounds recovery across long catch-up attempts (%s)", async (outcome) => {
    vi.useFakeTimers();
    const sockets: ReturnType<typeof createWsHarness>[] = [];
    connectWebSocketMock.mockReset().mockImplementation(() => {
      const socket = createWsHarness();
      sockets.push(socket);
      return Promise.resolve(socket.client);
    });
    const reads: ReturnType<
      typeof Promise.withResolvers<{ synced: boolean }>
    >[] = [];
    const events: SpaceRuntimeEvent[] = [];
    const runtime = new SpaceSessionRuntime({
      wsUrl: "wss://example.com/v1/spaces/ops-room",
      wsHeaders: {},
      recoverConnection: true,
      helloProfile: {
        kind: "human",
        profileId: "self-profile",
        profileName: "Felix",
      },
      selfProfileId: "self-profile",
      loadMembers: () => Promise.resolve(null),
      formatError: String,
      scheduleDeferredWork: (work) => work(),
      replayHistory: (_onEvent, reconnect) => {
        if (!reconnect) {
          return Promise.resolve({ synced: true });
        }
        const read = Promise.withResolvers<{ synced: boolean }>();
        reads.push(read);
        return read.promise;
      },
    });
    runtime.subscribe((event) => events.push(event));
    const started = await runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]?.close(1006, "network interrupted");
    if (outcome === "unfinished") {
      for (const [index, delay] of [1000, 2000, 4000, 8000, 8000].entries()) {
        await vi.advanceTimersByTimeAsync(delay);
        await vi.advanceTimersByTimeAsync(31_000);
        sockets[index + 1]?.close(1006, "catch-up still unfinished");
        reads[index]?.resolve({ synced: true });
        await vi.advanceTimersByTimeAsync(0);
      }
    } else {
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(31_000);
      reads[0]?.resolve({ synced: true });
      await vi.advanceTimersByTimeAsync(0);
      // A long open socket is not 30 seconds of successful recovery.
      sockets[1]?.close(1006, "closed immediately after catch-up");
      await vi.advanceTimersByTimeAsync(2000);
      reads[1]?.resolve({ synced: true });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(31_000);
      sockets[2]?.close(
        1006,
        "new failure after a stable recovered connection"
      );
      await vi.advanceTimersByTimeAsync(1000);
    }
    const attempts = events
      .filter((event) => event.type === "connection.reconnecting")
      .map((event) => event.attempt);
    const closedBeforeStop = events.find(
      (event) => event.type === "connection.closed"
    );
    runtime.stop("SIGINT");
    reads.at(-1)?.resolve({ synced: true });
    sockets.at(-1)?.close(1000, "SIGINT");
    await started.closed;
    expect(attempts).toEqual(
      outcome === "unfinished" ? [1, 2, 3, 4, 5] : [1, 2, 1]
    );
    if (outcome === "unfinished") {
      expect(sockets).toHaveLength(6);
      expect(closedBeforeStop).toMatchObject({
        source: "error",
        reason: expect.stringContaining("could not reconnect after 5 attempts"),
      });
    } else {
      expect(closedBeforeStop).toBeUndefined();
      expect(sockets).toHaveLength(4);
    }
  });

  it.each([
    false,
    true,
  ])("keeps the watch lifetime and exact send receipt across recovery (interrupted=%s)", async (interrupted) => {
    vi.useFakeTimers();
    const first = createWsHarness();
    const second = createWsHarness();
    const third = createWsHarness();
    connectWebSocketMock
      .mockReset()
      .mockResolvedValueOnce(first.client)
      .mockResolvedValueOnce(second.client)
      .mockResolvedValueOnce(third.client);
    const events: SpaceRuntimeEvent[] = [];
    const replayReads: Array<{ deliver: () => void; finish: () => void }> = [];
    let receipt: ReturnType<SpaceSessionRuntime["sendText"]>;
    const runtime = new SpaceSessionRuntime({
      wsUrl: "wss://example.com/v1/spaces/ops-room",
      wsHeaders: {},
      recoverConnection: true,
      helloProfile: {
        kind: "human",
        profileId: "self-profile",
        profileName: "Felix",
      },
      selfProfileId: "self-profile",
      loadMembers: () => Promise.resolve(null),
      formatError: (error) => String(error),
      scheduleDeferredWork: (work) => work(),
      replayHistory: (onEvent, reconnect) => {
        if (!reconnect) {
          return Promise.resolve({ synced: true });
        }
        return new Promise((resolve) =>
          replayReads.push({
            deliver: () => {
              if (!receipt.queued) {
                throw new Error("expected queued receipt");
              }
              onEvent({
                ...createSignalTextEvent({
                  id: "confirmed-after-gap",
                  ts: 2,
                  profileId: "self-profile",
                  profileName: "Felix",
                  text: "one message",
                }),
                data: {
                  text: "one message",
                  meta: { clientMessageId: receipt.clientMessageId },
                },
              });
            },
            finish: () => resolve({ synced: true }),
          })
        );
      },
    });
    runtime.subscribe((event) => events.push(event));
    const started = await runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    receipt = runtime.sendText({ text: "one message" });
    let closed = false;
    started.closed.then(() => {
      closed = true;
    });
    first.close(1006, "network interrupted");
    await vi.advanceTimersByTimeAsync(1000);
    expect(closed).toBe(false);
    expect(events.filter((event) => event.type === "connected")).toHaveLength(
      1
    );
    expect(runtime.sendText({ text: "during recovery" })).toEqual({
      queued: false,
    });
    const read = replayReads[0];
    if (!read) {
      throw new Error("missing recovery read");
    }
    if (interrupted) {
      second.close(1006, "interrupted during catch-up");
    }
    read.deliver();
    read.finish();
    await vi.advanceTimersByTimeAsync(0);
    if (interrupted) {
      expect(events.filter((event) => event.type === "connected")).toHaveLength(
        1
      );
      await vi.advanceTimersByTimeAsync(2000);
      const resumed = replayReads[1];
      if (!resumed) {
        throw new Error("missing resumed recovery read");
      }
      resumed.deliver();
      resumed.finish();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(events.filter((event) => event.type === "send.confirmed")).toEqual([
      expect.objectContaining({
        clientMessageId: receipt.queued ? receipt.clientMessageId : null,
      }),
    ]);
    expect(
      events.filter((event) => event.type === "signal.received")
    ).toHaveLength(1);
    expect(events.filter((event) => event.type === "connected")).toHaveLength(
      2
    );
    expect(
      [first, second, third]
        .flatMap((harness) => harness.send.mock.calls)
        .map((call) => JSON.parse(String(call[0])).type)
        .filter((type) => type === "signal.text")
    ).toEqual(["signal.text"]);
    runtime.stop("SIGINT");
    (interrupted ? third : second).close(1000, "SIGINT");
    await started.closed;
    expect(
      events.filter((event) => event.type === "connection.closed")
    ).toEqual([expect.objectContaining({ source: "close", code: 1000 })]);
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
    expect(JSON.parse(String(harness.send.mock.calls[0]?.[0] ?? "{}"))).toEqual(
      {
        type: "hello",
        profile: {
          kind: "human",
          profileId: "self-profile",
          profileName: "Felix",
        },
        capabilities: {
          spaceMessageAddressing: true,
          spaceImageGeometry: true,
        },
      }
    );
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

  it("keeps Human Mention targets on current websocket frames", async () => {
    const harness = createWsHarness();
    connectWebSocketMock.mockResolvedValue(harness.client);
    const humanProfileId = "11111111-2222-4333-8444-555555555555";
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
      text: "@Mira(mention) please review",
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        mentionTargets: [humanProfileId],
        text: "@Mira(mention) please review",
      },
    });

    const sent = JSON.parse(String(harness.send.mock.calls[1]?.[0] ?? "{}"));
    expect(sent.data.messageEnvelope).toEqual({
      activationTargets: [],
      referenceTargets: [],
      mentionTargets: [humanProfileId],
      text: "@Mira(mention) please review",
    });
    expect(sent.data.messageEnvelope).not.toHaveProperty("ccTargets");
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
