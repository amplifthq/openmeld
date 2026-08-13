import { afterEach, describe, expect, it, vi } from "vitest";
import { setAuthSession } from "../src/config/auth-session";
import { runTail } from "../src/space/history";
import { runSpaceThread } from "../src/space/thread";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const AGENT_PROFILE_ID = "agt_aaaaaaaa-0000-0000-0000-000000000000";
const OWNER_USER_ID = "user-1";
const OWNER_NAME = "Felix";
const HUMAN_PROFILE_ID = "11111111-0000-0000-0000-000000000001";
const AGENT_SIGNAL_PROFILE_ID = "agt_11111111-0000-0000-0000-000000000001";
const FULL_UUID_ERROR = /full 36-character UUID/i;
const runReadonlyPiTuiSessionMock = vi.fn();

vi.mock("../src/space/shell/pi-tui/run-readonly-pi-tui-session", () => {
  return {
    runReadonlyPiTuiSession: (
      ...args: Parameters<typeof runReadonlyPiTuiSessionMock>
    ): ReturnType<typeof runReadonlyPiTuiSessionMock> =>
      runReadonlyPiTuiSessionMock(...args),
  };
});

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const profile = {
    openMeldProfileId: "agt_aaaaaaaa-0000-0000-0000-000000000000",
    profileName: "Mira",
    profileKind: "agent",
    status: "active",
    ownerUserId: "user-1",
    ownerName: "Felix",
    source: "cli_create",
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  } as const;
  return {
    requireOpenMeldProfile: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) => ({
        ...profile,
        openMeldProfileId: String(
          openMeldProfileId ?? profile.openMeldProfileId
        ),
      })
    ),
    resolveOpenMeldProfileOrNull: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) => ({
        ...profile,
        openMeldProfileId: String(
          openMeldProfileId ?? profile.openMeldProfileId
        ),
      })
    ),
  };
});

