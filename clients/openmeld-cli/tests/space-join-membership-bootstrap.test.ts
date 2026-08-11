import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import type { createPresenter as createRuntimePresenter } from "../src/runtime/presenter/index";
import {
  resolveSpaceJoinMembershipBootstrap,
  type SpaceJoinMembershipBootstrapDependencies,
  type SpaceJoinMembershipCandidate,
} from "../src/space/join-membership-bootstrap";

const cancelMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const promptSearchMultiselectWorkbenchMock = vi.hoisted(() => vi.fn());
const resolveCurrentReplyReadinessSnapshotMock = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => {
  return {
    cancel: (...args: unknown[]) => cancelMock(...args),
    confirm: (...args: unknown[]) => confirmMock(...args),
    isCancel: (value: unknown) => isCancelMock(value),
    select: (...args: unknown[]) => selectMock(...args),
  };
});

vi.mock("../src/ui/search-select", () => {
  return {
    promptSearchMultiselectWorkbench: (
      ...args: Parameters<typeof promptSearchMultiselectWorkbenchMock>
    ) => promptSearchMultiselectWorkbenchMock(...args),
  };
});

vi.mock("../src/system/current-reply-readiness-snapshot", () => {
  return {
    resolveCurrentReplyReadinessSnapshot: (
      ...args: Parameters<typeof resolveCurrentReplyReadinessSnapshotMock>
    ) => resolveCurrentReplyReadinessSnapshotMock(...args),
  };
});

const OPENMELD_PROFILE = {
  openMeldProfileId: "hum-join-membership",
  profileName: "Felix",
  profileHandle: "felix",
  profileKind: "human",
  status: "active",
  ownerUserId: "user-1",
  source: "cli_create",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-03-05T00:00:00.000Z",
  updatedAt: "2026-03-05T00:00:00.000Z",
} satisfies OpenMeldProfile;

const HUMAN_CANDIDATE: SpaceJoinMembershipCandidate = {
  profileId: "11111111-1111-1111-1111-111111111111",
  profileName: "Other Human",
  profileKind: "human",
  alreadyJoined: false,
  needsActivation: false,
};

const AGENT_CANDIDATE: SpaceJoinMembershipCandidate = {
  profileId: "agt_11111111-1111-1111-1111-111111111111",
  profileName: "Ops Agent",
  profileKind: "agent",
  agentControllerRef: "builtin:codex",
  alreadyJoined: false,
  needsActivation: false,
};

type WorkbenchPromptInput = {
  message?: string;
  items?: Array<{ value: string }>;
  initialSelectedValues?: string[];
  emptyLabel?: string;
  footerActions?: Array<{
    value: string;
    label: string;
    disabled?: boolean;
  }>;
};

function createPresenter() {
  return {
    line: vi.fn(),
    data: vi.fn(),
    event: vi.fn(),
  } as unknown as ReturnType<typeof createRuntimePresenter>;
}

function normalizeRequestedMemberIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids: string[] = [];
  for (const item of value) {
    const profileId = String(item ?? "").trim();
    if (!profileId || ids.includes(profileId)) {
      continue;
    }
    ids.push(profileId);
  }
  return ids;
}

