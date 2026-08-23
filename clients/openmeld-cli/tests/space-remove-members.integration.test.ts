import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type { AccountSpaceIndexItem } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSpaceRemoveMembers } from "../src/space/command";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const CURRENT_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_PROFILE_NAME = "felix-owner-profile";
const OWNER_NAME_OPAQUE = "b575a0f4-c06c-48f5-96a5-0bdfeb78278b";
const CREATOR_PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const MEMBER_ONE_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER_TWO_ID = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER_THREE_ID = "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const READY_DAEMON_ROUTE_OBSERVATION = {
  observedAt: "2026-03-06T00:00:00.000Z",
  reasonCode: "online",
  status: "online",
} as const;
const ANSI_ESCAPE_PATTERN = "\\x1B\\[[0-9;]*m";
const stripAnsi = (value: string | null): string =>
  (value ?? "").replace(new RegExp(ANSI_ESCAPE_PATTERN, "g"), "");

const listOpenMeldProfilesMock = vi.hoisted(() => vi.fn());
const resolveOpenMeldProfileByIdOrNameMock = vi.hoisted(() => vi.fn());
const resolveOpenMeldProfileOrNullMock = vi.hoisted(() => vi.fn());
const listAccountSpaceIndexMock = vi.hoisted(() => vi.fn());
const listProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
const updateProfileSpaceHistoryStatusMock = vi.hoisted(() => vi.fn());
const fetchSpaceRequestWithTimeoutMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn());
const promptSearchSelectMock = vi.hoisted(() => vi.fn());
const promptSearchMultiselectMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const canUseInteractivePromptsMock = vi.hoisted(() => vi.fn());

type RecordedFetchRequest = {
  url: string;
  init?: RequestInit;
};

let sharedFetchRequests: RecordedFetchRequest[] = [];
let sharedFetchImplementation: (
  request: RecordedFetchRequest
) => Promise<Response>;

async function forwardToSharedFetch(input: {
  url: string;
  init?: RequestInit;
}): Promise<Response> {
  const request: RecordedFetchRequest = {
    url: input.url,
    init: input.init,
  };
  sharedFetchRequests.push(request);
  return await sharedFetchImplementation(request);
}

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

vi.mock("../src/config/openmeld-profiles-api", () => {
  return {
    listOpenMeldProfiles: (...args: unknown[]) =>
      listOpenMeldProfilesMock(...args),
    resolveOpenMeldProfileByIdOrName: (...args: unknown[]) =>
      resolveOpenMeldProfileByIdOrNameMock(...args),
  };
});

vi.mock("../src/config/resolve-openmeld-profile", () => {
  return {
    resolveOpenMeldProfileOrNull: (...args: unknown[]) =>
      resolveOpenMeldProfileOrNullMock(...args),
  };
});

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (...args: unknown[]) =>
      getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/config/account-space-index-api", () => {
  return {
    listAccountSpaceIndex: (...args: unknown[]) =>
      listAccountSpaceIndexMock(...args),
  };
});

vi.mock("../src/config/profile-space-history-api", () => {
  class MockProfileSpaceHistoryApiError extends Error {
    readonly status: number | null;
    readonly code: string | null;
    readonly endpoint: string;
    readonly canFallbackToLocal: boolean;

    constructor(input: {
      message: string;
      status?: number | null;
      code?: string | null;
      endpoint?: string;
      canFallbackToLocal?: boolean;
    }) {
      super(input.message);
      this.name = "ProfileSpaceHistoryApiError";
      this.status =
        typeof input.status === "number" ? Math.trunc(input.status) : null;
      this.code = input.code ?? null;
      this.endpoint = input.endpoint ?? "mock-endpoint";
      this.canFallbackToLocal = input.canFallbackToLocal === true;
    }
  }

  return {
    listProfileSpaceHistory: (...args: unknown[]) =>
      listProfileSpaceHistoryMock(...args),
    upsertProfileSpaceHistory: vi.fn(),
    updateProfileSpaceHistoryStatus: (...args: unknown[]) =>
      updateProfileSpaceHistoryStatusMock(...args),
    resolveGatewayHost: vi.fn(() => "gateway.openmeld.invalid"),
    ProfileSpaceHistoryApiError: MockProfileSpaceHistoryApiError,
  };
});