function createSignalsResponse(signals: readonly unknown[]): Response {
  return new Response(
    JSON.stringify({
      signals,
      nextCursor: null,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

function createSpaceMetaResponse(): Response {
  return new Response(
    JSON.stringify({
      spaceId: "demo",
      organizationId: "org-1",
      visibility: "private",
      accessMode: "members_only",
      name: "Demo",
      creator: {
        profileId: HUMAN_PROFILE_ID,
        profileName: OWNER_NAME,
        kind: "human",
        ownerUserId: OWNER_USER_ID,
        ownerName: OWNER_NAME,
      },
      passwordProtected: false,
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

function createMembersResponse(): Response {
  return new Response(
    JSON.stringify({
      spaceId: "demo",
      generatedAt: "2026-03-10T00:00:00.000Z",
      summary: {
        totalCount: 1,
        humanCount: 1,
        agentCount: 0,
        liveNowCount: 0,
      },
      humans: [
        {
          profileId: HUMAN_PROFILE_ID,
          profileName: OWNER_NAME,
          profileKind: "human",
          mentionAlias: null,
          status: "active",
          memberSource: "space_creator",
          memberSourceLabel: "Creator",
          addedAt: "2026-03-10T00:00:00.000Z",
          removedAt: null,
          createdAt: "2026-03-10T00:00:00.000Z",
          updatedAt: "2026-03-10T00:00:00.000Z",
          addedByProfileId: null,
          addedByOwnerUserId: null,
          addedByDisplayName: null,
          removedByProfileId: null,
          removedByOwnerUserId: null,
          removalReason: null,
          firstEnteredAt: "2026-03-10T00:00:00.000Z",
          lastEnteredAt: "2026-03-10T00:00:00.000Z",
          lastSeenAt: "2026-03-10T00:00:00.000Z",
          lastSeenLabel: "Seen now",
          liveNow: false,
          ownerUserId: OWNER_USER_ID,
          ownerName: OWNER_NAME,
        },
      ],
      agents: [],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

function createIdentityDirectoryResponse(): Response {
  return new Response(
    JSON.stringify({
      spaceId: "demo",
      generatedAt: "2026-03-10T00:00:00.000Z",
      entries: [
        {
          profileId: HUMAN_PROFILE_ID,
          profileName: OWNER_NAME,
          profileKind: "human",
          mentionAlias: null,
          ownerUserId: OWNER_USER_ID,
          ownerName: OWNER_NAME,
          agentControllerRef: null,
        },
        {
          profileId: AGENT_SIGNAL_PROFILE_ID,
          profileName: "Mira",
          profileKind: "agent",
          mentionAlias: null,
          ownerUserId: OWNER_USER_ID,
          ownerName: OWNER_NAME,
          agentControllerRef: "builtin:codex",
        },
      ],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

function createThreadsResponse(input: {
  threads: readonly unknown[];
  previews: readonly unknown[];
}): Response {
  return new Response(
    JSON.stringify({ threads: input.threads, previews: input.previews }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

function createThreadSignalsResponse(input: {
  signals: readonly unknown[];
  placements: readonly unknown[];
}): Response {
  return new Response(
    JSON.stringify({ signals: input.signals, placements: input.placements }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

function mockHistoryFetch(input: {
  signals: readonly unknown[];
  threads?: readonly unknown[];
  threadPreviews?: readonly unknown[];
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((requestUrl) => {
    const url = String(requestUrl);
    if (url.includes("/threads")) {
      return Promise.resolve(
        createThreadsResponse({
          threads: input.threads ?? [],
          previews: input.threadPreviews ?? [],
        })
      );
    }
    if (url.includes("/signals")) {
      return Promise.resolve(createSignalsResponse(input.signals));
    }
    if (url.includes("/meta")) {
      return Promise.resolve(createSpaceMetaResponse());
    }
    if (url.includes("/identity-directory")) {
      return Promise.resolve(createIdentityDirectoryResponse());
    }
    if (url.includes("/members")) {
      return Promise.resolve(createMembersResponse());
    }
    throw new Error(`unexpected request: ${url}`);
  });
}

describe("tail view mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a short signal id locally before any network request", async () => {
    await withTempHome(async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
        throw new Error("fetch should not be called for a short signal id");
      });
      await expect(
        runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 20,
          json: false,
          afterSignalId: "80d6ac34",
          view: "agent",
        })
      ).rejects.toThrow(FULL_UUID_ERROR);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("emits full envelopes in agent view even without --json", async () => {
    await withTempHome(async () => {
      mockHistoryFetch({
        signals: [
          {
            v: 1,
            id: "signal-1",
            spaceId: "demo",
            ts: 1,
            type: "signal.text",
            profile: {
              kind: "agent",
              profileId: AGENT_SIGNAL_PROFILE_ID,
              profileName: "Mira",
              owner: OWNER_USER_ID,
              ownerName: OWNER_NAME,
              agentControllerRef: "builtin:codex",
            },
            data: {
              text: "hello",
            },
          },
        ],
      });

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 20,
          json: false,
          view: "agent",
        });
      });

      expect(stderr).toBe("");
      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));

      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        type: "system.session.meta",
        gatewayUrl: "https://gateway.openmeld.invalid",
        mode: "history viewer",
        profileId: AGENT_PROFILE_ID,
        profileName: "Mira",
        profileKind: "agent",
        ownerUserId: OWNER_USER_ID,
        ownerName: OWNER_NAME,
        access: "members only",
        accessMode: "members_only",
        security: "members only",
        spaceId: "demo",
        spaceName: "Demo",
        visibility: "private",
      });
      expect(lines[1]).toMatchObject({
        type: "signal.text",
        id: "signal-1",
        profile: {
          profileId: AGENT_SIGNAL_PROFILE_ID,
          profileName: "Mira",
          kind: "agent",
          ownerUserId: OWNER_USER_ID,
          ownerName: OWNER_NAME,
          agentControllerRef: "builtin:codex",
        },
        data: {
          text: "hello",
        },
      });
      expect(stdout).not.toContain("system.space.members");
      expect(stdout).not.toContain("wakeableAgentCount");
      expect(stdout).not.toContain("ownerWakeDiagnostics");
    });
  });

  it("keeps the same canonical agent contract in raw-stream history mode", async () => {
    await withTempHome(async () => {
      mockHistoryFetch({
        signals: [
          {
            v: 1,
            id: "signal-1",
            spaceId: "demo",
            ts: 1,
            type: "signal.text",
            profile: {
              kind: "agent",
              profileId: AGENT_SIGNAL_PROFILE_ID,
              profileName: "Mira",
              owner: OWNER_USER_ID,
              ownerName: OWNER_NAME,
              agentControllerRef: "builtin:codex",
            },
            data: {
              text: "hello",
            },
          },
        ],
      });

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 20,
          json: true,
          rawStream: true,
          view: "agent",
        });
      });

      expect(stderr).toBe("");
      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));

      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        type: "system.session.meta",
      });
      expect(lines[1]).toMatchObject({
        type: "signal.text",
        profile: {
          agentControllerRef: "builtin:codex",
          ownerName: OWNER_NAME,
          ownerUserId: OWNER_USER_ID,
          profileId: AGENT_SIGNAL_PROFILE_ID,
        },
        messageReadProjection: {
          text: "hello",
          wakeTargets: [],
          referenceTargets: [],
          replyToSignalId: null,
          replyToContext: null,
        },
      });
      expect(stdout).not.toContain("system.space.members");
    });
  });

  it("prints compact message-only history when --brief is requested", async () => {
    await withTempHome(async () => {
      mockHistoryFetch({
        signals: [
          {
            v: 1,
            id: "signal-brief-1",
            spaceId: "demo",
            ts: 1,
            type: "signal.text",
            profile: {
              kind: "agent",
              profileId: AGENT_SIGNAL_PROFILE_ID,
              profileName: "Mira",
              owner: OWNER_USER_ID,
              ownerName: OWNER_NAME,
              agentControllerRef: "builtin:codex",
            },
            data: {
              text: "brief hello",
              messageEnvelope: {
                text: "brief hello",
                activationTargets: [],
                referenceTargets: [HUMAN_PROFILE_ID],
              },
            },
          },
        ],
      });

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 20,
          brief: true,
          json: false,
          view: "agent",
        });
      });

      expect(stderr).toBe("");
      const payload = JSON.parse(stdout.trim()) as {
        messages?: Array<{
          signalId?: string;
          text?: string | null;
          referenceTargets?: Array<{ profileId?: string }>;
        }>;
        proof?: { conversationReadable?: boolean };
        type?: string;
      };

      expect(payload.type).toBe("space.history.brief");
      expect(payload.proof?.conversationReadable).toBe(true);
      expect(payload.messages).toEqual([
        expect.objectContaining({
          signalId: "signal-brief-1",
          text: "brief hello",
          referenceTargets: [
            expect.objectContaining({
              profileId: HUMAN_PROFILE_ID,
            }),
          ],
        }),
      ]);
      expect(stdout).not.toContain("system.space.members");
      expect(stdout).not.toContain("system.session.meta");
      expect(stdout).not.toContain("diagnostics");
    });
  });

  it("decorates agent brief history messages with thread metadata", async () => {
    await withTempHome(async () => {
      mockHistoryFetch({
        signals: [
          {
            v: 1,
            id: "signal-root-1",
            spaceId: "demo",
            ts: 1,
            type: "signal.text",
            profile: {
              kind: "agent",
              profileId: AGENT_SIGNAL_PROFILE_ID,
              profileName: "Mira",
              owner: OWNER_USER_ID,
              ownerName: OWNER_NAME,
              agentControllerRef: "builtin:codex",
            },
            data: {
              text: "root message",
              messageEnvelope: {
                text: "root message",
                activationTargets: [],
                referenceTargets: [],
              },
            },
          },
        ],
        threads: [
          {
            threadId: "thr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            spaceId: "demo",
            rootSignalId: "signal-root-1",
            createdByProfileId: HUMAN_PROFILE_ID,
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
          },
        ],
        threadPreviews: [
          {
            threadId: "thr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            replyCount: 2,
            placements: [],
            signals: [
              {
                v: 1,
                id: "signal-reply-1",
                spaceId: "demo",
                ts: 2,
                type: "signal.text",
                profile: {
                  kind: "agent",
                  profileId: AGENT_SIGNAL_PROFILE_ID,
                  profileName: "Mira",
                  owner: OWNER_USER_ID,
                  ownerName: OWNER_NAME,
                  agentControllerRef: "builtin:codex",
                },
                data: {
                  text: "reply inside thread",
                  messageEnvelope: {
                    text: "reply inside thread",
                    activationTargets: [],
                    referenceTargets: [],
                  },
                },
              },
            ],
          },
        ],
      });

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 20,
          brief: true,
          json: false,
          view: "agent",
        });
      });

      expect(stderr).toBe("");
      const payload = JSON.parse(stdout.trim()) as {
        messages?: Array<{
          signalId?: string;
          thread?: {
            threadId?: string;
            replyCount?: number;
            replyPreviews?: Array<{ text?: string | null }>;
          } | null;
        }>;
        nextCommands?: string[];
      };
      const rootMessage = payload.messages?.find(
        (message) => message.signalId === "signal-root-1"
      );
      expect(rootMessage?.thread).toMatchObject({
        threadId: "thr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        replyCount: 2,
      });
      expect(rootMessage?.thread?.replyPreviews?.[0]?.text).toBe(
        "reply inside thread"
      );
      const threadCommand = payload.nextCommands?.[0] ?? "";
      expect(threadCommand).toContain("space thread");
      expect(threadCommand).toContain(
        "thr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
      );
      expect(threadCommand).toContain("--profile");
      expect(threadCommand).toContain("--view agent");
    });
  });

  it("renders a thread's nested replies in agent view", async () => {
    await withTempHome(async () => {
      const threadId = "thr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
      vi.spyOn(globalThis, "fetch").mockImplementation((requestUrl) => {
        const url = String(requestUrl);
        if (url.includes("/threads/") && url.includes("/signals")) {
          return Promise.resolve(
            createThreadSignalsResponse({
              signals: [
                {
                  v: 1,
                  id: "thread-reply-1",
                  spaceId: "demo",
                  ts: 2,
                  type: "signal.text",
                  profile: {
                    kind: "agent",
                    profileId: AGENT_SIGNAL_PROFILE_ID,
                    profileName: "Mira",
                    owner: OWNER_USER_ID,
                    ownerName: OWNER_NAME,
                    agentControllerRef: "builtin:codex",
                  },
                  data: {
                    text: "nested reply one",
                    messageEnvelope: {
                      text: "nested reply one",
                      activationTargets: [],
                      referenceTargets: [],
                    },
                  },
                },
              ],
              placements: [
                {
                  threadId,
                  signalId: "thread-reply-1",
                  placement: "thread",
                  createdAt: "2026-03-10T00:00:00.000Z",
                },
              ],
            })
          );
        }
        if (url.includes("/identity-directory")) {
          return Promise.resolve(createIdentityDirectoryResponse());
        }
        throw new Error(`unexpected request: ${url}`);
      });

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runSpaceThread({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          threadId,
          view: "agent",
        });
      });

      expect(stderr).toBe("");
      const payload = JSON.parse(stdout.trim()) as {
        type?: string;
        threadId?: string;
        signalCount?: number;
        signals?: Array<{ messageReadProjection?: { text?: string | null } }>;
      };
      expect(payload.type).toBe("space.thread");
      expect(payload.threadId).toBe(threadId);
      expect(payload.signalCount).toBe(1);
      expect(payload.signals?.[0]?.messageReadProjection?.text).toBe(
        "nested reply one"
      );
    });
  });

  it("adds messageReadProjection to human json history output", async () => {
    await withTempHome(async () => {
      mockHistoryFetch({
        signals: [
          {
            v: 1,
            id: "signal-human-json-1",
            spaceId: "demo",
            ts: 1,
            type: "signal.text",
            profile: {
              kind: "human",
              profileId: HUMAN_PROFILE_ID,
              profileName: "Felix",
            },
            data: {
              text: "@Mira(reference) hello",
              messageEnvelope: {
                text: "@Mira(reference) hello",
                activationTargets: [],
                referenceTargets: [AGENT_SIGNAL_PROFILE_ID],
              },
            },
          },
        ],
      });

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 20,
          json: true,
          view: "human",
        });
      });

      expect(stderr).toBe("");
      const payload = JSON.parse(stdout.trim()) as {
        type: string;
        messageReadProjection?: {
          referenceTargets?: Array<{ profileId?: string }>;
        };
      };

      expect(payload.type).toBe("signal.text");
      expect(payload.messageReadProjection?.referenceTargets).toEqual([
        expect.objectContaining({ profileId: AGENT_SIGNAL_PROFILE_ID }),
      ]);
    });
  });

  it("emits only session meta in agent view when no signals exist", async () => {
    await withTempHome(async () => {
      mockHistoryFetch({
        signals: [],
      });

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 20,
          json: false,
          view: "agent",
        });
      });

      expect(stderr).toBe("");
      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));

      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        type: "system.session.meta",
        profileId: AGENT_PROFILE_ID,
        spaceId: "demo",
      });
      expect(stdout).not.toContain("system.space.members");
    });
  });

  it("respects limit=0 and does not emit members in agent view", async () => {
    await withTempHome(async () => {
      const fetchMock = mockHistoryFetch({
        signals: [
          {
            v: 1,
            id: "signal-1",
            spaceId: "demo",
            ts: 1,
            type: "signal.text",
            profile: {
              kind: "agent",
              profileId: AGENT_SIGNAL_PROFILE_ID,
              profileName: "Mira",
            },
            data: {
              text: "hello",
            },
          },
        ],
      });

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 0,
          json: false,
          view: "agent",
        });
      });

      expect(stderr).toBe("");
      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/signals?recent=1&limit=200"),
        expect.anything()
      );
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        type: "system.session.meta",
        profileId: AGENT_PROFILE_ID,
      });
      expect(lines[1]).toMatchObject({
        id: "signal-1",
        type: "signal.text",
      });
      expect(stdout).not.toContain("system.space.members");
    });
  });

  it("adds Authorization header when logged in", async () => {
    await withTempHome(async () => {
      const previousForceInsecureToken =
        process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      try {
        await setAuthSession({
          accessToken: "tail-token",
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
        });

        const fetchSpy = mockHistoryFetch({
          signals: [],
        });

        await withCapturedStdio(async () => {
          await runTail({
            profile: AGENT_PROFILE_ID,
            baseUrl: "https://gateway.openmeld.invalid",
            space: "demo",
            limit: 20,
            json: false,
            view: "agent",
          });
        });

        for (const [, requestInit] of fetchSpy.mock.calls) {
          const headers = (requestInit?.headers ?? {}) as Record<
            string,
            string
          >;
          expect(headers.Authorization).toBe("Bearer tail-token");
        }
      } finally {
        if (previousForceInsecureToken === undefined) {
          Reflect.deleteProperty(
            process.env,
            "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
          );
        } else {
          process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN =
            previousForceInsecureToken;
        }
      }
    });
  });

  it("decorates human history messages with a thread indicator sub-line", async () => {
    await withTempHome(async () => {
      mockHistoryFetch({
        signals: [
          {
            v: 1,
            id: "signal-root-1",
            spaceId: "demo",
            ts: 1,
            type: "signal.text",
            profile: {
              kind: "human",
              profileId: HUMAN_PROFILE_ID,
              profileName: OWNER_NAME,
              owner: OWNER_USER_ID,
              ownerName: OWNER_NAME,
            },
            data: {
              text: "root message",
              messageEnvelope: {
                text: "root message",
                activationTargets: [],
                referenceTargets: [],
              },
            },
          },
        ],
        threads: [
          {
            threadId: "thr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            spaceId: "demo",
            rootSignalId: "signal-root-1",
            createdByProfileId: HUMAN_PROFILE_ID,
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
          },
        ],
        threadPreviews: [
          {
            threadId: "thr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            replyCount: 2,
            placements: [],
            signals: [],
          },
        ],
      });

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 20,
          json: false,
          view: "human",
        });
      });

      expect(stderr).toBe("");
      expect(stdout).toContain("2 replies");
      expect(stdout).toContain("openmeld space thread");
      expect(stdout).toContain("thr_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    });
  });

  it("shows chat first and summarizes suppressed system notices in human view", async () => {
    await withTempHome(async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/signals")) {
          return Promise.resolve(
            createSignalsResponse([
              {
                v: 1,
                id: "notice-1",
                spaceId: "demo",
                ts: 1,
                type: "signal.text",
                profile: {
                  kind: "system",
                  profileId: "openmeld-system",
                  profileName: "OpenMeld System",
                },
                data: {
                  text: "Felix added Joiner to this space.",
                  meta: {
                    purpose: "space_membership_join_notice",
                  },
                },
              },
              {
                v: 1,
                id: "chat-1",
                spaceId: "demo",
                ts: 2,
                type: "signal.text",
                profile: {
                  kind: "human",
                  profileId: HUMAN_PROFILE_ID,
                  profileName: "Felix",
                },
                data: {
                  text: "hello from history",
                },
              },
            ])
          );
        }

        if (url.includes("/identity-directory")) {
          return Promise.resolve(createIdentityDirectoryResponse());
        }

        if (url.includes("/meta")) {
          return Promise.resolve(createSpaceMetaResponse());
        }

        throw new Error(`unexpected request: ${url}`);
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 20,
          json: false,
          view: "human",
        });
      });

      expect(stdout).toContain("hello from history");
      expect(stdout).not.toContain("added Joiner to this space");
      expect(stdout).toContain("History is showing chat first.");
      expect(stdout).toContain("1 system notice");
      expect(stdout).not.toContain("presence update");
      expect(stdout).not.toContain("raw event stream");
    });
  });

  it("keeps important OpenMeld system signal.status visible in human history output", async () => {
    await withTempHome(async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/signals")) {
          return Promise.resolve(
            createSignalsResponse([
              {
                v: 1,
                id: "system-status-history-1",
                spaceId: "demo",
                ts: 1,
                type: "signal.status",
                profile: {
                  kind: "system",
                  profileId: "openmeld-system",
                  profileName: "OpenMeld System",
                },
                data: {
                  actorProfileId: AGENT_SIGNAL_PROFILE_ID,
                  status: "blocked",
                  dispatchId: "dispatch-1",
                  text: "Permission denied while finalizing the reply.",
                  generatedBy: "openmeld",
                },
              },
            ])
          );
        }

        if (url.includes("/identity-directory")) {
          return Promise.resolve(createIdentityDirectoryResponse());
        }

        if (url.includes("/meta")) {
          return Promise.resolve(createSpaceMetaResponse());
        }

        throw new Error(`unexpected request: ${url}`);
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 20,
          json: false,
          view: "human",
        });
      });

      expect(stdout).toContain("Permission denied while finalizing the reply.");
      expect(stdout).not.toContain("signal.status (openmeld-system)");
    });
  });

  it("uses the shared readonly pi-tui runner for tty human history", async () => {
    await withTempHome(async () => {
      const originalStdinIsTTY = process.stdin.isTTY;
      const originalStdoutIsTTY = process.stdout.isTTY;
      runReadonlyPiTuiSessionMock.mockResolvedValue(undefined);
      try {
        Object.defineProperty(process.stdin, "isTTY", {
          configurable: true,
          value: true,
        });
        Object.defineProperty(process.stdout, "isTTY", {
          configurable: true,
          value: true,
        });

        mockHistoryFetch({
          signals: [
            {
              v: 1,
              id: "chat-tty-history-1",
              spaceId: "demo",
              ts: 2,
              type: "signal.text",
              profile: {
                kind: "human",
                profileId: HUMAN_PROFILE_ID,
                profileName: "Felix",
              },
              data: {
                text: "hello from tty history",
              },
            },
          ],
        });

        await withCapturedStdio(async () => {
          await runTail({
            profile: AGENT_PROFILE_ID,
            baseUrl: "https://gateway.openmeld.invalid",
            space: "demo",
            limit: 20,
            json: false,
            view: "human",
          });
        });

        expect(runReadonlyPiTuiSessionMock).toHaveBeenCalledOnce();
      } finally {
        runReadonlyPiTuiSessionMock.mockReset();
        Object.defineProperty(process.stdin, "isTTY", {
          configurable: true,
          value: originalStdinIsTTY,
        });
        Object.defineProperty(process.stdout, "isTTY", {
          configurable: true,
          value: originalStdoutIsTTY,
        });
      }
    });
  });

  it("threads after-signal and filter queries through history reads", async () => {
    await withTempHome(async () => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((requestUrl) => {
          const url = new URL(String(requestUrl));
          if (url.pathname.endsWith("/signals")) {
            expect(url.searchParams.get("afterSignalId")).toBe(
              "11111111-1111-4111-8111-111111111111"
            );
            expect(url.searchParams.get("limit")).toBe("10");
            expect(url.searchParams.getAll("fromProfileId")).toEqual([
              HUMAN_PROFILE_ID,
            ]);
            expect(url.searchParams.getAll("signalType")).toEqual([
              "signal.text",
            ]);
            return Promise.resolve(
              createSignalsResponse([
                {
                  v: 1,
                  id: "signal-after-1",
                  spaceId: "demo",
                  ts: 2,
                  type: "signal.text",
                  profile: {
                    kind: "human",
                    profileId: HUMAN_PROFILE_ID,
                    profileName: OWNER_NAME,
                  },
                  data: {
                    text: "hello after anchor",
                  },
                },
              ])
            );
          }
          if (url.pathname.endsWith("/meta")) {
            return Promise.resolve(createSpaceMetaResponse());
          }
          if (url.pathname.endsWith("/identity-directory")) {
            return Promise.resolve(createIdentityDirectoryResponse());
          }
          throw new Error(`unexpected request: ${url}`);
        });

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 10,
          json: true,
          view: "agent",
          afterSignalId: "11111111-1111-4111-8111-111111111111",
          fromProfileIds: [HUMAN_PROFILE_ID],
          kinds: ["text"],
        });
      });

      expect(stderr).toBe("");
      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      expect(lines.at(-1)).toMatchObject({
        type: "signal.text",
        messageReadProjection: {
          text: "hello after anchor",
        },
      });
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  it("requests explicit recent history limits from the server", async () => {
    await withTempHome(async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((requestUrl) => {
        const url = new URL(String(requestUrl));
        if (url.pathname.endsWith("/signals")) {
          expect(url.searchParams.get("recent")).toBe("1");
          expect(url.searchParams.get("limit")).toBe("300");
          return Promise.resolve(createSignalsResponse([]));
        }
        if (url.pathname.endsWith("/meta")) {
          return Promise.resolve(createSpaceMetaResponse());
        }
        if (url.pathname.endsWith("/identity-directory")) {
          return Promise.resolve(createIdentityDirectoryResponse());
        }
        throw new Error(`unexpected request: ${url}`);
      });

      await withCapturedStdio(async () => {
        await runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 300,
          json: true,
          view: "agent",
        });
      });
    });
  });

  it("threads around-signal windows through history reads without local slicing", async () => {
    await withTempHome(async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((requestUrl) => {
        const url = new URL(String(requestUrl));
        if (url.pathname.endsWith("/signals")) {
          expect(url.searchParams.get("aroundSignalId")).toBe(
            "22222222-2222-4222-8222-222222222222"
          );
          expect(url.searchParams.get("beforeCount")).toBe("2");
          expect(url.searchParams.get("afterCount")).toBe("1");
          expect(url.searchParams.has("limit")).toBe(false);
          return Promise.resolve(
            createSignalsResponse([
              {
                v: 1,
                id: "signal-around-1",
                spaceId: "demo",
                ts: 1,
                type: "signal.text",
                profile: {
                  kind: "human",
                  profileId: HUMAN_PROFILE_ID,
                  profileName: OWNER_NAME,
                },
                data: {
                  text: "before anchor",
                },
              },
              {
                v: 1,
                id: "signal-around-2",
                spaceId: "demo",
                ts: 2,
                type: "signal.text",
                profile: {
                  kind: "human",
                  profileId: HUMAN_PROFILE_ID,
                  profileName: OWNER_NAME,
                },
                data: {
                  text: "anchor message",
                },
              },
            ])
          );
        }
        if (url.pathname.endsWith("/meta")) {
          return Promise.resolve(createSpaceMetaResponse());
        }
        if (url.pathname.endsWith("/identity-directory")) {
          return Promise.resolve(createIdentityDirectoryResponse());
        }
        throw new Error(`unexpected request: ${url}`);
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 1,
          json: true,
          view: "human",
          aroundSignalId: "22222222-2222-4222-8222-222222222222",
          beforeCount: 2,
          afterCount: 1,
        });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        type: "signal.text",
        data: {
          text: "before anchor",
        },
      });
      expect(lines[1]).toMatchObject({
        type: "signal.text",
        data: {
          text: "anchor message",
        },
      });
    });
  });

  it("rejects conflicting history anchor modes before making a request", async () => {
    await withTempHome(async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: 10,
          json: true,
          view: "agent",
          afterSignalId: "11111111-1111-4111-8111-111111111111",
          aroundSignalId: "22222222-2222-4222-8222-222222222222",
        })
      ).rejects.toThrow("Cannot use both afterSignalId and aroundSignalId.");

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("rejects negative limit", async () => {
    await withTempHome(async () => {
      await expect(
        runTail({
          profile: AGENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: "demo",
          limit: -1,
          json: false,
          view: "agent",
        })
      ).rejects.toThrow("limit must be a non-negative integer");
    });
  });
});
