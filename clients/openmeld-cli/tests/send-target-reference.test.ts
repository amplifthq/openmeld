import type { SpaceMemberDirectory } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildRequestContextMock,
  createCliSpaceApiMock,
  getMemberDirectoryMock,
  resolveBaseUrlMock,
} = vi.hoisted(() => {
  return {
    buildRequestContextMock: vi.fn(),
    createCliSpaceApiMock: vi.fn(),
    getMemberDirectoryMock: vi.fn(),
    resolveBaseUrlMock: vi.fn(),
  };
});

vi.mock("../src/config/openmeld-request-context", () => ({
  buildOpenMeldRequestContextFromProfileIdentity: buildRequestContextMock,
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: resolveBaseUrlMock,
}));

vi.mock("../src/space/cli-space-api", () => ({
  createCliSpaceApi: createCliSpaceApiMock,
}));

import {
  clearDispatchSendTargetReferenceCacheForTests,
  resolveDispatchSendTargetReference,
} from "../src/local-service/dispatch/send-target-reference";

describe("resolveDispatchSendTargetReference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDispatchSendTargetReferenceCacheForTests();
    resolveBaseUrlMock.mockResolvedValue("https://gateway.openmeld.invalid");
    buildRequestContextMock.mockReturnValue({
      profile: { profileId: "agt_actor" },
    });
    createCliSpaceApiMock.mockReturnValue({
      getMemberDirectory: getMemberDirectoryMock,
    });
  });

  afterEach(() => {
    clearDispatchSendTargetReferenceCacheForTests();
    vi.useRealTimers();
  });

  it("loads a sorted projection and formats reference lines from the member directory", async () => {
    getMemberDirectoryMock.mockResolvedValue(createMemberDirectory());

    const result = await resolveDispatchSendTargetReference({
      agentControllerRef: "builtin:codex",
      dispatchTask: createDispatchTask(),
      profileOwnerName: "Felix",
      profileOwnerUserId: "usr-felix",
      targetProfileName: "Codex",
    });

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      throw new Error("Expected loaded send target reference");
    }

    expect(
      result.projection.map((target) => target.primaryMentionLabel)
    ).toEqual(["Budget Analyst", "Mira", "Watcher"]);
    expect(result.referenceLines).toEqual([
      "Budget Analyst -> agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa (wake | reference)",
      "Mira -> 11111111-1111-4111-8111-111111111111 (mention)",
      "Watcher -> agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb (wake | reference)",
    ]);
    expect(buildRequestContextMock).toHaveBeenCalledWith({
      profileIdentity: {
        openMeldProfileId: "agt_actor",
        ownerName: "Felix",
        ownerUserId: "usr-felix",
        profileKind: "agent",
        profileName: "Codex",
      },
    });
  });

  it("returns a failed result with empty projection and reference lines when directory loading fails", async () => {
    getMemberDirectoryMock.mockRejectedValue(
      new Error("member directory unavailable")
    );

    const result = await resolveDispatchSendTargetReference({
      agentControllerRef: "builtin:codex",
      dispatchTask: createDispatchTask(),
      profileOwnerName: null,
      profileOwnerUserId: "usr-felix",
      targetProfileName: null,
    });

    expect(result).toEqual({
      status: "failed",
      errorMessage: "member directory unavailable",
      projection: null,
      referenceLines: [],
    });
  });

  it("shares one in-flight member directory request for concurrent loads with the same access scope", async () => {
    let resolveDirectory:
      | ((directory: SpaceMemberDirectory) => void)
      | undefined;
    const directoryPromise = new Promise<SpaceMemberDirectory>((resolve) => {
      resolveDirectory = resolve;
    });
    getMemberDirectoryMock.mockReturnValue(directoryPromise);

    const firstLoad = resolveDispatchSendTargetReference({
      agentControllerRef: "builtin:codex",
      dispatchTask: createDispatchTask({
        attemptId: "attempt-1",
        dispatchId: "dispatch-1",
        targetProfileId: "agt_actor",
      }),
      profileOwnerName: "Felix",
      profileOwnerUserId: "usr-felix",
      targetProfileName: "Codex",
    });
    const secondLoad = resolveDispatchSendTargetReference({
      agentControllerRef: "builtin:opencode",
      dispatchTask: createDispatchTask({
        attemptId: "attempt-2",
        dispatchId: "dispatch-2",
        targetProfileId: "agt_other",
      }),
      profileOwnerName: "Felix",
      profileOwnerUserId: "usr-felix",
      targetProfileName: "OpenCode",
    });

    await Promise.resolve();
    expect(getMemberDirectoryMock).toHaveBeenCalledTimes(1);

    resolveDirectory?.(createMemberDirectory());
    const [firstResult, secondResult] = await Promise.all([
      firstLoad,
      secondLoad,
    ]);

    expect(firstResult.status).toBe("loaded");
    expect(secondResult.status).toBe("loaded");
    expect(getMemberDirectoryMock).toHaveBeenCalledTimes(1);
  });

  it("reloads the member directory after the short cache TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-03T12:55:00.000Z"));
    getMemberDirectoryMock
      .mockResolvedValueOnce(
        createMemberDirectory([
          createDirectoryMember({
            displayName: "First",
            profileId: "agt_11111111-1111-4111-8111-111111111111",
            profileKind: "agent",
          }),
        ])
      )
      .mockResolvedValueOnce(
        createMemberDirectory([
          createDirectoryMember({
            displayName: "Second",
            profileId: "agt_22222222-2222-4222-8222-222222222222",
            profileKind: "agent",
          }),
        ])
      );

    const firstResult = await resolveDispatchSendTargetReference({
      agentControllerRef: "builtin:codex",
      dispatchTask: createDispatchTask(),
      profileOwnerName: "Felix",
      profileOwnerUserId: "usr-felix",
      targetProfileName: "Codex",
    });

    vi.setSystemTime(new Date("2026-07-03T12:55:19.999Z"));
    const cachedResult = await resolveDispatchSendTargetReference({
      agentControllerRef: "builtin:codex",
      dispatchTask: createDispatchTask({
        attemptId: "attempt-2",
        dispatchId: "dispatch-2",
        targetProfileId: "agt_other",
      }),
      profileOwnerName: "Felix",
      profileOwnerUserId: "usr-felix",
      targetProfileName: "OpenCode",
    });

    vi.setSystemTime(new Date("2026-07-03T12:55:20.001Z"));
    const reloadedResult = await resolveDispatchSendTargetReference({
      agentControllerRef: "builtin:codex",
      dispatchTask: createDispatchTask({
        attemptId: "attempt-3",
        dispatchId: "dispatch-3",
        targetProfileId: "agt_third",
      }),
      profileOwnerName: "Felix",
      profileOwnerUserId: "usr-felix",
      targetProfileName: "Third",
    });

    expect(getMemberDirectoryMock).toHaveBeenCalledTimes(2);
    expect(firstResult.status).toBe("loaded");
    expect(cachedResult.status).toBe("loaded");
    expect(reloadedResult.status).toBe("loaded");
    if (
      firstResult.status !== "loaded" ||
      cachedResult.status !== "loaded" ||
      reloadedResult.status !== "loaded"
    ) {
      throw new Error("Expected loaded send target references");
    }
    expect(firstResult.referenceLines).toEqual(cachedResult.referenceLines);
    expect(reloadedResult.referenceLines).toEqual([
      "Second -> agt_22222222-2222-4222-8222-222222222222 (wake | reference)",
    ]);
  });

  it("does not cache failed member directory loads", async () => {
    getMemberDirectoryMock
      .mockRejectedValueOnce(new Error("member directory unavailable"))
      .mockResolvedValueOnce(createMemberDirectory([]));

    const failedResult = await resolveDispatchSendTargetReference({
      agentControllerRef: "builtin:codex",
      dispatchTask: createDispatchTask(),
      profileOwnerName: null,
      profileOwnerUserId: "usr-felix",
      targetProfileName: null,
    });
    const loadedResult = await resolveDispatchSendTargetReference({
      agentControllerRef: "builtin:codex",
      dispatchTask: createDispatchTask({
        attemptId: "attempt-2",
        dispatchId: "dispatch-2",
        targetProfileId: "agt_other",
      }),
      profileOwnerName: null,
      profileOwnerUserId: "usr-felix",
      targetProfileName: null,
    });

    expect(failedResult.status).toBe("failed");
    expect(loadedResult.status).toBe("loaded");
    expect(getMemberDirectoryMock).toHaveBeenCalledTimes(2);
  });

  it("passes the dispatch space password when loading protected space targets", async () => {
    getMemberDirectoryMock.mockResolvedValue(createMemberDirectory([]));

    await resolveDispatchSendTargetReference({
      agentControllerRef: "builtin:codex",
      dispatchTask: createDispatchTask({
        spacePassword: "correct-password",
      }),
      profileOwnerName: null,
      profileOwnerUserId: "usr-felix",
      targetProfileName: "Codex",
    });

    expect(getMemberDirectoryMock).toHaveBeenCalledWith({
      requestContext: { profile: { profileId: "agt_actor" } },
      spaceId: "space-1",
      spacePassword: "correct-password",
    });
  });
});