vi.mock("../src/space/fetch-with-timeout", () => {
  return {
    fetchSpaceRequestWithTimeout: (...args: unknown[]) =>
      fetchSpaceRequestWithTimeoutMock(...args),
    resolveSpaceRequestTimeoutMsForDiagnostics: vi.fn(() => 10_000),
  };
});

vi.mock("@clack/prompts", () => {
  return {
    cancel: vi.fn(),
    confirm: vi.fn(),
    isCancel: (value: unknown) => isCancelMock(value),
    multiselect: vi.fn(),
    password: vi.fn(),
    select: vi.fn(),
    text: vi.fn(),
  };
});

vi.mock("../src/ui/search-select", () => {
  return {
    promptSearchSelect: (...args: unknown[]) => promptSearchSelectMock(...args),
    promptSearchMultiselect: (...args: unknown[]) =>
      promptSearchMultiselectMock(...args),
    promptSearchMultiselectWorkbench: vi.fn(),
  };
});

vi.mock("../src/runtime/interaction", () => {
  return {
    canUseInteractivePrompts: (...args: unknown[]) =>
      canUseInteractivePromptsMock(...args),
  };
});

describe("space remove-members", () => {
  beforeEach(() => {
    const profiles = [
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: CREATOR_PROFILE_ID,
        profileName: "space-host",
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: MEMBER_ONE_ID,
        profileName: "my-claude",
        profileKind: "agent",
        ownerName: OWNER_NAME_OPAQUE,
      }),
      buildProfile({
        openMeldProfileId: MEMBER_TWO_ID,
        profileName: "my-codex",
        profileKind: "agent",
        ownerName: OWNER_NAME_OPAQUE,
      }),
      buildProfile({
        openMeldProfileId: MEMBER_THREE_ID,
        profileName: "my-gemini",
        profileKind: "agent",
        ownerName: OWNER_NAME_OPAQUE,
      }),
    ];

    resolveOpenMeldProfileOrNullMock.mockResolvedValue(profiles[0]);
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [],
    });
    resolveOpenMeldProfileByIdOrNameMock.mockImplementation(
      (input: { profileIdentifier?: string }) => {
        const identifier = String(input.profileIdentifier ?? "").trim();
        const profile = profiles.find(
          (candidate) =>
            candidate.openMeldProfileId === identifier ||
            candidate.profileName === identifier ||
            candidate.profileHandle === identifier
        );
        if (!profile) {
          return Promise.reject(new Error(`profile not found: ${identifier}`));
        }
        return Promise.resolve(profile);
      }
    );
    listOpenMeldProfilesMock.mockResolvedValue(profiles);
    listProfileSpaceHistoryMock.mockResolvedValue([]);
    updateProfileSpaceHistoryStatusMock.mockResolvedValue({
      profileId: MEMBER_ONE_ID,
      gatewayHost: "gateway.openmeld.invalid",
      spaceId: SPACE_ID,
      status: "removed",
      updatedAt: "2026-03-06T00:00:00.000Z",
    });
    getAuthSessionStateMock.mockReset().mockResolvedValue(VALID_AUTH_STATE);
    isCancelMock.mockReset().mockReturnValue(false);
    promptSearchSelectMock.mockReset();
    promptSearchMultiselectMock.mockReset();
    canUseInteractivePromptsMock.mockReset().mockReturnValue(false);

    sharedFetchRequests = [];
    sharedFetchImplementation = (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
        method === "GET"
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify(
              buildSpaceMembersSnapshot({
                humans: [
                  buildHumanSpaceMemberSnapshot({
                    profileId: CREATOR_PROFILE_ID,
                    profileName: "space-host",
                    memberSource: "space_creator",
                  }),
                ],
                agents: [
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: MEMBER_ONE_ID,
                    profileName: "my-claude",
                  }),
                  buildWakeableAgentSpaceMemberSnapshot({
                    profileId: MEMBER_TWO_ID,
                    profileName: "my-codex",
                  }),
                ],
              })
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );
      }
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
        method === "POST"
      ) {
        const body = JSON.parse(String(request.init?.body ?? "{}")) as {
          text?: string;
        };
        return Promise.resolve(createPostSignalResponse(body.text ?? ""));
      }
      return Promise.reject(
        new Error(`Unexpected shared request: ${method} ${request.url}`)
      );
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = toRecordedFetchRequest(input, init);
      sharedFetchRequests.push(request);
      return await sharedFetchImplementation(request);
    });

    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
          body?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members/remove`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                removedMemberIds: [MEMBER_ONE_ID],
                alreadyAbsentMemberIds: [],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return forwardToSharedFetch(input);
      }
    );
  });

  it("rejects conflicting member selectors", async () => {
    await withTempHome(async () => {
      await expect(
        withSilencedStdio(async () =>
          runSpaceRemoveMembers({
            all: true,
            members: [MEMBER_ONE_ID],
            space: SPACE_ID,
            view: "human",
          })
        )
      ).rejects.toThrow(
        "`openmeld space remove-members`: use either --member <profile-id...> or --all, not both"
      );
    });
  });

  it("uses cloud AccountSpaces instead of local cache when prompting for a remove-members Space", async () => {
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          openProfileId: CURRENT_PROFILE_ID,
          openProfileName: OWNER_PROFILE_NAME,
          spaceId: SPACE_ID,
          spaceName: "Cloud Mission Control",
        }),
      ],
    });
    canUseInteractivePromptsMock.mockReturnValue(true);
    promptSearchSelectMock.mockResolvedValue({
      status: "submitted",
      value: "known:0",
    });

    await withTempHome(async (home) => {
      const staleCacheDir = join(
        home,
        ".openmeld",
        "accounts",
        "auth.openmeld.invalid",
        "user-1",
        "profiles",
        CURRENT_PROFILE_ID,
        "space-cache"
      );
      await mkdir(staleCacheDir, { recursive: true });
      await writeFile(join(staleCacheDir, "broken.json"), "{", "utf8");

      await withSilencedStdio(async () => {
        await runSpaceRemoveMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          members: [MEMBER_ONE_ID],
          view: "human",
        });
      });
    });

    expect(listAccountSpaceIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://gateway.openmeld.invalid",
        scope: "profile",
        selectedProfileId: CURRENT_PROFILE_ID,
      })
    );
    expect(listProfileSpaceHistoryMock).not.toHaveBeenCalled();
    expect(promptSearchSelectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Choose a space to remove members",
        items: expect.arrayContaining([
          expect.objectContaining({
            label: "Cloud Mission Control",
            value: "known:0",
          }),
        ]),
      })
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("persists one member-removed notice per successfully removed member and syncs profile-space-history", async () => {
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
        method === "GET"
      ) {
        return new Response(
          JSON.stringify(
            buildSpaceMembersSnapshot({
              humans: [
                buildHumanSpaceMemberSnapshot({
                  profileId: CREATOR_PROFILE_ID,
                  profileName: "space-host",
                  memberSource: "space_creator",
                }),
              ],
              agents: [
                buildWakeableAgentSpaceMemberSnapshot({
                  profileId: MEMBER_ONE_ID,
                  profileName: "my-claude",
                  mentionAlias: "claude-alias",
                }),
                buildWakeableAgentSpaceMemberSnapshot({
                  profileId: MEMBER_TWO_ID,
                  profileName: "my-claude",
                }),
              ],
            })
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return await defaultSharedFetchImplementation(request);
    };

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceRemoveMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          view: "human",
        });
      });
    });

    const membersDelete = fetchSpaceRequestWithTimeoutMock.mock.calls
      .map(
        (call) =>
          call[0] as { url: string; init?: { method?: string; body?: string } }
      )
      .find(
        (request) =>
          request.url.includes(`/v1/spaces/${SPACE_ID}/members/remove`) &&
          String(request.init?.method ?? "").toUpperCase() === "POST"
      );
    expect(membersDelete).toBeDefined();
    expect(
      JSON.parse(String(membersDelete?.init?.body ?? "{}")) as {
        memberProfileIds?: string[];
      }
    ).toEqual({
      memberProfileIds: [MEMBER_ONE_ID],
    });

    expect(updateProfileSpaceHistoryStatusMock).toHaveBeenCalledWith({
      baseUrl: "https://gateway.openmeld.invalid",
      requestContext: {
        actorContext: {
          requestId: expect.any(String),
          openMeldProfileId: MEMBER_ONE_ID,
          profileKind: "agent",
          profileHandle: "my-claude",
          profileName: "my-claude",
          ownerUserId: "user-felix",
          ownerName: OWNER_NAME_OPAQUE,
        },
      },
      openMeldProfileId: MEMBER_ONE_ID,
      profileName: "my-claude",
      spaceId: SPACE_ID,
      body: {
        gatewayHost: "gateway.openmeld.invalid",
        status: "removed",
        reason: "removed_by_member",
      },
    });

    const signalPosts = sharedFetchRequests.filter(
      (request) =>
        request.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
        String(request.init?.method ?? "").toUpperCase() === "POST"
    );
    expect(signalPosts).toHaveLength(1);
    const payload = JSON.parse(String(signalPosts[0]?.init?.body ?? "{}")) as {
      text?: string;
      meta?: {
        purpose?: string;
        targetProfileId?: string;
        targetProfileName?: string;
        targetMentionLabel?: string;
        removedByProfileId?: string;
        removedByDisplayName?: string;
      };
      type?: string;
      data?: unknown;
    };
    expect(payload.text).toBe(
      "felix-owner-profile removed 🤖 my-claude from this space."
    );
    expect(payload.meta).toMatchObject({
      purpose: "space_membership_remove_notice",
      targetProfileId: MEMBER_ONE_ID,
      targetProfileName: "my-claude",
      targetMentionLabel: "claude-alias",
      removedByProfileId: CURRENT_PROFILE_ID,
      removedByDisplayName: OWNER_PROFILE_NAME,
    });
    expect(payload.type).toBeUndefined();
    expect(payload.data).toBeUndefined();
  });

  it("does not persist a mention label for remove notices when the removed member is human", async () => {
    const HUMAN_MEMBER_ID = "22222222-2222-4222-8222-222222222222";
    const HUMAN_MEMBER_HANDLE = "alice-writer";
    const HUMAN_MEMBER_NAME = "Alice Writer";

    listOpenMeldProfilesMock.mockResolvedValue([
      buildProfile({
        openMeldProfileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: CREATOR_PROFILE_ID,
        profileName: "space-host",
        profileKind: "human",
      }),
      buildProfile({
        openMeldProfileId: HUMAN_MEMBER_ID,
        profileName: HUMAN_MEMBER_HANDLE,
        profileKind: "human",
      }),
    ]);
    updateProfileSpaceHistoryStatusMock.mockResolvedValue({
      profileId: HUMAN_MEMBER_ID,
      gatewayHost: "gateway.openmeld.invalid",
      spaceId: SPACE_ID,
      status: "removed",
      updatedAt: "2026-03-06T00:00:00.000Z",
    });
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
        method === "GET"
      ) {
        return new Response(
          JSON.stringify(
            buildSpaceMembersSnapshot({
              humans: [
                buildHumanSpaceMemberSnapshot({
                  profileId: CREATOR_PROFILE_ID,
                  profileName: "space-host",
                  memberSource: "space_creator",
                }),
                buildHumanSpaceMemberSnapshot({
                  profileId: HUMAN_MEMBER_ID,
                  profileName: HUMAN_MEMBER_NAME,
                  memberSource: "added_by_member",
                }),
              ],
              agents: [],
            })
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return await defaultSharedFetchImplementation(request);
    };
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
          body?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members/remove`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                removedMemberIds: [HUMAN_MEMBER_ID],
                alreadyAbsentMemberIds: [],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceRemoveMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [HUMAN_MEMBER_ID],
          view: "human",
        });
      });
    });

    expect(updateProfileSpaceHistoryStatusMock).toHaveBeenCalledWith({
      baseUrl: "https://gateway.openmeld.invalid",
      requestContext: {
        actorContext: {
          requestId: expect.any(String),
          openMeldProfileId: HUMAN_MEMBER_ID,
          profileKind: "human",
          profileHandle: HUMAN_MEMBER_HANDLE,
          profileName: HUMAN_MEMBER_NAME,
          ownerUserId: "user-felix",
          ownerName: OWNER_PROFILE_NAME,
        },
      },
      openMeldProfileId: HUMAN_MEMBER_ID,
      profileName: HUMAN_MEMBER_NAME,
      spaceId: SPACE_ID,
      body: {
        gatewayHost: "gateway.openmeld.invalid",
        status: "removed",
        reason: "removed_by_member",
      },
    });

    const signalPost = sharedFetchRequests.find(
      (request) =>
        request.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
        String(request.init?.method ?? "").toUpperCase() === "POST"
    );
    const payload = JSON.parse(String(signalPost?.init?.body ?? "{}")) as {
      meta?: {
        targetMentionLabel?: string;
        targetProfileHandle?: string;
      };
    };
    expect(payload.meta?.targetMentionLabel).toBe(HUMAN_MEMBER_NAME);
    expect(payload.meta?.targetProfileHandle).toBeUndefined();
  });

  it("renders a compact human success card and keeps already-absent members visible", async () => {
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
        method === "GET"
      ) {
        return new Response(
          JSON.stringify(
            buildSpaceMembersSnapshot({
              humans: [],
              agents: [
                buildWakeableAgentSpaceMemberSnapshot({
                  profileId: MEMBER_ONE_ID,
                  profileName: "my-claude",
                }),
              ],
            })
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      return await defaultSharedFetchImplementation(request);
    };
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
          body?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members/remove`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                removedMemberIds: [MEMBER_ONE_ID],
                alreadyAbsentMemberIds: [MEMBER_TWO_ID],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceRemoveMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID, MEMBER_TWO_ID],
          view: "human",
        })
      )
    );

    const plainStdout = stripAnsi(captured.stdout);
    expect(plainStdout).toContain("Removed from This Space");
    expect(plainStdout).toContain("my-claude (agent)");
    expect(plainStdout).toContain("Already absent: my-codex (agent)");
    expect(plainStdout).toContain("Broadcast 1 removal notice");
  });

  it("rejects removing the current profile", async () => {
    await withTempHome(async () => {
      await expect(
        runSpaceRemoveMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [CURRENT_PROFILE_ID],
          view: "agent",
        })
      ).rejects.toMatchObject({
        code: "space.remove_members.current_profile_forbidden",
      });
    });
  });

  it("rejects removing the space creator", async () => {
    resolveOpenMeldProfileOrNullMock.mockResolvedValue(
      buildProfile({
        openMeldProfileId: MEMBER_TWO_ID,
        profileName: "my-codex",
        profileKind: "agent",
        ownerName: OWNER_NAME_OPAQUE,
      })
    );

    await withTempHome(async () => {
      await expect(
        runSpaceRemoveMembers({
          profile: MEMBER_TWO_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [CREATOR_PROFILE_ID],
          view: "agent",
        })
      ).rejects.toMatchObject({
        code: "space.remove_members.creator_forbidden",
      });
    });
  });

  it("keeps remove-notice partial failure visible in agent output", async () => {
    resolveOpenMeldProfileOrNullMock.mockResolvedValue(
      buildProfile({
        openMeldProfileId: MEMBER_TWO_ID,
        profileName: "my-codex",
        profileKind: "agent",
        ownerName: OWNER_NAME_OPAQUE,
      })
    );
    let signalPostCount = 0;
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
        method === "GET"
      ) {
        return new Response(
          JSON.stringify(
            buildSpaceMembersSnapshot({
              humans: [],
              agents: [
                buildWakeableAgentSpaceMemberSnapshot({
                  profileId: MEMBER_ONE_ID,
                  profileName: "my-claude",
                }),
                buildWakeableAgentSpaceMemberSnapshot({
                  profileId: MEMBER_THREE_ID,
                  profileName: "my-gemini",
                }),
              ],
            })
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
        method === "POST"
      ) {
        signalPostCount += 1;
        const body = JSON.parse(String(request.init?.body ?? "{}")) as {
          text?: string;
        };
        if (signalPostCount === 2) {
          return createGatewayErrorResponse({
            code: "space.not_found",
            message: "space not found",
            requestId: "req-remove-notice",
            status: 404,
          });
        }
        return createPostSignalResponse(body.text ?? "");
      }
      return await defaultSharedFetchImplementation(request);
    };
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
          body?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members/remove`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                removedMemberIds: [MEMBER_ONE_ID, MEMBER_THREE_ID],
                alreadyAbsentMemberIds: [],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceRemoveMembers({
          profile: MEMBER_TWO_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID, MEMBER_THREE_ID],
          view: "agent",
        })
      )
    );

    const resultEnvelope = parseJsonLines(captured.stdout).find(
      (line) => line.code === "space.remove_members"
    );
    expect(resultEnvelope?.payload).toMatchObject({
      removeNotice: {
        recordedCount: 1,
        failedCount: 1,
        firstFailure: {
          code: "space.not_found",
          message: "space not found",
          requestId: "req-remove-notice",
          status: 404,
        },
      },
    });

    const signalPosts = sharedFetchRequests.filter(
      (request) =>
        request.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
        String(request.init?.method ?? "").toUpperCase() === "POST"
    );
    const secondSignalBody = JSON.parse(
      String(signalPosts[1]?.init?.body ?? "{}")
    ) as {
      text?: string;
      meta?: { purpose?: string; targetProfileId?: string };
      type?: string;
      data?: unknown;
    };
    expect(secondSignalBody).toMatchObject({
      text: "my-codex removed 🤖 my-gemini from this space.",
      meta: {
        purpose: "space_membership_remove_notice",
        targetProfileId: MEMBER_THREE_ID,
      },
    });
    expect(secondSignalBody.type).toBeUndefined();
    expect(secondSignalBody.data).toBeUndefined();
  });

  it("renders clean human remove-notice failures with request id", async () => {
    let signalPostCount = 0;
    const defaultSharedFetchImplementation = sharedFetchImplementation;
    sharedFetchImplementation = async (request) => {
      const method = String(request.init?.method ?? "GET").toUpperCase();
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/members`) &&
        method === "GET"
      ) {
        return new Response(
          JSON.stringify(
            buildSpaceMembersSnapshot({
              humans: [
                buildHumanSpaceMemberSnapshot({
                  profileId: CREATOR_PROFILE_ID,
                  profileName: "space-host",
                  memberSource: "space_creator",
                }),
              ],
              agents: [
                buildWakeableAgentSpaceMemberSnapshot({
                  profileId: MEMBER_ONE_ID,
                  profileName: "my-claude",
                }),
              ],
            })
          ),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }
      if (
        request.url.includes(`/v1/spaces/${SPACE_ID}/signals`) &&
        method === "POST"
      ) {
        signalPostCount += 1;
        const body = JSON.parse(String(request.init?.body ?? "{}")) as {
          text?: string;
        };
        if (signalPostCount === 1) {
          return createGatewayErrorResponse({
            code: "space.not_found",
            message: "space not found",
            requestId: "req-human-remove-notice",
            status: 404,
          });
        }
        return createPostSignalResponse(body.text ?? "");
      }
      return await defaultSharedFetchImplementation(request);
    };
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: {
        url: string;
        init?: {
          method?: string;
          body?: string;
        };
      }) => {
        const method = String(input.init?.method ?? "GET").toUpperCase();
        if (
          input.url.includes(`/v1/spaces/${SPACE_ID}/members/remove`) &&
          method === "POST"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                removedMemberIds: [MEMBER_ONE_ID],
                alreadyAbsentMemberIds: [],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return forwardToSharedFetch(input);
      }
    );

    const captured = await withTempHome(async () =>
      withCapturedStdio(async () =>
        runSpaceRemoveMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          members: [MEMBER_ONE_ID],
          view: "human",
        })
      )
    );

    const visibleOutput = stripAnsi(captured.stdout);
    expect(visibleOutput).toContain(
      "OpenMeld updated the Space members, but couldn't post 1 removal notice. The membership change is already saved."
    );
    expect(visibleOutput).not.toContain("req-human-remove-notice");
    expect(visibleOutput).not.toContain("space not found");
    expect(visibleOutput).not.toContain("HTTP 404:");
  });

  it("uses a searchable prompt for human member removal selection", async () => {
    canUseInteractivePromptsMock.mockReturnValue(true);
    promptSearchMultiselectMock.mockResolvedValue({
      status: "submitted",
      value: [MEMBER_ONE_ID],
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceRemoveMembers({
          profile: CURRENT_PROFILE_ID,
          baseUrl: "https://gateway.openmeld.invalid",
          space: SPACE_ID,
          view: "human",
        });
      });
    });

    expect(promptSearchMultiselectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Choose at least one member to remove from this space",
        required: true,
        maxVisible: 8,
      })
    );
    const membersPrompt = promptSearchMultiselectMock.mock.calls[0]?.[0] as
      | {
          items?: Array<{ label?: string; detail?: string; value?: string }>;
        }
      | undefined;
    const memberLabels = (membersPrompt?.items ?? [])
      .map((item) => [item.label ?? "", item.detail ?? ""].join("\n"))
      .join("\n");
    expect(memberLabels).toContain("my-claude (agent)");
    expect(memberLabels).toContain(MEMBER_ONE_ID);
  });
});

function createAccountSpaceIndexItem(
  input: Partial<AccountSpaceIndexItem> = {}
): AccountSpaceIndexItem {
  const openProfileId = input.openProfileId ?? CURRENT_PROFILE_ID;
  const openProfileName = input.openProfileName ?? OWNER_PROFILE_NAME;
  const lastJoinedAt = input.lastJoinedAt ?? "2026-03-06T00:00:00.000Z";
  return {
    creatorKind: input.creatorKind ?? "human",
    creatorOwnerUserId: input.creatorOwnerUserId ?? "user-1",
    creatorProfileId: input.creatorProfileId ?? CREATOR_PROFILE_ID,
    creatorProfileName: input.creatorProfileName ?? "space-host",
    gatewayHost: input.gatewayHost ?? "gateway.openmeld.invalid",
    joinedProfiles: input.joinedProfiles ?? [
      {
        lastJoinedAt,
        pinnedAt: input.pinnedAt ?? null,
        profileId: openProfileId,
        profileName: openProfileName,
      },
    ],
    lastJoinedAt,
    lastSeenTs: input.lastSeenTs ?? 321,
    openProfileId,
    openProfileName,
    organizationId: input.organizationId ?? "org-1",
    pinnedAt: input.pinnedAt ?? null,
    pinnedProfileIds: input.pinnedProfileIds ?? [],
    spaceCreatedAt: input.spaceCreatedAt ?? "2026-03-06T00:00:00.000Z",
    spaceId: input.spaceId ?? SPACE_ID,
    spaceName: input.spaceName ?? "Cloud Mission Control",
    spaceUpdatedAt: input.spaceUpdatedAt ?? "2026-03-06T00:00:00.000Z",
    status: input.status ?? "active",
    updatedAt: input.updatedAt ?? "2026-03-06T00:00:00.000Z",
    visibility: input.visibility ?? "private",
  };
}

function parseJsonLines(output: string | null): Array<{
  code?: string;
  payload?: Record<string, unknown>;
}> {
  return String(output ?? "")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(
      (line) =>
        JSON.parse(line) as {
          code?: string;
          payload?: Record<string, unknown>;
        }
    );
}

function buildProfile(input: {
  openMeldProfileId: string;
  profileName: string;
  profileKind: "human" | "agent" | "system";
  ownerName?: string;
}) {
  return {
    openMeldProfileId: input.openMeldProfileId,
    profileHandle: input.profileName,
    profileName: input.profileName,
    profileKind: input.profileKind,
    status: "active",
    ownerUserId: "user-felix",
    ownerName: input.ownerName ?? OWNER_PROFILE_NAME,
    source: "cli_test",
    createdByUserId: "user-felix",
    lastUsedAt: null,
    createdAt: "2026-03-05T00:00:00.000Z",
    updatedAt: "2026-03-05T00:00:00.000Z",
  } as const;
}

function buildSpaceMembersSnapshot(input: {
  humans: ReturnType<typeof buildHumanSpaceMemberSnapshot>[];
  agents: ReturnType<typeof buildWakeableAgentSpaceMemberSnapshot>[];
}) {
  return createSpaceMembersSnapshot({
    spaceId: SPACE_ID,
    generatedAt: "2026-03-06T00:00:00.000Z",
    humans: input.humans,
    agents: input.agents,
  });
}

function createPostSignalResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      v: 1,
      id: "sig-1",
      spaceId: SPACE_ID,
      ts: 1,
      profile: {
        kind: "human",
        profileId: CURRENT_PROFILE_ID,
        profileName: OWNER_PROFILE_NAME,
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

function createGatewayErrorResponse(input: {
  code: string;
  message: string;
  requestId: string;
  status: number;
}): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: input.code,
        message: input.message,
        requestId: input.requestId,
      },
    }),
    {
      status: input.status,
      headers: {
        "content-type": "application/json",
        "x-openmeld-request-id": input.requestId,
      },
    }
  );
}

function buildHumanSpaceMemberSnapshot(input: {
  profileId: string;
  profileName: string;
  memberSource: "space_creator" | "added_by_member";
}) {
  return createSpaceMemberHumanSnapshot({
    profileId: input.profileId,
    profileName: input.profileName,
    mentionAlias: null,
    status: "active" as const,
    memberSource: input.memberSource,
    memberSourceLabel:
      input.memberSource === "space_creator"
        ? "Space creator"
        : `Added by ${OWNER_PROFILE_NAME}`,
    addedAt: "2026-03-06T00:00:00.000Z",
    removedAt: null,
    createdAt: "2026-03-06T00:00:00.000Z",
    updatedAt: "2026-03-06T00:00:00.000Z",
    addedByProfileId:
      input.memberSource === "space_creator" ? null : CURRENT_PROFILE_ID,
    addedByOwnerUserId:
      input.memberSource === "space_creator" ? null : "user-felix",
    addedByDisplayName:
      input.memberSource === "space_creator" ? null : OWNER_PROFILE_NAME,
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: null,
    lastSeenLabel: null,
    liveNow: false,
    ownerUserId: "user-felix",
    ownerName: OWNER_PROFILE_NAME,
  });
}

function buildWakeableAgentSpaceMemberSnapshot(input: {
  profileId: string;
  profileName: string;
  mentionAlias?: string | null;
}) {
  return createSpaceMemberAgentSnapshot({
    profileId: input.profileId,
    profileName: input.profileName,
    mentionAlias: input.mentionAlias ?? null,
    status: "active" as const,
    memberSource: "added_by_member" as const,
    memberSourceLabel: `Added by ${OWNER_PROFILE_NAME}`,
    addedAt: "2026-03-06T00:00:00.000Z",
    removedAt: null,
    createdAt: "2026-03-06T00:00:00.000Z",
    updatedAt: "2026-03-06T00:00:00.000Z",
    addedByProfileId: CURRENT_PROFILE_ID,
    addedByOwnerUserId: "user-felix",
    addedByDisplayName: OWNER_PROFILE_NAME,
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: null,
    lastSeenLabel: null,
    liveNow: false,
    ownerUserId: "user-felix",
    ownerName: OWNER_NAME_OPAQUE,
    agentControllerRef: `builtin:${input.profileName}`,
    agentControllerConversationId: null,
    wakeRouteEvidence: READY_DAEMON_ROUTE_OBSERVATION,
    wakeabilityStatus: "ready",
  });
}

function toRecordedFetchRequest(
  input: string | URL | Request,
  init?: RequestInit
): RecordedFetchRequest {
  if (typeof input === "string" || input instanceof URL) {
    return {
      url: String(input),
      init,
    };
  }

  return {
    url: input.url,
    init: {
      method: init?.method ?? input.method,
      headers: init?.headers ?? Object.fromEntries(input.headers.entries()),
      body: init?.body,
      signal: init?.signal ?? input.signal,
    },
  };
}
