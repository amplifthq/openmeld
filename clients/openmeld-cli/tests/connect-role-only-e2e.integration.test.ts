import { afterEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import { runConnect as runConnectCommand } from "../src/space/connect";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const connectWebSocketMock = vi.fn();
const CATCHUP_BUFFER_OVERFLOW_EVENT_COUNT = 2105;
type RunConnectInput = Parameters<typeof runConnectCommand>[0];

const runConnect = async (
  input: Omit<RunConnectInput, "connectionMode"> & {
    connectionMode?: RunConnectInput["connectionMode"];
  }
) =>
  await runConnectCommand({
    ...input,
    connectionMode: input.connectionMode ?? "join",
  });

vi.mock("../src/transport/ws", () => {
  return {
    connectWebSocket: (
      ...args: Parameters<typeof connectWebSocketMock>
    ): ReturnType<typeof connectWebSocketMock> => connectWebSocketMock(...args),
  };
});

describe("connect role-only cursor sync e2e", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("does not persist synthetic lastSeenTs=0 and never catches up from afterTs=0", async () => {
    const wsClient = {
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
      waitUntilClosed: vi.fn(() => Promise.resolve()),
    };
    connectWebSocketMock.mockResolvedValue(wsClient);

    const cursorState: {
      lastSeenTs?: number;
      role?: string;
    } = {};
    const cursorPatchPayloads: Record<string, unknown>[] = [];
    const signalAfterTsValues: string[] = [];
    const signalRecentFlags: string[] = [];
    const okJson = (payload: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/meta")) {
          return okJson({
            spaceId: "ops-room",
            organizationId: "org-1",
            visibility: "private",
          });
        }

        if (url.pathname.includes("/cursors/")) {
          if (method === "GET") {
            return okJson(cursorState);
          }

          if (method === "PATCH") {
            const body = JSON.parse(String(init?.body ?? "{}")) as Record<
              string,
              unknown
            >;
            cursorPatchPayloads.push(body);

            if (typeof body.lastSeenTs === "number") {
              cursorState.lastSeenTs = body.lastSeenTs;
            }
            if (typeof body.role === "string") {
              cursorState.role = body.role;
            }

            return okJson(cursorState);
          }
        }

        if (method === "GET" && url.pathname.endsWith("/signals")) {
          const afterTs = url.searchParams.get("afterTs");
          if (afterTs !== null) {
            signalAfterTsValues.push(afterTs);
          }
          const recent = url.searchParams.get("recent");
          if (recent !== null) {
            signalRecentFlags.push(recent);
          }
          return okJson({
            signals: [],
            nextCursor: null,
          });
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });

    await withTempHome(async () => {
      const openMeldProfile = createOpenMeldProfileInput({
        openMeldProfileId: "eeeeeeee-0000-0000-0000-000000000000",
        profileName: "Codex",
        profileKind: "agent",
      });
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--role-only-e2e",
          profileId: "eeeeeeee-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
          silent: true,
        });
      });

      // First connect simulates: openmeld space join ... --role
      await withSilencedStdio(async () => {
        await runConnect({
          profile: "codex--role-only-e2e",
          openMeldProfile,
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "ndjson",
          role: "Incident Triage Bot",
          view: "agent",
        });
      });

      // Second connect simulates a later watch/join with no explicit role updates.
      await withSilencedStdio(async () => {
        await runConnect({
          profile: "codex--role-only-e2e",
          openMeldProfile,
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "ndjson",
          view: "agent",
        });
      });
    });

    expect(fetchSpy).toHaveBeenCalled();
    expect(connectWebSocketMock).toHaveBeenCalledTimes(2);
    expect(signalRecentFlags).toEqual(["1", "1"]);
    expect(signalAfterTsValues).toEqual([]);
    expect(cursorPatchPayloads).toHaveLength(1);
    expect(cursorPatchPayloads[0]).toEqual({
      role: "Incident Triage Bot",
    });
  });

  it("pauses cursor persistence when recent preload is unsynced even when lastSeenTs exists", async () => {
    let onMessageHandler: ((raw: string) => void) | null = null;
    let resolveClosed: (() => void) | null = null;
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const wsClient = {
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      onMessage: vi.fn((handler: (raw: string) => void) => {
        onMessageHandler = handler;
      }),
      onClose: vi.fn(),
      onError: vi.fn(),
      waitUntilClosed: vi.fn(() => closedPromise),
    };
    connectWebSocketMock.mockResolvedValue(wsClient);

    const cursorPatchPayloads: Record<string, unknown>[] = [];
    const okJson = (payload: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method ?? "GET").toUpperCase();

      if (method === "GET" && url.pathname.endsWith("/meta")) {
        return okJson({
          spaceId: "ops-room",
          organizationId: "org-1",
          visibility: "private",
        });
      }

      if (method === "GET" && url.pathname.endsWith("/members")) {
        return okJson({
          spaceId: "ops-room",
          generatedAt: "2026-03-06T00:00:00.000Z",
          summary: {
            totalCount: 0,
            humanCount: 0,
            agentCount: 0,
            liveNowCount: 0,
          },
          humans: [],
          agents: [],
        });
      }

      if (url.pathname.includes("/cursors/")) {
        if (method === "GET") {
          return okJson({ lastSeenTs: 100 });
        }
        if (method === "PATCH") {
          cursorPatchPayloads.push(
            JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
          );
          return okJson({});
        }
      }

      if (
        method === "GET" &&
        url.pathname.endsWith("/signals") &&
        url.searchParams.get("recent") === "1"
      ) {
        return Promise.resolve(
          new Response("upstream unavailable", { status: 500 })
        );
      }

      throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
    });

    await withTempHome(async () => {
      const openMeldProfile = createOpenMeldProfileInput({
        openMeldProfileId: "ffffffff-0000-0000-0000-000000000000",
        profileName: "Codex",
        profileKind: "agent",
      });
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--catchup-pause",
          profileId: "ffffffff-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
          silent: true,
        });
      });

      const connectPromise = withSilencedStdio(async () => {
        await runConnect({
          profile: "codex--catchup-pause",
          openMeldProfile,
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "ndjson",
          view: "agent",
        });
      });

      await vi.waitFor(() => {
        expect(onMessageHandler).not.toBeNull();
      });

      onMessageHandler?.(
        JSON.stringify({
          v: 1,
          id: "signal-live-1",
          spaceId: "ops-room",
          ts: 9001,
          type: "signal.text",
          profile: { kind: "human", profileId: "alice", profileName: "Alice" },
          data: { text: "hello from live ws" },
        })
      );
      resolveClosed?.();

      await connectPromise;
    });

    expect(cursorPatchPayloads).toEqual([]);
  });

  it("dedupes duplicated websocket signals that arrive during catch-up buffering", async () => {
    let onMessageHandler: ((raw: string) => void) | null = null;
    let resolveClosed: (() => void) | null = null;
    let resolveRecentSignalsFetch: ((value: Response) => void) | null = null;

    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const recentSignalsFetchPromise = new Promise<Response>((resolve) => {
      resolveRecentSignalsFetch = resolve;
    });
    const wsClient = {
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      onMessage: vi.fn((handler: (raw: string) => void) => {
        onMessageHandler = handler;
      }),
      onClose: vi.fn(),
      onError: vi.fn(),
      waitUntilClosed: vi.fn(() => closedPromise),
    };
    connectWebSocketMock.mockResolvedValue(wsClient);

    const okJson = (payload: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method ?? "GET").toUpperCase();

      if (method === "GET" && url.pathname.endsWith("/meta")) {
        return okJson({
          spaceId: "ops-room",
          organizationId: "org-1",
          visibility: "private",
        });
      }

      if (url.pathname.includes("/cursors/")) {
        if (method === "GET") {
          return okJson({});
        }
        if (method === "PATCH") {
          return okJson({});
        }
      }

      if (
        method === "GET" &&
        url.pathname.endsWith("/signals") &&
        url.searchParams.get("recent") === "1"
      ) {
        return recentSignalsFetchPromise;
      }

      throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
    });

    await withTempHome(async () => {
      const openMeldProfile = createOpenMeldProfileInput({
        openMeldProfileId: "dddddddd-0000-0000-0000-000000000000",
        profileName: "Codex",
        profileKind: "agent",
      });
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--dedupe-during-buffering",
          profileId: "dddddddd-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
          silent: true,
        });
      });

      const connectPromise = withCapturedStdio(async () => {
        await runConnect({
          profile: "codex--dedupe-during-buffering",
          openMeldProfile,
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "ndjson",
          view: "agent",
        });
      });

      await vi.waitFor(() => {
        expect(onMessageHandler).not.toBeNull();
      });

      const duplicatedSignal = JSON.stringify({
        v: 1,
        id: "signal-live-dup",
        spaceId: "ops-room",
        ts: 9001,
        type: "signal.text",
        profile: { kind: "human", profileId: "alice", profileName: "Alice" },
        data: { text: "hello from live ws" },
      });
      onMessageHandler?.(duplicatedSignal);
      onMessageHandler?.(duplicatedSignal);

      resolveRecentSignalsFetch?.(
        new Response(
          JSON.stringify({
            signals: [],
            nextCursor: null,
          }),
          { status: 200 }
        )
      );
      resolveClosed?.();

      const { stdout } = await connectPromise;
      const duplicatedEvents = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { id?: string; type?: string })
        .filter((event) => event.id === "signal-live-dup");
      expect(duplicatedEvents).toHaveLength(1);
    });
  });

  it("switches to live passthrough when catch-up live buffer overflows", async () => {
    let onMessageHandler: ((raw: string) => void) | null = null;
    let resolveClosed: (() => void) | null = null;
    let resolveRecentSignalsFetch: ((value: Response) => void) | null = null;

    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const recentSignalsFetchPromise = new Promise<Response>((resolve) => {
      resolveRecentSignalsFetch = resolve;
    });
    const wsClient = {
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      onMessage: vi.fn((handler: (raw: string) => void) => {
        onMessageHandler = handler;
      }),
      onClose: vi.fn(),
      onError: vi.fn(),
      waitUntilClosed: vi.fn(() => closedPromise),
    };
    connectWebSocketMock.mockResolvedValue(wsClient);

    const cursorPatchPayloads: Record<string, unknown>[] = [];
    const okJson = (payload: unknown): Promise<Response> =>
      Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method ?? "GET").toUpperCase();

      if (method === "GET" && url.pathname.endsWith("/meta")) {
        return okJson({
          spaceId: "ops-room",
          organizationId: "org-1",
          visibility: "private",
        });
      }

      if (url.pathname.includes("/cursors/")) {
        if (method === "GET") {
          return okJson({ lastSeenTs: 100 });
        }
        if (method === "PATCH") {
          cursorPatchPayloads.push(
            JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
          );
          return okJson({});
        }
      }

      if (
        method === "GET" &&
        url.pathname.endsWith("/signals") &&
        url.searchParams.get("recent") === "1"
      ) {
        return recentSignalsFetchPromise;
      }

      throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
    });

    await withTempHome(async () => {
      const openMeldProfile = createOpenMeldProfileInput({
        openMeldProfileId: "cccccccc-0000-0000-0000-000000000000",
        profileName: "Codex",
        profileKind: "agent",
      });
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--buffer-overflow",
          profileId: "cccccccc-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
          silent: true,
        });
      });

      const connectPromise = withCapturedStdio(async () => {
        await runConnect({
          profile: "codex--buffer-overflow",
          openMeldProfile,
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "ndjson",
          view: "human",
        });
      });

      await vi.waitFor(() => {
        expect(onMessageHandler).not.toBeNull();
      });

      for (
        let index = 0;
        index < CATCHUP_BUFFER_OVERFLOW_EVENT_COUNT;
        index += 1
      ) {
        onMessageHandler?.(
          JSON.stringify({
            v: 1,
            id: `signal-overflow-${index}`,
            spaceId: "ops-room",
            ts: 9001 + index,
            type: "signal.text",
            profile: {
              kind: "human",
              profileId: "alice",
              profileName: "Alice",
            },
            data: { text: `overflow-${index}` },
          })
        );
      }

      resolveRecentSignalsFetch?.(
        new Response(
          JSON.stringify({
            signals: [],
            nextCursor: null,
          }),
          { status: 200 }
        )
      );
      resolveClosed?.();

      const { stdout, stderr } = await connectPromise;
      const overflowSignalIds = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { id?: string })
        .flatMap((event) =>
          typeof event.id === "string" &&
          event.id.startsWith("signal-overflow-")
            ? [event.id]
            : []
        );

      expect(overflowSignalIds).toHaveLength(
        CATCHUP_BUFFER_OVERFLOW_EVENT_COUNT
      );
      expect(new Set(overflowSignalIds).size).toBe(
        CATCHUP_BUFFER_OVERFLOW_EVENT_COUNT
      );
      expect(stderr).toContain(
        "Warning: OpenMeld couldn't fully catch up to recent messages, so live updates will continue without saving your place for this session."
      );
      expect(stderr).toContain(
        "Warning: OpenMeld will keep showing live updates, but it won't save your place for the rest of this session."
      );
      expect(cursorPatchPayloads).toEqual([]);
    });
  });
});

function createOpenMeldProfileInput(input: {
  openMeldProfileId: string;
  profileName: string;
  profileKind: "human" | "agent" | "system";
}) {
  return createTestOpenMeldProfile({
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.profileName,
    profileKind: input.profileKind,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  });
}
