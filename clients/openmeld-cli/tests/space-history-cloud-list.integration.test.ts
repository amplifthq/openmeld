import type { AccountSpaceIndexItem } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const listAccountSpaceIndexMock = vi.hoisted(() => vi.fn());
const listProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
const querySpaceDeletionTombstonesMock = vi.hoisted(() => vi.fn());
const updateProfileSpaceHistoryStatusMock = vi.hoisted(() => vi.fn());
const listOpenMeldProfilesMock = vi.hoisted(() => vi.fn());
const promptSearchSelectMock = vi.hoisted(() => vi.fn());
const promptTextEntryMock = vi.hoisted(() => vi.fn());
const emitSpaceCommandPreflightMock = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => {
  return {
    cancel: vi.fn(),
    confirm: vi.fn(),
    isCancel: vi.fn(() => false),
    select: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      clear: vi.fn(),
    })),
    text: vi.fn(),
  };
});

vi.mock("../src/ui/search-select", () => {
  return {
    promptSearchMultiselectWorkbench: vi.fn(),
    promptSearchSelect: (...args: Parameters<typeof promptSearchSelectMock>) =>
      promptSearchSelectMock(...args),
  };
});

vi.mock("../src/ui/text-entry", () => {
  return {
    promptTextEntry: (...args: Parameters<typeof promptTextEntryMock>) =>
      promptTextEntryMock(...args),
  };
});

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

vi.mock("../src/space/connect", () => {
  return {
    runConnect: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../src/space/preflight", () => ({
  emitSpaceCommandPreflight: (
    ...args: Parameters<typeof emitSpaceCommandPreflightMock>
  ) => emitSpaceCommandPreflightMock(...args),
  emitResolvedSpaceCommandPreflight: vi.fn(),
  emitSpaceFailureNextStep: vi.fn(),
  resolveSpaceFailureGuidance: vi.fn(),
}));

vi.mock("../src/config/account-space-index-api", () => ({
  listAccountSpaceIndex: (
    ...args: Parameters<typeof listAccountSpaceIndexMock>
  ) => listAccountSpaceIndexMock(...args),
}));

vi.mock("../src/config/profile-space-history-api", () => {
  class ProfileSpaceHistoryApiError extends Error {
    readonly status: number | null;
    readonly code: string | null;
    readonly endpoint: string;
    readonly canFallbackToLocal: boolean;

    constructor(input: {
      message: string;
      endpoint: string;
      status?: number | null;
      code?: string | null;
      canFallbackToLocal?: boolean;
    }) {
      super(input.message);
      this.name = "ProfileSpaceHistoryApiError";
      this.status = input.status ?? null;
      this.code = input.code ?? null;
      this.endpoint = input.endpoint;
      this.canFallbackToLocal = input.canFallbackToLocal === true;
    }
  }

  return {
    ProfileSpaceHistoryApiError,
    listProfileSpaceHistory: (
      ...args: Parameters<typeof listProfileSpaceHistoryMock>
    ) => listProfileSpaceHistoryMock(...args),
    upsertProfileSpaceHistory: vi.fn(),
    updateProfileSpaceHistoryStatus: (
      ...args: Parameters<typeof updateProfileSpaceHistoryStatusMock>
    ) => updateProfileSpaceHistoryStatusMock(...args),
  };
});

vi.mock("../src/config/space-deletion-tombstone-api", () => {
  return {
    querySpaceDeletionTombstones: (
      ...args: Parameters<typeof querySpaceDeletionTombstonesMock>
    ) => querySpaceDeletionTombstonesMock(...args),
    upsertSpaceDeletionTombstone: vi.fn(),
  };
});

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const toProfile = (openMeldProfileId: string) => {
    const isHuman = openMeldProfileId.toLowerCase().includes("mira");
    const isDefault = openMeldProfileId.toLowerCase().includes("main");
    return {
      openMeldProfileId,
      profileName: isHuman ? "Mira" : "Codex",
      profileKind: isHuman ? "human" : "agent",
      isDefault,
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      lastUsedAt: null,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
    } as const;
  };

  return {
    requireOpenMeldProfile: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
        toProfile(String(openMeldProfileId ?? "default"))
    ),
    resolveOpenMeldProfileOrNull: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
        toProfile(String(openMeldProfileId ?? "default"))
    ),
  };
});

vi.mock("../src/config/openmeld-profiles-api", () => {
  const toProfile = (openMeldProfileId: string) => {
    const isHuman = openMeldProfileId.toLowerCase().includes("mira");
    const isDefault = openMeldProfileId.toLowerCase().includes("main");
    return {
      openMeldProfileId,
      profileName: isHuman ? "Mira" : "Codex",
      profileKind: isHuman ? "human" : "agent",
      isDefault,
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      lastUsedAt: null,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
    } as const;
  };

  return {
    listOpenMeldProfiles: (
      ...args: Parameters<typeof listOpenMeldProfilesMock>
    ) => listOpenMeldProfilesMock(...args),
    resolveOpenMeldProfileByIdOrName: vi.fn(
      async ({ profileIdentifier }: { profileIdentifier?: string }) =>
        toProfile(String(profileIdentifier ?? "default"))
    ),
  };
});

