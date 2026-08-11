import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenMeldLockError } from "../src/config/lock";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import { runSpaceJoinConnectHandoff } from "../src/space/join-connect-handoff";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const runConnectMock = vi.hoisted(() => vi.fn());
const cancelMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn());
const passwordPromptMock = vi.hoisted(() => vi.fn());

vi.mock("../src/space/connect", () => {
  return {
    runConnect: (...args: Parameters<typeof runConnectMock>) =>
      runConnectMock(...args),
  };
});

vi.mock("@clack/prompts", () => {
  return {
    cancel: (...args: Parameters<typeof cancelMock>) => cancelMock(...args),
    confirm: vi.fn(),
    isCancel: (...args: Parameters<typeof isCancelMock>) =>
      isCancelMock(...args),
    multiselect: vi.fn(),
    password: (...args: Parameters<typeof passwordPromptMock>) =>
      passwordPromptMock(...args),
    select: vi.fn(),
    text: vi.fn(),
  };
});

describe("space join connect handoff", () => {
  beforeEach(() => {
    runConnectMock.mockReset();
    cancelMock.mockReset();
    isCancelMock.mockReset().mockReturnValue(false);
    passwordPromptMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("keeps human join on stdio without stream-only fallback", async () => {
    runConnectMock.mockResolvedValue(undefined);
    const harness = createPresenterHarness();

    const result = await runSpaceJoinConnectHandoff({
      openMeldProfileId: "agt-join-human",
      openMeldProfile: createProfile({
        openMeldProfileId: "agt-join-human",
        profileName: "Human Join",
      }),
      baseUrl: "https://example.com",
      space: "ops-room",
      presenter: harness.presenter,
      resolvedView: "human",
      output: "text",
      localEcho: true,
      canPromptJoinPassword: false,
      rawStream: false,
    });

    expect(result).toBe("connected");
    expect(harness.events).toHaveLength(0);
    expect(runConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "agt-join-human",
        connectionMode: "join",
        stdio: true,
        sendCommand: undefined,
        view: "human",
      })
    );
  });

  it("emits stream-only join fallback with a deterministic send command", async () => {
    runConnectMock.mockResolvedValue(undefined);
    const harness = createPresenterHarness();

    await withStubbedStdinIsTTY(false, async () => {
      const result = await runSpaceJoinConnectHandoff({
        openMeldProfileId: "agt-join-agent",
        openMeldProfile: createProfile({
          openMeldProfileId: "agt-join-agent",
          profileName: "Agent Join",
        }),
        baseUrl: "https://example.com",
        space: "ops-room",
        presenter: harness.presenter,
        resolvedView: "agent",
        output: "ndjson",
        localEcho: false,
        canPromptJoinPassword: false,
        rawStream: false,
      });

      expect(result).toBe("connected");
    });

    expect(harness.events).toEqual([
      {
        type: "info",
        code: "space.join.stdin_fallback_watch",
        data: {
          connectionMode: "join",
          profileId: "agt-join-agent",
          spaceId: "ops-room",
          sendCommand:
            "openmeld space --gateway-url https://example.com send --profile agt-join-agent ops-room <text...>",
        },
      },
    ]);
    expect(runConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "agt-join-agent",
        stdio: false,
        sendCommand:
          "openmeld space --gateway-url https://example.com send --profile agt-join-agent ops-room <text...>",
        view: "agent",
      })
    );
  });

  it("still emits the stream-only fallback event in raw-stream mode", async () => {
    runConnectMock.mockResolvedValue(undefined);
    const harness = createPresenterHarness();

    await withStubbedStdinIsTTY(false, async () => {
      const result = await runSpaceJoinConnectHandoff({
        openMeldProfileId: "agt-join-agent-raw",
        openMeldProfile: createProfile({
          openMeldProfileId: "agt-join-agent-raw",
          profileName: "Agent Raw Join",
        }),
        baseUrl: "https://example.com",
        space: "ops-room",
        presenter: harness.presenter,
        resolvedView: "agent",
        output: "ndjson",
        localEcho: false,
        canPromptJoinPassword: false,
        rawStream: true,
      });

      expect(result).toBe("connected");
    });

    expect(harness.events).toEqual([
      {
        type: "info",
        code: "space.join.stdin_fallback_watch",
        data: {
          connectionMode: "join",
          profileId: "agt-join-agent-raw",
          spaceId: "ops-room",
          sendCommand:
            "openmeld space --gateway-url https://example.com send --profile agt-join-agent-raw ops-room <text...>",
        },
      },
    ]);
  });

  it("keeps explicit gateway urls in the stream-only send command", async () => {
    runConnectMock.mockResolvedValue(undefined);
    const harness = createPresenterHarness();

    await withStubbedStdinIsTTY(false, async () => {
      await runSpaceJoinConnectHandoff({
        openMeldProfileId: "agt-join-gateway",
        openMeldProfile: createProfile({
          openMeldProfileId: "agt-join-gateway",
          profileName: "Gateway Join",
        }),
        baseUrl: "https://gateway.example.com",
        space: "ops-room",
        presenter: harness.presenter,
        resolvedView: "agent",
        output: "ndjson",
        localEcho: false,
        canPromptJoinPassword: false,
        rawStream: false,
      });
    });

    expect(harness.events[0]).toMatchObject({
      data: {
        sendCommand:
          "openmeld space --gateway-url https://gateway.example.com send --profile agt-join-gateway ops-room <text...>",
      },
    });
  });

  it("uses the user-facing cli entry in the stream-only send command", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    runConnectMock.mockResolvedValue(undefined);
    const harness = createPresenterHarness();

    await withStubbedStdinIsTTY(false, async () => {
      await runSpaceJoinConnectHandoff({
        openMeldProfileId: "agt-join-entry",
        openMeldProfile: createProfile({
          openMeldProfileId: "agt-join-entry",
          profileName: "Entry Join",
        }),
        baseUrl: "https://gateway.example.com",
        space: "ops-room",
        presenter: harness.presenter,
        resolvedView: "agent",
        output: "ndjson",
        localEcho: false,
        canPromptJoinPassword: false,
        rawStream: false,
      });
    });

    expect(harness.events[0]).toMatchObject({
      data: {
        sendCommand:
          "openmeld-dev space --gateway-url https://gateway.example.com send --profile agt-join-entry ops-room <text...>",
      },
    });
  });

  it("retries password challenges inside the handoff seam for promptable joins", async () => {
    runConnectMock
      .mockRejectedValueOnce(new Error("space password required"))
      .mockResolvedValueOnce(undefined);
    passwordPromptMock.mockResolvedValueOnce("correct-password");
    const harness = createPresenterHarness();

    const result = await runSpaceJoinConnectHandoff({
      openMeldProfileId: "agt-join-retry",
      openMeldProfile: createProfile({
        openMeldProfileId: "agt-join-retry",
        profileName: "Retry Join",
      }),
      baseUrl: "https://example.com",
      space: "ops-room",
      initialPassword: "wrong-password",
      presenter: harness.presenter,
      resolvedView: "human",
      output: "text",
      localEcho: true,
      canPromptJoinPassword: true,
      rawStream: false,
    });

    expect(result).toBe("connected");
    expect(harness.lines).toContainEqual(
      expect.objectContaining({ code: "space.join.password.required" })
    );
    expect(runConnectMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ password: "wrong-password" })
    );
    expect(runConnectMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ password: "correct-password" })
    );
  });

  it("returns cancelled when the connect-time password retry is cancelled", async () => {
    const cancelToken = Symbol("cancel");
    runConnectMock.mockRejectedValueOnce(new Error("space password invalid"));
    passwordPromptMock.mockResolvedValueOnce(cancelToken);
    isCancelMock.mockImplementation((value) => value === cancelToken);
    const harness = createPresenterHarness();

    const result = await runSpaceJoinConnectHandoff({
      openMeldProfileId: "agt-join-cancelled",
      openMeldProfile: createProfile({
        openMeldProfileId: "agt-join-cancelled",
        profileName: "Cancelled Join",
      }),
      baseUrl: "https://example.com",
      space: "ops-room",
      presenter: harness.presenter,
      resolvedView: "human",
      output: "text",
      localEcho: true,
      canPromptJoinPassword: true,
      rawStream: false,
    });

    expect(result).toBe("cancelled");
    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
  });

  it("does not fall back to human password prompts for agent joins", async () => {
    runConnectMock.mockRejectedValueOnce(new Error("space password invalid"));
    const harness = createPresenterHarness();

    await expect(
      runSpaceJoinConnectHandoff({
        openMeldProfileId: "agt-join-agent-password",
        openMeldProfile: createProfile({
          openMeldProfileId: "agt-join-agent-password",
          profileName: "Agent Password Join",
        }),
        baseUrl: "https://example.com",
        space: "ops-room",
        presenter: harness.presenter,
        resolvedView: "agent",
        output: "ndjson",
        localEcho: false,
        canPromptJoinPassword: false,
        rawStream: false,
      })
    ).rejects.toThrow("space password invalid");

    expect(passwordPromptMock).not.toHaveBeenCalled();
  });

  it("passes resolved role facts through to runConnect unchanged", async () => {
    runConnectMock.mockResolvedValue(undefined);
    const harness = createPresenterHarness();

    await runSpaceJoinConnectHandoff({
      openMeldProfileId: "agt-join-role-pass",
      openMeldProfile: createProfile({
        openMeldProfileId: "agt-join-role-pass",
        profileName: "Role Pass Join",
      }),
      baseUrl: "https://example.com",
      space: "ops-room",
      presenter: harness.presenter,
      resolvedView: "human",
      output: "text",
      localEcho: true,
      canPromptJoinPassword: false,
      rawStream: false,
      role: "Architect",
      mentionAlias: "arch-join",
    });

    expect(runConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "Architect",
        mentionAlias: "arch-join",
      })
    );
  });

  it("keeps duplicate join lock output structured in human ndjson mode", async () => {
    runConnectMock.mockRejectedValueOnce(
      new OpenMeldLockError({
        path: "/tmp/space-join.lock",
        key: "localhost_8080__ops-room__agt-join-human-lock",
        metaRaw:
          '{"pid":20012,"profile":"agt-join-human-lock","sessionId":"terminal-ppid-69862","at":"2026-03-04T09:36:28.619Z"}',
      })
    );
    const harness = createPresenterHarness();

    await expect(
      runSpaceJoinConnectHandoff({
        openMeldProfileId: "agt-join-human-lock",
        openMeldProfile: createProfile({
          openMeldProfileId: "agt-join-human-lock",
          profileName: "Human Lock Join",
        }),
        baseUrl: "https://example.com",
        space: "ops-room",
        presenter: harness.presenter,
        resolvedView: "human",
        output: "ndjson",
        localEcho: true,
        canPromptJoinPassword: false,
        rawStream: false,
      })
    ).rejects.toMatchObject({
      code: "openmeld.space.output_handled",
    });

    expect(harness.lines).toEqual([]);
    expect(harness.data).toEqual([
      {
        code: "space.join.lock_blocked",
        payload: {
          text: expect.stringContaining("🔒 Join blocked"),
        },
      },
    ]);
  });

  it("guides human users to repair an orphaned legacy join lock", async () => {
    runConnectMock.mockRejectedValueOnce(
      new OpenMeldLockError({
        path: "/tmp/space-join.lock",
        key: "localhost_8080__ops-room__agt-join-orphaned-lock",
        metaRaw:
          '{"pid":20012,"profile":"agt-join-orphaned-lock","sessionId":"terminal-ppid-69862","at":"2026-03-04T09:36:28.619Z"}',
        contentionState: "orphaned",
      })
    );
    const harness = createPresenterHarness();

    await expect(
      runSpaceJoinConnectHandoff({
        openMeldProfileId: "agt-join-orphaned-lock",
        openMeldProfile: createProfile({
          openMeldProfileId: "agt-join-orphaned-lock",
          profileName: "Orphaned Lock Join",
        }),
        baseUrl: "https://example.com",
        space: "ops-room",
        presenter: harness.presenter,
        resolvedView: "human",
        output: "text",
        localEcho: true,
        canPromptJoinPassword: false,
        rawStream: false,
      })
    ).rejects.toMatchObject({
      code: "openmeld.space.output_handled",
    });

    expect(harness.lines).toEqual([
      {
        code: "space.join.lock_blocked",
        text: expect.stringContaining("lock left by an older version"),
      },
    ]);
    expect(harness.lines[0]?.text).toContain(
      "Close any other OpenMeld commands"
    );
    expect(harness.lines[0]?.text).toContain("`openmeld repair local-state`");
    expect(harness.lines[0]?.text).not.toContain(
      "This profile has already joined this space"
    );
  });
});

