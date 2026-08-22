import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSpaceBoard } from "../src/space/board-command";
import {
  runSpaceCreate,
  runSpaceHistory,
  runSpaceJoin,
  runSpaceSend,
  runSpaceWatch,
} from "../src/space/command";
import { runSpaceContract } from "../src/space/contract-command";
import { runSpaceContractSet } from "../src/space/contract-set-command";
import { runSpaceGuideRead } from "../src/space/guide-command";
import { runSpaceResult } from "../src/space/result-command";
import { runSpaceStatus } from "../src/space/status-command";
import { runSpaceUpdates } from "../src/space/updates-command";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const resolveOpenMeldProfileOrNullMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: resolveOpenMeldProfileOrNullMock,
}));

vi.mock("../src/config/openmeld-profiles-api", () => ({
  resolveOpenMeldProfileByIdOrName: async ({
    profileIdentifier,
  }: {
    profileIdentifier?: string;
  }) =>
    profileIdentifier
      ? {
          openMeldProfileId: profileIdentifier,
          profileName: "Resolved Profile",
          profileKind: "agent",
          status: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        }
      : null,
}));

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: getAuthSessionStateMock,
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
  openMeldProfileId: "human_operator",
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

const SYSTEM_PROFILE = {
  openMeldProfileId: "sys_dispatcher",
  profileName: "System Dispatcher",
  profileKind: "system",
  status: "active",
  ownerUserId: "system",
  source: "system",
  createdByUserId: null,
  lastUsedAt: null,
  createdAt: "2026-02-20T00:00:00.000Z",
  updatedAt: "2026-02-20T00:00:00.000Z",
} as const;

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    createdAt: "2026-03-01T00:00:00.000Z",
    activeOrganization: {
      id: "org-1",
      slug: "acme",
      name: "Acme",
    },
  },
};