function createDependencies(input?: {
  resolveCandidates?: (
    ...args: Parameters<
      SpaceJoinMembershipBootstrapDependencies["resolveSpaceMemberCandidatesForAdd"]
    >
  ) => ReturnType<
    SpaceJoinMembershipBootstrapDependencies["resolveSpaceMemberCandidatesForAdd"]
  >;
  resolveSelected?: (
    ...args: Parameters<
      SpaceJoinMembershipBootstrapDependencies["resolveSelectedSpaceMemberCandidates"]
    >
  ) => ReturnType<
    SpaceJoinMembershipBootstrapDependencies["resolveSelectedSpaceMemberCandidates"]
  >;
}) {
  type ApplySpaceAddMembers =
    SpaceJoinMembershipBootstrapDependencies["applySpaceAddMembers"];
  type PersistSpaceAddMembersJoinNotices =
    SpaceJoinMembershipBootstrapDependencies["persistSpaceAddMembersJoinNotices"];
  type EmitSpaceAddMembersResult =
    SpaceJoinMembershipBootstrapDependencies["emitSpaceAddMembersResult"];

  const resolveSpaceMemberCandidatesForAdd = vi.fn(
    input?.resolveCandidates ??
      (async () =>
        [HUMAN_CANDIDATE, AGENT_CANDIDATE] as SpaceJoinMembershipCandidate[])
  );
  const resolveSelectedSpaceMemberCandidates = vi.fn(
    input?.resolveSelected ??
      ((selectionInput: {
        candidates: SpaceJoinMembershipCandidate[];
        selectedProfileIds: string[];
      }) =>
        selectionInput.selectedProfileIds
          .map((profileId) =>
            selectionInput.candidates.find(
              (candidate) => candidate.profileId === profileId
            )
          )
          .filter((candidate): candidate is SpaceJoinMembershipCandidate =>
            Boolean(candidate)
          ))
  );
  const createProfileByKind = vi.fn();
  const resolveCreateProfileKind = vi.fn();
  const resolveCreateProfileName = vi.fn();
  const resolveAgentProfileSetup = vi.fn();
  const persistAgentTransportSelection = vi.fn();
  const prepareSpaceMemberCandidatesLocalParticipation = vi.fn(
    (input: { candidates: SpaceJoinMembershipCandidate[] }) => {
      return Promise.resolve({
        status: "continue" as const,
        candidates: input.candidates,
      });
    }
  );
  const applySpaceAddMembers = vi.fn<ApplySpaceAddMembers>(async () => ({
    added: [],
    alreadyJoined: [],
    failed: [],
    warnings: [],
  }));
  const persistSpaceAddMembersJoinNotices =
    vi.fn<PersistSpaceAddMembersJoinNotices>(async () => ({
      recordedCount: 0,
      failedCount: 0,
    }));
  const emitSpaceAddMembersResult = vi.fn<EmitSpaceAddMembersResult>();

  return {
    resolveSpaceMemberCandidatesForAdd,
    resolveSelectedSpaceMemberCandidates,
    normalizeRequestedMemberIds,
    sortSpaceMemberCandidatesForPrompt: vi.fn(
      (sortInput: {
        candidates: SpaceJoinMembershipCandidate[];
        initialSelectedProfileIds: string[];
      }) => {
        if (sortInput.initialSelectedProfileIds.length === 0) {
          return sortInput.candidates;
        }
        const selectedIds = new Set(sortInput.initialSelectedProfileIds);
        return [...sortInput.candidates].sort((left, right) => {
          const leftSelected = selectedIds.has(left.profileId);
          const rightSelected = selectedIds.has(right.profileId);
          if (leftSelected === rightSelected) {
            return 0;
          }
          return leftSelected ? -1 : 1;
        });
      }
    ),
    buildHumanSpaceMemberCandidateSearchItem: vi.fn(
      (candidate: SpaceJoinMembershipCandidate) => ({
        value: candidate.profileId,
        label: candidate.profileName,
        detail: candidate.profileKind,
        searchText: `${candidate.profileId}\n${candidate.profileName}`,
        disabled: candidate.alreadyJoined,
      })
    ),
    createProfileByKind,
    resolveCreateProfileKind,
    resolveCreateProfileName,
    resolveAgentProfileSetup,
    persistAgentTransportSelection,
    prepareSpaceMemberCandidatesLocalParticipation,
    applySpaceAddMembers,
    persistSpaceAddMembersJoinNotices,
    emitSpaceAddMembersResult,
  } satisfies SpaceJoinMembershipBootstrapDependencies;
}

