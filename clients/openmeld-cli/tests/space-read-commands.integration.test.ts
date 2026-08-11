import { SPACE_UPDATES_MAX_LIMIT } from "@openmeld/schemas";
import { createSpaceMembersSnapshot } from "@openmeld/schemas/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import { runSpaceBoard } from "../src/space/board-command";
import { runSpaceHistory } from "../src/space/command";
import { runSpaceContract } from "../src/space/contract-command";
import { runSpaceResult } from "../src/space/result-command";
import { runSpaceUpdates } from "../src/space/updates-command";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const passwordPromptMock = vi.hoisted(() => vi.fn());
const resolveOpenMeldProfileByIdOrNameMock = vi.hoisted(() => vi.fn());

const PROFILE = {
  openMeldProfileId: "mira--phase5a-read",
  profileName: "Mira",
  profileKind: "human",
  status: "active",
  ownerUserId: "user-1",
  source: "cli_create",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-03-21T00:00:00.000Z",
  updatedAt: "2026-03-21T00:00:00.000Z",
} as const;

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "http://localhost",
    clientId: "openmeld-cli",
    createdAt: "2026-03-21T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

const VALID_SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_GENERATED_AT = "2026-03-21T00:00:00.000Z";

type TestIdentityDirectoryEntry = {
  agentControllerRef?: string | null;
  mentionAlias?: string | null;
  ownerName?: string | null;
  ownerUserId?: string | null;
  profileId: string;
  profileKind: "agent" | "human";
  profileName: string;
};

function createIdentityDirectory(entries: TestIdentityDirectoryEntry[]) {
  return {
    spaceId: VALID_SPACE_ID,
    generatedAt: TEST_GENERATED_AT,
    entries: entries.map((entry) => ({
      profileId: entry.profileId,
      profileName: entry.profileName,
      profileKind: entry.profileKind,
      mentionAlias: entry.mentionAlias ?? null,
      ownerUserId: entry.ownerUserId ?? null,
      ownerName: entry.ownerName ?? null,
      agentControllerRef: entry.agentControllerRef ?? null,
    })),
  };
}

function createIdentityDirectoryResponse(
  entries: TestIdentityDirectoryEntry[]
) {
  return new Response(JSON.stringify(createIdentityDirectory(entries)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  multiselect: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
  password: (input: unknown) => passwordPromptMock(input),
  select: vi.fn(() => "no"),
  spinner: vi.fn(),
  text: vi.fn(),
}));

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: vi.fn(
    async ({ openMeldProfileId }: { openMeldProfileId?: string }) => ({
      ...PROFILE,
      openMeldProfileId: String(openMeldProfileId ?? PROFILE.openMeldProfileId),
    })
  ),
}));

vi.mock("../src/config/openmeld-profiles-api", () => ({
  resolveOpenMeldProfileByIdOrName: (...args: unknown[]) =>
    resolveOpenMeldProfileByIdOrNameMock(...args),
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

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => true),
}));

