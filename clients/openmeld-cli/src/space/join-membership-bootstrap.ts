import { cancel, confirm, isCancel, select } from "@clack/prompts";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import type {
  AgentProfileSetupResult,
  persistAgentTransportSelection,
  resolveAgentProfileSetup,
} from "../profile/agent-setup-flow";
import type {
  CreateProfileKind,
  createProfileByKind,
  resolveCreateProfileKind,
  resolveCreateProfileName,
} from "../profile/create-flow";
import { resolveOpenClawLocalDiagnosticsValue } from "../provider-hosts/openclaw/diagnostics";
import { formatInlineOpenMeldCliCommands } from "../runtime/cli-entry-command";
import type { createPresenter } from "../runtime/presenter/index";
import { resolveCurrentReplyReadinessSnapshot } from "../system/current-reply-readiness-snapshot";
import { buildReplyReadinessGuidance } from "../system/reply-readiness-guidance";
import { renderInfoCard } from "../ui/info-card";
import { buildPublicSpaceBringAgentsConfirmPromptConfig } from "../ui/public-space-warning";
import {
  promptSearchMultiselectWorkbench,
  type SearchPromptFooterAction,
  type SearchPromptFooterActionResolver,
} from "../ui/search-select";
import { formatTransportModeDisplay } from "../ui/transport-mode-display";
import type { StructuredGatewayFailure } from "./gateway-response";
import {
  buildBringProfilesWithYouPromptConfig,
  getJoinProfileWorkbenchMessage,
} from "./space-add-members-ui";

export type SpaceJoinMembershipBootstrapResult =
  | { status: "ready" }
  | { status: "back" }
  | { status: "cancelled" };

export type SpaceJoinProfileWorkbenchState = {
  pendingSelectedProfileIds: string[];
  locallyCreatedPendingProfiles: SpaceJoinMembershipCandidate[];
};

export type SpaceJoinMembershipCandidate = {
  openMeldProfile?: OpenMeldProfile;
  profileId: string;
  profileHandle?: string;
  profileName: string;
  profileKind: "human" | "agent";
  ownerProfileName?: string;
  ownerUserId?: string;
  ownerName?: string;
  agentControllerRef?: string;
  controllerEnabled?: boolean;
  localTargetAgentId?: string | null;
  localTargetDisplayName?: string | null;
  localTargetLaunchStatus?:
    | "ready"
    | "needs_choice"
    | "needs_repair"
    | "not_available"
    | null;
  localTargetSelectable?: boolean;
  localParticipationReadiness?:
    | "ready"
    | "needs_repair"
    | "not_running"
    | "not_installed"
    | "unknown"
    | null;
  localParticipationReasonCodes?: string[];
  localParticipationReasonText?: string | null;
  alreadyJoined: boolean;
  needsActivation: boolean;
};

type SpaceJoinAddMembersFlowResult = {
  status: "ready" | "cancelled" | "back";
  workbenchState: SpaceJoinProfileWorkbenchState;
};

type SpaceJoinWorkbenchSelectionResult =
  | { status: "ready" }
  | { status: "cancelled" }
  | {
      status: "retry";
      workbenchState: SpaceJoinProfileWorkbenchState;
    };

type SpaceJoinProfileWorkbenchAction = "create_new" | "join_now";

type SpaceJoinMembershipSearchItem = {
  value: string;
  label: string;
  detail: string;
  searchText: string;
  disabled: boolean;
};

type SpaceJoinMembershipApplyResult = {
  added: SpaceJoinMembershipCandidate[];
  alreadyJoined: SpaceJoinMembershipCandidate[];
  failed: Array<{
    candidate: SpaceJoinMembershipCandidate;
    error: unknown;
  }>;
  warnings: Array<{
    candidate: SpaceJoinMembershipCandidate;
    error: unknown;
  }>;
};

type SpaceJoinAddMembersNoticeSummary = {
  recordedCount: number;
  failedCount: number;
  firstFailure?: StructuredGatewayFailure;
};

type JoinMembershipBootstrapPresenter = ReturnType<typeof createPresenter>;

