import type { SignalEnvelope } from "@openmeld/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setAuthSession } from "../src/config/auth-session";
import {
  processIgnoredOlderThanLiveFloorSignal,
  replayMissedSignals,
  replayRecentSignals,
  resolveInitialLiveFloorTs,
  shouldIgnoreIncomingSignal,
} from "../src/space/connect-catchup";
import { withTempHome } from "./helpers/fs";

const TEXT_SIGNAL_1 = {
  v: 1,
  id: "signal-1",
  spaceId: "room-1",
  ts: 101,
  type: "signal.text",
  profile: { kind: "human", profileId: "alice", profileName: "Alice" },
  data: { text: "hello" },
} as const;

const SESSION_PROFILE_IDENTITY = {
  kind: "human" as const,
  openMeldProfileId: "demo--aaaaaaaa",
  profileName: "Demo",
};

describe("connect catch-up dedupe state", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the shared signal API anchor when replaying after reconnect", async () => {
    const seenSignalIds = new Set<string>();
    const events: unknown[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("afterSignalId")).toBe("signal-anchor");
        expect(url.searchParams.get("afterTs")).toBeNull();
        expect(url.searchParams.get("limit")).toBe("200");
        expect(url.searchParams.get("cursor")).toBeNull();
        return Promise.resolve(
          new Response(
            JSON.stringify({
              signals: [TEXT_SIGNAL_1],
              nextCursor: null,
            }),
            { status: 200 }
          )
        );
      });

    await replayMissedSignals({
      profileIdentity: SESSION_PROFILE_IDENTITY,
      baseUrl: "https://example.com",
      space: "room-1",
      afterSignalId: "signal-anchor",
      seenSignalIds,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(seenSignalIds.has("signal-1")).toBe(true);
  });

  it("replays recent history and dedupes by signal id", async () => {
    const seenSignalIds = new Set<string>(["signal-1"]);
    const events: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          signals: [
            TEXT_SIGNAL_1,
            {
              ...TEXT_SIGNAL_1,
              id: "signal-2",
              data: { text: "newer" },
            },
          ],
          nextCursor: null,
        }),
        { status: 200 }
      )
    );

    await replayRecentSignals({
      profileIdentity: SESSION_PROFILE_IDENTITY,
      baseUrl: "https://example.com",
      space: "room-1",
      limit: 100,
      seenSignalIds,
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events).toHaveLength(1);
    expect((events[0] as { id?: string }).id).toBe("signal-2");
    expect(seenSignalIds.has("signal-1")).toBe(true);
    expect(seenSignalIds.has("signal-2")).toBe(true);
  });

  it("marks replayed signal ids as seen only after delivery", async () => {
    const seenSignalIds = new Set<string>();
    const seenStateDuringDelivery: boolean[] = [];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          signals: [TEXT_SIGNAL_1],
          nextCursor: null,
        }),
        { status: 200 }
      )
    );

    await replayRecentSignals({
      profileIdentity: SESSION_PROFILE_IDENTITY,
      baseUrl: "https://example.com",
      space: "room-1",
      limit: 100,
      seenSignalIds,
      onEvent: (event) => {
        const signalId = String((event as { id?: string }).id ?? "");
        seenStateDuringDelivery.push(seenSignalIds.has(signalId));
      },
    });

    expect(seenStateDuringDelivery).toEqual([false]);
    expect(seenSignalIds.has("signal-1")).toBe(true);
  });

  it("caps replay dedupe ids to a bounded window", async () => {
    const seenSignalIds = new Set<string>();
    for (let index = 0; index < 50_000; index += 1) {
      seenSignalIds.add(`signal-${index}`);
    }

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          signals: [
            {
              ...TEXT_SIGNAL_1,
              id: "signal-new",
              ts: 202,
            },
          ],
          nextCursor: null,
        }),
        { status: 200 }
      )
    );

    await replayRecentSignals({
      profileIdentity: SESSION_PROFILE_IDENTITY,
      baseUrl: "https://example.com",
      space: "room-1",
      limit: 100,
      seenSignalIds,
      onEvent: () => {
        // no-op
      },
    });

    expect(seenSignalIds.size).toBe(50_000);
    expect(seenSignalIds.has("signal-0")).toBe(false);
    expect(seenSignalIds.has("signal-new")).toBe(true);
  });

  it("shrinks an oversized replay dedupe set back to the cap", async () => {
    const seenSignalIds = new Set<string>();
    for (let index = 0; index < 50_001; index += 1) {
      seenSignalIds.add(`signal-${index}`);
    }

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          signals: [
            {
              ...TEXT_SIGNAL_1,
              id: "signal-new",
              ts: 203,
            },
          ],
          nextCursor: null,
        }),
        { status: 200 }
      )
    );

    await replayRecentSignals({
      profileIdentity: SESSION_PROFILE_IDENTITY,
      baseUrl: "https://example.com",
      space: "room-1",
      limit: 100,
      seenSignalIds,
      onEvent: () => {
        // no-op
      },
    });

    expect(seenSignalIds.size).toBe(50_000);
    expect(seenSignalIds.has("signal-0")).toBe(false);
    expect(seenSignalIds.has("signal-1")).toBe(false);
    expect(seenSignalIds.has("signal-new")).toBe(true);
  });

  it("skips recent replay fetch when history limit is zero", async () => {
    const seenSignalIds = new Set<string>();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await replayRecentSignals({
      profileIdentity: SESSION_PROFILE_IDENTITY,
      baseUrl: "https://example.com",
      space: "room-1",
      limit: 0,
      seenSignalIds,
      onEvent: () => {
        // no-op
      },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requests recent preload directly and dedupes against seen ids", async () => {
    const seenSignalIds = new Set<string>();
    const events: Array<{ id?: string }> = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("limit")).toBe("2");
        expect(url.searchParams.get("recent")).toBe("1");
        expect(url.searchParams.get("cursor")).toBeNull();
        return Promise.resolve(
          new Response(
            JSON.stringify({
              signals: [
                {
                  ...TEXT_SIGNAL_1,
                  id: "signal-1",
                  ts: 101,
                  data: { text: "m1" },
                },
                {
                  ...TEXT_SIGNAL_1,
                  id: "signal-2",
                  ts: 102,
                  data: { text: "m2" },
                },
              ],
            }),
            { status: 200 }
          )
        );
      });

    await replayRecentSignals({
      profileIdentity: SESSION_PROFILE_IDENTITY,
      baseUrl: "https://example.com",
      space: "room-1",
      limit: 2,
      seenSignalIds,
      onEvent: (event) => {
        events.push(event as { id?: string });
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.id)).toEqual(["signal-1", "signal-2"]);
    expect(seenSignalIds.has("signal-1")).toBe(true);
    expect(seenSignalIds.has("signal-2")).toBe(true);
  });

  it("adds Authorization header when session exists", async () => {
    await withTempHome(async () => {
      const previousForceInsecure =
        process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;
      try {
        process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
        await setAuthSession({
          accessToken: "connect-token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
        });

        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response(
            JSON.stringify({
              signals: [
                {
                  ...TEXT_SIGNAL_1,
                },
              ],
            }),
            { status: 200 }
          )
        );

        const seenSignalIds = new Set<string>();
        const events: unknown[] = [];

        await replayMissedSignals({
          profileIdentity: SESSION_PROFILE_IDENTITY,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "room-1",
          afterSignalId: "signal-anchor",
          seenSignalIds,
          onEvent: (event) => {
            events.push(event);
          },
        });

        const requestInit = fetchSpy.mock.calls[0]?.[1] as
          | RequestInit
          | undefined;
        expect(requestInit).toBeDefined();
        const headers = (requestInit?.headers ?? {}) as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer connect-token");
        expect(events).toHaveLength(1);
      } finally {
        if (previousForceInsecure === undefined) {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = undefined;
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN =
            previousForceInsecure;
        }
      }
    });
  });

  it("ignores non-hint websocket signals that are older than live floor ts", () => {
    const seenSignalIds = new Set<string>();
    const ignoreResult = shouldIgnoreIncomingSignal({
      event: TEXT_SIGNAL_1,
      liveFloorTs: 102,
      seenSignalIds,
    });

    expect(ignoreResult.ignore).toBe(true);
    expect(ignoreResult.reason).toBe("older_than_live_floor");
  });

  it("records old hint signal ids and avoids duplicate hint handling", () => {
    const seenSignalIds = new Set<string>();
    const oldHintSignal = {
      ...TEXT_SIGNAL_1,
      id: "signal-old-hint-1",
      data: {
        text: "@my-codex is replying...",
        meta: {
          transient: true,
          purpose: "agent_replying",
          dispatchId: "dispatch-1",
          targetProfileId: "agt-my-codex",
        },
      },
    } satisfies SignalEnvelope;
    const onDispatchActivityEvent = vi.fn();

    const firstIgnore = shouldIgnoreIncomingSignal({
      event: oldHintSignal,
      liveFloorTs: 999,
      seenSignalIds,
    });
    expect(firstIgnore.ignore).toBe(true);
    expect(firstIgnore.reason).toBe("older_than_live_floor");

    const firstProcessed = processIgnoredOlderThanLiveFloorSignal({
      event: oldHintSignal,
      seenSignalIds,
      onDispatchActivityEvent,
    });
    expect(firstProcessed).toBe(true);
    expect(onDispatchActivityEvent).toHaveBeenCalledTimes(1);
    expect(seenSignalIds.has("signal-old-hint-1")).toBe(true);

    const secondIgnore = shouldIgnoreIncomingSignal({
      event: oldHintSignal,
      liveFloorTs: 999,
      seenSignalIds,
    });
    expect(secondIgnore.ignore).toBe(true);
    expect(secondIgnore.reason).toBe("seen_replay_duplicate");
  });

  it("keeps seen id set bounded when processing older-than-floor hints", () => {
    const seenSignalIds = new Set<string>();
    for (let index = 0; index < 50_000; index += 1) {
      seenSignalIds.add(`signal-${index}`);
    }
    const oldHintSignal = {
      ...TEXT_SIGNAL_1,
      id: "signal-old-hint-bounded",
      data: {
        text: "@my-codex is replying...",
        meta: {
          transient: true,
          purpose: "agent_replying",
          dispatchId: "dispatch-bounded",
          targetProfileId: "agt-my-codex",
        },
      },
    } satisfies SignalEnvelope;

    const processed = processIgnoredOlderThanLiveFloorSignal({
      event: oldHintSignal,
      seenSignalIds,
      onDispatchActivityEvent: () => {
        // no-op
      },
    });

    expect(processed).toBe(true);
    expect(seenSignalIds.size).toBe(50_000);
    expect(seenSignalIds.has("signal-old-hint-bounded")).toBe(true);
  });

  it("forwards older-than-live-floor terminal signals so stale dispatch activity can clear", () => {
    const seenSignalIds = new Set<string>();
    const onDispatchActivityEvent = vi.fn();
    const oldTerminalStatusSignal = {
      ...TEXT_SIGNAL_1,
      id: "signal-old-terminal-1",
      type: "signal.status" as const,
      data: {
        dispatchId: "dispatch-1",
        status: "done",
        generatedBy: "openmeld",
        actorProfileId: "agt-my-codex",
        text: "Done",
      },
    } satisfies SignalEnvelope;

    const processed = processIgnoredOlderThanLiveFloorSignal({
      event: oldTerminalStatusSignal,
      seenSignalIds,
      onDispatchActivityEvent,
    });

    expect(processed).toBe(true);
    expect(onDispatchActivityEvent).toHaveBeenCalledWith(
      oldTerminalStatusSignal
    );
    expect(seenSignalIds.has("signal-old-terminal-1")).toBe(true);
  });

  it("does not ignore websocket signals with equal timestamp but different id", () => {
    const seenSignalIds = new Set<string>();
    const ignoreResult = shouldIgnoreIncomingSignal({
      event: {
        ...TEXT_SIGNAL_1,
        id: "signal-2",
      },
      liveFloorTs: 101,
      seenSignalIds,
    });

    expect(ignoreResult.ignore).toBe(false);
    expect(ignoreResult.reason).toBe(null);
  });

  it("ignores websocket signals already seen in catch-up and keeps dedupe id", () => {
    const seenSignalIds = new Set<string>(["signal-1"]);
    const ignoreResult = shouldIgnoreIncomingSignal({
      event: TEXT_SIGNAL_1,
      liveFloorTs: 0,
      seenSignalIds,
    });

    expect(ignoreResult.ignore).toBe(true);
    expect(ignoreResult.reason).toBe("seen_replay_duplicate");
    expect(seenSignalIds.has("signal-1")).toBe(true);
  });

  it("ignores websocket signals with equal timestamp when id was seen in catch-up", () => {
    const seenSignalIds = new Set<string>(["signal-1"]);
    const ignoreResult = shouldIgnoreIncomingSignal({
      event: TEXT_SIGNAL_1,
      liveFloorTs: 101,
      seenSignalIds,
    });

    expect(ignoreResult.ignore).toBe(true);
    expect(ignoreResult.reason).toBe("seen_replay_duplicate");
    expect(seenSignalIds.has("signal-1")).toBe(true);
  });

  it("continues ignoring repeated duplicates after reconnect retries", () => {
    const seenSignalIds = new Set<string>(["signal-1"]);
    const firstIgnore = shouldIgnoreIncomingSignal({
      event: TEXT_SIGNAL_1,
      liveFloorTs: 0,
      seenSignalIds,
    });
    const secondIgnore = shouldIgnoreIncomingSignal({
      event: TEXT_SIGNAL_1,
      liveFloorTs: 0,
      seenSignalIds,
    });

    expect(firstIgnore.ignore).toBe(true);
    expect(firstIgnore.reason).toBe("seen_replay_duplicate");
    expect(secondIgnore.ignore).toBe(true);
    expect(secondIgnore.reason).toBe("seen_replay_duplicate");
    expect(seenSignalIds.has("signal-1")).toBe(true);
  });

  it("does not ignore new websocket signals above live floor ts", () => {
    const seenSignalIds = new Set<string>();
    const ignoreResult = shouldIgnoreIncomingSignal({
      event: TEXT_SIGNAL_1,
      liveFloorTs: 100,
      seenSignalIds,
    });

    expect(ignoreResult.ignore).toBe(false);
    expect(ignoreResult.reason).toBe(null);
  });

  it("does not ignore self-authored websocket signals below live floor ts", () => {
    const seenSignalIds = new Set<string>();
    const ignoreResult = shouldIgnoreIncomingSignal({
      event: TEXT_SIGNAL_1,
      liveFloorTs: 999,
      seenSignalIds,
      selfProfileId: "alice",
    });

    expect(ignoreResult.ignore).toBe(false);
    expect(ignoreResult.reason).toBe(null);
  });

  it("does not ignore hello ack events", () => {
    const seenSignalIds = new Set<string>();
    const ignoreResult = shouldIgnoreIncomingSignal({
      event: {
        type: "system.hello.ack",
        profile: { kind: "human", profileId: "alice", profileName: "Alice" },
      },
      liveFloorTs: 999,
      seenSignalIds,
    });

    expect(ignoreResult.ignore).toBe(false);
    expect(ignoreResult.reason).toBe(null);
  });

  it("clamps live floor when lastSeen ts is far in the future", () => {
    const nowMs = 1_000_000;
    const liveFloorTs = resolveInitialLiveFloorTs({
      lastSeenTs: nowMs + 120_000,
      nowMs,
    });

    expect(liveFloorTs).toBe(nowMs);
  });

  it("keeps live floor when lastSeen ts is within future skew tolerance", () => {
    const nowMs = 1_000_000;
    const liveFloorTs = resolveInitialLiveFloorTs({
      lastSeenTs: nowMs + 10_000,
      nowMs,
    });

    expect(liveFloorTs).toBe(nowMs + 10_000);
  });

  it("falls back to zero live floor when lastSeen ts is missing", () => {
    const liveFloorTs = resolveInitialLiveFloorTs({
      lastSeenTs: null,
      nowMs: 1_000_000,
    });

    expect(liveFloorTs).toBe(0);
  });
});
