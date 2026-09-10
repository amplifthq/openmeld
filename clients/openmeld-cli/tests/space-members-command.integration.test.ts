import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import { runSpaceMembers } from "../src/space/members-command";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const resolveOpenMeldProfileByIdOrNameMock = vi.hoisted(() => vi.fn());

const PROFILE = {
  openMeldProfileId: "mira--space-members",
  profileName: "Mira",
  profileKind: "human",
  status: "active",
  ownerUserId: "user-1",
  source: "cli_create",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
} as const;

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const VALID_SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// This complete shared API-client fixture shape was also verified through the
// dev-lane GET member-directory command smoke. Values are deterministic here.
const MEMBER_DIRECTORY = {
  spaceId: VALID_SPACE_ID,
  generatedAt: "2026-04-03T00:00:00.000Z",
  members: [
    {
      profileId: HUMAN_PROFILE_ID,
      profileKind: "human",
      displayName: "Mira",
      primaryMentionLabel: "Mira",
      mentionLabels: ["Mira"],
      mentionAlias: null,
      labelSource: "profile_name",
      lookupTokens: ["mira"],
      preferredLookupToken: "mira",
      profileIdShort: "11111111",
      allowedRelations: {
        mention: true,
        wake: false,
        reference: false,
      },
      ownerUserId: "user-1",
      ownerName: "Mira",
      agentCard: null,
      spaceRole: {
        role: "Product lead",
        roleDescription: "Owns launch decisions.",
      },
    },
    {
      profileId: "agt_22222222-2222-4222-8222-222222222222",
      profileKind: "agent",
      displayName: "Build Agent",
      primaryMentionLabel: "Build Agent",
      mentionLabels: ["Build Agent", "Builder"],
      mentionAlias: "builder",
      labelSource: "profile_name",
      lookupTokens: ["build agent", "builder"],
      preferredLookupToken: "build agent",
      profileIdShort: "agt_22222",
      allowedRelations: {
        mention: false,
        wake: true,
        reference: true,
      },
      ownerUserId: "user-1",
      ownerName: "Mira",
      agentCard: {
        role: "Engineer",
        roleDescription: "Implements scoped changes.",
      },
      spaceRole: null,
    },
  ],
} as const;

const MEMBERS_SNAPSHOT = {
  spaceId: VALID_SPACE_ID,
  generatedAt: "2026-04-03T00:00:00.000Z",
  summary: {
    totalCount: 2,
    humanCount: 1,
    agentCount: 1,
    liveNowCount: 0,
    wakeableAgentCount: 1,
    checkingAgentCount: 0,
    offlineAgentCount: 0,
    unavailableAgentCount: 0,
  },
  humans: [
    buildMemberSnapshotBase({
      profileId: HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Mira",
    }),
  ],
  agents: [
    {
      ...buildMemberSnapshotBase({
        profileId: "agt_22222222-2222-4222-8222-222222222222",
        profileKind: "agent",
        profileName: "Build Agent",
      }),
      agentControllerRef: "builtin:codex",
      agentControllerConversationId: "thread-build",
      agentWakeAvailability: {
        action: "none",
        badgeLabel: "Available",
        category: "available",
        isRefreshing: false,
        label: "Available for Wake",
        phase: "available",
        reasonCode: "agent_execution.ready",
        status: "available_for_wake",
        summary: "Available for Wake",
        tooltip: "Available for Wake",
      },
    },
  ],
} as const;

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "http://localhost",
    clientId: "openmeld-cli",
    createdAt: "2026-07-20T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  multiselect: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
  password: vi.fn(),
  select: vi.fn(() => "no"),
  spinner: vi.fn(),
  text: vi.fn(),
}));

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: vi.fn(async () => PROFILE),
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
    getAuthSessionState: (...args: unknown[]) =>
      getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => true),
}));