// Arrow-property signatures keep these dependencies contravariant: a new
// required parameter on an implementation must fail typecheck here instead of
// being silently accepted the way method-shorthand (bivariant) members allow.
export type SpaceJoinMembershipBootstrapDependencies = {
  resolveSpaceMemberCandidatesForAdd: (input: {
    currentProfile: OpenMeldProfile;
    currentOwnerUserId?: string;
    mode: "profiles";
    space: string;
    baseUrl: string;
    password?: string;
  }) => Promise<SpaceJoinMembershipCandidate[]>;
  resolveSelectedSpaceMemberCandidates: (input: {
    candidates: SpaceJoinMembershipCandidate[];
    selectedProfileIds: string[];
  }) => SpaceJoinMembershipCandidate[];
  normalizeRequestedMemberIds: (value: unknown) => string[];
  sortSpaceMemberCandidatesForPrompt: (input: {
    candidates: SpaceJoinMembershipCandidate[];
    initialSelectedProfileIds: string[];
  }) => SpaceJoinMembershipCandidate[];
  buildHumanSpaceMemberCandidateSearchItem: (
    candidate: SpaceJoinMembershipCandidate
  ) => SpaceJoinMembershipSearchItem;
  createProfileByKind: typeof createProfileByKind;
  resolveCreateProfileKind: typeof resolveCreateProfileKind;
  resolveCreateProfileName: typeof resolveCreateProfileName;
  resolveAgentProfileSetup: typeof resolveAgentProfileSetup;
  persistAgentTransportSelection: typeof persistAgentTransportSelection;
  prepareSpaceMemberCandidatesLocalParticipation: (input: {
    actorProfile: OpenMeldProfile;
    candidates: SpaceJoinMembershipCandidate[];
    presenter: JoinMembershipBootstrapPresenter;
    resolvedView: "human" | "agent";
  }) => Promise<
    | {
        status: "continue";
        candidates: SpaceJoinMembershipCandidate[];
      }
    | {
        status: "cancelled";
      }
  >;
  applySpaceAddMembers: (input: {
    actorProfile: OpenMeldProfile;
    candidates: SpaceJoinMembershipCandidate[];
    space: string;
    baseUrl: string;
    password?: string;
  }) => Promise<SpaceJoinMembershipApplyResult>;
  persistSpaceAddMembersJoinNotices: (input: {
    actorProfile: OpenMeldProfile;
    baseUrl: string;
    space: string;
    password?: string;
    addedMembers: SpaceJoinMembershipCandidate[];
  }) => Promise<SpaceJoinAddMembersNoticeSummary>;
  emitSpaceAddMembersResult: (input: {
    mode: "profiles";
    presenter: JoinMembershipBootstrapPresenter;
    resolvedView: "human" | "agent";
    space: string;
    selectedCount: number;
    result: SpaceJoinMembershipApplyResult;
    joinNoticeSummary: SpaceJoinAddMembersNoticeSummary;
  }) => void;
};

// Join membership bootstrap owns bring-profiles, workbench, create-profile,
// and apply-before-join flow only. Access truth and connect handoff stay out.
export async function resolveSpaceJoinMembershipBootstrap(
  input: {
    openMeldProfile: OpenMeldProfile;
    baseUrl: string;
    space: string;
    password?: string;
    publicSpace: boolean;
    canPromptPreJoinActions: boolean;
    skipBringProfilesPrompt: boolean;
    allowBackToTargetSelection: boolean;
    resolvedView: "human" | "agent";
    presenter: JoinMembershipBootstrapPresenter;
  },
  dependencies: SpaceJoinMembershipBootstrapDependencies
): Promise<SpaceJoinMembershipBootstrapResult> {
  if (!input.canPromptPreJoinActions) {
    return { status: "ready" };
  }
  if (input.skipBringProfilesPrompt) {
    return { status: "ready" };
  }

  let workbenchState = createSpaceJoinProfileWorkbenchState(
    undefined,
    dependencies
  );
  for (;;) {
    const addMembersDecision = await confirmJoinAddMembersBeforeConnect({
      allowBack: input.allowBackToTargetSelection,
    });
    if (addMembersDecision === null) {
      return { status: "cancelled" };
    }
    if (addMembersDecision === "back") {
      return { status: "back" };
    }
    if (addMembersDecision === "no") {
      return { status: "ready" };
    }

    const addMembersFlowResult = await runJoinAddMembersFlowBeforeConnect(
      {
        openMeldProfile: input.openMeldProfile,
        baseUrl: input.baseUrl,
        space: input.space,
        password: input.password,
        publicSpace: input.publicSpace,
        resolvedView: input.resolvedView,
        presenter: input.presenter,
        workbenchState,
      },
      dependencies
    );
    workbenchState = addMembersFlowResult.workbenchState;
    if (addMembersFlowResult.status === "back") {
      continue;
    }
    if (addMembersFlowResult.status === "cancelled") {
      return { status: "cancelled" };
    }
    return { status: "ready" };
  }
}

