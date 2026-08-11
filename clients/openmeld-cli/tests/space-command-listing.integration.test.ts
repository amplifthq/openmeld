import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AccountSpaceIndexItem } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const listAccountSpaceIndexMock = vi.hoisted(() => vi.fn());
const listProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
const querySpaceDeletionTombstonesMock = vi.hoisted(() => vi.fn());
const updateProfileSpaceHistoryStatusMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const listOpenMeldProfilesMock = vi.hoisted(() => vi.fn());

const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SPACE_ID_2 =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const MAIN_HUMAN_PROFILE = "mira-main-space-listing";

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

vi.mock("../src/config/space-deletion-tombstone-api", () => ({
  querySpaceDeletionTombstones: (
    ...args: Parameters<typeof querySpaceDeletionTombstonesMock>
  ) => querySpaceDeletionTombstonesMock(...args),
  upsertSpaceDeletionTombstone: vi.fn(),
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

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const toProfile = (openMeldProfileId: string) => {
    const normalized = openMeldProfileId.toLowerCase();
    const isAgent =
      normalized.startsWith("agt") || normalized.includes("agent");
    const isDefault = normalized.includes("main");
    return {
      openMeldProfileId,
      profileName: isAgent ? "Codex" : "Mira",
      profileHandle: isAgent ? "codex" : "mira",
      profileKind: isAgent ? "agent" : "human",
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
        toProfile(String(openMeldProfileId ?? "mira-main-space-listing"))
    ),
    resolveOpenMeldProfileOrNull: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
        toProfile(String(openMeldProfileId ?? "mira-main-space-listing"))
    ),
  };
});

vi.mock("../src/config/openmeld-profiles-api", () => {
  const toProfile = (openMeldProfileId: string) => {
    const normalized = openMeldProfileId.toLowerCase();
    const isAgent =
      normalized.startsWith("agt") || normalized.includes("agent");
    const isDefault = normalized.includes("main");
    return {
      openMeldProfileId,
      profileName: isAgent ? "Codex" : "Mira",
      profileHandle: isAgent ? "codex" : "mira",
      profileKind: isAgent ? "agent" : "human",
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
        toProfile(String(profileIdentifier ?? "mira-main-space-listing"))
    ),
  };
});

import { runSpaceList } from "../src/space/command";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