import { select } from "@clack/prompts";
import { runSpaceJoin, runSpaceWatch } from "../src/space/command";
import { runConnect } from "../src/space/connect";
import { upsertSpaceConfig } from "../src/space/local-state";
import { withSilencedStdio, withTempHome } from "./helpers/fs";

const SPACE_ID_ALPHA =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SPACE_ID_BETA =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const SPACE_ID_CA_DM =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SPACE_ID_WELCOMING =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HUMAN_PROFILE = "mira--history-cloud";
const MAIN_HUMAN_PROFILE = "mira-main-history-cloud";
const AGENT_PROFILE = "codex--history-cloud";
const EXPLICIT_BASE_URL = "https://gateway.testing.example";
const HUMAN_RUNTIME_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.testing.example",
    clientId: "openmeld-cli",
    createdAt: "2026-03-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

function createAccountSpaceIndexItem(
  input: Partial<AccountSpaceIndexItem> = {}
): AccountSpaceIndexItem {
  const openProfileId = input.openProfileId ?? HUMAN_PROFILE;
  const openProfileName = input.openProfileName ?? "Mira";
  const lastJoinedAt = input.lastJoinedAt ?? "2026-02-20T02:00:00.000Z";
  return {
    creatorKind: input.creatorKind ?? "human",
    creatorOwnerUserId: input.creatorOwnerUserId ?? "user-1",
    creatorProfileId: input.creatorProfileId ?? HUMAN_PROFILE,
    creatorProfileName: input.creatorProfileName ?? "Mira",
    gatewayHost: input.gatewayHost ?? "gateway.testing.example",
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
    spaceCreatedAt: input.spaceCreatedAt ?? "2026-02-20T00:00:00.000Z",
    spaceId: input.spaceId ?? SPACE_ID_ALPHA,
    spaceName: input.spaceName ?? "Mission Control",
    spaceUpdatedAt: input.spaceUpdatedAt ?? "2026-02-20T01:00:00.000Z",
    status: input.status ?? "active",
    updatedAt: input.updatedAt ?? "2026-02-20T02:00:00.000Z",
    visibility: input.visibility ?? "private",
  };
}

function emptyAccountSpaceIndex() {
  return { pinnedItems: [], spaceItems: [] };
}

function createSpaceMetaPayload(spaceId: string) {
  return {
    spaceId,
    organizationId: "org-1",
    visibility: "private",
  };
}

function getLegacyListDependencyCallCounts(): {
  listProfileSpaceHistory: number;
  querySpaceDeletionTombstones: number;
  updateProfileSpaceHistoryStatus: number;
} {
  return {
    listProfileSpaceHistory: listProfileSpaceHistoryMock.mock.calls.length,
    querySpaceDeletionTombstones:
      querySpaceDeletionTombstonesMock.mock.calls.length,
    updateProfileSpaceHistoryStatus:
      updateProfileSpaceHistoryStatusMock.mock.calls.length,
  };
}