async function runJoinAddMembersFlowBeforeConnect(
  input: {
    openMeldProfile: OpenMeldProfile;
    baseUrl: string;
    space: string;
    password?: string;
    publicSpace: boolean;
    resolvedView: "human" | "agent";
    presenter: JoinMembershipBootstrapPresenter;
    workbenchState: SpaceJoinProfileWorkbenchState;
  },
  dependencies: SpaceJoinMembershipBootstrapDependencies
): Promise<SpaceJoinAddMembersFlowResult> {
  let workbenchState = createSpaceJoinProfileWorkbenchState(
    {
      pendingSelectedProfileIds: input.workbenchState.pendingSelectedProfileIds,
      locallyCreatedPendingProfiles:
        input.workbenchState.locallyCreatedPendingProfiles,
    },
    dependencies
  );

  for (;;) {
    const fetchedCandidates =
      await dependencies.resolveSpaceMemberCandidatesForAdd({
        currentProfile: input.openMeldProfile,
        currentOwnerUserId: input.openMeldProfile.ownerUserId,
        mode: "profiles",
        space: input.space,
        baseUrl: input.baseUrl,
        password: input.password,
      });
    workbenchState = reconcileSpaceJoinProfileWorkbenchState(
      {
        workbenchState,
        candidates: fetchedCandidates,
      },
      dependencies
    );
    const visibleCandidates = mergeSpaceJoinMembershipCandidates(
      fetchedCandidates,
      workbenchState.locallyCreatedPendingProfiles
    );

    const workbenchResult = await promptJoinProfileWorkbenchBeforeConnect(
      {
        candidates: visibleCandidates,
        workbenchState,
      },
      dependencies
    );
    workbenchState = createSpaceJoinProfileWorkbenchState(
      {
        pendingSelectedProfileIds: workbenchResult.selectedProfileIds,
        locallyCreatedPendingProfiles:
          workbenchState.locallyCreatedPendingProfiles,
      },
      dependencies
    );
    if (workbenchResult.status === "back") {
      return {
        status: "back",
        workbenchState,
      };
    }
    if (workbenchResult.status === "cancelled") {
      return {
        status: "cancelled",
        workbenchState,
      };
    }

    if (workbenchResult.action === "create_new") {
      const createdProfile = await runJoinCreateProfileBeforeConnect(
        {
          resolvedView: input.resolvedView,
          presenter: input.presenter,
        },
        dependencies
      );
      if (createdProfile === "cancelled") {
        return {
          status: "cancelled",
          workbenchState,
        };
      }
      if (!createdProfile) {
        continue;
      }
      workbenchState = createSpaceJoinProfileWorkbenchState(
        {
          pendingSelectedProfileIds: [
            ...workbenchState.pendingSelectedProfileIds,
            createdProfile.openMeldProfileId,
          ],
          locallyCreatedPendingProfiles: [
            ...workbenchState.locallyCreatedPendingProfiles,
            buildLocallyCreatedPendingSpaceJoinMembershipCandidate(
              createdProfile
            ),
          ],
        },
        dependencies
      );
      continue;
    }

    const submitResult = await runJoinWorkbenchSelectionBeforeConnect(
      {
        profile: input.openMeldProfile,
        baseUrl: input.baseUrl,
        space: input.space,
        ownerUserId: input.openMeldProfile.ownerUserId,
        password: input.password,
        publicSpace: input.publicSpace,
        resolvedView: input.resolvedView,
        presenter: input.presenter,
        workbenchState,
      },
      dependencies
    );
    if (submitResult.status === "cancelled") {
      return {
        status: "cancelled",
        workbenchState,
      };
    }
    if (submitResult.status === "retry") {
      workbenchState = submitResult.workbenchState;
      continue;
    }
    return {
      status: "ready",
      workbenchState,
    };
  }
}

function createSpaceJoinProfileWorkbenchState(
  input:
    | {
        pendingSelectedProfileIds?: string[];
        locallyCreatedPendingProfiles?: SpaceJoinMembershipCandidate[];
      }
    | undefined,
  dependencies: SpaceJoinMembershipBootstrapDependencies
): SpaceJoinProfileWorkbenchState {
  return {
    pendingSelectedProfileIds: dependencies.normalizeRequestedMemberIds(
      input?.pendingSelectedProfileIds
    ),
    locallyCreatedPendingProfiles: normalizeSpaceJoinMembershipCandidates(
      input?.locallyCreatedPendingProfiles
    ),
  };
}