function createDispatchTask(
  input: {
    attemptId?: string;
    dispatchId?: string;
    spacePassword?: string | null;
    targetProfileId?: string;
  } = {}
): Parameters<typeof resolveDispatchSendTargetReference>[0]["dispatchTask"] {
  return {
    attemptId: input.attemptId ?? "attempt-1",
    dispatchId: input.dispatchId ?? "dispatch-1",
    sourceEventId: "signal-1",
    spaceId: "space-1",
    spacePassword: input.spacePassword ?? null,
    targetProfileId: input.targetProfileId ?? "agt_actor",
  };
}

function createMemberDirectory(
  members: SpaceMemberDirectory["members"] = [
    createDirectoryMember({
      displayName: "Watcher",
      profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      profileKind: "agent",
    }),
    createDirectoryMember({
      displayName: "Budget Analyst",
      profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      profileKind: "agent",
    }),
    createDirectoryMember({
      displayName: "Mira",
      profileId: "11111111-1111-4111-8111-111111111111",
      profileKind: "human",
    }),
  ]
): SpaceMemberDirectory {
  return {
    spaceId: "space-1",
    generatedAt: "2026-04-09T00:00:00.000Z",
    members,
  };
}

function createDirectoryMember(input: {
  displayName: string;
  profileId: string;
  profileKind: "agent" | "human";
}): SpaceMemberDirectory["members"][number] {
  const mentionLabels = [input.displayName];
  return {
    allowedRelations: {
      wake: input.profileKind === "agent",
      reference: input.profileKind === "agent",
      mention: input.profileKind === "human",
    },
    agentCard: null,
    displayName: input.displayName,
    labelSource: "profile_name",
    lookupTokens: [
      input.profileId,
      input.displayName.toLowerCase(),
      ...mentionLabels.map((label) => label.toLowerCase()),
    ],
    mentionAlias: null,
    mentionLabels,
    ownerName: input.profileKind === "agent" ? "Felix" : input.displayName,
    ownerUserId: input.profileKind === "agent" ? "usr-felix" : "usr-mira",
    preferredLookupToken: input.displayName.toLowerCase(),
    primaryMentionLabel: input.displayName,
    profileId: input.profileId,
    profileIdShort: input.profileId.startsWith("agt_")
      ? `agt_${input.profileId.slice(4, 9)}`
      : input.profileId.slice(0, 5),
    profileKind: input.profileKind,
    spaceRole: null,
  };
}
