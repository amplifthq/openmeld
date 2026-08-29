import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithCleanupPreservingRunError } from "../src/config/lock";
import { runConnect } from "../src/space/connect";
import { withTempHome } from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";
import { createSpaceMetaFixture } from "./helpers/space-meta-fixture";

const acquireLockMock = vi.hoisted(() => vi.fn());
const releaseLockMock = vi.hoisted(() => vi.fn());
const runWithHeldLockMock = vi.hoisted(() => vi.fn());
const connectWebSocketMock = vi.hoisted(() => vi.fn());

vi.mock("../src/config/lock", async () => {
  const actual = await vi.importActual("../src/config/lock");
  return {
    ...actual,
    acquireLock: (...args: Parameters<typeof acquireLockMock>) =>
      acquireLockMock(...args),
    releaseLock: (...args: Parameters<typeof releaseLockMock>) =>
      releaseLockMock(...args),
    runWithHeldLock: (...args: Parameters<typeof runWithHeldLockMock>) =>
      runWithHeldLockMock(...args),
  };
});

vi.mock("../src/transport/ws", () => {
  return {
    connectWebSocket: (
      ...args: Parameters<typeof connectWebSocketMock>
    ): ReturnType<typeof connectWebSocketMock> => connectWebSocketMock(...args),
  };
});

describe("connect lock policy", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    acquireLockMock.mockImplementation(
      async (input: { openMeldProfileId: string }) => ({
        path:
          input.openMeldProfileId === "auth-session"
            ? "/tmp/auth-session.lock"
            : "/tmp/join.lock",
      })
    );
    releaseLockMock.mockResolvedValue(undefined);
    runWithHeldLockMock.mockImplementation(
      async (input: { lock: { path: string }; run: () => Promise<unknown> }) =>
        await runWithCleanupPreservingRunError({
          run: input.run,
          cleanup: () => releaseLockMock(input.lock),
        })
    );
    connectWebSocketMock.mockResolvedValue({
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn(),
      onMessage: vi.fn(),
      onClose: vi.fn(),
      onError: vi.fn(),
      waitUntilClosed: vi.fn(async () => undefined),
    });
    mockConnectFetchSuccess();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it("keeps a hard local lock for join connections", async () => {
    await withTempHome(async () => {
      await runConnect({
        profile: "profile-key",
        openMeldProfile: createOpenMeldProfileInput({
          openMeldProfileId: "agt-join",
          profileName: "Join Agent",
          profileKind: "agent",
        }),
        baseUrl: "https://example.com",
        space: "ops-room",
        connectionMode: "join",
        stdio: false,
        output: "ndjson",
        view: "agent",
        historyLimit: 0,
      });
    });

    expect(acquireLockMock).toHaveBeenCalledWith({
      openMeldProfileId: "agt-join",
      key: "example.com__ops-room__agt-join__join",
      meta: {
        mode: "join",
        space: "ops-room",
        profileId: "agt-join",
      },
    });
    expect(runWithHeldLockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lock: { path: "/tmp/join.lock" },
        releaseContext: expect.objectContaining({
          component: "space.connect",
          lockKey: "example.com__ops-room__agt-join__join",
          mode: "join",
          profileId: "agt-join",
          space: "ops-room",
        }),
      })
    );
    expect(releaseLockMock).toHaveBeenCalledWith({ path: "/tmp/join.lock" });
  });

  it("skips local hard locks for watch connections", async () => {
    await withTempHome(async () => {
      await runConnect({
        profile: "profile-key",
        openMeldProfile: createOpenMeldProfileInput({
          openMeldProfileId: "agt-watch",
          profileName: "Watch Agent",
          profileKind: "agent",
        }),
        baseUrl: "https://example.com",
        space: "ops-room",
        connectionMode: "watch",
        stdio: false,
        output: "ndjson",
        view: "agent",
        historyLimit: 0,
      });
    });

    expect(acquireLockMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ openMeldProfileId: "agt-watch" })
    );
    expect(releaseLockMock).not.toHaveBeenCalledWith({
      path: "/tmp/join.lock",
    });
  });

  it("fails closed when connectionMode is omitted", async () => {
    await withTempHome(async () => {
      await expect(
        runConnect({
          profile: "profile-key",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "agt-missing-mode",
            profileName: "Join Agent",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          stdio: false,
          output: "ndjson",
          view: "agent",
          historyLimit: 0,
        } as unknown as Parameters<typeof runConnect>[0])
      ).rejects.toThrow("runConnect requires explicit connectionMode");
    });

    expect(acquireLockMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ openMeldProfileId: "agt-missing-mode" })
    );
    expect(releaseLockMock).not.toHaveBeenCalledWith({
      path: "/tmp/join.lock",
    });
  });

  it("preserves the connection error when lock release also fails", async () => {
    const connectionError = new Error("socket connect failed");
    releaseLockMock.mockRejectedValueOnce(new Error("release failed"));
    connectWebSocketMock.mockRejectedValueOnce(connectionError);

    await withTempHome(async () => {
      await expect(
        runConnect({
          profile: "profile-key",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "agt-join-error",
            profileName: "Join Agent",
            profileKind: "agent",
          }),
          baseUrl: "https://example.com",
          space: "ops-room",
          connectionMode: "join",
          stdio: false,
          output: "ndjson",
          view: "agent",
          historyLimit: 0,
        })
      ).rejects.toThrow("socket connect failed");
    });

    expect(releaseLockMock).toHaveBeenCalledWith({ path: "/tmp/join.lock" });
  });
});

function mockConnectFetchSuccess(): void {
  const okJson = (payload: unknown): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(String(input));
    const method = String(init?.method ?? "GET").toUpperCase();

    if (method === "GET" && url.pathname.endsWith("/meta")) {
      return okJson(createSpaceMetaFixture({ spaceId: "ops-room" }));
    }

    if (method === "GET" && url.pathname.includes("/cursors/")) {
      return okJson({});
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

    throw new Error(`Unexpected fetch: ${method} ${url.toString()}`);
  });
}

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