function reconcileSpaceJoinProfileWorkbenchState(
  input: {
    workbenchState: SpaceJoinProfileWorkbenchState;
    candidates: SpaceJoinMembershipCandidate[];
  },
  dependencies: SpaceJoinMembershipBootstrapDependencies
): SpaceJoinProfileWorkbenchState {
  const visibleLocalPendingProfiles =
    input.workbenchState.locallyCreatedPendingProfiles.filter(
      (candidate) =>
        !input.candidates.some(
          (fetchedCandidate) =>
            fetchedCandidate.profileId === candidate.profileId
        )
    );
  const visibleCandidates = mergeSpaceJoinMembershipCandidates(
    input.candidates,
    visibleLocalPendingProfiles
  );
  const selectableIds = new Set(
    visibleCandidates
      .filter((candidate) => !candidate.alreadyJoined)
      .map((candidate) => candidate.profileId)
  );
  return createSpaceJoinProfileWorkbenchState(
    {
      pendingSelectedProfileIds:
        input.workbenchState.pendingSelectedProfileIds.filter((profileId) =>
          selectableIds.has(profileId)
        ),
      locallyCreatedPendingProfiles: visibleLocalPendingProfiles,
    },
    dependencies
  );
}

async function promptJoinProfileWorkbenchBeforeConnect(
  input: {
    candidates: SpaceJoinMembershipCandidate[];
    workbenchState: SpaceJoinProfileWorkbenchState;
  },
  dependencies: SpaceJoinMembershipBootstrapDependencies
): Promise<
  | {
      status: "action";
      action: SpaceJoinProfileWorkbenchAction;
      selectedProfileIds: string[];
    }
  | {
      status: "back";
      selectedProfileIds: string[];
    }
  | {
      status: "cancelled";
      selectedProfileIds: string[];
    }
> {
  const sortedCandidates = dependencies.sortSpaceMemberCandidatesForPrompt({
    candidates: input.candidates,
    initialSelectedProfileIds: input.workbenchState.pendingSelectedProfileIds,
  });
  const hasVisibleProfiles = sortedCandidates.some(
    (candidate) => !candidate.alreadyJoined
  );
  const footerActionsResolver: SearchPromptFooterActionResolver<string> = ({
    selectedValues,
  }) =>
    buildJoinProfileWorkbenchFooterActions({
      hasVisibleProfiles,
      selectedCount: selectedValues.length,
    });

  const selected = await promptSearchMultiselectWorkbench({
    message: getJoinProfileWorkbenchMessage(),
    items: sortedCandidates.map((candidate) =>
      dependencies.buildHumanSpaceMemberCandidateSearchItem(candidate)
    ),
    maxVisible: 8,
    allowBack: true,
    backLabel: "Back",
    emptyLabel: "No other profiles are available yet.",
    footerActions: footerActionsResolver({
      selectedValues: input.workbenchState.pendingSelectedProfileIds,
    }),
    footerActionsResolver,
    initialSelectedValues: input.workbenchState.pendingSelectedProfileIds,
  });
  if (selected.status === "action") {
    if (selected.action !== "create_new" && selected.action !== "join_now") {
      throw new Error(
        `unexpected join workbench action: ${String(selected.action)}`
      );
    }
    return {
      status: "action",
      action: selected.action,
      selectedProfileIds: dependencies.normalizeRequestedMemberIds(
        selected.selectedValues
      ),
    };
  }

  if (selected.status === "back") {
    return {
      status: "back",
      selectedProfileIds: dependencies.normalizeRequestedMemberIds(
        selected.selectedValues
      ),
    };
  }

  return {
    status: "cancelled",
    selectedProfileIds: dependencies.normalizeRequestedMemberIds(
      selected.selectedValues
    ),
  };
}

function buildJoinProfileWorkbenchFooterActions(input: {
  hasVisibleProfiles: boolean;
  selectedCount: number;
}): SearchPromptFooterAction[] {
  const createAction: SearchPromptFooterAction = {
    value: "create_new",
    icon: "🆕",
    label: "Create new profile",
    hint: "Create it, then return here.",
  };
  const joinAction: SearchPromptFooterAction = {
    value: "join_now",
    icon: "➡️",
    label: buildJoinProfileWorkbenchJoinActionLabel(input.selectedCount),
    separatorBefore: true,
    ...(input.selectedCount > 0 ? { accent: true } : {}),
    ...(input.selectedCount === 0
      ? {
          hint: "Select at least one profile first.",
          disabled: true,
        }
      : {}),
  };
  return [createAction, joinAction];
}

function buildJoinProfileWorkbenchJoinActionLabel(
  selectedCount: number
): string {
  const profileLabel = selectedCount === 1 ? "profile" : "profiles";
  return `Join this space with ${String(selectedCount)} selected ${profileLabel}`;
}