describe("space read commands", () => {
  beforeEach(() => {
    resolveOpenMeldProfileByIdOrNameMock.mockImplementation(
      async (input: { profileIdentifier?: string }) => ({
        ...PROFILE,
        openMeldProfileId: String(
          input.profileIdentifier ?? PROFILE.openMeldProfileId
        ),
      })
    );
  });

  afterEach(() => {
    getAuthSessionStateMock.mockReset();
    passwordPromptMock.mockReset();
    resolveOpenMeldProfileByIdOrNameMock.mockReset();
    vi.restoreAllMocks();
  });

  it("renders human-readable contract output", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            version: 2,
            updatedAt: "2026-03-21T00:00:00.000Z",
            updatedBy: "system",
            dispatchPolicy: { mode: "mention_only" },
            publicationMode: "collaboration",
            allowedActions: ["post_message", "post_status", "stay_silent"],
            resultArchivePolicy: { mode: "all_final_results" },
            authorityOrder: "default",
            entryBrief: "default",
            dispatchBrief: "default",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceContract({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Space contract:");
      expect(plainStdout).toContain("Dispatch");
      expect(plainStdout).toContain("Publication");
      expect(plainStdout).toContain("Allowed actions");
      expect(plainStdout).toContain("Result archive");
      expect(plainStdout).toContain(
        "Actions: post_message | post_status | stay_silent"
      );
    });
  });

  it("renders the Space Board as compact Markdown and canonical JSON", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      const board = {
        space: {
          id: VALID_SPACE_ID,
          name: "Launch Room",
          purpose: "Coordinate the launch.",
          guide: "Surface blockers immediately.",
        },
        members: {
          totalCount: 3,
          humanCount: 1,
          agentCount: 2,
          centerAgentPresent: true,
        },
        workingNow: [
          {
            profileId: "agt_11111111-1111-4111-8111-111111111111",
            profileName: "Builder",
            startedAt: "2026-07-15T01:00:00.000Z",
          },
        ],
        recentOutcomes: [
          {
            at: "2026-07-15T00:45:00.000Z",
            profileId: "agt_22222222-2222-4222-8222-222222222222",
            profileName: "Reviewer",
            outcome: "replied",
          },
        ],
      } as const;
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(board), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
      );

      const markdownOutput = await withCapturedStdio(async () => {
        await runSpaceBoard({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "human",
        });
      });
      const jsonOutput = await withCapturedStdio(async () => {
        await runSpaceBoard({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: true,
          view: "agent",
        });
      });

      expect(markdownOutput.plainStdout).toContain("# Space: Launch Room");
      expect(markdownOutput.plainStdout).toContain(
        "1 person, 2 agents, Center Agent present"
      );
      expect(markdownOutput.plainStdout).toContain(
        "- Builder (started 2026-07-15T01:00:00.000Z)"
      );
      expect(JSON.parse(jsonOutput.plainStdout)).toEqual(board);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      for (const [requestUrl] of fetchSpy.mock.calls) {
        expect(new URL(String(requestUrl)).pathname).toBe(
          `/v1/spaces/${VALID_SPACE_ID}/board`
        );
      }
    });
  });

  it("emits ndjson updates in json mode", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/updates`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "sig-status-1",
                    spaceId: VALID_SPACE_ID,
                    ts: 1,
                    profile: {
                      kind: "agent",
                      profileId: "agt_33333333-3333-4333-8333-333333333333",
                      profileName: "hi-agent",
                    },
                    type: "signal.status",
                    data: {
                      actorProfileId:
                        "agt_33333333-3333-4333-8333-333333333333",
                      dispatchId: "dispatch-1",
                      generatedBy: "openmeld",
                      status: "done",
                      text: "STATUS-TEXT",
                    },
                  },
                  {
                    v: 1,
                    id: "sig-notice-1",
                    spaceId: VALID_SPACE_ID,
                    ts: 2,
                    profile: {
                      kind: "system",
                      profileId: "system",
                      profileName: "system",
                    },
                    type: "signal.system_notice",
                    data: {
                      noticeType: "stay_silent",
                      actorProfileId:
                        "agt_33333333-3333-4333-8333-333333333333",
                      actorName: "hi-agent",
                      dispatchId: "dispatch-1",
                      generatedBy: "openmeld",
                      reason: "Handled privately.",
                      text: "hi-agent chose to stay silent: Handled privately.",
                    },
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/identity-directory`)
        ) {
          return Promise.resolve(
            createIdentityDirectoryResponse([
              {
                profileId: "agt_33333333-3333-4333-8333-333333333333",
                profileName: "hi-agent",
                profileKind: "agent",
                agentControllerRef: "builtin:codex",
              },
            ])
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/identity-directory`)
        ) {
          return Promise.resolve(
            createIdentityDirectoryResponse([
              {
                profileId: "44444444-4444-4444-4444-444444444444",
                profileName: "Referenced Human",
                profileKind: "human",
                ownerUserId: "44444444-4444-4444-4444-444444444444",
                ownerName: "Referenced Human",
              },
              {
                profileId: "agt_33333333-3333-4333-8333-333333333333",
                profileName: "hi-agent",
                profileKind: "agent",
                agentControllerRef: "builtin:codex",
              },
            ])
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                generatedAt: "2026-03-21T00:00:00.000Z",
                summary: {
                  totalCount: 1,
                  humanCount: 0,
                  agentCount: 1,
                  liveNowCount: 0,
                },
                humans: [],
                agents: [
                  {
                    profileId: "agt_33333333-3333-4333-8333-333333333333",
                    profileName: "hi-agent",
                    profileKind: "agent",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "added_by_member",
                    memberSourceLabel: "Added by a member",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: HUMAN_PROFILE_ID,
                    addedByOwnerUserId: null,
                    addedByDisplayName: PROFILE.profileName,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: null,
                    ownerName: null,
                    agentControllerRef: "builtin:codex",
                    agentControllerConversationId: null,
                    workingDirectory: null,
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/dispatches/lookup`)
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                query: {
                  spaceId: VALID_SPACE_ID,
                  sourceSignalId: "11111111-1111-4111-8111-111111111111",
                  clientMessageId: null,
                  targetProfileId: null,
                },
                matches: [
                  {
                    dispatchId: "dispatch-json-1",
                    sourceSignalId: "11111111-1111-4111-8111-111111111111",
                    targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
                    status: "dispatching",
                    attemptCount: 1,
                    latestAttemptId: "attempt-json-1",
                    latestAttemptStatus: "waiting_result",
                    latestAttemptErrorCode: null,
                    latestAttemptErrorMessage: null,
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
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
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
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
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
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
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceUpdates({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          afterSignalId: "11111111-1111-4111-8111-111111111111",
          limit: 20,
          json: true,
          view: "human",
        });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map(
          (line) =>
            JSON.parse(line) as {
              id?: string;
              kind?: string;
              type?: string;
              messageReadProjection?: { text?: string };
            }
        );
      expect(lines).toHaveLength(4);
      expect(lines[0]).toMatchObject({
        kind: "space.dispatch_execution",
      });
      expect(lines[1]).toMatchObject({
        kind: "space.round_read_projection",
      });
      expect(lines.slice(2).map((line) => line.type)).toEqual([
        "signal.status",
        "signal.system_notice",
      ]);
      expect(lines[2]?.messageReadProjection?.text).toBe("STATUS-TEXT");
      expect(lines[3]?.messageReadProjection?.text).toBe(
        "hi-agent chose to stay silent: Handled privately."
      );
    });
  });

  it("keeps rendering updates when the identity directory fails after the updates read succeeds", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/updates`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "sig-text-1",
                    spaceId: VALID_SPACE_ID,
                    ts: 2,
                    profile: {
                      kind: "human",
                      profileId: HUMAN_PROFILE_ID,
                      profileName: PROFILE.profileName,
                    },
                    type: "signal.text",
                    data: {
                      text: "still visible after members failure",
                    },
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/identity-directory`)
        ) {
          return Promise.resolve(
            new Response("identity directory unavailable", {
              status: 503,
              headers: { "content-type": "text/plain" },
            })
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
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
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/dispatches/lookup`)
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                query: {
                  spaceId: VALID_SPACE_ID,
                  sourceSignalId: "11111111-1111-4111-8111-111111111111",
                  clientMessageId: null,
                  targetProfileId: null,
                },
                matches: [],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceUpdates({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          afterSignalId: "11111111-1111-4111-8111-111111111111",
          limit: 20,
          json: true,
          view: "human",
        });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        kind: "space.round_read_projection",
      });
      expect(lines[1]).toMatchObject({
        type: "signal.text",
        messageReadProjection: {
          text: "still visible after members failure",
        },
      });
    });
  });

  it("emits dispatch execution evidence before update lines in json mode", async () => {
    const READY_AGENT_PROFILE_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const BLOCKED_AGENT_PROFILE_ID = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/updates`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "sig-status-1",
                    spaceId: VALID_SPACE_ID,
                    ts: 2,
                    profile: {
                      kind: "agent",
                      profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                      profileName: "Ready Agent",
                    },
                    type: "signal.status",
                    data: {
                      actorProfileId:
                        "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                      dispatchId: "dispatch-ready",
                      generatedBy: "openmeld",
                      status: "done",
                      text: "status text",
                    },
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/identity-directory`)
        ) {
          return Promise.resolve(
            createIdentityDirectoryResponse([
              {
                profileId: READY_AGENT_PROFILE_ID,
                profileName: "Ready Agent",
                profileKind: "agent",
                agentControllerRef: "builtin:codex",
              },
              {
                profileId: BLOCKED_AGENT_PROFILE_ID,
                profileName: "Blocked Agent",
                profileKind: "agent",
                agentControllerRef: "builtin:codex",
              },
            ])
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "11111111-1111-4111-8111-111111111111",
                    spaceId: VALID_SPACE_ID,
                    ts: 1,
                    profile: {
                      kind: "human",
                      profileId: HUMAN_PROFILE_ID,
                      profileName: PROFILE.profileName,
                    },
                    type: "signal.text",
                    data: {
                      text: "@Ready Agent(wake) @Blocked Agent(wake) anchor",
                      messageEnvelope: {
                        text: "@Ready Agent(wake) @Blocked Agent(wake) anchor",
                        activationTargets: [
                          READY_AGENT_PROFILE_ID,
                          BLOCKED_AGENT_PROFILE_ID,
                        ],
                        referenceTargets: [],
                      },
                    },
                  },
                ],
                nextCursor: null,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/dispatches/lookup`)
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                query: {
                  spaceId: VALID_SPACE_ID,
                  sourceSignalId: "11111111-1111-4111-8111-111111111111",
                  clientMessageId: null,
                  targetProfileId: null,
                },
                matches: [
                  {
                    dispatchId: "dispatch-ready",
                    sourceSignalId: "11111111-1111-4111-8111-111111111111",
                    targetProfileId: READY_AGENT_PROFILE_ID,
                    status: "dispatching",
                    attemptCount: 1,
                    latestAttemptId: "attempt-ready",
                    latestAttemptStatus: "waiting_result",
                    latestAttemptErrorCode: null,
                    latestAttemptErrorMessage: null,
                  },
                  {
                    dispatchId: "dispatch-blocked",
                    sourceSignalId: "11111111-1111-4111-8111-111111111111",
                    targetProfileId: BLOCKED_AGENT_PROFILE_ID,
                    status: "blocked",
                    attemptCount: 1,
                    latestAttemptId: "attempt-blocked",
                    latestAttemptStatus: "blocked",
                    latestAttemptErrorCode: "route.not_registered",
                    latestAttemptErrorMessage: "Route is not registered.",
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceUpdates({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          afterSignalId: "11111111-1111-4111-8111-111111111111",
          limit: 20,
          json: true,
          view: "human",
        });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines[0]).toMatchObject({
        kind: "space.dispatch_execution",
        dispatchExecution: {
          sourceSignalId: "11111111-1111-4111-8111-111111111111",
          targetDispatches: [
            expect.objectContaining({
              targetDisplayName: "Ready Agent",
              status: "dispatch_recorded",
              targetProfileId: READY_AGENT_PROFILE_ID,
            }),
            expect.objectContaining({
              targetProfileId: BLOCKED_AGENT_PROFILE_ID,
              targetDisplayName: "Blocked Agent",
              status: "blocked",
              reasonCode: "route.not_registered",
            }),
          ],
        },
      });
      expect(lines[1]).toMatchObject({
        kind: "space.round_read_projection",
        roundReadProjection: {
          sourceSignalId: "11111111-1111-4111-8111-111111111111",
          targets: [
            expect.objectContaining({
              profileId: READY_AGENT_PROFILE_ID,
              relation: "wake",
              dispatchState: "dispatch_recorded",
              publicOutcome: "post_status",
              publishedSignalId: "sig-status-1",
            }),
            expect.objectContaining({
              profileId: BLOCKED_AGENT_PROFILE_ID,
              relation: "wake",
              dispatchState: "blocked",
              publicOutcome: null,
              reasonCode: "route.not_registered",
            }),
          ],
        },
      });
      expect(lines[2]?.type).toBe("signal.status");
    });
  });

  it("emits a structured unavailable line when updates cannot load dispatch execution evidence", async () => {
    await withTempHome(async () => {
      const readyAgentProfileId = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/updates`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "sig-status-unavailable",
                    spaceId: VALID_SPACE_ID,
                    ts: 2,
                    profile: {
                      kind: "agent",
                      profileId: readyAgentProfileId,
                      profileName: "Ready Agent",
                    },
                    type: "signal.status",
                    data: {
                      actorProfileId: readyAgentProfileId,
                      dispatchId: "dispatch-unavailable",
                      generatedBy: "openmeld",
                      status: "working",
                      text: "Still working.",
                    },
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/identity-directory`)
        ) {
          return Promise.resolve(
            createIdentityDirectoryResponse([
              {
                profileId: HUMAN_PROFILE_ID,
                profileName: PROFILE.profileName,
                profileKind: "human",
                ownerUserId: "user-1",
                ownerName: PROFILE.profileName,
              },
              {
                profileId: readyAgentProfileId,
                profileName: "Ready Agent",
                profileKind: "agent",
                agentControllerRef: "builtin:codex",
              },
            ])
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/identity-directory`)
        ) {
          return Promise.resolve(
            createIdentityDirectoryResponse([
              {
                profileId: HUMAN_PROFILE_ID,
                profileName: PROFILE.profileName,
                profileKind: "human",
                ownerUserId: "user-1",
                ownerName: PROFILE.profileName,
              },
              {
                profileId: "agt_33333333-3333-4333-8333-333333333333",
                profileName: "hi-agent",
                profileKind: "agent",
                agentControllerRef: "builtin:codex",
              },
            ])
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                generatedAt: "2026-03-21T00:00:00.000Z",
                summary: {
                  totalCount: 2,
                  humanCount: 1,
                  agentCount: 1,
                  liveNowCount: 0,
                },
                humans: [
                  {
                    profileId: HUMAN_PROFILE_ID,
                    profileName: PROFILE.profileName,
                    profileKind: "human",
                    status: "active",
                    memberSource: "joined_directly",
                    memberSourceLabel: "Joined directly",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: null,
                    addedByOwnerUserId: null,
                    addedByDisplayName: null,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: "user-1",
                    ownerName: PROFILE.profileName,
                  },
                ],
                agents: [
                  {
                    profileId: readyAgentProfileId,
                    profileName: "Ready Agent",
                    profileKind: "agent",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "added_by_member",
                    memberSourceLabel: "Added by a member",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: HUMAN_PROFILE_ID,
                    addedByOwnerUserId: null,
                    addedByDisplayName: PROFILE.profileName,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: null,
                    ownerName: null,
                    agentControllerRef: "builtin:codex",
                    agentControllerConversationId: null,
                    workingDirectory: null,
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "33333333-3333-4333-8333-333333333333",
                    spaceId: VALID_SPACE_ID,
                    ts: 1,
                    profile: {
                      kind: "human",
                      profileId: HUMAN_PROFILE_ID,
                      profileName: PROFILE.profileName,
                    },
                    type: "signal.text",
                    data: {
                      text: "@Ready Agent(wake) Please help.",
                      messageEnvelope: {
                        text: "@Ready Agent(wake) Please help.",
                        activationTargets: [readyAgentProfileId],
                        referenceTargets: [],
                      },
                    },
                  },
                ],
                nextCursor: null,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/dispatches/lookup`)
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: false,
                error: {
                  code: "space.dispatch_lookup.unavailable",
                  message: "dispatch lookup temporarily unavailable",
                  requestId: "req-lookup-1",
                },
              }),
              {
                status: 503,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceUpdates({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          afterSignalId: "33333333-3333-4333-8333-333333333333",
          limit: 20,
          json: true,
          view: "human",
        });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines[0]).toMatchObject({
        kind: "space.dispatch_execution_unavailable",
        code: "space.dispatch_lookup.unavailable",
        message: "dispatch lookup temporarily unavailable",
        requestId: "req-lookup-1",
        sourceSignalId: "33333333-3333-4333-8333-333333333333",
      });
      expect(lines[1]).toMatchObject({
        kind: "space.round_read_projection",
        roundReadProjection: {
          sourceSignalId: "33333333-3333-4333-8333-333333333333",
        },
      });
      expect(lines[2]?.type).toBe("signal.status");
    });
  });

  it("reads anchored history in json mode without dropping messageReadProjection", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
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
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "sig-history-1",
                    spaceId: VALID_SPACE_ID,
                    ts: 1,
                    profile: {
                      kind: "human",
                      profileId: HUMAN_PROFILE_ID,
                      profileName: PROFILE.profileName,
                    },
                    type: "signal.text",
                    data: {
                      text: "@Phase 2a Agent(reference) anchored history",
                      messageEnvelope: {
                        text: "@Phase 2a Agent(reference) anchored history",
                        activationTargets: [],
                        referenceTargets: [
                          "agt_33333333-3333-4333-8333-333333333333",
                        ],
                      },
                    },
                  },
                ],
                nextCursor: null,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/meta`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                organizationId: "org-1",
                visibility: "private",
                name: "Demo",
                creator: {
                  profileId: HUMAN_PROFILE_ID,
                  profileName: PROFILE.profileName,
                  kind: "human",
                },
                passwordProtected: false,
                createdAt: "2026-03-21T00:00:00.000Z",
                updatedAt: "2026-03-21T00:00:00.000Z",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/identity-directory`)
        ) {
          return Promise.resolve(
            createIdentityDirectoryResponse([
              {
                profileId: HUMAN_PROFILE_ID,
                profileName: PROFILE.profileName,
                profileKind: "human",
                ownerUserId: "user-1",
                ownerName: PROFILE.profileName,
              },
            ])
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/identity-directory`)
        ) {
          return Promise.resolve(
            createIdentityDirectoryResponse([
              {
                profileId: "agt_33333333-3333-4333-8333-333333333333",
                profileName: "hi-agent",
                profileKind: "agent",
                agentControllerRef: "builtin:codex",
              },
            ])
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                generatedAt: "2026-03-21T00:00:00.000Z",
                summary: {
                  totalCount: 1,
                  humanCount: 1,
                  agentCount: 0,
                  liveNowCount: 0,
                },
                humans: [
                  {
                    profileId: HUMAN_PROFILE_ID,
                    profileName: PROFILE.profileName,
                    profileKind: "human",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "space_creator",
                    memberSourceLabel: "Creator",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: null,
                    addedByOwnerUserId: null,
                    addedByDisplayName: null,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: PROFILE.ownerUserId,
                    ownerName: null,
                  },
                ],
                agents: [],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected request: ${url}`);
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceHistory({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          limit: 10,
          json: true,
          view: "human",
          afterSignalId: "11111111-1111-4111-8111-111111111111",
          fromProfileIds: [HUMAN_PROFILE_ID],
          kinds: ["text"],
        });
      });

      const payload = JSON.parse(stdout.trim()) as {
        messageReadProjection?: {
          referenceTargets?: Array<{ profileId?: string }>;
        };
      };
      expect(payload.messageReadProjection?.referenceTargets).toEqual([
        expect.objectContaining({
          profileId: "agt_33333333-3333-4333-8333-333333333333",
        }),
      ]);
    });
  });

  it("keeps semantic reply cues in human history output when the visible window misses the anchor", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
          if (
            url.searchParams.get("aroundSignalId") ===
            "66666666-6666-4666-8666-666666666666"
          ) {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  signals: [
                    {
                      v: 1,
                      id: "66666666-6666-4666-8666-666666666666",
                      spaceId: VALID_SPACE_ID,
                      ts: 2,
                      profile: {
                        kind: "agent",
                        profileId: "agt_33333333-3333-4333-8333-333333333333",
                        profileName: "Phase 2a Agent",
                      },
                      type: "signal.text",
                      data: {
                        text: "Ack",
                        messageEnvelope: {
                          text: "Ack",
                          activationTargets: [],
                          referenceTargets: [],
                          replyToSignalId:
                            "11111111-1111-4111-8111-111111111111",
                        },
                        replyTo: {
                          signalId: "11111111-1111-4111-8111-111111111111",
                          profileId: HUMAN_PROFILE_ID,
                          profileKind: "human",
                          profileName: PROFILE.profileName,
                          previewText: "@Phase 2a Agent(wake) anchor",
                        },
                      },
                    },
                  ],
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
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "11111111-1111-4111-8111-111111111111",
                    spaceId: VALID_SPACE_ID,
                    ts: 1,
                    profile: {
                      kind: "human",
                      profileId: HUMAN_PROFILE_ID,
                      profileName: PROFILE.profileName,
                    },
                    type: "signal.text",
                    data: {
                      text: "@Phase 2a Agent(wake) anchor",
                      messageEnvelope: {
                        text: "@Phase 2a Agent(wake) anchor",
                        activationTargets: [
                          "agt_33333333-3333-4333-8333-333333333333",
                        ],
                        referenceTargets: [],
                      },
                    },
                  },
                ],
                nextCursor: null,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/meta`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                organizationId: "org-1",
                visibility: "private",
                name: "Demo",
                creator: {
                  profileId: HUMAN_PROFILE_ID,
                  profileName: PROFILE.profileName,
                  kind: "human",
                },
                passwordProtected: false,
                createdAt: "2026-03-21T00:00:00.000Z",
                updatedAt: "2026-03-21T00:00:00.000Z",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/identity-directory`)
        ) {
          return Promise.resolve(
            createIdentityDirectoryResponse([
              {
                profileId: HUMAN_PROFILE_ID,
                profileName: PROFILE.profileName,
                profileKind: "human",
                ownerUserId: "user-1",
                ownerName: PROFILE.profileName,
              },
            ])
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                generatedAt: "2026-03-21T00:00:00.000Z",
                summary: {
                  totalCount: 2,
                  humanCount: 1,
                  agentCount: 1,
                  liveNowCount: 0,
                },
                humans: [
                  {
                    profileId: HUMAN_PROFILE_ID,
                    profileName: PROFILE.profileName,
                    profileKind: "human",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "space_creator",
                    memberSourceLabel: "Creator",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: null,
                    addedByOwnerUserId: null,
                    addedByDisplayName: null,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: "user-1",
                    ownerName: PROFILE.profileName,
                  },
                ],
                agents: [
                  {
                    profileId: "agt_33333333-3333-4333-8333-333333333333",
                    profileName: "Phase 2a Agent",
                    profileKind: "agent",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "added_by_member",
                    memberSourceLabel: "Added by a member",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: HUMAN_PROFILE_ID,
                    addedByOwnerUserId: null,
                    addedByDisplayName: PROFILE.profileName,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: null,
                    ownerName: null,
                    agentControllerRef: "builtin:codex",
                    agentControllerConversationId: null,
                    workingDirectory: null,
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected request: ${url}`);
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceHistory({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          limit: 10,
          json: false,
          view: "human",
          aroundSignalId: "66666666-6666-4666-8666-666666666666",
          beforeCount: 0,
          afterCount: 1,
        });
      });

      expect(plainStdout).toContain("reply to Mira · wake:");
      expect(plainStdout).not.toContain(
        "reply to Mira · @Phase 2a Agent(wake) anchor"
      );
      expect(plainStdout).toContain("Ack");
    });
  });

  it("requests explicit recent history limits in history mode", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
          expect(url.searchParams.get("recent")).toBe("1");
          expect(url.searchParams.get("limit")).toBe("250");
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
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/meta`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                organizationId: "org-1",
                visibility: "private",
                name: "Demo Space",
                creator: {
                  profileId: HUMAN_PROFILE_ID,
                  profileName: PROFILE.profileName,
                  kind: "human",
                  ownerUserId: PROFILE.ownerUserId,
                  ownerName: PROFILE.profileName,
                },
                passwordProtected: false,
                createdAt: "2026-03-21T00:00:00.000Z",
                updatedAt: "2026-03-21T00:00:00.000Z",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                generatedAt: "2026-03-22T00:00:00.000Z",
                summary: {
                  totalCount: 1,
                  humanCount: 1,
                  agentCount: 0,
                  liveNowCount: 0,
                },
                humans: [],
                agents: [],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected request: ${url}`);
      });

      await withCapturedStdio(async () => {
        await runSpaceHistory({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          limit: 250,
          json: true,
          view: "human",
        });
      });
    });
  });

  it("renders human-readable updates output with a summary card", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/updates`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "sig-text-1",
                    spaceId: VALID_SPACE_ID,
                    ts: 1,
                    profile: {
                      kind: "human",
                      profileId: HUMAN_PROFILE_ID,
                      profileName: PROFILE.profileName,
                    },
                    type: "signal.text",
                    data: {
                      text: "PHASE5A-TEXT-TEST",
                    },
                  },
                  {
                    v: 1,
                    id: "sig-status-1",
                    spaceId: VALID_SPACE_ID,
                    ts: 2,
                    profile: {
                      kind: "agent",
                      profileId: "agt_33333333-3333-4333-8333-333333333333",
                      profileName: "hi-agent",
                    },
                    type: "signal.status",
                    data: {
                      actorProfileId:
                        "agt_33333333-3333-4333-8333-333333333333",
                      dispatchId: "dispatch-1",
                      generatedBy: "openmeld",
                      status: "done",
                      text: "PHASE5A-STATUS-TEST",
                    },
                  },
                  {
                    v: 1,
                    id: "sig-notice-1",
                    spaceId: VALID_SPACE_ID,
                    ts: 3,
                    profile: {
                      kind: "system",
                      profileId: "system",
                      profileName: "system",
                    },
                    type: "signal.system_notice",
                    data: {
                      noticeType: "stay_silent",
                      actorProfileId:
                        "agt_33333333-3333-4333-8333-333333333333",
                      actorName: "hi-agent",
                      dispatchId: "dispatch-1",
                      generatedBy: "openmeld",
                      reason: "Handled privately.",
                      text: "hi-agent chose to stay silent: Handled privately.",
                    },
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                generatedAt: "2026-03-21T00:00:00.000Z",
                summary: {
                  totalCount: 2,
                  humanCount: 1,
                  agentCount: 1,
                  liveNowCount: 0,
                },
                humans: [
                  {
                    profileId: HUMAN_PROFILE_ID,
                    profileName: PROFILE.profileName,
                    profileKind: "human",
                    status: "active",
                    memberSource: "joined_directly",
                    memberSourceLabel: "Joined directly",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: null,
                    addedByOwnerUserId: null,
                    addedByDisplayName: null,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: "user-1",
                    ownerName: PROFILE.profileName,
                  },
                ],
                agents: [
                  {
                    profileId: "agt_33333333-3333-4333-8333-333333333333",
                    profileName: "hi-agent",
                    profileKind: "agent",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "added_by_member",
                    memberSourceLabel: "Added by a member",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: HUMAN_PROFILE_ID,
                    addedByOwnerUserId: null,
                    addedByDisplayName: PROFILE.profileName,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: null,
                    ownerName: null,
                    agentControllerRef: "builtin:codex",
                    agentControllerConversationId: null,
                    workingDirectory: null,
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "11111111-1111-4111-8111-111111111111",
                    spaceId: VALID_SPACE_ID,
                    ts: 0,
                    profile: {
                      kind: "human",
                      profileId: HUMAN_PROFILE_ID,
                      profileName: PROFILE.profileName,
                    },
                    type: "signal.text",
                    data: {
                      text: "@hi-agent anchor",
                      messageEnvelope: {
                        text: "@hi-agent anchor",
                        activationTargets: [
                          "agt_33333333-3333-4333-8333-333333333333",
                        ],
                        referenceTargets: [],
                      },
                    },
                  },
                  {
                    v: 1,
                    id: "sig-text-1",
                    spaceId: VALID_SPACE_ID,
                    ts: 1,
                    profile: {
                      kind: "human",
                      profileId: HUMAN_PROFILE_ID,
                      profileName: PROFILE.profileName,
                    },
                    type: "signal.text",
                    data: {
                      text: "PHASE5A-TEXT-TEST",
                    },
                  },
                  {
                    v: 1,
                    id: "sig-status-1",
                    spaceId: VALID_SPACE_ID,
                    ts: 2,
                    profile: {
                      kind: "agent",
                      profileId: "agt_33333333-3333-4333-8333-333333333333",
                      profileName: "hi-agent",
                    },
                    type: "signal.status",
                    data: {
                      actorProfileId:
                        "agt_33333333-3333-4333-8333-333333333333",
                      dispatchId: "dispatch-1",
                      generatedBy: "openmeld",
                      status: "done",
                      text: "PHASE5A-STATUS-TEST",
                      replyTo: {
                        signalId: "11111111-1111-4111-8111-111111111111",
                        profileId: HUMAN_PROFILE_ID,
                        profileKind: "human",
                        profileName: PROFILE.profileName,
                        previewText: "@hi-agent anchor",
                      },
                    },
                  },
                ],
                nextCursor: null,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/dispatches/lookup`)
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                query: {
                  spaceId: VALID_SPACE_ID,
                  sourceSignalId: "11111111-1111-4111-8111-111111111111",
                  clientMessageId: null,
                  targetProfileId: null,
                },
                matches: [
                  {
                    dispatchId: "dispatch-1",
                    sourceSignalId: "11111111-1111-4111-8111-111111111111",
                    targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
                    status: "dispatching",
                    attemptCount: 1,
                    latestAttemptId: "attempt-1",
                    latestAttemptStatus: "waiting_result",
                    latestAttemptErrorCode: null,
                    latestAttemptErrorMessage: null,
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected request: ${url.toString()}`);
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceUpdates({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          afterSignalId: "11111111-1111-4111-8111-111111111111",
          limit: 5,
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Space updates:");
      expect(plainStdout).toContain(
        "After signal: 11111111-1111-4111-8111-111111111111"
      );
      expect(plainStdout).toContain("Updates shown: 3");
      expect(plainStdout).toContain(
        "Workflow: A public status update was written back."
      );
      expect(plainStdout).toContain(
        "Published signal: signal.status · sig-status-1"
      );
      expect(plainStdout).toContain(
        "Round: 1 wake target · 1 dispatch recorded · 1 status posted"
      );
      expect(plainStdout).toContain(
        "hi-agent · wake · dispatch recorded · posted status · sig-status-1"
      );
      expect(plainStdout).toContain("Dispatch history: 1 recorded");
      expect(plainStdout).toContain(
        "hi-agent · recorded · ledger dispatching · attempt waiting_result"
      );
      expect(plainStdout).toContain(
        "`space updates` shows formal execution evidence for this message round."
      );
      expect(plainStdout).toContain("Included: text | status | system_notice");
      expect(plainStdout).toContain("PHASE5A-TEXT-TEST");
      expect(plainStdout).toContain("PHASE5A-STATUS-TEST");
      expect(plainStdout).toContain(
        "hi-agent chose to stay silent: Handled privately."
      );
    });
  });

  it("uses semantic reply cues in human updates output when signal history is available", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/updates`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "66666666-6666-4666-8666-666666666666",
                    spaceId: VALID_SPACE_ID,
                    ts: 2,
                    profile: {
                      kind: "agent",
                      profileId: "agt_33333333-3333-4333-8333-333333333333",
                      profileName: "hi-agent",
                    },
                    type: "signal.text",
                    data: {
                      text: "Ack",
                      messageEnvelope: {
                        text: "Ack",
                        activationTargets: [],
                        referenceTargets: [],
                        replyToSignalId: "11111111-1111-4111-8111-111111111111",
                      },
                      replyTo: {
                        signalId: "11111111-1111-4111-8111-111111111111",
                        profileId: HUMAN_PROFILE_ID,
                        profileKind: "human",
                        profileName: PROFILE.profileName,
                        previewText: "@hi-agent anchor",
                      },
                    },
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                generatedAt: "2026-03-21T00:00:00.000Z",
                summary: {
                  totalCount: 2,
                  humanCount: 1,
                  agentCount: 1,
                  liveNowCount: 0,
                },
                humans: [
                  {
                    profileId: HUMAN_PROFILE_ID,
                    profileName: PROFILE.profileName,
                    profileKind: "human",
                    status: "active",
                    memberSource: "joined_directly",
                    memberSourceLabel: "Joined directly",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: null,
                    addedByOwnerUserId: null,
                    addedByDisplayName: null,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: "user-1",
                    ownerName: PROFILE.profileName,
                  },
                ],
                agents: [
                  {
                    profileId: "agt_33333333-3333-4333-8333-333333333333",
                    profileName: "hi-agent",
                    profileKind: "agent",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "added_by_member",
                    memberSourceLabel: "Added by a member",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: HUMAN_PROFILE_ID,
                    addedByOwnerUserId: null,
                    addedByDisplayName: PROFILE.profileName,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: null,
                    ownerName: null,
                    agentControllerRef: "builtin:codex",
                    agentControllerConversationId: null,
                    workingDirectory: null,
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "11111111-1111-4111-8111-111111111111",
                    spaceId: VALID_SPACE_ID,
                    ts: 1,
                    profile: {
                      kind: "human",
                      profileId: HUMAN_PROFILE_ID,
                      profileName: PROFILE.profileName,
                    },
                    type: "signal.text",
                    data: {
                      text: "@hi-agent anchor",
                      messageEnvelope: {
                        text: "@hi-agent anchor",
                        activationTargets: [
                          "agt_33333333-3333-4333-8333-333333333333",
                        ],
                        referenceTargets: [],
                      },
                    },
                  },
                ],
                nextCursor: null,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected request: ${url.toString()}`);
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceUpdates({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          afterSignalId: "11111111-1111-4111-8111-111111111111",
          limit: 5,
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("reply to Mira · wake:");
      expect(plainStdout).not.toContain("reply to Mira · @hi-agent anchor");
      expect(plainStdout).toContain("Ack");
    });
  });

  it("shows a visible unavailable summary when updates cannot load dispatch execution evidence", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/updates`)) {
          return Promise.resolve(
            new Response(JSON.stringify({ signals: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                generatedAt: "2026-03-21T00:00:00.000Z",
                summary: {
                  totalCount: 0,
                  humanCount: 0,
                  agentCount: 0,
                  liveNowCount: 0,
                },
                humans: [],
                agents: [],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
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
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/dispatches/lookup`)
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: false,
                error: {
                  code: "space.dispatch_lookup.unavailable",
                  message: "dispatch lookup temporarily unavailable",
                  requestId: "req-lookup-human-1",
                },
              }),
              {
                status: 503,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected request: ${url.toString()}`);
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceUpdates({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          afterSignalId: "33333333-3333-4333-8333-333333333333",
          limit: 5,
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Dispatch history");
      expect(plainStdout).toContain(
        "unavailable · dispatch lookup temporarily unavailable · request req-lookup-human-1"
      );
    });
  });

  it("renders the updates-specific empty state in human mode", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("/updates?")) {
          return Promise.resolve(
            new Response(JSON.stringify({ signals: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (url.includes("/members")) {
          return Promise.resolve(
            new Response(JSON.stringify({ humans: [], agents: [] }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        throw new Error(`unexpected request: ${url}`);
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceUpdates({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          afterSignalId: "99999999-9999-4999-8999-999999999999",
          limit: 20,
          json: false,
          view: "human",
        });
      });

      expect(stdout).toContain("no updates found after this signal");
    });
  });

  it("rejects updates limits above the shared maximum before making requests", async () => {
    await expect(
      runSpaceUpdates({
        entryChecksHandled: true,
        profile: PROFILE.openMeldProfileId,
        baseUrl: "http://localhost",
        space: VALID_SPACE_ID,
        afterSignalId: "55555555-5555-4555-8555-555555555555",
        limit: SPACE_UPDATES_MAX_LIMIT + 1,
        json: true,
        view: "human",
      })
    ).rejects.toThrow(
      `limit must be less than or equal to ${String(SPACE_UPDATES_MAX_LIMIT)}`
    );
  });

  it("rejects missing --after-signal before making requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      runSpaceUpdates({
        entryChecksHandled: true,
        profile: PROFILE.openMeldProfileId,
        baseUrl: "http://localhost",
        space: VALID_SPACE_ID,
        afterSignalId: "   ",
        limit: 20,
        json: true,
        view: "human",
      })
    ).rejects.toThrow("missing required --after-signal value");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects non-positive updates limits before making requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      runSpaceUpdates({
        entryChecksHandled: true,
        profile: PROFILE.openMeldProfileId,
        baseUrl: "http://localhost",
        space: VALID_SPACE_ID,
        afterSignalId: "55555555-5555-4555-8555-555555555555",
        limit: 0,
        json: true,
        view: "human",
      })
    ).rejects.toThrow("limit must be a positive integer");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders human-readable result output", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/result`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                resultRef: "dispatch-result:result-1",
                dispatchId: "dispatch-1",
                spaceId: VALID_SPACE_ID,
                actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
                actorName: "hi-agent",
                replyToSignalId: "11111111-1111-4111-8111-111111111111",
                resultKind: "status",
                statusType: "done",
                previewText: "done",
                publicOutcome: "post_status",
                publishedSignalId: "sig-published-1",
                createdAt: "2026-03-21T00:00:00.000Z",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(
            `/spaces/${VALID_SPACE_ID}/dispatches/dispatch-1/trace`
          )
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                query: {
                  spaceId: VALID_SPACE_ID,
                  dispatchId: "dispatch-1",
                },
                trace: {
                  dispatch: {
                    dispatchId: "dispatch-1",
                    idempotencyKey: "idem-1",
                    sourceEventId: "11111111-1111-4111-8111-111111111111",
                    targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
                    status: "blocked",
                    firstSeenAt: "2026-03-21T00:00:00.000Z",
                    lastAttemptAt: "2026-03-21T00:00:00.000Z",
                    attemptCount: 1,
                    latestAttemptId: "attempt-1",
                  },
                  latestAttempt: {
                    attemptId: "attempt-1",
                    dispatchId: "dispatch-1",
                    idempotencyKey: "idem-1",
                    attemptNo: 1,
                    status: "blocked",
                    daemonSessionId: null,
                    connectionGeneration: null,
                    leaseEpoch: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    startedAt: null,
                    finishedAt: "2026-03-21T00:00:00.000Z",
                    errorCode: "route.not_registered",
                    errorMessage: "Route is not registered.",
                  },
                  recentOpsDecisions: [],
                  replySignal: null,
                  streaming: null,
                  runtime: null,
                  execution: null,
                  origin: null,
                  prompt: null,
                  conversation: null,
                  openClawGatewayVisibility: null,
                  openClawBinding: null,
                  structuredActionFailure: null,
                },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                generatedAt: "2026-03-21T00:00:00.000Z",
                summary: {
                  totalCount: 1,
                  humanCount: 0,
                  agentCount: 1,
                  liveNowCount: 0,
                },
                humans: [],
                agents: [
                  {
                    profileId: "agt_33333333-3333-4333-8333-333333333333",
                    profileName: "hi-agent",
                    profileKind: "agent",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "added_by_member",
                    memberSourceLabel: "Added by a member",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: HUMAN_PROFILE_ID,
                    addedByOwnerUserId: null,
                    addedByDisplayName: PROFILE.profileName,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: null,
                    ownerName: null,
                    agentControllerRef: "builtin:codex",
                    agentControllerConversationId: null,
                    workingDirectory: null,
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(
            `/spaces/${VALID_SPACE_ID}/dispatches/dispatch-json-1/trace`
          )
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                query: {
                  spaceId: VALID_SPACE_ID,
                  dispatchId: "dispatch-json-1",
                },
                trace: {
                  dispatch: {
                    dispatchId: "dispatch-json-1",
                    idempotencyKey: "idem-json-1",
                    sourceEventId: "77777777-7777-4777-8777-777777777777",
                    targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
                    status: "dispatching",
                    firstSeenAt: "2026-03-21T00:00:00.000Z",
                    lastAttemptAt: "2026-03-21T00:00:00.000Z",
                    attemptCount: 1,
                    latestAttemptId: "attempt-json-1",
                  },
                  latestAttempt: {
                    attemptId: "attempt-json-1",
                    dispatchId: "dispatch-json-1",
                    idempotencyKey: "idem-json-1",
                    attemptNo: 1,
                    status: "waiting_result",
                    daemonSessionId: "daemon-1",
                    connectionGeneration: 1,
                    leaseEpoch: 2,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    startedAt: "2026-03-21T00:00:01.000Z",
                    finishedAt: null,
                    errorCode: null,
                    errorMessage: null,
                  },
                  recentOpsDecisions: [],
                  replySignal: null,
                  streaming: null,
                  runtime: null,
                  execution: null,
                  origin: null,
                  prompt: null,
                  conversation: null,
                  openClawGatewayVisibility: null,
                  openClawBinding: null,
                  structuredActionFailure: null,
                },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
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
        throw new Error(`unexpected request: ${url.toString()}`);
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceResult({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          dispatchId: "dispatch-1",
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Space dispatch result:");
      expect(plainStdout).toContain("Actor: hi-agent");
      expect(plainStdout).toContain(
        "Actor profile ID: agt_33333333-3333-4333-8333-333333333333"
      );
      expect(plainStdout).toContain("Dispatch ID: dispatch-1");
      expect(plainStdout).not.toContain("Dispatch history");
      expect(plainStdout).not.toContain("route.not_registered");
      expect(plainStdout).toContain("Public outcome: post_status");
      expect(plainStdout).toContain(
        "Workflow: A public status update was written back."
      );
      expect(plainStdout).toContain(
        "Published signal: signal.status · sig-published-1"
      );
      expect(plainStdout).toContain("Status type: done");
      expect(plainStdout).toContain(
        "`space result` reads archived dispatch results only."
      );
    });
  });

  it("keeps identity-directory relation names in human result output when actorName is already present", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/result`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                resultRef: "dispatch-result:keep-snapshot",
                dispatchId: "dispatch-keep-snapshot",
                spaceId: VALID_SPACE_ID,
                actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
                actorName: "hi-agent",
                resultKind: "text",
                finalText: "Done",
                publicOutcome: "post_message",
                createdAt: "2026-03-21T00:00:00.000Z",
                messageEnvelope: {
                  text: "Done",
                  activationTargets: [],
                  referenceTargets: ["44444444-4444-4444-4444-444444444444"],
                },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(
            `/spaces/${VALID_SPACE_ID}/dispatches/dispatch-keep-snapshot/trace`
          )
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                query: {
                  spaceId: VALID_SPACE_ID,
                  dispatchId: "dispatch-keep-snapshot",
                },
                trace: {
                  dispatch: {
                    dispatchId: "dispatch-keep-snapshot",
                    idempotencyKey: "idem-keep-snapshot",
                    sourceEventId: null,
                    targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
                    status: "succeeded",
                    firstSeenAt: "2026-03-21T00:00:00.000Z",
                    lastAttemptAt: "2026-03-21T00:00:01.000Z",
                    attemptCount: 1,
                    latestAttemptId: "attempt-keep-snapshot",
                  },
                  latestAttempt: {
                    attemptId: "attempt-keep-snapshot",
                    dispatchId: "dispatch-keep-snapshot",
                    idempotencyKey: "idem-keep-snapshot",
                    attemptNo: 1,
                    status: "succeeded",
                    daemonSessionId: "daemon-keep-snapshot",
                    connectionGeneration: 1,
                    leaseEpoch: 1,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    startedAt: "2026-03-21T00:00:01.000Z",
                    finishedAt: "2026-03-21T00:00:02.000Z",
                    errorCode: null,
                    errorMessage: null,
                  },
                  recentOpsDecisions: [],
                  replySignal: null,
                  streaming: null,
                  runtime: null,
                  execution: null,
                  origin: null,
                  prompt: null,
                  conversation: null,
                  openClawGatewayVisibility: null,
                  openClawBinding: null,
                  structuredActionFailure: null,
                },
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/identity-directory`)
        ) {
          return Promise.resolve(
            createIdentityDirectoryResponse([
              {
                profileId: "44444444-4444-4444-4444-444444444444",
                profileName: "Referenced Human",
                profileKind: "human",
                ownerUserId: "44444444-4444-4444-4444-444444444444",
                ownerName: "Referenced Human",
              },
              {
                profileId: "agt_33333333-3333-4333-8333-333333333333",
                profileName: "hi-agent",
                profileKind: "agent",
                agentControllerRef: "builtin:codex",
              },
            ])
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                generatedAt: "2026-03-21T00:00:00.000Z",
                summary: {
                  totalCount: 2,
                  humanCount: 1,
                  agentCount: 1,
                  liveNowCount: 0,
                },
                humans: [
                  {
                    profileId: "44444444-4444-4444-4444-444444444444",
                    profileName: "Referenced Human",
                    profileKind: "human",
                    status: "active",
                    memberSource: "joined_directly",
                    memberSourceLabel: "Joined directly",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: null,
                    addedByOwnerUserId: null,
                    addedByDisplayName: null,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    mentionAlias: null,
                    ownerUserId: "44444444-4444-4444-4444-444444444444",
                    ownerName: "Referenced Human",
                  },
                ],
                agents: [
                  {
                    profileId: "agt_33333333-3333-4333-8333-333333333333",
                    profileName: "hi-agent",
                    profileKind: "agent",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "added_by_member",
                    memberSourceLabel: "Added by a member",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: HUMAN_PROFILE_ID,
                    addedByOwnerUserId: null,
                    addedByDisplayName: PROFILE.profileName,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: null,
                    ownerName: null,
                    agentControllerRef: "builtin:codex",
                    agentControllerConversationId: null,
                    workingDirectory: null,
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
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
        throw new Error(`unexpected request: ${url.toString()}`);
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceResult({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          dispatchId: "dispatch-keep-snapshot",
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Reference: Referenced Human");
      expect(plainStdout).not.toContain(
        "Reference: 44444444-4444-4444-4444-444444444444"
      );
    });
  });

  it("emits result json with messageReadProjection", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/result`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                resultRef: "dispatch-result:result-json-1",
                dispatchId: "dispatch-json-1",
                spaceId: VALID_SPACE_ID,
                actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
                actorName: "hi-agent",
                replyToSignalId: "77777777-7777-4777-8777-777777777777",
                resultKind: "text",
                finalText: "Final reply text",
                messageEnvelope: {
                  text: "Final reply text",
                  activationTargets: [],
                  referenceTargets: [
                    "agt_33333333-3333-4333-8333-333333333333",
                  ],
                  replyToSignalId: "77777777-7777-4777-8777-777777777777",
                },
                publicOutcome: "post_message",
                createdAt: "2026-03-21T00:00:00.000Z",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/identity-directory`)
        ) {
          return Promise.resolve(
            createIdentityDirectoryResponse([
              {
                profileId: HUMAN_PROFILE_ID,
                profileName: PROFILE.profileName,
                profileKind: "human",
                ownerUserId: "user-1",
                ownerName: PROFILE.profileName,
              },
              {
                profileId: "agt_33333333-3333-4333-8333-333333333333",
                profileName: "hi-agent",
                profileKind: "agent",
                agentControllerRef: "builtin:codex",
              },
            ])
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                generatedAt: "2026-03-21T00:00:00.000Z",
                summary: {
                  totalCount: 2,
                  humanCount: 1,
                  agentCount: 1,
                  liveNowCount: 0,
                },
                humans: [
                  {
                    profileId: HUMAN_PROFILE_ID,
                    profileName: PROFILE.profileName,
                    profileKind: "human",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "joined_directly",
                    memberSourceLabel: "Joined directly",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: null,
                    addedByOwnerUserId: null,
                    addedByDisplayName: null,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: "user-1",
                    ownerName: PROFILE.profileName,
                  },
                ],
                agents: [
                  {
                    profileId: "agt_33333333-3333-4333-8333-333333333333",
                    profileName: "hi-agent",
                    profileKind: "agent",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "added_by_member",
                    memberSourceLabel: "Added by a member",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: HUMAN_PROFILE_ID,
                    addedByOwnerUserId: null,
                    addedByDisplayName: PROFILE.profileName,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: null,
                    ownerName: null,
                    agentControllerRef: "builtin:codex",
                    agentControllerConversationId: null,
                    workingDirectory: null,
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "77777777-7777-4777-8777-777777777777",
                    spaceId: VALID_SPACE_ID,
                    ts: 1,
                    profile: {
                      kind: "human",
                      profileId: HUMAN_PROFILE_ID,
                      profileName: PROFILE.profileName,
                    },
                    type: "signal.text",
                    data: {
                      text: "@hi-agent context",
                      messageEnvelope: {
                        text: "@hi-agent context",
                        activationTargets: [
                          "agt_33333333-3333-4333-8333-333333333333",
                        ],
                        referenceTargets: [],
                      },
                    },
                  },
                ],
                nextCursor: null,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
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
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceResult({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          dispatchId: "dispatch-json-1",
          json: true,
          view: "human",
        });
      });

      const payload = JSON.parse(stdout.trim()) as {
        resultRef: string;
        messageReadProjection?: {
          referenceTargets?: Array<{ displayName?: string }>;
          replyToContext?: { actorDisplayName?: string; resolved?: boolean };
        };
      };

      expect(payload.resultRef).toBe("dispatch-result:result-json-1");
      expect(payload).not.toHaveProperty("dispatchExecution");
      expect(payload.messageReadProjection?.referenceTargets).toEqual([
        expect.objectContaining({ displayName: "hi-agent" }),
      ]);
      expect(payload.messageReadProjection?.replyToContext).toMatchObject({
        actorDisplayName: PROFILE.profileName,
        resolved: true,
      });
    });
  });

  it("loads signal history for result json when only archived messageEnvelope carries replyToSignalId", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/result`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                resultRef: "dispatch-result:result-json-envelope-only",
                dispatchId: "dispatch-json-envelope-only",
                spaceId: VALID_SPACE_ID,
                actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
                actorName: "hi-agent",
                resultKind: "text",
                finalText: "Final reply text",
                messageEnvelope: {
                  text: "Final reply text",
                  activationTargets: [],
                  referenceTargets: [
                    "agt_33333333-3333-4333-8333-333333333333",
                  ],
                  replyToSignalId: "88888888-8888-4888-8888-888888888888",
                },
                publicOutcome: "post_message",
                createdAt: "2026-03-21T00:00:00.000Z",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/identity-directory`)
        ) {
          return Promise.resolve(
            createIdentityDirectoryResponse([
              {
                profileId: "agt_33333333-3333-4333-8333-333333333333",
                profileName: "hi-agent",
                profileKind: "agent",
                agentControllerRef: "builtin:codex",
              },
            ])
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                generatedAt: "2026-03-21T00:00:00.000Z",
                summary: {
                  totalCount: 2,
                  humanCount: 1,
                  agentCount: 1,
                  liveNowCount: 0,
                },
                humans: [
                  {
                    profileId: HUMAN_PROFILE_ID,
                    profileName: PROFILE.profileName,
                    profileKind: "human",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "joined_directly",
                    memberSourceLabel: "Joined directly",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: null,
                    addedByOwnerUserId: null,
                    addedByDisplayName: null,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: "user-1",
                    ownerName: PROFILE.profileName,
                  },
                ],
                agents: [
                  {
                    profileId: "agt_33333333-3333-4333-8333-333333333333",
                    profileName: "hi-agent",
                    profileKind: "agent",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "added_by_member",
                    memberSourceLabel: "Added by a member",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: HUMAN_PROFILE_ID,
                    addedByOwnerUserId: null,
                    addedByDisplayName: PROFILE.profileName,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: null,
                    ownerName: null,
                    agentControllerRef: "builtin:codex",
                    agentControllerConversationId: null,
                    workingDirectory: null,
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "88888888-8888-4888-8888-888888888888",
                    spaceId: VALID_SPACE_ID,
                    ts: 1,
                    profile: {
                      kind: "human",
                      profileId: HUMAN_PROFILE_ID,
                      profileName: PROFILE.profileName,
                    },
                    type: "signal.text",
                    data: {
                      text: "@hi-agent context",
                      messageEnvelope: {
                        text: "@hi-agent context",
                        activationTargets: [
                          "agt_33333333-3333-4333-8333-333333333333",
                        ],
                        referenceTargets: [],
                      },
                    },
                  },
                ],
                nextCursor: null,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceResult({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          dispatchId: "dispatch-json-envelope-only",
          json: true,
          view: "human",
        });
      });

      const payload = JSON.parse(stdout.trim()) as {
        messageReadProjection?: {
          replyToSignalId?: string;
          replyToContext?: { actorDisplayName?: string; resolved?: boolean };
        };
      };

      expect(payload.messageReadProjection?.replyToSignalId).toBe(
        "88888888-8888-4888-8888-888888888888"
      );
      expect(payload.messageReadProjection?.replyToContext).toMatchObject({
        actorDisplayName: PROFILE.profileName,
        resolved: true,
      });
    });
  });

  it("falls back to the identity directory for actor name in human result output", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/result`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                resultRef: "dispatch-result:result-2",
                dispatchId: "dispatch-2",
                spaceId: VALID_SPACE_ID,
                actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
                replyToSignalId: "22222222-2222-4222-8222-222222222222",
                resultKind: "status",
                statusType: "done",
                previewText: "done",
                publicOutcome: "post_status",
                publishedSignalId: "sig-published-2",
                createdAt: "2026-03-21T00:00:00.000Z",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/identity-directory`)
        ) {
          return Promise.resolve(
            createIdentityDirectoryResponse([
              {
                profileId: "agt_33333333-3333-4333-8333-333333333333",
                profileName: "hi-agent",
                profileKind: "agent",
                agentControllerRef: "builtin:codex",
              },
            ])
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: VALID_SPACE_ID,
                generatedAt: "2026-03-21T00:00:00.000Z",
                summary: {
                  totalCount: 1,
                  humanCount: 0,
                  agentCount: 1,
                  liveNowCount: 0,
                },
                humans: [],
                agents: [
                  {
                    profileId: "agt_33333333-3333-4333-8333-333333333333",
                    profileName: "hi-agent",
                    profileKind: "agent",
                    mentionAlias: null,
                    status: "active",
                    memberSource: "added_by_member",
                    memberSourceLabel: "Added by a member",
                    addedAt: "2026-03-21T00:00:00.000Z",
                    removedAt: null,
                    createdAt: "2026-03-21T00:00:00.000Z",
                    updatedAt: "2026-03-21T00:00:00.000Z",
                    addedByProfileId: HUMAN_PROFILE_ID,
                    addedByOwnerUserId: null,
                    addedByDisplayName: PROFILE.profileName,
                    removedByProfileId: null,
                    removedByOwnerUserId: null,
                    removalReason: null,
                    firstEnteredAt: null,
                    lastEnteredAt: null,
                    lastSeenAt: null,
                    lastSeenLabel: null,
                    liveNow: false,
                    ownerUserId: null,
                    ownerName: null,
                    agentControllerRef: "builtin:codex",
                    agentControllerConversationId: null,
                    workingDirectory: null,
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
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
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceResult({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          dispatchId: "dispatch-2",
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Actor: hi-agent");
      expect(plainStdout).toContain(
        "Actor profile ID: agt_33333333-3333-4333-8333-333333333333"
      );
    });
  });

  it("rejects duplicate result selectors before fetching", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await expect(
        runSpaceResult({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          dispatchId: "dispatch-1",
          resultRef: "dispatch-result:result-1",
          json: true,
          view: "human",
        })
      ).rejects.toThrow(
        "exactly one of --dispatch or --result-ref is required"
      );

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("prompts for password and retries contract reads in human view", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      passwordPromptMock.mockResolvedValueOnce("secret-0321");
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input, init) => {
          const url = new URL(String(input));
          const password = new Headers(init?.headers).get(
            "x-openmeld-space-password"
          );
          if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/contract`)) {
            if (password !== "secret-0321") {
              return Promise.resolve(
                new Response(
                  JSON.stringify({
                    ok: false,
                    error: {
                      code: "upstream_error",
                      message: "space password required",
                    },
                  }),
                  {
                    status: 401,
                    headers: { "content-type": "application/json" },
                  }
                )
              );
            }
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  version: 2,
                  updatedAt: "2026-03-21T00:00:00.000Z",
                  updatedBy: "system",
                  dispatchPolicy: { mode: "mention_only" },
                  publicationMode: "collaboration",
                  allowedActions: [
                    "post_message",
                    "post_status",
                    "stay_silent",
                  ],
                  resultArchivePolicy: { mode: "all_final_results" },
                  authorityOrder: "default",
                  entryBrief: "default",
                  dispatchBrief: "default",
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }
              )
            );
          }
          throw new Error(`unexpected fetch call: ${url.toString()}`);
        });

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceContract({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "human",
        });
      });

      expect(passwordPromptMock).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(stdout).toContain("Space contract:");
    });
  });

  it("reuses the prompted password for updates and identity directory", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      passwordPromptMock.mockResolvedValueOnce("secret-0321");
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      const headerPasswords: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const url = new URL(String(input));
        const password =
          new Headers(init?.headers).get("x-openmeld-space-password") ?? "";
        headerPasswords.push(password);
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/updates`)) {
          if (password !== "secret-0321") {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  ok: false,
                  error: {
                    code: "space.password_required",
                    message: "space password required",
                  },
                }),
                {
                  status: 401,
                  headers: { "content-type": "application/json" },
                }
              )
            );
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                signals: [
                  {
                    v: 1,
                    id: "sig-text-1",
                    spaceId: VALID_SPACE_ID,
                    ts: 1,
                    profile: {
                      kind: "human",
                      profileId: PROFILE.openMeldProfileId,
                      profileName: PROFILE.profileName,
                    },
                    type: "signal.text",
                    data: {
                      text: "hello",
                    },
                  },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/members`)) {
          if (password !== "secret-0321") {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  ok: false,
                  error: {
                    code: "space.password_required",
                    message: "space password required",
                  },
                }),
                {
                  status: 401,
                  headers: { "content-type": "application/json" },
                }
              )
            );
          }
          return Promise.resolve(
            new Response(
              JSON.stringify(
                createSpaceMembersSnapshot({
                  spaceId: VALID_SPACE_ID,
                  generatedAt: "2026-03-21T00:00:00.000Z",
                })
              ),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (url.pathname.endsWith(`/spaces/${VALID_SPACE_ID}/signals`)) {
          if (password !== "secret-0321") {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  ok: false,
                  error: {
                    code: "space.password_required",
                    message: "space password required",
                  },
                }),
                {
                  status: 401,
                  headers: { "content-type": "application/json" },
                }
              )
            );
          }
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
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

      await withCapturedStdio(async () => {
        await runSpaceUpdates({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          afterSignalId: "11111111-1111-4111-8111-111111111111",
          limit: 20,
          json: false,
          view: "human",
        });
      });

      expect(passwordPromptMock).toHaveBeenCalledTimes(1);
      expect(headerPasswords).toEqual([
        "",
        "secret-0321",
        "secret-0321",
        "secret-0321",
        "secret-0321",
      ]);
    });
  });

  it("preserves structured gateway failure context for updates reads", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "space.not_found",
              message: "space not found",
              requestId: "req-updates-404",
            },
          }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          }
        )
      );

      await expect(
        runSpaceUpdates({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          afterSignalId: "44444444-4444-4444-8444-444444444444",
          limit: 5,
          json: false,
          view: "human",
        })
      ).rejects.toMatchObject({
        code: "space.not_found",
        requestId: "req-updates-404",
        status: 404,
      });
    });
  });

  it("explains that missing dispatch results are a read-scope boundary, not silent breakage", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "space.dispatch_result.not_found",
              message: "dispatch result not found",
              requestId: "req-result-404",
            },
          }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          }
        )
      );

      await expect(
        runSpaceResult({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          dispatchId: "dispatch-missing",
          json: false,
          view: "human",
        })
      ).rejects.toMatchObject({
        code: "space.dispatch_result.not_found",
        requestId: "req-result-404",
        status: 404,
        message:
          "No archived dispatch result was found. `space result` reads archived dispatch results only. Use `openmeld service trace` to inspect Wake execution and the final visible Space outcome.",
      });
    });
  });

  it("explains missing dispatch results even when the server reports upstream_error", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "upstream_error",
              message: "dispatch result not found",
              requestId: "req-result-upstream-404",
            },
          }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          }
        )
      );

      await expect(
        runSpaceResult({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          dispatchId: "dispatch-missing",
          json: false,
          view: "human",
        })
      ).rejects.toMatchObject({
        code: "upstream_error",
        requestId: "req-result-upstream-404",
        status: 404,
        message:
          "No archived dispatch result was found. `space result` reads archived dispatch results only. Use `openmeld service trace` to inspect Wake execution and the final visible Space outcome.",
      });
    });
  });

  it("keeps missing archived result failures structured outside human render mode", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "space.dispatch_result.not_found",
              message: "dispatch result not found",
              requestId: "req-result-agent-404",
            },
          }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          }
        )
      );

      await expect(
        runSpaceResult({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          dispatchId: "dispatch-missing",
          json: true,
          view: "human",
        })
      ).rejects.toMatchObject({
        code: "space.dispatch_result.not_found",
        requestId: "req-result-agent-404",
        status: 404,
        message: "dispatch result not found",
      });
    });
  });
});
