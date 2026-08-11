import { afterEach, describe, expect, it, vi } from "vitest";
import { runSpaceSend } from "../src/space/command";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const resolveOpenMeldProfileOrNullMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    createdAt: "2026-03-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: resolveOpenMeldProfileOrNullMock,
}));

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (
      ...args: Parameters<typeof getAuthSessionStateMock>
    ) => getAuthSessionStateMock(...args),
  };
});

const VALID_SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const AGENT_PROFILE = {
  openMeldProfileId: "agt_executor",
  profileName: "Executor",
  profileKind: "agent",
  status: "active",
  ownerUserId: "user-1",
  source: "cli_create",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-02-20T00:00:00.000Z",
  updatedAt: "2026-02-20T00:00:00.000Z",
} as const;

const HUMAN_PROFILE = {
  openMeldProfileId: "hum_operator",
  profileName: "Felix",
  profileKind: "human",
  status: "active",
  ownerUserId: "user-1",
  source: "auth_bootstrap",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-02-20T00:00:00.000Z",
  updatedAt: "2026-02-20T00:00:00.000Z",
} as const;

function createPostedSignalResponse() {
  return new Response(
    JSON.stringify({
      v: 1,
      id: "evt-1",
      spaceId: VALID_SPACE_ID,
      ts: 1,
      profile: {
        kind: "agent",
        profileId: AGENT_PROFILE.openMeldProfileId,
      },
      type: "signal.text",
      data: {
        text: "hello",
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

describe("space send agent profile guard output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resolveOpenMeldProfileOrNullMock.mockReset();
    getAuthSessionStateMock.mockReset();
    Reflect.deleteProperty(process.env, "OPENMELD_DISPATCH_RUNTIME_MODE");
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID"
    );
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID"
    );
  });

  it("prints profile consistency hint and sender identity in agent view", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      resolveOpenMeldProfileOrNullMock.mockImplementation(
        async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
          openMeldProfileId
            ? { ...AGENT_PROFILE, openMeldProfileId }
            : AGENT_PROFILE
      );
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => createPostedSignalResponse());

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceSend({
          profile: "agt_executor",
          baseUrl: "https://gateway.openmeld.invalid",
          space: VALID_SPACE_ID,
          text: "hello",
          view: "agent",
        });
      });

      const hint = findAgentLineEnvelope(
        stdout,
        "space.send.profile_consistency_hint"
      );
      expect(hint?.text).toBe(
        "Profile guard: keep profile consistent unless intentional switch."
      );

      const sender = findAgentLineEnvelope(stdout, "send.acting_profile");
      expect(sender?.text).toBe("sender: agt_executor (agent)");
      expect(sender?.data).toMatchObject({
        profileId: "agt_executor",
        profileKind: "agent",
        profileName: "Executor",
      });

      expect(fetchSpy).toHaveBeenCalled();
      const call = fetchSpy.mock.calls.at(-1);
      const requestInit =
        (call?.[1] as
          | {
              headers?: Record<string, string>;
              body?: string;
            }
          | undefined) ?? {};
      expect(requestInit.headers?.["x-openmeld-profile-id"]).toBe(
        "agt_executor"
      );
      expect(JSON.parse(requestInit.body ?? "{}")).toMatchObject({
        text: "hello",
      });
    });
  });

  it("does not print agent-only guard output in human view", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      resolveOpenMeldProfileOrNullMock.mockImplementation(
        async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
          openMeldProfileId
            ? { ...HUMAN_PROFILE, openMeldProfileId }
            : HUMAN_PROFILE
      );
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        createPostedSignalResponse()
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceSend({
          profile: "hum_operator",
          baseUrl: "https://gateway.openmeld.invalid",
          space: VALID_SPACE_ID,
          text: "hello",
          view: "human",
        });
      });

      expect(
        findAgentLineEnvelope(stdout, "space.send.profile_consistency_hint")
      ).toBeUndefined();
      expect(
        findAgentLineEnvelope(stdout, "send.acting_profile")
      ).toBeUndefined();
      expect(
        findAgentLineEnvelope(stdout, "space.send.owner_directive_ack_hint")
      ).toBeUndefined();
      expect(stdout).not.toContain("Profile guard: keep profile consistent");
      expect(stdout).toContain("sender: hum_operator (human)");
    });
  });

  it("prints workflow ack hint for PLAN without ACK in agent view", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      resolveOpenMeldProfileOrNullMock.mockImplementation(
        async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
          openMeldProfileId
            ? { ...AGENT_PROFILE, openMeldProfileId }
            : AGENT_PROFILE
      );
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        createPostedSignalResponse()
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceSend({
          profile: "agt_executor",
          baseUrl: "https://gateway.openmeld.invalid",
          space: VALID_SPACE_ID,
          text: "PLAN: implement issue #006 phase-1",
          view: "agent",
        });
      });

      const hint = findAgentLineEnvelope(
        stdout,
        "space.send.owner_directive_ack_hint"
      );
      expect(hint?.text).toContain("ACK:<owner-signal-id>");
      expect(hint?.text).toContain("BLOCKED:");
    });
  });

  it("prints workflow ack hint when PLAN appears after context lines", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      resolveOpenMeldProfileOrNullMock.mockImplementation(
        async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
          openMeldProfileId
            ? { ...AGENT_PROFILE, openMeldProfileId }
            : AGENT_PROFILE
      );
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        createPostedSignalResponse()
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceSend({
          profile: "agt_executor",
          baseUrl: "https://gateway.openmeld.invalid",
          space: `${VALID_SPACE_ID}\n`,
          text: "Context: owner requested summary first.\nPLAN: implement issue #006 phase-1",
          view: "agent",
        });
      });

      expect(
        findAgentLineEnvelope(stdout, "space.send.owner_directive_ack_hint")
      ).toBeDefined();
    });
  });

  it("blocks public write when running inside a dispatch-owned runtime", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_DISPATCH_RUNTIME_MODE = "dispatch-owned-runtime";
      process.env.OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID = "dispatch-123";
      process.env.OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID = "agt_executor";

      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      resolveOpenMeldProfileOrNullMock.mockImplementation(
        async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
          openMeldProfileId
            ? { ...AGENT_PROFILE, openMeldProfileId }
            : AGENT_PROFILE
      );
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        withCapturedStdio(async () => {
          await runSpaceSend({
            profile: "agt_executor",
            baseUrl: "https://gateway.openmeld.invalid",
            space: VALID_SPACE_ID,
            text: "hello",
            view: "agent",
          });
        })
      ).rejects.toThrow(
        "openmeld space send is blocked inside a dispatch-owned runtime"
      );

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("does not print workflow ack hint when PLAN includes ACK reference", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      resolveOpenMeldProfileOrNullMock.mockImplementation(
        async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
          openMeldProfileId
            ? { ...AGENT_PROFILE, openMeldProfileId }
            : AGENT_PROFILE
      );
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        createPostedSignalResponse()
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceSend({
          profile: "agt_executor",
          baseUrl: "https://gateway.openmeld.invalid",
          space: VALID_SPACE_ID,
          text: "PLAN: implement issue #006 phase-1\nACK: 269d639a-42d8-4ca1-94dc-7f9811e1ec4e",
          view: "agent",
        });
      });

      expect(
        findAgentLineEnvelope(stdout, "space.send.owner_directive_ack_hint")
      ).toBeUndefined();
    });
  });

  it("does not print agent-only guard output when profile guard blocks send", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      resolveOpenMeldProfileOrNullMock.mockResolvedValue(null);

      const { result, stdout } = await withCapturedStdio(async () => {
        try {
          await runSpaceSend({
            space: VALID_SPACE_ID,
            text: "hello",
            view: "agent",
          });
          return { error: undefined as unknown };
        } catch (error) {
          return { error };
        }
      });

      expect(result.error).toMatchObject({
        code: "space.profile.required",
      });
      expect(
        findAgentLineEnvelope(stdout, "space.send.profile_consistency_hint")
      ).toBeUndefined();
      expect(
        findAgentLineEnvelope(stdout, "send.acting_profile")
      ).toBeUndefined();
    });
  });
});

function findAgentLineEnvelope(
  stdout: string,
  code: string
): { text?: string; data?: Record<string, unknown> } | undefined {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        code?: string;
        text?: string;
        data?: Record<string, unknown>;
      };
      if (parsed.type === "line" && parsed.code === code) {
        return {
          ...(typeof parsed.text === "string" ? { text: parsed.text } : {}),
          ...(parsed.data ? { data: parsed.data } : {}),
        };
      }
    } catch {
      // Ignore plain-text lines in human view.
    }
  }

  return undefined;
}