describe("space join membership bootstrap", () => {
  beforeEach(() => {
    cancelMock.mockReset();
    confirmMock.mockReset().mockResolvedValue(true);
    isCancelMock.mockReset().mockReturnValue(false);
    selectMock.mockReset().mockResolvedValue("no");
    promptSearchMultiselectWorkbenchMock.mockReset();
    resolveCurrentReplyReadinessSnapshotMock
      .mockReset()
      .mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns ready immediately when skipBringProfilesPrompt is true", async () => {
    const dependencies = createDependencies();

    const result = await resolveSpaceJoinMembershipBootstrap(
      {
        openMeldProfile: OPENMELD_PROFILE,
        baseUrl: "http://localhost:8080",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        publicSpace: true,
        canPromptPreJoinActions: true,
        skipBringProfilesPrompt: true,
        allowBackToTargetSelection: true,
        resolvedView: "human",
        presenter: createPresenter(),
      },
      dependencies
    );

    expect(result).toEqual({ status: "ready" });
    expect(selectMock).not.toHaveBeenCalled();
    expect(promptSearchMultiselectWorkbenchMock).not.toHaveBeenCalled();
  });

  it("returns ready immediately when host membership prompts are disabled", async () => {
    const dependencies = createDependencies();

    const result = await resolveSpaceJoinMembershipBootstrap(
      {
        openMeldProfile: OPENMELD_PROFILE,
        baseUrl: "http://localhost:8080",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        publicSpace: true,
        canPromptPreJoinActions: false,
        skipBringProfilesPrompt: false,
        allowBackToTargetSelection: true,
        resolvedView: "agent",
        presenter: createPresenter(),
      },
      dependencies
    );

    expect(result).toEqual({ status: "ready" });
    expect(selectMock).not.toHaveBeenCalled();
    expect(promptSearchMultiselectWorkbenchMock).not.toHaveBeenCalled();
    expect(
      dependencies.resolveSpaceMemberCandidatesForAdd
    ).not.toHaveBeenCalled();
  });

  it("returns back when the bring-profiles prompt selects back", async () => {
    const dependencies = createDependencies();
    selectMock.mockResolvedValueOnce("back");

    const result = await resolveSpaceJoinMembershipBootstrap(
      {
        openMeldProfile: OPENMELD_PROFILE,
        baseUrl: "http://localhost:8080",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        publicSpace: true,
        canPromptPreJoinActions: true,
        skipBringProfilesPrompt: false,
        allowBackToTargetSelection: true,
        resolvedView: "human",
        presenter: createPresenter(),
      },
      dependencies
    );

    expect(result).toEqual({ status: "back" });
  });

  it("returns cancelled when the bring-profiles prompt is cancelled", async () => {
    const dependencies = createDependencies();
    selectMock.mockResolvedValueOnce(Symbol("cancelled"));
    isCancelMock.mockReturnValueOnce(true);

    const result = await resolveSpaceJoinMembershipBootstrap(
      {
        openMeldProfile: OPENMELD_PROFILE,
        baseUrl: "http://localhost:8080",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        publicSpace: true,
        canPromptPreJoinActions: true,
        skipBringProfilesPrompt: false,
        allowBackToTargetSelection: true,
        resolvedView: "human",
        presenter: createPresenter(),
      },
      dependencies
    );

    expect(result).toEqual({ status: "cancelled" });
    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
  });

  it("opens the workbench even when there are no available profiles", async () => {
    const dependencies = createDependencies({
      resolveCandidates: () => Promise.resolve([]),
    });
    const workbenchCalls: WorkbenchPromptInput[] = [];

    selectMock.mockResolvedValueOnce("yes").mockResolvedValueOnce("no");
    promptSearchMultiselectWorkbenchMock.mockImplementation(
      (input: unknown) => {
        workbenchCalls.push(input as WorkbenchPromptInput);
        return Promise.resolve({
          status: "back",
          selectedValues: [],
        });
      }
    );

    const result = await resolveSpaceJoinMembershipBootstrap(
      {
        openMeldProfile: OPENMELD_PROFILE,
        baseUrl: "http://localhost:8080",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        publicSpace: true,
        canPromptPreJoinActions: true,
        skipBringProfilesPrompt: false,
        allowBackToTargetSelection: false,
        resolvedView: "human",
        presenter: createPresenter(),
      },
      dependencies
    );

    expect(result).toEqual({ status: "ready" });
    expect(workbenchCalls).toHaveLength(1);
    expect(workbenchCalls[0]).toMatchObject({
      message: "Review the profiles to bring into this space",
      emptyLabel: "No other profiles are available yet.",
      initialSelectedValues: [],
    });
    expect(workbenchCalls[0]?.items).toEqual([]);
    expect(workbenchCalls[0]?.footerActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "create_new",
          label: "Create new profile",
        }),
        expect.objectContaining({
          value: "join_now",
          disabled: true,
        }),
      ])
    );
  });

  it("keeps a created human profile selected when returning to the workbench", async () => {
    const createdHuman: OpenMeldProfile = {
      ...OPENMELD_PROFILE,
      openMeldProfileId: "33333333-3333-3333-3333-333333333333",
      profileName: "Fresh Human",
      profileHandle: "fresh-human",
    };
    let candidateCallCount = 0;
    const dependencies = createDependencies({
      resolveCandidates: () => {
        candidateCallCount += 1;
        if (candidateCallCount === 1) {
          return Promise.resolve([AGENT_CANDIDATE]);
        }
        return Promise.resolve([
          AGENT_CANDIDATE,
          {
            ...HUMAN_CANDIDATE,
            profileId: createdHuman.openMeldProfileId,
            profileName: createdHuman.profileName,
          },
        ]);
      },
    });
    dependencies.createProfileByKind.mockResolvedValueOnce(createdHuman);
    dependencies.resolveCreateProfileKind.mockResolvedValueOnce({
      status: "submitted",
      value: "human",
    });
    dependencies.resolveCreateProfileName.mockResolvedValueOnce({
      status: "submitted",
      value: "Fresh Human",
    });
    dependencies.applySpaceAddMembers.mockResolvedValueOnce({
      added: [
        AGENT_CANDIDATE,
        {
          ...HUMAN_CANDIDATE,
          profileId: createdHuman.openMeldProfileId,
          profileName: createdHuman.profileName,
        },
      ],
      alreadyJoined: [],
      failed: [],
      warnings: [],
    });

    const workbenchCalls: WorkbenchPromptInput[] = [];
    selectMock.mockResolvedValueOnce("yes");
    promptSearchMultiselectWorkbenchMock
      .mockImplementationOnce((input: unknown) => {
        workbenchCalls.push(input as WorkbenchPromptInput);
        return Promise.resolve({
          status: "action",
          action: "create_new",
          selectedValues: [AGENT_CANDIDATE.profileId],
        });
      })
      .mockImplementationOnce((input: unknown) => {
        workbenchCalls.push(input as WorkbenchPromptInput);
        return Promise.resolve({
          status: "action",
          action: "join_now",
          selectedValues: [
            AGENT_CANDIDATE.profileId,
            createdHuman.openMeldProfileId,
          ],
        });
      });

    const result = await resolveSpaceJoinMembershipBootstrap(
      {
        openMeldProfile: OPENMELD_PROFILE,
        baseUrl: "http://localhost:8080",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        publicSpace: false,
        canPromptPreJoinActions: true,
        skipBringProfilesPrompt: false,
        allowBackToTargetSelection: false,
        resolvedView: "human",
        presenter: createPresenter(),
      },
      dependencies
    );

    expect(result).toEqual({ status: "ready" });
    expect(dependencies.createProfileByKind).toHaveBeenCalledTimes(1);
    expect(workbenchCalls[1]?.initialSelectedValues).toEqual([
      AGENT_CANDIDATE.profileId,
      createdHuman.openMeldProfileId,
    ]);
    expect(dependencies.applySpaceAddMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.objectContaining({ profileId: AGENT_CANDIDATE.profileId }),
          expect.objectContaining({
            profileId: createdHuman.openMeldProfileId,
          }),
        ]),
      })
    );
  });

  it("keeps a newly created profile selected even before candidate refresh catches up", async () => {
    const createdHuman: OpenMeldProfile = {
      ...OPENMELD_PROFILE,
      openMeldProfileId: "44444444-4444-4444-4444-444444444444",
      profileName: "Eventually Visible Human",
      profileHandle: "eventually-visible-human",
    };
    const dependencies = createDependencies({
      resolveCandidates: () => Promise.resolve([AGENT_CANDIDATE]),
    });
    dependencies.createProfileByKind.mockResolvedValueOnce(createdHuman);
    dependencies.resolveCreateProfileKind.mockResolvedValueOnce({
      status: "submitted",
      value: "human",
    });
    dependencies.resolveCreateProfileName.mockResolvedValueOnce({
      status: "submitted",
      value: createdHuman.profileName,
    });
    dependencies.applySpaceAddMembers.mockResolvedValueOnce({
      added: [
        AGENT_CANDIDATE,
        {
          profileId: createdHuman.openMeldProfileId,
          profileName: createdHuman.profileName,
          profileHandle: createdHuman.profileHandle,
          profileKind: "human",
          ownerUserId: createdHuman.ownerUserId,
          alreadyJoined: false,
          needsActivation: false,
        },
      ],
      alreadyJoined: [],
      failed: [],
      warnings: [],
    });

    const workbenchCalls: WorkbenchPromptInput[] = [];
    selectMock.mockResolvedValueOnce("yes");
    promptSearchMultiselectWorkbenchMock
      .mockImplementationOnce((input: unknown) => {
        workbenchCalls.push(input as WorkbenchPromptInput);
        return Promise.resolve({
          status: "action",
          action: "create_new",
          selectedValues: [AGENT_CANDIDATE.profileId],
        });
      })
      .mockImplementationOnce((input: unknown) => {
        workbenchCalls.push(input as WorkbenchPromptInput);
        return Promise.resolve({
          status: "action",
          action: "join_now",
          selectedValues: [
            AGENT_CANDIDATE.profileId,
            createdHuman.openMeldProfileId,
          ],
        });
      });

    const result = await resolveSpaceJoinMembershipBootstrap(
      {
        openMeldProfile: OPENMELD_PROFILE,
        baseUrl: "http://localhost:8080",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        publicSpace: false,
        canPromptPreJoinActions: true,
        skipBringProfilesPrompt: false,
        allowBackToTargetSelection: false,
        resolvedView: "human",
        presenter: createPresenter(),
      },
      dependencies
    );

    expect(result).toEqual({ status: "ready" });
    expect(workbenchCalls[1]?.initialSelectedValues).toEqual([
      AGENT_CANDIDATE.profileId,
      createdHuman.openMeldProfileId,
    ]);
    expect(workbenchCalls[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: AGENT_CANDIDATE.profileId }),
        expect.objectContaining({ value: createdHuman.openMeldProfileId }),
      ])
    );
    expect(dependencies.applySpaceAddMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.objectContaining({ profileId: AGENT_CANDIDATE.profileId }),
          expect.objectContaining({
            profileId: createdHuman.openMeldProfileId,
          }),
        ]),
      })
    );
  });

  it("does not silently drop unresolved selected profiles before submit", async () => {
    const presenter = createPresenter();
    const dependencies = createDependencies({
      resolveCandidates: () => Promise.resolve([AGENT_CANDIDATE]),
    });

    selectMock.mockResolvedValueOnce("yes").mockResolvedValueOnce("no");
    promptSearchMultiselectWorkbenchMock
      .mockResolvedValueOnce({
        status: "action",
        action: "join_now",
        selectedValues: ["missing-profile-id"],
      })
      .mockResolvedValueOnce({
        status: "back",
        selectedValues: ["missing-profile-id"],
      });

    const result = await resolveSpaceJoinMembershipBootstrap(
      {
        openMeldProfile: OPENMELD_PROFILE,
        baseUrl: "http://localhost:8080",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        publicSpace: false,
        canPromptPreJoinActions: true,
        skipBringProfilesPrompt: false,
        allowBackToTargetSelection: false,
        resolvedView: "human",
        presenter,
      },
      dependencies
    );

    expect(result).toEqual({ status: "ready" });
    expect(dependencies.applySpaceAddMembers).not.toHaveBeenCalled();
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.join.membership_selection.sync_pending",
      })
    );
    expect(promptSearchMultiselectWorkbenchMock).toHaveBeenCalledTimes(2);
  });

  it("returns cancelled when agent controller setup is cancelled during create-profile", async () => {
    const dependencies = createDependencies();
    dependencies.resolveCreateProfileKind.mockResolvedValueOnce({
      status: "submitted",
      value: "agent",
    });
    dependencies.resolveCreateProfileName.mockResolvedValueOnce({
      status: "submitted",
      value: "Cancelled Agent",
    });
    dependencies.resolveAgentProfileSetup.mockResolvedValueOnce({
      status: "cancelled",
    });

    selectMock.mockResolvedValueOnce("yes");
    promptSearchMultiselectWorkbenchMock.mockResolvedValueOnce({
      status: "action",
      action: "create_new",
      selectedValues: [],
    });

    const result = await resolveSpaceJoinMembershipBootstrap(
      {
        openMeldProfile: OPENMELD_PROFILE,
        baseUrl: "http://localhost:8080",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        publicSpace: false,
        canPromptPreJoinActions: true,
        skipBringProfilesPrompt: false,
        allowBackToTargetSelection: false,
        resolvedView: "human",
        presenter: createPresenter(),
      },
      dependencies
    );

    expect(result).toEqual({ status: "cancelled" });
    expect(dependencies.createProfileByKind).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
  });

  it("filters only agent candidates when public-space agent confirmation is declined", async () => {
    const presenter = createPresenter();
    const dependencies = createDependencies();
    dependencies.applySpaceAddMembers.mockResolvedValueOnce({
      added: [HUMAN_CANDIDATE],
      alreadyJoined: [],
      failed: [],
      warnings: [],
    });
    confirmMock.mockResolvedValueOnce(false);
    selectMock.mockResolvedValueOnce("yes");
    promptSearchMultiselectWorkbenchMock.mockResolvedValueOnce({
      status: "action",
      action: "join_now",
      selectedValues: [HUMAN_CANDIDATE.profileId, AGENT_CANDIDATE.profileId],
    });

    const result = await resolveSpaceJoinMembershipBootstrap(
      {
        openMeldProfile: OPENMELD_PROFILE,
        baseUrl: "http://localhost:8080",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        password: "space-secret",
        publicSpace: true,
        canPromptPreJoinActions: true,
        skipBringProfilesPrompt: false,
        allowBackToTargetSelection: false,
        resolvedView: "human",
        presenter,
      },
      dependencies
    );

    expect(result).toEqual({ status: "ready" });
    expect(
      dependencies.resolveSpaceMemberCandidatesForAdd
    ).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ password: "space-secret" })
    );
    expect(dependencies.applySpaceAddMembers).toHaveBeenCalledWith(
      expect.objectContaining({
        password: "space-secret",
        candidates: [HUMAN_CANDIDATE],
      })
    );
    expect(presenter.line).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "space.add_members.public_agent_skipped",
      })
    );
  });

  it("fast-fails when add-members fails entirely with no added members", async () => {
    const dependencies = createDependencies();
    dependencies.applySpaceAddMembers.mockResolvedValueOnce({
      added: [],
      alreadyJoined: [],
      failed: [
        {
          candidate: HUMAN_CANDIDATE,
          error: new Error("member mutation failed"),
        },
      ],
      warnings: [],
    });

    selectMock.mockResolvedValueOnce("yes");
    promptSearchMultiselectWorkbenchMock.mockResolvedValueOnce({
      status: "action",
      action: "join_now",
      selectedValues: [HUMAN_CANDIDATE.profileId],
    });

    await expect(
      resolveSpaceJoinMembershipBootstrap(
        {
          openMeldProfile: OPENMELD_PROFILE,
          baseUrl: "http://localhost:8080",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          publicSpace: false,
          canPromptPreJoinActions: true,
          skipBringProfilesPrompt: false,
          allowBackToTargetSelection: false,
          resolvedView: "human",
          presenter: createPresenter(),
        },
        dependencies
      )
    ).rejects.toThrow(
      "failed to add members for space 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef: member mutation failed"
    );
  });
});