async function runJoinWorkbenchSelectionBeforeConnect(
  input: {
    profile: OpenMeldProfile;
    baseUrl: string;
    space: string;
    ownerUserId?: string;
    password?: string;
    publicSpace: boolean;
    resolvedView: "human" | "agent";
    presenter: JoinMembershipBootstrapPresenter;
    workbenchState: SpaceJoinProfileWorkbenchState;
  },
  dependencies: SpaceJoinMembershipBootstrapDependencies
): Promise<SpaceJoinWorkbenchSelectionResult> {
  const fetchedCandidates =
    await dependencies.resolveSpaceMemberCandidatesForAdd({
      currentProfile: input.profile,
      currentOwnerUserId: input.ownerUserId,
      mode: "profiles",
      space: input.space,
      baseUrl: input.baseUrl,
      password: input.password,
    });
  const candidates = mergeSpaceJoinMembershipCandidates(
    fetchedCandidates,
    input.workbenchState.locallyCreatedPendingProfiles
  );
  const selectedProfileIds = dependencies.normalizeRequestedMemberIds(
    input.workbenchState.pendingSelectedProfileIds
  );
  if (selectedProfileIds.length === 0) {
    return { status: "ready" };
  }
  const selectedCandidates = dependencies.resolveSelectedSpaceMemberCandidates({
    candidates,
    selectedProfileIds,
  });
  if (selectedCandidates.length !== selectedProfileIds.length) {
    const resolvedSelectedIds = new Set(
      selectedCandidates.map((candidate) => candidate.profileId)
    );
    const unresolvedSelectedProfileIds = selectedProfileIds.filter(
      (profileId) => !resolvedSelectedIds.has(profileId)
    );
    input.presenter.line({
      code: "space.join.membership_selection.sync_pending",
      text: "One or more selected profiles are still syncing. Review the list again, then retry when the missing profiles appear.",
      data: {
        unresolvedSelectedProfileIds,
      },
    });
    return {
      status: "retry",
      workbenchState: createSpaceJoinProfileWorkbenchState(
        {
          pendingSelectedProfileIds: selectedProfileIds,
          locallyCreatedPendingProfiles:
            input.workbenchState.locallyCreatedPendingProfiles,
        },
        dependencies
      ),
    };
  }
  const applyResult = await applySelectedSpaceAddMembersBeforeJoin(
    {
      actorProfile: input.profile,
      baseUrl: input.baseUrl,
      space: input.space,
      password: input.password,
      publicSpace: input.publicSpace,
      resolvedView: input.resolvedView,
      presenter: input.presenter,
      selectedCandidates,
      cancelResult: "cancelled",
    },
    dependencies
  );
  return applyResult === "cancelled"
    ? { status: "cancelled" }
    : { status: "ready" };
}

function mergeSpaceJoinMembershipCandidates(
  fetchedCandidates: SpaceJoinMembershipCandidate[],
  locallyCreatedPendingProfiles: SpaceJoinMembershipCandidate[]
): SpaceJoinMembershipCandidate[] {
  if (locallyCreatedPendingProfiles.length === 0) {
    return fetchedCandidates;
  }

  const mergedCandidates = [...fetchedCandidates];
  const seenProfileIds = new Set(
    fetchedCandidates.map((candidate) => candidate.profileId)
  );
  for (const candidate of locallyCreatedPendingProfiles) {
    if (seenProfileIds.has(candidate.profileId)) {
      continue;
    }
    seenProfileIds.add(candidate.profileId);
    mergedCandidates.push(candidate);
  }
  return mergedCandidates;
}

function normalizeSpaceJoinMembershipCandidates(
  value: unknown
): SpaceJoinMembershipCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedCandidates: SpaceJoinMembershipCandidate[] = [];
  const seenProfileIds = new Set<string>();
  for (const item of value) {
    const candidate = normalizeSpaceJoinMembershipCandidate(item);
    if (!candidate || seenProfileIds.has(candidate.profileId)) {
      continue;
    }
    seenProfileIds.add(candidate.profileId);
    normalizedCandidates.push(candidate);
  }
  return normalizedCandidates;
}

function normalizeSpaceJoinMembershipCandidate(
  value: unknown
): SpaceJoinMembershipCandidate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<SpaceJoinMembershipCandidate>;
  const profileId = String(candidate.profileId ?? "").trim();
  const profileName = String(candidate.profileName ?? "").trim();
  const profileKind = resolveSpaceJoinMembershipProfileKind(
    candidate.profileKind
  );
  if (!(profileId && profileName && profileKind)) {
    return null;
  }

  return {
    profileId,
    profileName,
    profileKind,
    alreadyJoined: candidate.alreadyJoined === true,
    needsActivation: candidate.needsActivation === true,
    profileHandle: normalizeOptionalString(candidate.profileHandle),
    ownerProfileName: normalizeOptionalString(candidate.ownerProfileName),
    ownerUserId: normalizeOptionalString(candidate.ownerUserId),
    ownerName: normalizeOptionalString(candidate.ownerName),
    agentControllerRef: normalizeOptionalString(candidate.agentControllerRef),
    controllerEnabled: candidate.controllerEnabled === true,
  };
}