describe("space members command", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
    resolveOpenMeldProfileByIdOrNameMock.mockResolvedValue(PROFILE);
  });

  afterEach(() => {
    getAuthSessionStateMock.mockReset();
    resolveOpenMeldProfileByIdOrNameMock.mockReset();
    vi.restoreAllMocks();
  });

  async function initializeProfile(): Promise<void> {
    await withSilencedStdio(async () => {
      await runInit({
        profile: PROFILE.openMeldProfileId,
        profileId: HUMAN_PROFILE_ID,
        profileName: PROFILE.profileName,
        kind: "human",
      });
    });
  }

  function mockMemberDirectoryResponse() {
    return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method ?? "GET").toUpperCase();
      if (
        method !== "GET" ||
        url.pathname !== `/v1/spaces/${VALID_SPACE_ID}/member-directory`
      ) {
        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      }
      return Promise.resolve(
        new Response(JSON.stringify(MEMBER_DIRECTORY), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    });
  }

  it("renders the member directory for a person", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const fetchSpy = mockMemberDirectoryResponse();

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceMembers({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Space members (2):");
      expect(plainStdout).toContain("Mira");
      expect(plainStdout).toContain("reference");
      expect(plainStdout).toContain("Build Agent");
      expect(plainStdout).toContain(
        "--wake agt_22222222-2222-4222-8222-222222222222, --reference agt_22222222-2222-4222-8222-222222222222"
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [request, init] = fetchSpy.mock.calls[0] ?? [];
      expect(String(init?.method ?? "GET").toUpperCase()).toBe("GET");
      expect(new URL(String(request)).pathname).toBe(
        `/v1/spaces/${VALID_SPACE_ID}/member-directory`
      );
    });
  });

  it("emits one versioned, scriptable JSON envelope", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      mockMemberDirectoryResponse();

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceMembers({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: true,
          view: "agent",
        });
      });

      expect(JSON.parse(plainStdout)).toEqual({
        schemaVersion: 1,
        type: "space.members",
        ...MEMBER_DIRECTORY,
      });
      expect(plainStdout.trim().split("\n")).toHaveLength(1);
    });
  });

  it("emits the full directory through the agent-view result envelope", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      mockMemberDirectoryResponse();

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceMembers({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "agent",
        });
      });

      const lines = plainStdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines).toContainEqual({
        type: "result",
        code: "space.members.directory",
        payload: MEMBER_DIRECTORY,
      });
      expect(lines).toContainEqual(
        expect.objectContaining({
          type: "line",
          code: "space.members.summary",
          data: expect.objectContaining({ memberCount: 2 }),
        })
      );
    });
  });

  it("returns one compact target with Core-owned Wake availability", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const path = new URL(String(input)).pathname;
        const payload = path.endsWith("/member-directory")
          ? MEMBER_DIRECTORY
          : MEMBERS_SNAPSHOT;
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceMembers({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          brief: true,
          target: "@Builder",
          view: "agent",
        });
      });

      const output = JSON.parse(plainStdout);
      expect(output).toMatchObject({
        type: "result",
        code: "space.members.brief",
        payload: {
          members: [
            {
              profileId: "agt_22222222-2222-4222-8222-222222222222",
              canWakeNow: true,
              wakeAvailability: { status: "available_for_wake" },
            },
          ],
        },
      });
      expect(output).not.toHaveProperty(
        "payload.members.0.wakeAvailability.badgeLabel"
      );
      expect(output).not.toHaveProperty(
        "payload.members.0.ownerWakeDiagnostics"
      );
      expect(plainStdout.trim().split("\n")).toHaveLength(1);
    });
  });

  it("preserves the Core blocker when a compact target cannot be Woken", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const blockedSnapshot = {
        ...MEMBERS_SNAPSHOT,
        summary: {
          ...MEMBERS_SNAPSHOT.summary,
          unavailableAgentCount: 1,
          wakeableAgentCount: 0,
        },
        agents: MEMBERS_SNAPSHOT.agents.map((agent) => ({
          ...agent,
          agentWakeAvailability: {
            ...agent.agentWakeAvailability,
            action: "reconnect_binding",
            badgeLabel: "Connect",
            category: "unavailable",
            label: "Connect local agent",
            phase: "connect_local_agent",
            reasonCode: "agent_profile_binding.missing",
            status: "unavailable_for_wake",
            summary: "Connect a local agent before this profile can reply.",
            tooltip: "Connect local agent",
          },
        })),
      };
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const path = new URL(String(input)).pathname;
        const payload = path.endsWith("/member-directory")
          ? MEMBER_DIRECTORY
          : blockedSnapshot;
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceMembers({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          brief: true,
          target: "agt_22222222-2222-4222-8222-222222222222",
          view: "agent",
        });
      });

      const output = JSON.parse(plainStdout);
      expect(output).toMatchObject({
        payload: {
          members: [
            {
              canWakeNow: false,
              wakeAvailability: {
                action: "reconnect_binding",
                reasonCode: "agent_profile_binding.missing",
                status: "unavailable_for_wake",
                summary: "Connect a local agent before this profile can reply.",
              },
            },
          ],
        },
      });
      expect(plainStdout).not.toContain("badgeLabel");
    });
  });
});

function buildMemberSnapshotBase(input: {
  profileId: string;
  profileKind: "agent" | "human";
  profileName: string;
}) {
  return {
    profileId: input.profileId,
    profileName: input.profileName,
    profileKind: input.profileKind,
    mentionAlias: null,
    status: "active" as const,
    memberSource: "added_by_member" as const,
    memberSourceLabel: "Added by Mira",
    addedAt: "2026-04-03T00:00:00.000Z",
    removedAt: null,
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    addedByProfileId: HUMAN_PROFILE_ID,
    addedByOwnerUserId: "user-1",
    addedByDisplayName: "Mira",
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: null,
    lastSeenLabel: null,
    liveNow: false,
    ownerUserId: "user-1",
    ownerName: "Mira",
  };
}