function createProfile(input: {
  openMeldProfileId: string;
  profileName: string;
}): OpenMeldProfile {
  return createTestOpenMeldProfile({
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.profileName,
    profileKind: "agent",
  });
}

function createPresenterHarness(): {
  presenter: {
    event: (type: string, code: string, data?: Record<string, unknown>) => void;
    line: (payload: { code: string; text: string }) => void;
    data: (payload: { code: string; payload: unknown }) => void;
  };
  events: Array<{
    type: string;
    code: string;
    data?: Record<string, unknown>;
  }>;
  lines: Array<{ code: string; text: string }>;
  data: Array<{ code: string; payload: unknown }>;
} {
  const events: Array<{
    type: string;
    code: string;
    data?: Record<string, unknown>;
  }> = [];
  const lines: Array<{ code: string; text: string }> = [];
  const data: Array<{ code: string; payload: unknown }> = [];
  return {
    presenter: {
      event: (type, code, data) => {
        events.push({ type, code, ...(data ? { data } : {}) });
      },
      line: (payload) => {
        lines.push(payload);
      },
      data: (payload) => {
        data.push(payload);
      },
    },
    events,
    lines,
    data,
  };
}

async function withStubbedStdinIsTTY<T>(
  isTTY: boolean,
  run: () => Promise<T>
): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: isTTY,
  });
  try {
    return await run();
  } finally {
    if (original) {
      Object.defineProperty(process.stdin, "isTTY", original);
    } else {
      Reflect.deleteProperty(process.stdin, "isTTY");
    }
  }
}