describe("space selection cloud history list", () => {
  beforeEach(() => {
    const selectMock = vi.mocked(select);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-20T02:30:00.000Z"));
    selectMock.mockReset();
    selectMock.mockImplementation((input: unknown) => {
      const prompt = input as { message?: string } | undefined;
      if (prompt?.message === "Bring your agents or other profiles with you?") {
        return Promise.resolve("no");
      }
      return Promise.resolve(undefined);
    });
    getAuthSessionStateMock.mockReset();
    listAccountSpaceIndexMock.mockReset();
    listAccountSpaceIndexMock.mockResolvedValue(emptyAccountSpaceIndex());
    listProfileSpaceHistoryMock.mockReset();
    querySpaceDeletionTombstonesMock.mockReset();
    querySpaceDeletionTombstonesMock.mockResolvedValue([]);
    updateProfileSpaceHistoryStatusMock.mockReset();
    listOpenMeldProfilesMock.mockReset();
    listOpenMeldProfilesMock.mockResolvedValue([]);
    promptSearchSelectMock.mockReset();
    promptTextEntryMock.mockReset();
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
    emitSpaceCommandPreflightMock.mockReset().mockResolvedValue({
      deviceReplyReadiness: {
        reasonCodes: [],
        reasonText: "Ready",
        replyReadiness: "ready",
        updatedAt: "2026-04-11T00:00:00.000Z",
        wakeableRouteCount: 1,
      },
      payload: {},
      serviceParticipationReadiness: {
        serviceReadiness: "ready",
        summaryText: "Ready",
        detailText:
          "OpenMeld Service is running and the local service link is available on this device",
        nextStepSummary: null,
        nextSteps: [],
        runtimeHeadline: "running",
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    getAuthSessionStateMock.mockReset();
    listAccountSpaceIndexMock.mockReset();
    listProfileSpaceHistoryMock.mockReset();
    querySpaceDeletionTombstonesMock.mockReset();
    updateProfileSpaceHistoryStatusMock.mockReset();
    listOpenMeldProfilesMock.mockReset();
    promptSearchSelectMock.mockReset();
    promptTextEntryMock.mockReset();
    emitSpaceCommandPreflightMock.mockReset();
  });

  it("uses AccountSpaces options in human view and shows creator identity fields", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("history");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: "known:0",
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${SPACE_ID_ALPHA}/meta`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify(createSpaceMetaPayload(SPACE_ID_ALPHA)),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          creatorProfileId: HUMAN_PROFILE,
          openProfileId: HUMAN_PROFILE,
          spaceId: SPACE_ID_ALPHA,
          spaceName: "Mission Control",
        }),
      ],
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: HUMAN_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          view: "human",
          allowPrompt: true,
          output: "text",
        });
      });
    });

    expect(listAccountSpaceIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: EXPLICIT_BASE_URL,
        scope: "profile",
        selectedProfileId: HUMAN_PROFILE,
        limit: 500,
      })
    );
    const sourcePrompt = selectMock.mock.calls[0]?.[0] as {
      message: string;
      options: Array<{ value: string; label: string; hint?: string }>;
    };
    expect(sourcePrompt.message).toContain("Choose a space to join");
    expect(sourcePrompt.message).toContain(
      "Showing spaces for this profile only."
    );
    expect(sourcePrompt.options[0]).toEqual(
      expect.objectContaining({
        value: "history",
        label: "Choose a space you created or joined",
        hint: "1 space",
      })
    );
    expect(sourcePrompt.options[1]).toEqual(
      expect.objectContaining({
        value: "manual",
        label: "Enter a space ID manually",
      })
    );
    const historyPrompt = promptSearchSelectMock.mock.calls[0]?.[0] as {
      message: string;
      allowBack: boolean;
      backLabel: string;
      items: Array<{
        value: string;
        label: string;
        detail: string;
        searchText: string;
      }>;
    };
    expect(historyPrompt.message).toContain("Choose a space to join");
    expect(historyPrompt.message).toContain(
      "Showing spaces for this profile only."
    );
    expect(historyPrompt.allowBack).toBe(true);
    expect(historyPrompt.backLabel).toBe("Back");
    expect(historyPrompt.items[0]).toEqual(
      expect.objectContaining({
        value: "known:0",
      })
    );
    expect(historyPrompt.items[0]?.label).toBe("Mission Control");
    expect(historyPrompt.items[0]?.detail).toBe(
      "ID 01234567...abcdef · Created by Mira · joined 30m ago"
    );
    expect(historyPrompt.items[0]?.searchText).toContain(SPACE_ID_ALPHA);
    expect(historyPrompt.items[0]?.searchText).toContain(HUMAN_PROFILE);

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: HUMAN_PROFILE,
        space: SPACE_ID_ALPHA,
        baseUrl: EXPLICIT_BASE_URL,
        trackProfileSpaceHistory: true,
      })
    );
    expect(fetchSpy).toHaveBeenCalled();
    expect(getLegacyListDependencyCallCounts()).toEqual({
      listProfileSpaceHistory: 0,
      querySpaceDeletionTombstones: 0,
      updateProfileSpaceHistoryStatus: 0,
    });
  });

  it("uses the shared source and searchable picker for human watch", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("history");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: "known:0",
    });
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          creatorProfileId: HUMAN_PROFILE,
          openProfileId: HUMAN_PROFILE,
          spaceId: SPACE_ID_ALPHA,
          spaceName: "Mission Control",
        }),
      ],
    });

    const stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutIsTTY = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      await withTempHome(async () => {
        await upsertSpaceConfig({
          openMeldProfileId: HUMAN_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          space: SPACE_ID_ALPHA,
          name: "Mission Control",
          profileName: "Mira",
          creator: {
            profile: HUMAN_PROFILE,
            profileId: HUMAN_RUNTIME_PROFILE_ID,
            profileName: "Mira",
            kind: "human",
          },
          spaceCreatedAt: "2026-02-20T00:00:00.000Z",
          spaceUpdatedAt: "2026-02-20T01:00:00.000Z",
        });
        await withSilencedStdio(async () => {
          await runSpaceWatch({
            profile: HUMAN_PROFILE,
            baseUrl: EXPLICIT_BASE_URL,
            view: "human",
          });
        });
      });
    } finally {
      if (stdinIsTTY) {
        Object.defineProperty(process.stdin, "isTTY", stdinIsTTY);
      }
      if (stdoutIsTTY) {
        Object.defineProperty(process.stdout, "isTTY", stdoutIsTTY);
      }
    }

    const sourcePrompt = selectMock.mock.calls[0]?.[0] as {
      message: string;
      options: Array<{ value: string; label: string; hint?: string }>;
    };
    expect(sourcePrompt.message).toContain("Choose a space to watch");
    expect(sourcePrompt.message).toContain(
      "Showing spaces for this profile only."
    );
    expect(sourcePrompt.options).toHaveLength(2);
    expect(sourcePrompt.options[0]).toEqual(
      expect.objectContaining({
        value: "history",
        label: "Choose a space you created or joined",
        hint: "1 space",
      })
    );
    expect(sourcePrompt.options[1]).toEqual(
      expect.objectContaining({
        value: "manual",
        label: "Enter a space ID manually",
      })
    );

    const historyPrompt = promptSearchSelectMock.mock.calls[0]?.[0] as {
      message: string;
      maxVisible: number;
      allowBack: boolean;
      backLabel: string;
      items: Array<{
        value: string;
        label: string;
        detail: string;
        searchText: string;
      }>;
    };
    expect(historyPrompt.message).toContain("Choose a space to watch");
    expect(historyPrompt.message).toContain(
      "Showing spaces for this profile only."
    );
    expect(historyPrompt.maxVisible).toBe(8);
    expect(historyPrompt.allowBack).toBe(true);
    expect(historyPrompt.backLabel).toBe("Back");
    expect(historyPrompt.items).toHaveLength(1);
    expect(historyPrompt.items[0]).toEqual(
      expect.objectContaining({
        value: "known:0",
        label: "Mission Control",
      })
    );
    expect(historyPrompt.items[0]?.detail).toContain("ID 01234567...abcdef");
    expect(historyPrompt.items[0]?.detail).toContain("Created by Mira");
    expect(historyPrompt.items[0]?.searchText).toContain(SPACE_ID_ALPHA);
    expect(historyPrompt.items[0]?.searchText).toContain(HUMAN_PROFILE);

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: HUMAN_PROFILE,
        space: SPACE_ID_ALPHA,
        baseUrl: EXPLICIT_BASE_URL,
        connectionMode: "watch",
      })
    );
    expect(getLegacyListDependencyCallCounts()).toEqual({
      listProfileSpaceHistory: 0,
      querySpaceDeletionTombstones: 0,
      updateProfileSpaceHistoryStatus: 0,
    });
  });

  it("uses AccountSpaces instead of local cache for non-default profile watch candidates", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("history");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: "known:0",
    });
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          creatorProfileId: AGENT_PROFILE,
          creatorProfileName: "Codex",
          creatorKind: "agent",
          openProfileId: AGENT_PROFILE,
          openProfileName: "Codex",
          spaceId: SPACE_ID_BETA,
          spaceName: "Build Room",
        }),
      ],
    });

    const stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutIsTTY = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      await withTempHome(async () => {
        await upsertSpaceConfig({
          openMeldProfileId: AGENT_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          space: SPACE_ID_CA_DM,
          name: "Center Agent",
          profileName: "Codex",
          spacePurpose: "openmeld_dm_space",
        });
        await upsertSpaceConfig({
          openMeldProfileId: AGENT_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          space: SPACE_ID_WELCOMING,
          name: "OpenMeld Welcoming Space",
          profileName: "Codex",
          spacePurpose: "openmeld_welcoming_space",
        });
        await withSilencedStdio(async () => {
          await runSpaceWatch({
            profile: AGENT_PROFILE,
            baseUrl: EXPLICIT_BASE_URL,
            view: "human",
          });
        });
      });
    } finally {
      if (stdinIsTTY) {
        Object.defineProperty(process.stdin, "isTTY", stdinIsTTY);
      }
      if (stdoutIsTTY) {
        Object.defineProperty(process.stdout, "isTTY", stdoutIsTTY);
      }
    }

    expect(listAccountSpaceIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: EXPLICIT_BASE_URL,
        includePurposes: true,
        limit: 500,
        scope: "profile",
        selectedProfileId: AGENT_PROFILE,
      })
    );
    const historyPrompt = promptSearchSelectMock.mock.calls[0]?.[0] as {
      items: Array<{
        label: string;
        searchText: string;
      }>;
    };
    expect(historyPrompt.items).toHaveLength(1);
    expect(historyPrompt.items[0]?.label).toBe("Build Room");
    expect(historyPrompt.items[0]?.searchText).not.toContain(SPACE_ID_CA_DM);
    expect(historyPrompt.items[0]?.searchText).not.toContain("Center Agent");
    expect(historyPrompt.items[0]?.searchText).not.toContain(
      SPACE_ID_WELCOMING
    );
    expect(historyPrompt.items[0]?.searchText).not.toContain(
      "OpenMeld Welcoming Space"
    );
    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: AGENT_PROFILE,
        space: SPACE_ID_BETA,
        baseUrl: EXPLICIT_BASE_URL,
        connectionMode: "watch",
      })
    );
  });

  it("filters legacy welcoming spaces from the local watch fallback", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("history");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: "known:0",
    });
    listAccountSpaceIndexMock.mockRejectedValue(new TypeError("fetch failed"));

    const stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutIsTTY = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );

    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    try {
      await withTempHome(async () => {
        await upsertSpaceConfig({
          openMeldProfileId: AGENT_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          space: SPACE_ID_BETA,
          name: "Local Build Room",
          profileName: "Codex",
        });
        await upsertSpaceConfig({
          openMeldProfileId: AGENT_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          space: SPACE_ID_WELCOMING,
          name: "OpenMeld Welcoming Space",
          profileName: "Codex",
          spacePurpose: "openmeld_welcoming_space",
        });
        await withSilencedStdio(async () => {
          await runSpaceWatch({
            profile: AGENT_PROFILE,
            baseUrl: EXPLICIT_BASE_URL,
            view: "human",
          });
        });
      });
    } finally {
      if (stdinIsTTY) {
        Object.defineProperty(process.stdin, "isTTY", stdinIsTTY);
      }
      if (stdoutIsTTY) {
        Object.defineProperty(process.stdout, "isTTY", stdoutIsTTY);
      }
    }

    const historyPrompt = promptSearchSelectMock.mock.calls[0]?.[0] as {
      items: Array<{
        label: string;
        searchText: string;
      }>;
    };
    expect(historyPrompt.items).toHaveLength(1);
    expect(historyPrompt.items[0]?.label).toBe("Local Build Room");
    expect(historyPrompt.items[0]?.searchText).not.toContain(
      SPACE_ID_WELCOMING
    );
    expect(historyPrompt.items[0]?.searchText).not.toContain(
      "OpenMeld Welcoming Space"
    );
    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: AGENT_PROFILE,
        space: SPACE_ID_BETA,
        baseUrl: EXPLICIT_BASE_URL,
        connectionMode: "watch",
      })
    );
  });

  it("renders AccountSpaces items even when never joined from this device", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("history");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "cancelled",
    });
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          creatorProfileId: HUMAN_PROFILE,
          openProfileId: HUMAN_PROFILE,
          spaceId: SPACE_ID_ALPHA,
          spaceName: "Fresh Space",
          lastJoinedAt: "2026-02-20T02:10:00.000Z",
          spaceCreatedAt: "2026-02-20T02:10:00.000Z",
          spaceUpdatedAt: "2026-02-20T02:10:00.000Z",
        }),
      ],
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: HUMAN_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          view: "human",
          allowPrompt: true,
          output: "text",
        });
      });
    });

    const sourcePrompt = selectMock.mock.calls[0]?.[0] as {
      message: string;
      options: Array<{ value: string; label: string; hint?: string }>;
    };
    expect(sourcePrompt.message).toContain("Choose a space to join");
    expect(sourcePrompt.options[0]).toEqual(
      expect.objectContaining({
        value: "history",
        label: "Choose a space you created or joined",
        hint: "1 space",
      })
    );

    const historyPrompt = promptSearchSelectMock.mock.calls[0]?.[0] as {
      items: Array<{
        value: string;
        label: string;
        detail: string;
        searchText: string;
      }>;
    };
    expect(historyPrompt.items).toHaveLength(1);
    expect(historyPrompt.items[0]).toEqual(
      expect.objectContaining({
        value: "known:0",
      })
    );
    expect(historyPrompt.items[0]?.label).toContain("Fresh Space");
    expect(historyPrompt.items[0]?.searchText).toContain(SPACE_ID_ALPHA);
    expect(runConnect).not.toHaveBeenCalled();
    expect(getLegacyListDependencyCallCounts()).toEqual({
      listProfileSpaceHistory: 0,
      querySpaceDeletionTombstones: 0,
      updateProfileSpaceHistoryStatus: 0,
    });
  });

  it("omits spaces the Space-Index no longer returns", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("history");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "cancelled",
    });
    // The Space-Index is the single read source: a removed space is simply
    // absent from the projection. The CLI no longer reconstructs removals from
    // profile history, nor cleans a local cache while listing.
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          creatorProfileId: HUMAN_PROFILE,
          openProfileId: HUMAN_PROFILE,
          spaceId: SPACE_ID_BETA,
          spaceName: "Current Space",
        }),
      ],
    });

    await withTempHome(async () => {
      await upsertSpaceConfig({
        openMeldProfileId: HUMAN_PROFILE,
        baseUrl: EXPLICIT_BASE_URL,
        space: SPACE_ID_ALPHA,
        profileName: "Mira",
        name: "Retired Space",
      });
      await upsertSpaceConfig({
        openMeldProfileId: HUMAN_PROFILE,
        baseUrl: EXPLICIT_BASE_URL,
        space: SPACE_ID_BETA,
        profileName: "Mira",
        name: "Current Space",
      });

      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: HUMAN_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          view: "human",
          allowPrompt: true,
          output: "text",
        });
      });
    });

    const historyPrompt = promptSearchSelectMock.mock.calls[0]?.[0] as {
      items: Array<{ value: string; label: string }>;
    };
    expect(historyPrompt.items).toHaveLength(1);
    expect(historyPrompt.items[0]?.label).toContain("Current Space");
    expect(historyPrompt.items[0]?.label).not.toContain("Retired Space");
    expect(getLegacyListDependencyCallCounts()).toEqual({
      listProfileSpaceHistory: 0,
      querySpaceDeletionTombstones: 0,
      updateProfileSpaceHistoryStatus: 0,
    });
  });

  it("requires explicit space target in agent view even when spaces exist", async () => {
    const selectMock = vi.mocked(select);
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID_ALPHA,
          spaceName: "Code Review Room",
          creatorProfileId: "agt_other",
          creatorKind: "agent",
          openProfileId: AGENT_PROFILE,
          openProfileName: "Codex",
          lastSeenTs: 88,
        }),
      ],
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await expect(
          runSpaceJoin({
            profile: AGENT_PROFILE,
            baseUrl: EXPLICIT_BASE_URL,
            view: "agent",
            allowPrompt: true,
            output: "text",
            role: "OpenMeld Profile History Executor",
          })
        ).rejects.toMatchObject({
          code: "space.join.target.required",
        });
      });
    });

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptSearchSelectMock).not.toHaveBeenCalled();
    expect(runConnect).not.toHaveBeenCalled();
  });

  it("hides incomplete stale items the Space-Index omits from its projection", async () => {
    // The Space-Index only returns complete, live spaces. An item that the
    // projection drops (e.g. a stale row with no creator/timestamps) is simply
    // not present; the CLI no longer probes /meta or marks history rows removed
    // while listing.
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("history");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: "known:0",
    });
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          creatorProfileId: HUMAN_PROFILE,
          openProfileId: HUMAN_PROFILE,
          spaceId: SPACE_ID_ALPHA,
          spaceName: "Mission Control",
        }),
      ],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${SPACE_ID_ALPHA}/meta`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify(createSpaceMetaPayload(SPACE_ID_ALPHA)),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: HUMAN_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          view: "human",
          allowPrompt: true,
          output: "text",
        });
      });
    });

    const historyPrompt = promptSearchSelectMock.mock.calls[0]?.[0] as {
      items: Array<{ label: string }>;
    };
    expect(
      historyPrompt.items.some((option) => option.label.includes("Second"))
    ).toBe(false);
    expect(historyPrompt.items).toHaveLength(1);
    expect(historyPrompt.items[0]?.label).toBe("Mission Control");
    expect(fetchSpy).toHaveBeenCalled();
    expect(getLegacyListDependencyCallCounts()).toEqual({
      listProfileSpaceHistory: 0,
      querySpaceDeletionTombstones: 0,
      updateProfileSpaceHistoryStatus: 0,
    });
  });

  it("keeps manual space ID entry as the second join option", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("manual");
    promptTextEntryMock.mockResolvedValueOnce({
      status: "submitted",
      value: SPACE_ID_BETA,
    });
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          creatorProfileId: HUMAN_PROFILE,
          openProfileId: HUMAN_PROFILE,
          spaceId: SPACE_ID_ALPHA,
          spaceName: "Mission Control",
        }),
      ],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${SPACE_ID_BETA}/meta`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify(createSpaceMetaPayload(SPACE_ID_BETA)),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: HUMAN_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          view: "human",
          allowPrompt: true,
          output: "text",
        });
      });
    });

    const sourcePrompt = selectMock.mock.calls[0]?.[0] as {
      options: Array<{ value: string; label: string; hint?: string }>;
    };
    expect(sourcePrompt.options[0]).toEqual(
      expect.objectContaining({
        value: "history",
        label: "Choose a space you created or joined",
      })
    );
    expect(sourcePrompt.options[1]).toEqual(
      expect.objectContaining({
        value: "manual",
        label: "Enter a space ID manually",
      })
    );
    expect(promptTextEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Enter a space ID manually",
        allowBack: true,
      })
    );
    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: HUMAN_PROFILE,
        space: SPACE_ID_BETA,
        baseUrl: EXPLICIT_BASE_URL,
        trackProfileSpaceHistory: true,
      })
    );
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("shows a back option in the join source picker and returns back cleanly", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("back");
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          creatorProfileId: HUMAN_PROFILE,
          openProfileId: HUMAN_PROFILE,
          spaceId: SPACE_ID_ALPHA,
          spaceName: "Mission Control",
        }),
      ],
    });

    let result: Awaited<ReturnType<typeof runSpaceJoin>> | null = null;
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        result = await runSpaceJoin({
          profile: HUMAN_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          view: "human",
          allowPrompt: true,
          output: "text",
        });
      });
    });

    const sourcePrompt = selectMock.mock.calls[0]?.[0] as {
      options: Array<{ value: string; label: string; hint?: string }>;
    };
    expect(sourcePrompt.options[2]).toEqual(
      expect.objectContaining({
        value: "back",
        label: "Back",
      })
    );
    expect(result).toBe("back");
    expect(runConnect).not.toHaveBeenCalled();
    expect(promptTextEntryMock).not.toHaveBeenCalled();
  });

  it("offers create and back when no known spaces exist yet", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("back");
    listAccountSpaceIndexMock.mockResolvedValue(emptyAccountSpaceIndex());

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: HUMAN_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          view: "human",
          allowPrompt: true,
          output: "text",
        });
      });
    });

    const sourcePrompt = selectMock.mock.calls[0]?.[0] as {
      message: string;
      options: Array<{ value: string; label: string; hint?: string }>;
    };
    expect(sourcePrompt.message).toContain("No spaces yet");
    expect(sourcePrompt.message).toContain(
      "Showing spaces for this profile only."
    );
    expect(sourcePrompt.options).toEqual([
      expect.objectContaining({
        value: "manual",
        label: "Enter a space ID manually",
      }),
      expect.objectContaining({
        value: "create",
        label: "Create a new space and join",
      }),
      expect.objectContaining({
        value: "back",
        label: "Back",
      }),
    ]);
    expect(promptTextEntryMock).not.toHaveBeenCalled();
    expect(runConnect).not.toHaveBeenCalled();
  });

  it("returns to the join menu when manual entry goes back", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("manual").mockResolvedValueOnce("history");
    promptTextEntryMock.mockResolvedValueOnce({
      status: "back",
    });
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: "known:0",
    });
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          creatorProfileId: HUMAN_PROFILE,
          openProfileId: HUMAN_PROFILE,
          spaceId: SPACE_ID_ALPHA,
          spaceName: "Mission Control",
        }),
      ],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${SPACE_ID_ALPHA}/meta`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify(createSpaceMetaPayload(SPACE_ID_ALPHA)),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: HUMAN_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          view: "human",
          allowPrompt: true,
          output: "text",
        });
      });
    });

    expect(promptTextEntryMock).toHaveBeenCalledTimes(1);
    expect(promptSearchSelectMock).toHaveBeenCalledTimes(1);
    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: HUMAN_PROFILE,
        space: SPACE_ID_ALPHA,
        baseUrl: EXPLICIT_BASE_URL,
        trackProfileSpaceHistory: true,
      })
    );
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("passes the full Space-Index list to the searchable human prompt", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("history");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: "known:3",
    });
    // Descending lastJoinedAt so the sorted picker order matches input order
    // (most-recently-joined first), keeping known:<index> aligned with input.
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map(
        (name, index) =>
          createAccountSpaceIndexItem({
            creatorProfileId: HUMAN_PROFILE,
            openProfileId: HUMAN_PROFILE,
            spaceId: `${String(index + 1).repeat(64)}`,
            spaceName: name,
            spaceCreatedAt: `2026-02-2${String(8 - index)}T00:00:00.000Z`,
            spaceUpdatedAt: `2026-02-2${String(8 - index)}T01:00:00.000Z`,
            lastJoinedAt: `2026-02-2${String(8 - index)}T02:00:00.000Z`,
            lastSeenTs: 400 - index,
            updatedAt: `2026-02-2${String(8 - index)}T02:00:00.000Z`,
          })
      ),
    });
    const selectedSpaceId = "4".repeat(64);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${selectedSpaceId}/meta`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify(createSpaceMetaPayload(selectedSpaceId)),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: HUMAN_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          view: "human",
          allowPrompt: true,
          output: "text",
        });
      });
    });

    const historyPrompt = promptSearchSelectMock.mock.calls[0]?.[0] as {
      message: string;
      maxVisible: number;
      allowBack: boolean;
      backLabel: string;
      items: Array<{
        value: string;
        label: string;
        detail: string;
        searchText: string;
      }>;
    };
    expect(historyPrompt.message).toContain("Choose a space to join");
    expect(historyPrompt.message).toContain(
      "Showing spaces for this profile only."
    );
    expect(historyPrompt.maxVisible).toBe(8);
    expect(historyPrompt.allowBack).toBe(true);
    expect(historyPrompt.backLabel).toBe("Back");
    expect(historyPrompt.items).toHaveLength(5);
    expect(historyPrompt.items[0]?.label).toContain("Alpha");
    expect(historyPrompt.items[1]?.label).toContain("Bravo");
    expect(historyPrompt.items[2]?.label).toContain("Charlie");
    expect(historyPrompt.items[3]?.label).toContain("Delta");
    expect(historyPrompt.items[4]?.label).toContain("Echo");
    expect(historyPrompt.items[3]?.value).toBe("known:3");
    expect(historyPrompt.items[3]?.searchText).toContain(selectedSpaceId);
    expect(historyPrompt.items[3]?.detail).toContain("joined");

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: HUMAN_PROFILE,
        space: selectedSpaceId,
        baseUrl: EXPLICIT_BASE_URL,
        trackProfileSpaceHistory: true,
      })
    );
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("aggregates owned profile spaces for the main human profile via account scope", async () => {
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("history");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: "known:0",
    });
    // Server-side aggregation: the account-scope projection already merges the
    // owner's other human and agent profiles. The CLI no longer fans out one
    // profile-history read per owned profile.
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID_ALPHA,
          spaceName: "Agent Space",
          creatorProfileId: "codex-owned-helper",
          creatorProfileName: "Codex",
          creatorKind: "agent",
          openProfileId: "codex-owned-helper",
          openProfileName: "Codex",
          lastJoinedAt: "2026-02-20T02:20:00.000Z",
        }),
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID_BETA,
          spaceName: "Human Space",
          creatorProfileId: "mira-secondary-helper",
          creatorProfileName: "Mira Sidecar",
          creatorKind: "human",
          openProfileId: "mira-secondary-helper",
          openProfileName: "Mira Sidecar",
          lastJoinedAt: "2026-02-20T02:10:00.000Z",
          lastSeenTs: 111,
        }),
      ],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${SPACE_ID_ALPHA}/meta`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify(createSpaceMetaPayload(SPACE_ID_ALPHA)),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: MAIN_HUMAN_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          view: "human",
          allowPrompt: true,
          output: "text",
        });
      });
    });

    expect(listAccountSpaceIndexMock).toHaveBeenCalledTimes(1);
    expect(listAccountSpaceIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "account",
        selectedProfileId: MAIN_HUMAN_PROFILE,
        limit: 500,
      })
    );

    const sourcePrompt = selectMock.mock.calls[0]?.[0] as {
      message: string;
      options: Array<{ value: string; label: string; hint?: string }>;
    };
    expect(sourcePrompt.message).toContain("Choose a space to join");
    expect(sourcePrompt.message).toContain(
      "Showing spaces from your main profile and your other human and agent profiles."
    );
    expect(sourcePrompt.options[0]?.hint).toBe("2 spaces");
    expect(sourcePrompt.options[0]?.label).toBe(
      "Choose a space from your profiles"
    );

    const historyPrompt = promptSearchSelectMock.mock.calls[0]?.[0] as {
      message: string;
      items: Array<{
        value: string;
        label: string;
        detail: string;
        searchText: string;
      }>;
    };
    expect(historyPrompt.message).toContain("Choose a space to join");
    expect(historyPrompt.message).toContain(
      "Showing spaces from your main profile and your other human and agent profiles."
    );
    expect(historyPrompt.items).toHaveLength(2);
    expect(historyPrompt.items[0]?.label).toBe("Agent Space");
    expect(historyPrompt.items[0]?.detail).toContain("Created by Codex");
    expect(historyPrompt.items[0]?.detail).not.toContain("via Codex");
    expect(historyPrompt.items[0]?.searchText).toContain("codex-owned-helper");
    expect(historyPrompt.items[1]?.label).toBe("Human Space");
    expect(historyPrompt.items[1]?.detail).toContain("Created by Mira Sidecar");

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: MAIN_HUMAN_PROFILE,
        space: SPACE_ID_ALPHA,
        baseUrl: EXPLICIT_BASE_URL,
        trackProfileSpaceHistory: true,
      })
    );
    expect(fetchSpy).toHaveBeenCalled();
    expect(getLegacyListDependencyCallCounts()).toEqual({
      listProfileSpaceHistory: 0,
      querySpaceDeletionTombstones: 0,
      updateProfileSpaceHistoryStatus: 0,
    });
  });

  it("keeps owner-scoped spaces visible when the Space-Index still returns them", async () => {
    // Owner-scope visibility is decided entirely by the server projection now:
    // a space the index still returns stays visible, with no client-side live
    // /meta validation or profile-history reconciliation.
    const selectMock = vi.mocked(select);
    selectMock.mockResolvedValueOnce("history");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: "known:0",
    });
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID_ALPHA,
          spaceName: "Still Live",
          creatorProfileId: "codex-owned-helper",
          creatorProfileName: "Codex",
          creatorKind: "agent",
          openProfileId: "codex-owned-helper",
          openProfileName: "Codex",
          lastJoinedAt: "2026-02-20T02:20:00.000Z",
        }),
      ],
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(`/spaces/${SPACE_ID_ALPHA}/meta`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify(createSpaceMetaPayload(SPACE_ID_ALPHA)),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: MAIN_HUMAN_PROFILE,
          baseUrl: EXPLICIT_BASE_URL,
          view: "human",
          allowPrompt: true,
          output: "text",
        });
      });
    });

    const historyPrompt = promptSearchSelectMock.mock.calls[0]?.[0] as {
      items: Array<{ label: string; detail: string }>;
    };
    expect(historyPrompt.items).toHaveLength(1);
    expect(historyPrompt.items[0]?.label).toBe("Still Live");
    expect(historyPrompt.items[0]?.detail).toContain("Created by Codex");
    expect(getLegacyListDependencyCallCounts()).toEqual({
      listProfileSpaceHistory: 0,
      querySpaceDeletionTombstones: 0,
      updateProfileSpaceHistoryStatus: 0,
    });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("fails fast when the Space-Index lookup throws instead of showing a picker", async () => {
    // Regression for the removed "fails fast on cloud auth errors" case: the
    // join flow loads the Space-Index before any picker, so when
    // listAccountSpaceIndex rejects (e.g. a cloud auth failure with no local
    // fallback) the command must surface that error and never silently degrade
    // into a prompt.
    const selectMock = vi.mocked(select);
    listAccountSpaceIndexMock.mockRejectedValue(
      new Error("authentication required")
    );

    await withTempHome(async () => {
      await expect(
        withSilencedStdio(async () => {
          await runSpaceJoin({
            profile: HUMAN_PROFILE,
            baseUrl: EXPLICIT_BASE_URL,
            view: "human",
            allowPrompt: true,
            output: "text",
          });
        })
      ).rejects.toThrow("authentication required");
    });

    expect(selectMock).not.toHaveBeenCalled();
    expect(promptSearchSelectMock).not.toHaveBeenCalled();
    expect(runConnect).not.toHaveBeenCalled();
  });
});