function createPostSignalResponse(text = "hello"): Response {
  return new Response(
    JSON.stringify({
      v: 1,
      id: "sig-1",
      spaceId: VALID_SPACE_ID,
      ts: 1,
      profile: {
        kind: "human",
        profileId: "11111111-1111-4111-8111-111111111111",
        profileName: "Mira",
      },
      type: "signal.text",
      data: {
        text,
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

describe("space command profile guardrail", () => {
  beforeEach(() => {
    resolveOpenMeldProfileOrNullMock.mockReset();
    getAuthSessionStateMock.mockReset();
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails fast with space.profile.required when no explicit profile and no selected profile", async () => {
    await withTempHome(async () => {
      resolveOpenMeldProfileOrNullMock.mockResolvedValue(null);
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const runners: Array<{
        label: string;
        run: () => Promise<unknown>;
      }> = [
        {
          label: "create",
          run: () =>
            runSpaceCreate({
              name: "ops-room",
              visibility: "private",
              view: "agent",
            }),
        },
        {
          label: "join",
          run: () =>
            runSpaceJoin({
              space: VALID_SPACE_ID,
              view: "agent",
            }),
        },
        {
          label: "watch",
          run: () =>
            runSpaceWatch({
              space: VALID_SPACE_ID,
              view: "agent",
            }),
        },
        {
          label: "send",
          run: () =>
            runSpaceSend({
              space: VALID_SPACE_ID,
              text: "hello",
              view: "agent",
            }),
        },
        {
          label: "send_stdin",
          run: () =>
            runSpaceSend({
              space: VALID_SPACE_ID,
              text: "hello",
              stdin: true,
              view: "agent",
            }),
        },
        {
          label: "send_text_file",
          run: () =>
            runSpaceSend({
              space: VALID_SPACE_ID,
              textFile: "/tmp/missing-profile-guard.txt",
              view: "agent",
            }),
        },
        {
          label: "history",
          run: () =>
            runSpaceHistory({
              space: VALID_SPACE_ID,
              limit: 20,
              json: false,
              view: "agent",
            }),
        },
        {
          label: "guide",
          run: () =>
            runSpaceGuideRead({
              space: VALID_SPACE_ID,
              json: false,
              view: "agent",
            }),
        },
        {
          label: "board",
          run: () =>
            runSpaceBoard({
              space: VALID_SPACE_ID,
              json: false,
              view: "agent",
            }),
        },
        {
          label: "contract",
          run: () =>
            runSpaceContract({
              space: VALID_SPACE_ID,
              json: false,
              view: "agent",
            }),
        },
        {
          label: "contract_set",
          run: () =>
            runSpaceContractSet({
              space: VALID_SPACE_ID,
              dispatchPolicy: "mention_only",
              json: false,
              view: "agent",
            }),
        },
        {
          label: "status",
          run: () =>
            runSpaceStatus({
              space: VALID_SPACE_ID,
              json: false,
              view: "agent",
            }),
        },
        {
          label: "updates",
          run: () =>
            runSpaceUpdates({
              space: VALID_SPACE_ID,
              afterSignalId: "11111111-1111-4111-8111-111111111111",
              limit: 20,
              json: false,
              view: "agent",
            }),
        },
        {
          label: "result",
          run: () =>
            runSpaceResult({
              space: VALID_SPACE_ID,
              dispatchId: "dispatch-1",
              json: false,
              view: "agent",
            }),
        },
      ];

      for (const runner of runners) {
        try {
          await runner.run();
          throw new Error(`expected ${runner.label} to fail`);
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error
              ? String((error as { code?: unknown }).code ?? "")
              : "";
          expect(code).toBe("space.profile.required");
        }

        const lastCall =
          resolveOpenMeldProfileOrNullMock.mock.calls.at(-1)?.[0];
        expect(lastCall).toMatchObject({
          allowDefaultFallback: false,
          persistSelection: false,
        });
      }

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("uses the same space.profile.required code in human view", async () => {
    await withTempHome(async () => {
      resolveOpenMeldProfileOrNullMock.mockResolvedValue(null);

      await expect(
        runSpaceSend({
          space: VALID_SPACE_ID,
          text: "hello",
          view: "human",
        })
      ).rejects.toMatchObject({
        code: "space.profile.required",
      });
    });
  });

  it("allows human profiles to act in agent view for space commands", async () => {
    await withTempHome(async () => {
      resolveOpenMeldProfileOrNullMock.mockImplementation(
        async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
          openMeldProfileId ? { ...HUMAN_PROFILE, openMeldProfileId } : null
      );
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input, init) => {
          const url = String(input);
          if (url.includes("/signals") && init?.method !== "POST") {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  signals: [],
                  nextCursor: null,
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }
              )
            );
          }
          return Promise.resolve(
            createPostSignalResponse("hello from human operator")
          );
        });

      await withCapturedStdio(async () => {
        await runSpaceSend({
          profile: "human_operator",
          space: VALID_SPACE_ID,
          text: "hello",
          view: "agent",
        });

        await runSpaceHistory({
          profile: "human_operator",
          space: VALID_SPACE_ID,
          limit: 20,
          json: false,
          view: "agent",
        });
      });

      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  it("blocks system profile usage in agent view for space send", async () => {
    await withTempHome(async () => {
      resolveOpenMeldProfileOrNullMock.mockImplementation(
        async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
          openMeldProfileId ? { ...SYSTEM_PROFILE, openMeldProfileId } : null
      );
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        runSpaceSend({
          profile: "sys_dispatcher",
          space: VALID_SPACE_ID,
          text: "blocked",
          view: "agent",
        })
      ).rejects.toMatchObject({
        code: "space.profile.unsupported_kind",
      });

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("allows explicit --profile to bypass guardrail for space send", async () => {
    await withTempHome(async () => {
      resolveOpenMeldProfileOrNullMock.mockImplementation(
        async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
          openMeldProfileId ? { ...AGENT_PROFILE, openMeldProfileId } : null
      );
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => createPostSignalResponse());

      await runSpaceSend({
        profile: "agt_executor",
        baseUrl: "https://gateway.openmeld.invalid",
        space: VALID_SPACE_ID,
        text: "hello",
        view: "agent",
      });

      expect(fetchSpy).toHaveBeenCalled();
      expect(resolveOpenMeldProfileOrNullMock).toHaveBeenCalledWith({
        openMeldProfileId: "agt_executor",
        allowDefaultFallback: false,
        persistSelection: false,
      });
    });
  });

  it("allows selected profile (no explicit --profile) to bypass guardrail", async () => {
    await withTempHome(async () => {
      resolveOpenMeldProfileOrNullMock.mockImplementation(
        async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
          openMeldProfileId ? null : AGENT_PROFILE
      );
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () =>
          createPostSignalResponse("hello with selected profile")
        );

      await runSpaceSend({
        baseUrl: "https://gateway.openmeld.invalid",
        space: VALID_SPACE_ID,
        text: "hello with selected profile",
        view: "agent",
      });

      expect(fetchSpy).toHaveBeenCalled();
      const guardCall = resolveOpenMeldProfileOrNullMock.mock.calls.find(
        (call) => {
          const payload = call[0] as
            | {
                allowDefaultFallback?: boolean;
                openMeldProfileId?: string;
              }
            | undefined;
          return payload?.allowDefaultFallback === false;
        }
      );
      expect(guardCall?.[0]).toMatchObject({
        openMeldProfileId: undefined,
        allowDefaultFallback: false,
      });
    });
  });

  it("bootstraps default human profile in interactive human view", async () => {
    await withTempHome(async () => {
      const originalStdinIsTTY = process.stdin.isTTY;
      const originalStdoutIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        writable: true,
        enumerable: true,
        configurable: true,
      });

      resolveOpenMeldProfileOrNullMock.mockImplementation(
        (input?: {
          openMeldProfileId?: string;
          allowDefaultFallback?: boolean;
          profileKind?: string;
          persistSelection?: boolean;
        }) => {
          if (input?.allowDefaultFallback === false) {
            return Promise.resolve(null);
          }
          if (input?.profileKind === "human") {
            return Promise.resolve(HUMAN_PROFILE);
          }
          return Promise.resolve(null);
        }
      );

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () =>
          createPostSignalResponse("hello from human tty")
        );

      try {
        await runSpaceSend({
          baseUrl: "https://gateway.openmeld.invalid",
          space: VALID_SPACE_ID,
          text: "hello from human tty",
          view: "human",
        });
      } finally {
        Object.defineProperty(process.stdin, "isTTY", {
          value: originalStdinIsTTY,
          writable: true,
          enumerable: true,
          configurable: true,
        });
        Object.defineProperty(process.stdout, "isTTY", {
          value: originalStdoutIsTTY,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }

      expect(fetchSpy).toHaveBeenCalled();
      expect(resolveOpenMeldProfileOrNullMock).toHaveBeenCalledWith({
        openMeldProfileId: undefined,
        allowDefaultFallback: false,
        persistSelection: false,
      });
      expect(resolveOpenMeldProfileOrNullMock).toHaveBeenCalledWith({
        profileKind: "human",
        persistSelection: true,
        allowDefaultFallback: true,
      });
    });
  });
});