describe("space list command", () => {
  afterEach(() => {
    vi.clearAllMocks();
    listAccountSpaceIndexMock.mockReset();
    listProfileSpaceHistoryMock.mockReset();
    querySpaceDeletionTombstonesMock.mockReset();
    updateProfileSpaceHistoryStatusMock.mockReset();
    getAuthSessionStateMock.mockReset();
    listOpenMeldProfilesMock.mockReset();
  });

  it("prints AccountSpaces results in human view", async () => {
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          openProfileId: "mira--space-listing",
          openProfileName: "Mira",
          spaceId: SPACE_ID,
          spaceName: "Mission Control",
        }),
      ],
    });

    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceList({
          profile: "mira--space-listing",
          baseUrl: "https://gateway.testing.example",
          limit: 20,
          view: "human",
        });
      });

      expect(stdout).toContain("Showing spaces for this profile only.");
      expect(stdout).toContain("1. Mission Control");
      expect(stdout).toContain(`Space ID: ${SPACE_ID}`);
      expect(stdout).toContain("Space Creator: Mira");
      expect(stdout).toContain("Space Creator Profile ID: mira--space-listing");
      expect(stdout).not.toContain("Creator ID:");
    });

    expect(listAccountSpaceIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://gateway.testing.example",
        limit: 20,
        scope: "profile",
        selectedProfileId: "mira--space-listing",
      })
    );
    expect(getLegacyListDependencyCallCounts()).toEqual({
      listProfileSpaceHistory: 0,
      querySpaceDeletionTombstones: 0,
      updateProfileSpaceHistoryStatus: 0,
    });
  });

  it("does not read or repair local space cache while listing AccountSpaces", async () => {
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [],
    });

    await withTempHome(async (home) => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      const cacheDir = join(
        home,
        ".openmeld",
        "accounts",
        "unauthenticated",
        "local",
        "profiles",
        "mira--space-listing",
        "space-cache"
      );
      await mkdir(cacheDir, { recursive: true });
      await writeFile(join(cacheDir, "broken.json"), "{", "utf8");

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceList({
          profile: "mira--space-listing",
          baseUrl: "https://gateway.testing.example",
          limit: 20,
          view: "human",
        });
      });

      expect(stdout).toContain("No spaces found for this profile yet.");
    });

    expect(getLegacyListDependencyCallCounts()).toEqual({
      listProfileSpaceHistory: 0,
      querySpaceDeletionTombstones: 0,
      updateProfileSpaceHistoryStatus: 0,
    });
  });

  it("returns structured AccountSpaces payload in agent json mode", async () => {
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          openProfileId: "agt-space-listing",
          openProfileName: "Codex",
          creatorKind: "agent",
          creatorProfileId: "agt-space-listing",
          creatorProfileName: "Codex",
          spaceId: SPACE_ID,
          spaceName: "Mission Control",
        }),
      ],
    });

    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceList({
          profile: "agt-space-listing",
          baseUrl: "https://gateway.testing.example",
          limit: 20,
          json: true,
          view: "agent",
        });
      });

      const firstLine = stdout
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      expect(firstLine).toBeDefined();
      const envelope = JSON.parse(String(firstLine)) as {
        type?: string;
        code?: string;
        payload?: {
          proof?: {
            conversationReadable?: string;
            nextChecks?: string[];
            spaceVisible?: boolean;
            wakeExecutionSucceeded?: string;
          };
          visibilityScope?: string;
          deletedNotices?: unknown[];
          spaces?: { spaceId?: string; name?: string }[];
        };
      };
      expect(envelope.type).toBe("result");
      expect(envelope.code).toBe("space.list");
      expect(envelope.payload?.visibilityScope).toBe("profile");
      expect(envelope.payload?.proof).toMatchObject({
        conversationReadable: "not_checked",
        spaceVisible: true,
        wakeExecutionSucceeded: "not_checked",
      });
      expect(envelope.payload?.proof?.nextChecks).toContain(
        "<OPENMELD_CLI> space history <space-id> --kind text --brief --limit 20 --view agent"
      );
      expect(envelope.payload?.deletedNotices).toEqual([]);
      expect(envelope.payload?.spaces?.[0]?.spaceId).toBe(SPACE_ID);
      expect(envelope.payload?.spaces?.[0]?.name).toBe("Mission Control");
      expect(stdout).not.toContain("Updated local space cache");
    });

    expect(getLegacyListDependencyCallCounts()).toEqual({
      listProfileSpaceHistory: 0,
      querySpaceDeletionTombstones: 0,
      updateProfileSpaceHistoryStatus: 0,
    });
  });

  it("uses account scope for the default human profile without explicit --profile", async () => {
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          openProfileId: "agt-owned-space-listing",
          openProfileName: "Codex",
          creatorKind: "agent",
          creatorProfileId: "agt-owned-space-listing",
          creatorProfileName: "Codex",
          spaceId: SPACE_ID_2,
          spaceName: "Owner Agent Space",
        }),
      ],
    });

    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceList({
          baseUrl: "https://gateway.testing.example",
          limit: 20,
          view: "human",
        });
      });

      expect(stdout).toContain(
        "Showing spaces from your main profile and your other human and agent profiles."
      );
      expect(stdout).toContain("1. Owner Agent Space");
      expect(stdout).toContain(`Space ID: ${SPACE_ID_2}`);
      expect(stdout).toContain("Available via: Codex");
    });

    expect(listAccountSpaceIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        scope: "account",
        selectedProfileId: MAIN_HUMAN_PROFILE,
      })
    );
    expect(listOpenMeldProfilesMock).not.toHaveBeenCalled();
    expect(getLegacyListDependencyCallCounts()).toEqual({
      listProfileSpaceHistory: 0,
      querySpaceDeletionTombstones: 0,
      updateProfileSpaceHistoryStatus: 0,
    });
  });

  it("uses profile scope and backend limit for explicit agent profile list", async () => {
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          openProfileId: "agt-space-listing",
          openProfileName: "Codex",
          creatorKind: "agent",
          creatorProfileId: "agt-space-listing",
          creatorProfileName: "Codex",
          spaceId: SPACE_ID,
          spaceName: "Agent Space",
        }),
      ],
    });

    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withCapturedStdio(async () => {
        await runSpaceList({
          profile: "agt-space-listing",
          baseUrl: "https://gateway.testing.example",
          limit: 1,
          view: "agent",
        });
      });
    });

    expect(listAccountSpaceIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 1,
        scope: "profile",
        selectedProfileId: "agt-space-listing",
      })
    );
    expect(listOpenMeldProfilesMock).not.toHaveBeenCalled();
    expect(getLegacyListDependencyCallCounts()).toEqual({
      listProfileSpaceHistory: 0,
      querySpaceDeletionTombstones: 0,
      updateProfileSpaceHistoryStatus: 0,
    });
  });

  it("preserves AccountSpaces pinned-first ordering", async () => {
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID_2,
          spaceName: "Pinned Space",
          pinnedAt: "2026-02-21T00:00:00.000Z",
          pinnedProfileIds: ["mira--space-listing"],
        }),
      ],
      spaceItems: [
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID,
          spaceName: "Recent Space",
          lastJoinedAt: "2026-02-22T00:00:00.000Z",
        }),
      ],
    });

    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceList({
          profile: "mira--space-listing",
          baseUrl: "https://gateway.testing.example",
          limit: 20,
          view: "human",
        });
      });

      expect(stdout.indexOf("1. Pinned Space")).toBeLessThan(
        stdout.indexOf("2. Recent Space")
      );
    });

    expect(getLegacyListDependencyCallCounts()).toEqual({
      listProfileSpaceHistory: 0,
      querySpaceDeletionTombstones: 0,
      updateProfileSpaceHistoryStatus: 0,
    });
  });
});

function createAccountSpaceIndexItem(
  input: Partial<AccountSpaceIndexItem> = {}
): AccountSpaceIndexItem {
  const openProfileId = input.openProfileId ?? "mira--space-listing";
  const openProfileName = input.openProfileName ?? "Mira";
  const lastJoinedAt = input.lastJoinedAt ?? "2026-02-20T02:00:00.000Z";
  return {
    creatorKind: input.creatorKind ?? "human",
    creatorOwnerUserId: input.creatorOwnerUserId ?? "user-1",
    creatorProfileId: input.creatorProfileId ?? "mira--space-listing",
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
    spaceId: input.spaceId ?? SPACE_ID,
    spaceName: input.spaceName ?? "Mission Control",
    spaceUpdatedAt: input.spaceUpdatedAt ?? "2026-02-20T01:00:00.000Z",
    status: input.status ?? "active",
    updatedAt: input.updatedAt ?? "2026-02-20T02:00:00.000Z",
    visibility: input.visibility ?? "private",
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