function resolveSpaceJoinMembershipProfileKind(
  value: unknown
): SpaceJoinMembershipCandidate["profileKind"] | null {
  return value === "human" || value === "agent" ? value : null;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function buildLocallyCreatedPendingSpaceJoinMembershipCandidate(
  profile: OpenMeldProfile
): SpaceJoinMembershipCandidate {
  return {
    profileId: profile.openMeldProfileId,
    profileHandle: profile.profileHandle,
    profileName: profile.profileName,
    profileKind: profile.profileKind === "agent" ? "agent" : "human",
    ownerUserId: profile.ownerUserId,
    ownerName:
      typeof profile.ownerName === "string" ? profile.ownerName : undefined,
    agentControllerRef: undefined,
    controllerEnabled: false,
    alreadyJoined: false,
    needsActivation: false,
  };
}

async function confirmJoinAddMembersBeforeConnect(input: {
  allowBack: boolean;
}): Promise<"yes" | "no" | "back" | null> {
  const prompt = buildBringProfilesWithYouPromptConfig();
  const next = await select({
    message: prompt.message,
    initialValue: "no",
    options: [
      prompt.noOption,
      prompt.yesOption,
      ...(input.allowBack ? [prompt.backOption] : []),
    ],
  });
  if (isCancel(next)) {
    cancel("Cancelled.");
    return null;
  }
  if (next === "yes" || next === "no" || next === "back") {
    return next;
  }
  throw new Error(`unexpected join add-members decision: ${String(next)}`);
}

async function runJoinCreateProfileBeforeConnect(
  input: {
    resolvedView: "human" | "agent";
    presenter: JoinMembershipBootstrapPresenter;
  },
  dependencies: SpaceJoinMembershipBootstrapDependencies
): Promise<OpenMeldProfile | "cancelled" | null> {
  const draft = await resolveJoinCreatedProfileDraft(
    {
      resolvedView: input.resolvedView,
    },
    dependencies
  );
  if (draft === "cancelled") {
    cancel("Cancelled.");
    return "cancelled";
  }
  if (!draft) {
    return null;
  }

  const created = await dependencies.createProfileByKind({
    profileName: draft.profileName,
    profileKind: draft.profileKind,
    ...(draft.localAgentSelection
      ? { localAgentSelection: draft.localAgentSelection }
      : {}),
  });
  if (draft.setupResult?.status === "configured") {
    await dependencies.persistAgentTransportSelection({
      agentControllerRef: draft.setupResult.agentControllerRef,
      transportMode: draft.setupResult.transportMode,
    });
  }
  emitJoinCreatedProfileCard({
    presenter: input.presenter,
    profile: created,
    setupResult: draft.setupResult,
  });
  await emitJoinCreatedProfileReadinessNotice({
    presenter: input.presenter,
    profile: created,
    setupResult: draft.setupResult,
  });
  return created;
}

async function resolveJoinCreatedProfileDraft(
  input: {
    resolvedView: "human" | "agent";
  },
  dependencies: SpaceJoinMembershipBootstrapDependencies
): Promise<
  | {
      profileKind: CreateProfileKind;
      profileName: string;
      localAgentSelection?: {
        agentControllerRef: string;
        controllerEnabled: boolean;
      };
      setupResult: AgentProfileSetupResult | null;
    }
  | "cancelled"
  | null
> {
  while (true) {
    const profileKind = await dependencies.resolveCreateProfileKind({
      explicitKind: undefined,
      allowPrompt: true,
      resolvedView: input.resolvedView,
      allowBack: true,
      backLabel: "Back",
    });
    if (profileKind.status === "cancelled") {
      return "cancelled";
    }
    if (profileKind.status === "back") {
      return null;
    }

    while (true) {
      const profileName = await dependencies.resolveCreateProfileName({
        explicitProfileName: undefined,
        allowPrompt: true,
        resolvedView: input.resolvedView,
        profileKind: profileKind.value,
        allowBack: true,
        backLabel: "Back",
      });
      if (profileName.status === "cancelled") {
        return "cancelled";
      }
      if (profileName.status === "back") {
        break;
      }

      const localAgentSelectionResolution =
        await resolveJoinCreatedProfileLocalAgentSelection(
          profileKind.value,
          dependencies
        );
      if (localAgentSelectionResolution.status === "cancelled") {
        return "cancelled";
      }
      if (localAgentSelectionResolution.status === "back") {
        continue;
      }

      return {
        profileKind: profileKind.value,
        profileName: profileName.value,
        localAgentSelection: localAgentSelectionResolution.localAgentSelection,
        setupResult: localAgentSelectionResolution.setupResult,
      };
    }
  }
}

async function resolveJoinCreatedProfileLocalAgentSelection(
  profileKind: CreateProfileKind,
  dependencies: SpaceJoinMembershipBootstrapDependencies
): Promise<
  | {
      status: "submitted";
      localAgentSelection?: {
        agentControllerRef: string;
        controllerEnabled: boolean;
      };
      setupResult: AgentProfileSetupResult | null;
    }
  | {
      status: "back";
    }
  | {
      status: "cancelled";
    }
> {
  if (profileKind !== "agent") {
    return {
      status: "submitted",
      setupResult: null,
    };
  }

  const setupResult = await dependencies.resolveAgentProfileSetup({
    interactive: true,
    useAutoSelectionWhenNonInteractive: false,
    selectControllerMessage:
      "Choose which agent controller this profile should use.",
    selectTransportModeMessage:
      "How should this profile connect to its agent controller?",
    selectResponsePolicyMessage: "When should this profile auto-reply?",
    skipControllerOptionLabel: "Skip for now",
    allowBackToCaller: true,
  });
  if (setupResult.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }
  if (setupResult.status === "back") {
    return {
      status: "back",
    };
  }
  return {
    status: "submitted",
    ...(setupResult.status === "configured"
      ? {
          localAgentSelection: {
            agentControllerRef: setupResult.agentControllerRef,
            controllerEnabled: true,
          },
        }
      : {}),
    setupResult,
  };
}

function emitJoinCreatedProfileCard(input: {
  presenter: JoinMembershipBootstrapPresenter;
  profile: OpenMeldProfile;
  setupResult: AgentProfileSetupResult | null;
}): void {
  const controllerSummary =
    input.setupResult?.status === "configured"
      ? `${input.setupResult.controllerDisplayName} (${input.setupResult.agentControllerRef})`
      : "Not set up";
  const transportSummary =
    input.setupResult?.status === "configured"
      ? formatTransportModeDisplay(input.setupResult.transportMode)
      : "Not set up";

  renderInfoCard({
    presenter: input.presenter,
    title: "Profile Created",
    codePrefix: "space.join.profile_created.card",
    rows: [
      {
        label: "Profile Name",
        value: input.profile.profileName,
      },
      {
        label: "Type",
        value: input.profile.profileKind,
      },
      {
        label: "Profile ID",
        value: input.profile.openMeldProfileId,
      },
      {
        label: "Agent",
        value: controllerSummary,
      },
      {
        label: "Connection Type",
        value: transportSummary,
      },
    ],
    sanitize: true,
  });

  if (!input.setupResult || input.setupResult.status === "configured") {
    return;
  }

  const assignControllerCommand = `openmeld setup --profile ${input.profile.openMeldProfileId} --local-agent <agent-id>`;
  const summary =
    input.setupResult.status === "skipped_no_enabled_controllers"
      ? "OpenMeld created this profile without an agent because none is turned on right now."
      : "OpenMeld created this profile without an agent.";
  input.presenter.line({
    code: "space.join.profile_setup.skipped",
    text: formatInlineOpenMeldCliCommands(
      `${summary} You can set one later with \`${assignControllerCommand}\`.`
    ),
  });
}

async function emitJoinCreatedProfileReadinessNotice(input: {
  presenter: JoinMembershipBootstrapPresenter;
  profile: OpenMeldProfile;
  setupResult: AgentProfileSetupResult | null;
}): Promise<void> {
  if (
    input.profile.profileKind !== "agent" ||
    input.setupResult?.status !== "configured"
  ) {
    return;
  }

  const replyReadinessSnapshot = await resolveCurrentReplyReadinessSnapshot({
    checkGatewayChain: false,
    openClawDiagnosticsMode: "repair",
    ownerUserId: input.profile.ownerUserId,
    profile: input.profile,
  }).catch(() => null);
  const agentReplyReadiness = replyReadinessSnapshot?.agentReplyReadiness;
  if (
    !replyReadinessSnapshot ||
    agentReplyReadiness?.replyReadiness !== "blocked"
  ) {
    return;
  }

  const guidance = buildReplyReadinessGuidance({
    openClawLocalDiagnostics: resolveOpenClawLocalDiagnosticsValue(
      replyReadinessSnapshot.openClawLocalDiagnostics
    ),
    profile: input.profile,
    replyReadiness: agentReplyReadiness,
  });

  renderInfoCard({
    presenter: input.presenter,
    title: "Can't Reply Yet",
    codePrefix: "space.join.profile_ready_attention.card",
    sanitize: true,
    rows: [
      {
        label: "Profile Name",
        value: input.profile.profileName,
      },
      {
        label: "Can Reply in Space",
        value: "Unavailable",
      },
      {
        label: "Why",
        value: guidance.summary,
      },
      {
        label: "Do This",
        value:
          guidance.nextSteps[0] ??
          formatInlineOpenMeldCliCommands(
            "retry after OpenMeld local setup is fixed"
          ),
      },
      ...(guidance.nextSteps[1]
        ? [
            {
              label: "Then",
              value: guidance.nextSteps[1],
            },
          ]
        : []),
    ],
  });
}

async function applySelectedSpaceAddMembersBeforeJoin(
  input: {
    actorProfile: OpenMeldProfile;
    baseUrl: string;
    space: string;
    password?: string;
    publicSpace: boolean;
    resolvedView: "human" | "agent";
    presenter: JoinMembershipBootstrapPresenter;
    selectedCandidates: SpaceJoinMembershipCandidate[];
    cancelResult: "cancelled" | "back";
  },
  dependencies: SpaceJoinMembershipBootstrapDependencies
): Promise<"completed" | "cancelled" | "back"> {
  const confirmedCandidates =
    await filterAgentCandidatesForPublicSpaceBeforeJoin({
      candidates: input.selectedCandidates,
      publicSpace: input.publicSpace,
    });
  if (confirmedCandidates.status === "cancelled") {
    return input.cancelResult;
  }
  if (confirmedCandidates.skippedAgentCount > 0) {
    const profileLabel =
      confirmedCandidates.skippedAgentCount === 1 ? "profile" : "profiles";
    input.presenter.line({
      code: "space.add_members.public_agent_skipped",
      text: `Skipped ${String(confirmedCandidates.skippedAgentCount)} agent ${profileLabel} for this public space.`,
      data: {
        spaceId: input.space,
        skippedAgentCount: confirmedCandidates.skippedAgentCount,
      },
    });
  }
  if (confirmedCandidates.candidates.length === 0) {
    return "completed";
  }

  const servicePreparationResult =
    await dependencies.prepareSpaceMemberCandidatesLocalParticipation({
      actorProfile: input.actorProfile,
      candidates: confirmedCandidates.candidates,
      presenter: input.presenter,
      resolvedView: input.resolvedView,
    });
  if (servicePreparationResult.status === "cancelled") {
    return input.cancelResult;
  }

  const result = await dependencies.applySpaceAddMembers({
    actorProfile: input.actorProfile,
    candidates: servicePreparationResult.candidates,
    space: input.space,
    baseUrl: input.baseUrl,
    password: input.password,
  });
  const joinNoticeSummary =
    await dependencies.persistSpaceAddMembersJoinNotices({
      actorProfile: input.actorProfile,
      baseUrl: input.baseUrl,
      space: input.space,
      password: input.password,
      addedMembers: result.added,
    });
  dependencies.emitSpaceAddMembersResult({
    mode: "profiles",
    presenter: input.presenter,
    resolvedView: input.resolvedView,
    space: input.space,
    selectedCount: servicePreparationResult.candidates.length,
    result,
    joinNoticeSummary,
  });
  if (result.failed.length > 0 && result.added.length === 0) {
    throw new Error(
      `failed to add members for space ${input.space}: ${toErrorMessage(result.failed[0]?.error)}`
    );
  }
  return "completed";
}

async function filterAgentCandidatesForPublicSpaceBeforeJoin(input: {
  candidates: SpaceJoinMembershipCandidate[];
  publicSpace: boolean;
}): Promise<
  | {
      status: "ready";
      candidates: SpaceJoinMembershipCandidate[];
      skippedAgentCount: number;
    }
  | { status: "cancelled" }
> {
  if (!input.publicSpace) {
    return {
      status: "ready",
      candidates: input.candidates,
      skippedAgentCount: 0,
    };
  }

  const agentCandidates = input.candidates.filter(
    (candidate) => candidate.profileKind === "agent"
  );
  if (agentCandidates.length === 0) {
    return {
      status: "ready",
      candidates: input.candidates,
      skippedAgentCount: 0,
    };
  }

  const confirmed = await confirm({
    ...buildPublicSpaceBringAgentsConfirmPromptConfig({
      agentCount: agentCandidates.length,
    }),
    initialValue: true,
  });
  if (isCancel(confirmed)) {
    cancel("Cancelled.");
    return { status: "cancelled" };
  }
  if (confirmed) {
    return {
      status: "ready",
      candidates: input.candidates,
      skippedAgentCount: 0,
    };
  }
  return {
    status: "ready",
    candidates: input.candidates.filter(
      (candidate) => candidate.profileKind !== "agent"
    ),
    skippedAgentCount: agentCandidates.length,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}
