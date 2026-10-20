import { cancel, confirm, isCancel, multiselect, select } from "@clack/prompts";
import {
  type AgentProfileReasoningLevelModelCapability,
  getAgentControllerPermissionModeFieldLabel,
  parseAgentControllerRef,
  resolveAgentControllerPermissionModeForController,
  resolveAgentProfileEditCapabilities,
  resolveNativeAgentControllerPermissionModeForController,
} from "@openmeld/agent-runtime";
import { compareAgentControllerRefsForDisplay } from "@openmeld/schemas";
import type {
  AgentControllerPermissionMode,
  ModelCatalogModel,
} from "@openmeld/schemas/types";
import pc from "picocolors";
import { resolveLocalRegistryAgentIdFromAgentControllerRef } from "../agents/controller-identity";
import {
  type AgentTargetState,
  listAgentTargetStates,
} from "../agents/registry";
import {
  buildCommandAuthenticationPromptMessage,
  ensureCommandAuthenticationOrCancel,
  evaluateCommandAuthentication,
} from "../auth/command-auth";
import {
  clearSelectedOpenMeldProfileId,
  getSelectedOpenMeldProfileId,
  setSelectedOpenMeldProfileId,
} from "../config/openmeld-profile-selection";
import {
  deleteOpenMeldProfile,
  listOpenMeldProfiles,
  type OpenMeldProfile,
  primeOpenMeldProfilesSessionCache,
  resolveOpenMeldProfile,
  updateOpenMeldProfile,
} from "../config/openmeld-profiles-api";
import { submitRuntimeAgentControllerReport } from "../local-service/reporting/runtime-agent-controller-reporting-submission";
import { loadMemberAgentListingView } from "../member-agents/command";
import {
  buildMemberAgentListingView,
  formatProfileMemberAgentParent,
  hasActiveOrganizationForMemberAgents,
  isMemberAgentsEnabled,
  type MemberAgentListingView,
  type ProfileMemberAgentParent,
  readMemberAgentListing,
  resolveProfileMemberAgentParent,
} from "../member-agents/read";
import {
  type AgentProfileSetupResult,
  persistAgentTransportSelection,
  resolveAgentProfileSetup,
} from "../profile/agent-setup-flow";
import {
  assertAgentControllerPermissionModeSupported,
  type NormalizedAgentControllerPermissionModeInput,
  resolveAgentControllerPermissionModeInput,
} from "../profile/controller-permission-mode-input";
import {
  type CreateProfileKind,
  type CreateProfileLocalAgentSelection,
  createProfileByKind,
  resolveCreateProfileKind,
  resolveCreateProfileName,
} from "../profile/create-flow";
import {
  type NormalizedModelSelectionInput,
  normalizeModelSelectionInput,
} from "../profile/model-selection-input";
import {
  ensureOpenMeldManagedProfileWorkspace,
  setCustomProfileWorkspace,
  setOpenMeldManagedProfileWorkspace,
} from "../profile-workspace/service";
import {
  buildAgentProfileRuntimeData,
  buildAgentProfileRuntimeRows,
  buildAgentProfileStateData,
  buildAgentProfileStateRows,
  resolveAgentProfileRuntimeState,
} from "../runtime/agent-profile-state";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
} from "../runtime/cli-entry-command";
import { type RuntimeContext, resolveRuntimeContext } from "../runtime/context";
import {
  createProfileActionGuideError,
  createProfileMenuGuideError,
  type ProfileActionGuideExamples,
} from "../runtime/dual-view-guide-catalog";
import { canUseInteractivePrompts } from "../runtime/interaction";
import { formatMessage } from "../runtime/messages";
import { createPresenter } from "../runtime/presenter/index";
import { isProfileKindAllowedInView } from "../runtime/view-profile-guard";
import { updateAgentProfilePrimaryBindingAgentControllerPermissionMode } from "../system/agent-profile-binding-agent-controller-permission-mode";
import { updateAgentProfilePrimaryBindingModelSelection } from "../system/agent-profile-binding-model-selection";
import {
  type AgentProfilePrimaryAgentControllerReport,
  resolveAgentProfilePrimaryAgentControllerReport,
} from "../system/agent-profile-primary-binding";
import {
  ensureAgentProfileRuntimeBinding,
  formatAgentProfileBindingUpdateFailure,
} from "../system/ensure-agent-profile-runtime-binding";
import { createModelCatalogReadSession } from "../system/model-catalog-read-session";
import { renderInfoCard } from "../ui/info-card";
import {
  promptSearchMultiselect,
  promptSearchSelect,
} from "../ui/search-select";
import { promptTextEntry } from "../ui/text-entry";

const EXIT_PROFILE_SELECTION = "__exit__";
const BACK_UPDATE_FIELD_SELECTION = "__back_update_field__";
type ProfileAction = "delete" | "set" | "show" | "update";
type ProfileCommandAuthAction = "create" | "list" | ProfileAction;
type UpdateFieldSelection =
  | "agent_controller_permission_mode"
  | "agent_controller"
  | "model_selection"
  | "name"
  | "workspace";
type ProfileUpdateCommandExamples = Record<string, never>;
type PromptFlowResult<T> =
  | {
      status: "submitted";
      value: T;
    }
  | {
      status: "back";
    }
  | {
      status: "cancelled";
    };

export async function runProfileMenu(input?: {
  view?: string;
  entryChecksHandled?: boolean;
}) {
  const runtime = await resolveRuntimeContext({ view: input?.view });

  if (!canUseInteractivePrompts(runtime)) {
    throw createProfileMenuGuideError();
  }

  if (!input?.entryChecksHandled) {
    const authReady = await ensureProfileCommandAuthenticationOrCancel({
      action: "list",
      runtime,
    });
    if (!authReady) {
      return;
    }
  }

  while (true) {
    const action = await select({
      message: "Profile action",
      options: [
        { value: "create", label: "Create profile" },
        { value: "set", label: "Choose profile" },
        { value: "update", label: "Update profile" },
        { value: "delete", label: "Delete profile" },
        { value: "exit", label: "Exit" },
      ],
    });

    if (isCancel(action) || action === "exit") {
      cancel("Cancelled.");
      return;
    }

    if (
      !(
        action === "create" ||
        action === "set" ||
        action === "update" ||
        action === "delete"
      )
    ) {
      cancel("Cancelled.");
      return;
    }

    if (action === "create") {
      await runProfileCreate({
        view: input?.view,
        entryChecksHandled: true,
      });
      return;
    }

    if (action === "set") {
      await runProfileSet({
        view: input?.view,
        entryChecksHandled: true,
      });
      return;
    }

    if (action === "update") {
      const result = await runProfileUpdate({
        view: input?.view,
        entryChecksHandled: true,
        allowBackToCaller: true,
      });
      if (result === "back") {
        continue;
      }
      return;
    }

    await runProfileDelete({
      view: input?.view,
      entryChecksHandled: true,
    });
    return;
  }
}

export async function runProfileList(input?: {
  view?: string;
  entryChecksHandled?: boolean;
}) {
  const runtime = await resolveRuntimeContext({ view: input?.view });
  if (!input?.entryChecksHandled) {
    const authReady = await ensureProfileCommandAuthenticationOrCancel({
      action: "list",
      runtime,
    });
    if (!authReady) {
      return;
    }
  }
  const presenter = createPresenter(runtime);

  const profiles = await listVisibleProfilesForListByView(runtime.resolvedView);
  if (profiles.length === 0) {
    presenter.line({
      code: "profile.no_profiles",
      text: formatMessage(runtime.resolvedView, "profile.no_profiles"),
    });
    return;
  }

  const current = await resolveSelectedProfileIdForList(profiles);
  const memberAgentListing = (await shouldReadProfileMemberAgents())
    ? buildMemberAgentListingView({
        listing: await readMemberAgentListing(),
        profiles,
      })
    : null;
  for (const profile of profiles) {
    const selected = profile.openMeldProfileId === current;
    const memberAgent = resolveProfileParentForOutput({
      memberAgentListing,
      profile,
    });
    presenter.line({
      code: "profile.item",
      text: formatProfileListLine({
        memberAgent,
        profile,
        selected,
        resolvedView: runtime.resolvedView,
      }),
      data: {
        ...buildProfileListData({
          profile,
          selected,
        }),
        ...(memberAgent ? { memberAgent } : {}),
      },
    });
  }
}

export async function runProfileShow(input: {
  profile?: string;
  details?: boolean;
  json?: boolean;
  view?: string;
  entryChecksHandled?: boolean;
}) {
  const runtime = await resolveRuntimeContext({ view: input.view });
  if (!input.entryChecksHandled) {
    const authReady = await ensureProfileCommandAuthenticationOrCancel({
      action: "show",
      runtime,
    });
    if (!authReady) {
      return;
    }
  }
  const presenter = createPresenter(runtime);
  const allowPrompt = canUseInteractivePrompts(runtime);
  const explicitProfileId = normalizeOptionalString(input.profile);
  const visibleProfiles = explicitProfileId
    ? []
    : await listVisibleProfilesForListByView(runtime.resolvedView);
  const current = explicitProfileId
    ? null
    : await resolveCurrentProfileId({
        profiles: visibleProfiles,
        mutateSelection: false,
      });
  const profileId =
    explicitProfileId ??
    current ??
    (await resolveTargetProfile({
      explicitProfile: undefined,
      action: "show",
      allowPrompt,
      resolvedView: runtime.resolvedView,
      cachedProfiles: visibleProfiles,
      guideExamples: await resolveProfileUpdateCommandExamples(),
    }));
  if (!profileId) {
    return;
  }

  const profile = await resolveOpenMeldProfile({
    openMeldProfileId: profileId,
  });
  assertProfileAllowedInView({
    profileId: profile.openMeldProfileId,
    profileKind: profile.profileKind,
    resolvedView: runtime.resolvedView,
    action: "show",
  });
  const primaryBinding = await resolveProfileShowPrimaryBinding(profile).catch(
    (error: unknown) => {
      if (runtime.resolvedView !== "human" || input.json === true) {
        throw error;
      }
      console.error(
        "[openmeld.profile.binding_diagnostics_unavailable]",
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  );
  const agentRuntimeState = await resolveAgentProfileRuntimeState(profile, {
    includeDaemonRouteObservation: true,
    primaryBinding,
  });
  const memberAgent = resolveProfileParentForOutput({
    memberAgentListing:
      profile.profileKind === "agent" && (await shouldReadProfileMemberAgents())
        ? await loadMemberAgentListingView()
        : null,
    profile,
  });
  const memberAgentData = memberAgent ? { memberAgent } : {};
  if (input.json === true) {
    console.log(
      `${JSON.stringify(
        {
          ...buildProfileShowJsonPayload({
            agentRuntimeState,
            primaryBinding,
            profile,
          }),
          ...memberAgentData,
        },
        null,
        2
      )}`
    );
    return;
  }

  if (runtime.resolvedView === "human") {
    renderProfileSummaryCard({
      presenter,
      profile,
      agentRuntimeState,
      memberAgent,
    });
    return;
  }

  if (input.details !== true) {
    presenter.line({
      code: "profile.show",
      text: `profile: ${profile.openMeldProfileId}`,
      data: {
        ...buildCompactAgentProfileData({
          agentRuntimeState,
          primaryBinding,
          profile,
        }),
        ...memberAgentData,
      },
    });
    return;
  }
  presenter.line({
    code: "profile.show",
    text: `profile: ${profile.openMeldProfileId}`,
    data: {
      profile: profile.openMeldProfileId,
      openMeldProfileId: profile.openMeldProfileId,
      profileName: profile.profileName,
      profileHandle: profile.profileHandle,
      profileKind: profile.profileKind,
      ownerUserId: profile.ownerUserId,
      binding: buildAgentProfileBindingData(primaryBinding),
      ...buildAgentProfileStateData(profile),
      ...buildAgentProfileRuntimeData(agentRuntimeState),
      ...memberAgentData,
    },
  });
}

// Parent MemberAgents are printed only with the release flag on and an active
// Organization; otherwise Profile commands keep their previous output.
async function shouldReadProfileMemberAgents(): Promise<boolean> {
  return (
    isMemberAgentsEnabled() && (await hasActiveOrganizationForMemberAgents())
  );
}

function resolveProfileParentForOutput(input: {
  memberAgentListing: MemberAgentListingView | null;
  profile: OpenMeldProfile;
}): ProfileMemberAgentParent | null {
  if (!input.memberAgentListing || input.profile.profileKind !== "agent") {
    return null;
  }
  return resolveProfileMemberAgentParent({
    openMeldProfileId: input.profile.openMeldProfileId,
    view: input.memberAgentListing,
  });
}

async function resolveProfileShowPrimaryBinding(
  profile: OpenMeldProfile
): Promise<AgentProfilePrimaryAgentControllerReport | null> {
  if (profile.profileKind !== "agent") {
    return null;
  }
  return await resolveAgentProfilePrimaryAgentControllerReport({
    profile,
  });
}

function buildProfileShowJsonPayload(input: {
  agentRuntimeState: Awaited<
    ReturnType<typeof resolveAgentProfileRuntimeState>
  >;
  primaryBinding: AgentProfilePrimaryAgentControllerReport | null;
  profile: OpenMeldProfile;
}): Record<string, unknown> {
  return {
    profile: input.profile.openMeldProfileId,
    openMeldProfileId: input.profile.openMeldProfileId,
    profileName: input.profile.profileName,
    profileHandle: input.profile.profileHandle,
    profileKind: input.profile.profileKind,
    ownerUserId: input.profile.ownerUserId,
    status: input.profile.status,
    binding: buildAgentProfileBindingData(input.primaryBinding),
    runtime: buildAgentProfileRuntimeData(input.agentRuntimeState),
  };
}

function buildAgentProfileBindingData(
  primaryBinding: AgentProfilePrimaryAgentControllerReport | null
): Record<string, unknown> | null {
  if (!primaryBinding) {
    return null;
  }

  return {
    agentControllerConversationId:
      primaryBinding.primaryBinding.executionTarget
        ?.agentControllerConversationId ?? null,
    agentControllerPermissionMode:
      resolveNativeAgentControllerPermissionModeForController(
        primaryBinding.primaryBinding.agentControllerPermissionMode,
        { agentControllerRef: primaryBinding.agentControllerRef }
      ) ?? null,
    agentControllerRef: primaryBinding.agentControllerRef,
    openMeldServiceRuntimeId:
      primaryBinding.primaryBinding.executionTarget?.openMeldServiceRuntimeId ??
      null,
    bindingState: primaryBinding.bindingState,
    modelSelection: primaryBinding.primaryBinding.modelSelection ?? null,
    reasonCodes: primaryBinding.reasonCodes,
    routable: primaryBinding.routable,
  };
}

export async function runProfileCreate(input: {
  profileName?: string;
  kind?: string;
  agentController?: string;
  agentControllerConversationId?: string;
  controllerEnabled?: boolean;
  agentControllerPermissionModeInput?: string;
  confirmDangerousAgentControllerPermissionMode?: boolean;
  model?: string;
  reasoningEffort?: string;
  view?: string;
  entryChecksHandled?: boolean;
}) {
  const runtime = await resolveRuntimeContext({ view: input.view });
  if (!input.entryChecksHandled) {
    const authReady = await ensureProfileCommandAuthenticationOrCancel({
      action: "create",
      runtime,
    });
    if (!authReady) {
      return;
    }
  }
  const presenter = createPresenter(runtime);
  const allowPrompt = canUseInteractivePrompts(runtime);
  const draft = await resolveProfileCreateDraft({
    input,
    allowPrompt,
    resolvedView: runtime.resolvedView,
  });
  if (!draft) {
    return;
  }

  const created = await createProfileByKind({
    profileName: draft.profileName,
    profileKind: draft.profileKind,
    ...(draft.localAgentSelection
      ? { localAgentSelection: draft.localAgentSelection }
      : {}),
  });
  if (draft.setupResult?.status === "configured") {
    await persistAgentTransportSelection({
      agentControllerRef:
        draft.localAgentSelection?.agentControllerRef ??
        draft.setupResult.agentControllerRef,
      transportMode: draft.setupResult.transportMode,
    });
  }
  if (created.profileKind === "agent" && draft.localAgentSelection) {
    await ensureOpenMeldManagedProfileWorkspace({
      openMeldProfileId: created.openMeldProfileId,
    });
  }
  const agentRuntimeState: Awaited<
    ReturnType<typeof resolveAgentProfileRuntimeState>
  > = null;
  const selectionResult =
    runtime.resolvedView === "human"
      ? await setSelectedOpenMeldProfileId(created.openMeldProfileId)
      : null;

  await emitProfileCreateResult({
    runtime,
    presenter,
    profile: created,
    agentRuntimeState,
    selectionResult,
    setupResult: draft.setupResult,
  });
}

async function resolveProfileCreateDraft(input: {
  input: {
    profileName?: string;
    kind?: string;
    agentController?: string;
    agentControllerConversationId?: string;
    controllerEnabled?: boolean;
    agentControllerPermissionModeInput?: string;
    confirmDangerousAgentControllerPermissionMode?: boolean;
    model?: string;
    reasoningEffort?: string;
  };
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
}): Promise<{
  profileKind: CreateProfileKind;
  profileName: string;
  localAgentSelection?: CreateProfileLocalAgentSelection;
  setupResult: AgentProfileSetupResult | null;
} | null> {
  const kindWasPrompted = !input.input.kind && input.allowPrompt;
  while (true) {
    const profileKind = await resolveCreateProfileKind({
      explicitKind: input.input.kind,
      allowPrompt: input.allowPrompt,
      resolvedView: input.resolvedView,
    });
    if (profileKind.status !== "submitted") {
      cancel("Cancelled.");
      return null;
    }

    while (true) {
      const profileName = await resolveCreateProfileName({
        explicitProfileName: input.input.profileName,
        allowPrompt: input.allowPrompt,
        resolvedView: input.resolvedView,
        profileKind: profileKind.value,
        allowBack: kindWasPrompted,
      });
      if (profileName.status === "cancelled") {
        cancel("Cancelled.");
        return null;
      }
      if (profileName.status === "back") {
        break;
      }

      const localAgentSelectionResolution =
        await resolveProfileCreateLocalAgentSelection({
          profileKind: profileKind.value,
          agentController: input.input.agentController,
          agentControllerConversationId:
            input.input.agentControllerConversationId,
          controllerEnabled: input.input.controllerEnabled,
          agentControllerPermissionModeInput:
            input.input.agentControllerPermissionModeInput,
          confirmDangerousAgentControllerPermissionMode:
            input.input.confirmDangerousAgentControllerPermissionMode,
          model: input.input.model,
          reasoningEffort: input.input.reasoningEffort,
          allowPrompt: input.allowPrompt,
          allowBackToCaller: !input.input.profileName,
        });
      if (localAgentSelectionResolution.status === "cancelled") {
        cancel("Cancelled.");
        return null;
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

async function resolveProfileCreateLocalAgentSelection(input: {
  profileKind: CreateProfileKind;
  agentController?: string;
  agentControllerConversationId?: string;
  controllerEnabled?: boolean;
  agentControllerPermissionModeInput?: string;
  confirmDangerousAgentControllerPermissionMode?: boolean;
  model?: string;
  reasoningEffort?: string;
  allowPrompt: boolean;
  allowBackToCaller: boolean;
}): Promise<
  | {
      status: "submitted";
      localAgentSelection?: CreateProfileLocalAgentSelection;
      setupResult: AgentProfileSetupResult | null;
    }
  | {
      status: "back";
    }
  | {
      status: "cancelled";
    }
> {
  const modelSelection = normalizeModelSelectionInput({
    model: input.model,
    reasoningEffort: input.reasoningEffort,
  });
  const controllerPermissionMode =
    await resolveAgentControllerPermissionModeInput({
      agentControllerRef: input.agentController,
      allowPrompt: input.allowPrompt,
      confirmDangerousAgentControllerPermissionMode:
        input.confirmDangerousAgentControllerPermissionMode,
      agentControllerPermissionModeInput:
        input.agentControllerPermissionModeInput,
      flagName: "--agent-controller-permission-mode",
    });
  const localAgentSelection = await normalizeCreateLocalAgentSelectionInput({
    profileKind: input.profileKind,
    agentController: input.agentController,
    agentControllerConversationId: input.agentControllerConversationId,
    controllerEnabled: input.controllerEnabled,
  });
  if (
    input.profileKind !== "agent" &&
    modelSelection.hasAnyModelSelectionInput
  ) {
    throw new Error("--model can only be used with --kind agent.");
  }
  if (
    input.profileKind !== "agent" &&
    controllerPermissionMode.hasAnyAgentControllerPermissionModeInput
  ) {
    throw new Error(
      "--agent-controller-permission-mode can only be used with --kind agent."
    );
  }
  if (localAgentSelection) {
    return {
      status: "submitted",
      localAgentSelection: applyCreateLocalAgentSelectionIntents(
        localAgentSelection,
        {
          controllerPermissionMode,
          modelSelection,
        }
      ),
      setupResult: null,
    };
  }
  if (modelSelection.hasAnyModelSelectionInput && !input.allowPrompt) {
    throw new Error(
      "--model requires --agent-controller when prompts are disabled."
    );
  }
  if (
    controllerPermissionMode.hasAnyAgentControllerPermissionModeInput &&
    !input.allowPrompt
  ) {
    throw new Error(
      "--agent-controller-permission-mode requires --agent-controller when prompts are disabled."
    );
  }
  if (
    input.profileKind !== "agent" ||
    localAgentSelection ||
    !input.allowPrompt
  ) {
    return {
      status: "submitted",
      ...(localAgentSelection ? { localAgentSelection } : {}),
      setupResult: null,
    };
  }

  return await resolvePromptedProfileCreateLocalAgentSelection({
    allowBackToCaller: input.allowBackToCaller,
    controllerPermissionMode,
    modelSelection,
  });
}

type ProfileCreateLocalAgentSelectionResolution =
  | {
      status: "submitted";
      localAgentSelection?: CreateProfileLocalAgentSelection;
      setupResult: AgentProfileSetupResult | null;
    }
  | {
      status: "back";
    }
  | {
      status: "cancelled";
    };

async function resolvePromptedProfileCreateLocalAgentSelection(input: {
  allowBackToCaller: boolean;
  controllerPermissionMode: NormalizedAgentControllerPermissionModeInput;
  modelSelection: NormalizedModelSelectionInput;
}): Promise<ProfileCreateLocalAgentSelectionResolution> {
  const setupResult = await resolveAgentProfileSetup({
    interactive: true,
    useAutoSelectionWhenNonInteractive: false,
    selectControllerMessage: "Choose an agent controller for this profile.",
    selectTransportModeMessage:
      "How should this profile connect to its agent controller?",
    selectResponsePolicyMessage: "When should this profile auto-reply?",
    skipControllerOptionLabel: "Skip for now",
    allowBackToCaller: input.allowBackToCaller,
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
  if (
    setupResult.status !== "configured" &&
    (input.modelSelection.hasAnyModelSelectionInput ||
      input.controllerPermissionMode.hasAnyAgentControllerPermissionModeInput)
  ) {
    throw new Error(
      "--model and --agent-controller-permission-mode require an agent controller."
    );
  }
  return {
    status: "submitted",
    ...(setupResult.status === "configured"
      ? {
          localAgentSelection: applyCreateLocalAgentSelectionIntents(
            buildBuiltinLocalAgentSelection(setupResult.agentControllerRef),
            {
              controllerPermissionMode: input.controllerPermissionMode,
              modelSelection: input.modelSelection,
            }
          ),
        }
      : {}),
    setupResult,
  };
}

function applyCreateLocalAgentSelectionIntents(
  selection: CreateProfileLocalAgentSelection,
  input: {
    controllerPermissionMode: NormalizedAgentControllerPermissionModeInput;
    modelSelection: NormalizedModelSelectionInput;
  }
): CreateProfileLocalAgentSelection {
  if (input.controllerPermissionMode.agentControllerPermissionMode) {
    if (!selection.agentControllerRef) {
      throw new Error(
        "--agent-controller-permission-mode requires an agent controller."
      );
    }
    assertAgentControllerPermissionModeSupported({
      agentControllerPermissionMode:
        input.controllerPermissionMode.agentControllerPermissionMode,
      agentControllerRef: selection.agentControllerRef,
      flagName: "--agent-controller-permission-mode",
    });
  }
  return {
    ...selection,
    ...(input.controllerPermissionMode.agentControllerPermissionMode
      ? {
          agentControllerPermissionMode:
            input.controllerPermissionMode.agentControllerPermissionMode,
        }
      : {}),
    ...(input.modelSelection.modelId
      ? { modelId: input.modelSelection.modelId }
      : {}),
    ...(input.modelSelection.reasoningLevel
      ? { reasoningLevel: input.modelSelection.reasoningLevel }
      : {}),
  };
}

function buildBuiltinLocalAgentSelection(agentControllerRef: string): {
  agentControllerRef: string;
  controllerEnabled: true;
} {
  const parsed = parseAgentControllerRef(agentControllerRef);
  return {
    agentControllerRef: parsed?.ref ?? `builtin:${agentControllerRef}`,
    controllerEnabled: true,
  };
}

async function emitProfileCreateResult(input: {
  runtime: RuntimeContext;
  presenter: ReturnType<typeof createPresenter>;
  profile: OpenMeldProfile;
  agentRuntimeState: Awaited<
    ReturnType<typeof resolveAgentProfileRuntimeState>
  >;
  selectionResult: Awaited<
    ReturnType<typeof setSelectedOpenMeldProfileId>
  > | null;
  setupResult: AgentProfileSetupResult | null;
}): Promise<void> {
  if (input.runtime.resolvedView === "human") {
    if (!input.selectionResult) {
      throw new Error("profile.create selection result missing in human view");
    }
    renderProfileReadyCard({
      presenter: input.presenter,
      profile: input.profile,
      state: "created",
      agentRuntimeState: input.agentRuntimeState,
    });
    emitNonPersistentSelectionWarning({
      runtime: input.runtime,
      presenter: input.presenter,
      selectionPersistent: input.selectionResult.persistent,
      cliContextSource: input.selectionResult.cliContextSource,
    });
    await emitProfileCreateAgentSetupHint({
      presenter: input.presenter,
      resolvedView: input.runtime.resolvedView,
      profile: input.profile,
      setupResult: input.setupResult,
    });
    return;
  }

  input.presenter.line({
    code: "profile.created",
    text: `created Agent Profile identity: ${input.profile.openMeldProfileId}`,
    data: {
      openMeldProfileId: input.profile.openMeldProfileId,
      profileName: input.profile.profileName,
      profileHandle: input.profile.profileHandle,
      profileKind: input.profile.profileKind,
      ownerUserId: input.profile.ownerUserId,
      ...buildAgentProfileStateData(input.profile),
      ...buildAgentProfileRuntimeData(input.agentRuntimeState),
      currentProfileChanged: false,
      ...buildAgentCreateWakeReadinessData(input.profile),
      nextSteps: buildAgentCreateNextSteps(input.profile),
    },
  });
  await emitProfileCreateAgentSetupHint({
    presenter: input.presenter,
    resolvedView: input.runtime.resolvedView,
    profile: input.profile,
    setupResult: input.setupResult,
  });

  input.presenter.line({
    code: "profile.selection_unchanged",
    text: `created profile ${input.profile.openMeldProfileId}; current profile was not changed`,
    data: {
      createdProfileId: input.profile.openMeldProfileId,
      currentProfileChanged: false,
      reason:
        "Agent View profile creation does not change the acting identity. Pass --profile explicitly when this profile should act.",
      ...buildAgentCreateWakeReadinessData(input.profile),
      nextSteps: buildAgentCreateNextSteps(input.profile),
    },
  });
}

function emitProfileCreateAgentSetupHint(input: {
  presenter: ReturnType<typeof createPresenter>;
  resolvedView: "human" | "agent";
  profile: OpenMeldProfile;
  setupResult: AgentProfileSetupResult | null;
}): void {
  if (!input.setupResult || input.setupResult.status === "configured") {
    return;
  }

  const prepareCommand = formatOpenMeldCliCommand(
    `openmeld setup --profile ${input.profile.openMeldProfileId}`
  );
  const explicitLocalAgentSetupCommand = formatOpenMeldCliCommand(
    `openmeld setup --profile ${input.profile.openMeldProfileId} --local-agent <local-agent-id> --view agent`
  );
  const summary =
    input.setupResult.status === "skipped_no_enabled_controllers"
      ? "No enabled agent controller is available, so the profile was created without one."
      : "Agent controller setup was skipped, so the profile was created without one.";

  if (input.resolvedView === "agent") {
    input.presenter.line({
      code: "profile.create.agent_setup.skipped",
      text: summary,
      data: {
        status: input.setupResult.status,
        ...(input.setupResult.status === "skipped_no_enabled_controllers" &&
        input.setupResult.reason
          ? { reason: input.setupResult.reason }
          : {}),
        profileId: input.profile.openMeldProfileId,
        nextSteps: [
          `For this existing profile, run ${explicitLocalAgentSetupCommand} when you know which local agent it should use.`,
          `Or run ${prepareCommand} in an interactive Terminal and choose the local agent there.`,
        ],
        localAgentSetupCommand: explicitLocalAgentSetupCommand,
      },
    });
    return;
  }

  input.presenter.line({
    code: "profile.create.agent_setup.skipped",
    text: formatInlineOpenMeldCliCommands(
      `${summary} For this existing profile, run \`openmeld setup --profile ${input.profile.openMeldProfileId} --local-agent <local-agent-id>\` when you know which local agent it should use, or run \`${prepareCommand}\` in an interactive Terminal.`
    ),
  });
}

export async function runProfileSet(input: {
  profile?: string;
  view?: string;
  entryChecksHandled?: boolean;
}) {
  const runtime = await resolveRuntimeContext({ view: input.view });
  if (!input.entryChecksHandled) {
    const authReady = await ensureProfileCommandAuthenticationOrCancel({
      action: "set",
      runtime,
    });
    if (!authReady) {
      return;
    }
  }
  const presenter = createPresenter(runtime);

  const profileId = await resolveTargetProfile({
    explicitProfile: input.profile,
    action: "set",
    allowPrompt: canUseInteractivePrompts(runtime),
    resolvedView: runtime.resolvedView,
  });
  if (!profileId) {
    return;
  }

  const profile = await resolveOpenMeldProfile({
    openMeldProfileId: profileId,
  });
  const agentRuntimeState = await resolveAgentProfileRuntimeState(profile);
  assertProfileAllowedInView({
    profileId: profile.openMeldProfileId,
    profileKind: profile.profileKind,
    resolvedView: runtime.resolvedView,
    action: "set",
  });

  const selectionResult = await setSelectedOpenMeldProfileId(
    profile.openMeldProfileId
  );

  if (runtime.resolvedView === "human") {
    renderProfileReadyCard({
      presenter,
      profile,
      state: "selected",
      agentRuntimeState,
    });
    emitNonPersistentSelectionWarning({
      runtime,
      presenter,
      selectionPersistent: selectionResult.persistent,
      cliContextSource: selectionResult.cliContextSource,
    });
    return;
  }

  presenter.line({
    code: "profile.current_set",
    text: formatMessage(runtime.resolvedView, "profile.current_set", {
      profile: profile.openMeldProfileId,
    }),
    data: {
      profile: profile.openMeldProfileId,
      openMeldProfileId: profile.openMeldProfileId,
      profileName: profile.profileName,
      profileHandle: profile.profileHandle,
      profileKind: profile.profileKind,
      ownerUserId: profile.ownerUserId,
      ...buildAgentProfileStateData(profile),
      ...buildAgentProfileRuntimeData(agentRuntimeState),
    },
  });
  emitNonPersistentSelectionWarning({
    runtime,
    presenter,
    selectionPersistent: selectionResult.persistent,
    cliContextSource: selectionResult.cliContextSource,
  });
}

export async function runProfileDelete(input: {
  profile?: string;
  force?: boolean;
  view?: string;
  entryChecksHandled?: boolean;
}) {
  const runtime = await resolveRuntimeContext({ view: input.view });
  if (!input.entryChecksHandled) {
    const authReady = await ensureProfileCommandAuthenticationOrCancel({
      action: "delete",
      runtime,
    });
    if (!authReady) {
      return;
    }
  }
  const presenter = createPresenter(runtime);

  const visibleProfiles = await listVisibleProfilesForListByView(
    runtime.resolvedView
  );
  const current = await resolveCurrentProfileId({
    profiles: visibleProfiles,
    mutateSelection: false,
  });
  const profileIds = await resolveTargetProfilesForDelete({
    explicitProfile: input.profile,
    allowPrompt: canUseInteractivePrompts(runtime),
    resolvedView: runtime.resolvedView,
    cachedProfiles: visibleProfiles,
    presenter,
  });
  if (!profileIds) {
    return;
  }

  const profiles: OpenMeldProfile[] = [];
  for (const profileId of profileIds) {
    const profile = await resolveOpenMeldProfile({
      openMeldProfileId: profileId,
    });
    assertProfileAllowedInView({
      profileId: profile.openMeldProfileId,
      profileKind: profile.profileKind,
      resolvedView: runtime.resolvedView,
      action: "delete",
    });
    assertProfileDeletable(profile);
    profiles.push(profile);
  }

  const confirmed = await confirmDelete({
    profiles: profiles.map((profile) => profile.openMeldProfileId),
    force: input.force,
    allowPrompt: canUseInteractivePrompts(runtime),
    resolvedView: runtime.resolvedView,
  });
  if (!confirmed) {
    return;
  }

  const deletedProfileIds = new Set<string>();
  for (const profile of profiles) {
    await deleteOpenMeldProfile({
      openMeldProfileId: profile.openMeldProfileId,
    });
    deletedProfileIds.add(profile.openMeldProfileId);
    presenter.line({
      code: "profile.deleted",
      text: formatMessage(runtime.resolvedView, "profile.deleted", {
        profile: profile.openMeldProfileId,
      }),
      data: { profile: profile.openMeldProfileId },
    });
  }

  const remainingProfiles = (
    await listVisibleProfilesForListByView(runtime.resolvedView)
  ).filter((item) => !deletedProfileIds.has(item.openMeldProfileId));
  const remaining = remainingProfiles.map((item) => item.openMeldProfileId);
  const selected = await getSelectedOpenMeldProfileId();
  const selectedMissing = Boolean(selected && !remaining.includes(selected));
  const shouldSwitch =
    selectedMissing || (current ? deletedProfileIds.has(current) : false);
  if (!shouldSwitch) {
    return;
  }
  const fallback = await resolveCurrentProfileId({
    profiles: remainingProfiles,
    mutateSelection: false,
  });

  if (fallback) {
    await setSelectedOpenMeldProfileId(fallback);
    presenter.line({
      code: "profile.current_switched",
      text: formatMessage(runtime.resolvedView, "profile.current_switched", {
        profile: fallback,
      }),
      data: { profile: fallback },
    });
    return;
  }

  await clearSelectedOpenMeldProfileId();
  presenter.line({
    code: "profile.no_active",
    text: formatMessage(runtime.resolvedView, "profile.no_active"),
  });
}

export async function runProfileUpdate(input: {
  profile?: string;
  profileName?: string;
  agentController?: string;
  agentControllerConversationId?: string;
  agentControllerPermissionModeInput?: string;
  confirmDangerousAgentControllerPermissionMode?: boolean;
  model?: string;
  reasoningEffort?: string;
  workspaceMode?: string;
  workspacePath?: string;
  details?: boolean;
  view?: string;
  entryChecksHandled?: boolean;
  allowBackToCaller?: boolean;
}): Promise<"back" | undefined> {
  const runtime = await resolveRuntimeContext({ view: input.view });
  if (!input.entryChecksHandled) {
    const authReady = await ensureProfileCommandAuthenticationOrCancel({
      action: "update",
      runtime,
    });
    if (!authReady) {
      return;
    }
  }
  const presenter = createPresenter(runtime);
  const allowPrompt = canUseInteractivePrompts(runtime);
  const explicitProfileId = normalizeOptionalString(input.profile);

  const visibleProfiles = explicitProfileId
    ? []
    : await listVisibleProfilesForListByView(runtime.resolvedView);
  const current = explicitProfileId
    ? null
    : await resolveCurrentProfileId({
        profiles: visibleProfiles,
        mutateSelection: false,
      });

  const resolvedSelection = await resolveProfileUpdateSelection({
    explicitProfileId,
    allowPrompt,
    resolvedView: runtime.resolvedView,
    presenter,
    visibleProfiles,
    currentProfileId: current,
    profileName: input.profileName,
    agentController: input.agentController,
    agentControllerConversationId: input.agentControllerConversationId,
    agentControllerPermissionModeInput:
      input.agentControllerPermissionModeInput,
    confirmDangerousAgentControllerPermissionMode:
      input.confirmDangerousAgentControllerPermissionMode,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    workspaceMode: input.workspaceMode,
    workspacePath: input.workspacePath,
  });
  if (resolvedSelection.status !== "submitted") {
    return handleProfileUpdateExit({
      status: resolvedSelection.status,
      allowBackToCaller: input.allowBackToCaller === true,
    });
  }

  const { profile, payload } = resolvedSelection.value;
  const updated = await applyProfileUpdatePatch({
    profile,
    payload,
  });
  const agentRuntimeState = await resolveAgentProfileRuntimeState(updated);
  if (runtime.resolvedView === "human") {
    renderProfileReadyCard({
      presenter,
      profile: updated,
      state: "updated",
      agentRuntimeState,
    });
    return;
  }

  const primaryBinding = await resolveProfileShowPrimaryBinding(updated);
  if (input.details !== true) {
    presenter.line({
      code: "profile.updated",
      text: `updated profile: ${updated.openMeldProfileId}`,
      data: {
        ...buildCompactAgentProfileData({
          agentRuntimeState,
          primaryBinding,
          profile: updated,
        }),
        updatedFields: payload.updatedFields,
      },
    });
    return;
  }

  presenter.line({
    code: "profile.updated",
    text: `updated profile: ${updated.openMeldProfileId}`,
    data: {
      profile: updated.openMeldProfileId,
      openMeldProfileId: updated.openMeldProfileId,
      profileName: updated.profileName,
      profileHandle: updated.profileHandle,
      profileKind: updated.profileKind,
      ownerUserId: updated.ownerUserId,
      updatedFields: payload.updatedFields,
      binding: buildAgentProfileBindingData(primaryBinding),
      ...buildAgentProfileStateData(updated),
      ...buildAgentProfileRuntimeData(agentRuntimeState),
      nextSteps: buildAgentUpdateNextSteps(updated),
    },
  });
}

function buildCompactAgentProfileData(input: {
  agentRuntimeState: Awaited<
    ReturnType<typeof resolveAgentProfileRuntimeState>
  >;
  primaryBinding: AgentProfilePrimaryAgentControllerReport | null;
  profile: OpenMeldProfile;
}): Record<string, unknown> {
  const binding = buildAgentProfileBindingData(input.primaryBinding);
  const runtime = buildAgentProfileRuntimeData(input.agentRuntimeState);
  return {
    profile: input.profile.openMeldProfileId,
    openMeldProfileId: input.profile.openMeldProfileId,
    profileName: input.profile.profileName,
    profileKind: input.profile.profileKind,
    status: input.profile.status,
    binding: binding
      ? {
          agentControllerRef: binding.agentControllerRef,
          agentControllerConversationId: binding.agentControllerConversationId,
          agentControllerPermissionMode: binding.agentControllerPermissionMode,
          bindingState: binding.bindingState,
          routable: binding.routable,
          modelSelection: binding.modelSelection,
        }
      : null,
    replyReadiness: runtime.replyReadiness ?? null,
    workspace: runtime.workspace
      ? {
          status: runtime.workspace.status,
          configuredWorkspace: runtime.workspace.configuredWorkspace,
          effectiveRuntimeWorkingDirectory:
            runtime.workspace.effectiveRuntimeWorkingDirectory,
        }
      : null,
    nextAction: formatOpenMeldCliCommand(
      `openmeld profiles show ${input.profile.openMeldProfileId} --details --view agent`
    ),
  };
}

async function resolveProfileUpdateSelection(input: {
  explicitProfileId: string | null;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
  presenter: ReturnType<typeof createPresenter>;
  visibleProfiles: OpenMeldProfile[];
  currentProfileId: string | null;
  profileName?: string;
  agentController?: string;
  agentControllerConversationId?: string;
  agentControllerPermissionModeInput?: string;
  confirmDangerousAgentControllerPermissionMode?: boolean;
  model?: string;
  reasoningEffort?: string;
  workspaceMode?: string;
  workspacePath?: string;
}): Promise<
  PromptFlowResult<{
    profile: OpenMeldProfile;
    payload: ProfileUpdatePayload;
  }>
> {
  while (true) {
    const profileId = await resolveProfileIdForUpdate({
      explicitProfile: input.explicitProfileId ?? undefined,
      allowPrompt: input.allowPrompt,
      resolvedView: input.resolvedView,
      presenter: input.presenter,
      visibleProfiles: input.visibleProfiles,
      currentProfileId: input.currentProfileId,
    });
    if (profileId.status !== "submitted") {
      return profileId;
    }

    const selection = await resolveProfileUpdateSelectionForProfile({
      profileId: profileId.value,
      resolvedView: input.resolvedView,
      allowPrompt: input.allowPrompt,
      profileName: input.profileName,
      agentController: input.agentController,
      agentControllerConversationId: input.agentControllerConversationId,
      agentControllerPermissionModeInput:
        input.agentControllerPermissionModeInput,
      confirmDangerousAgentControllerPermissionMode:
        input.confirmDangerousAgentControllerPermissionMode,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      workspaceMode: input.workspaceMode,
      workspacePath: input.workspacePath,
    });
    if (selection.status === "back" && input.explicitProfileId === null) {
      continue;
    }
    return selection;
  }
}

async function resolveProfileUpdateSelectionForProfile(input: {
  profileId: string;
  resolvedView: "human" | "agent";
  allowPrompt: boolean;
  profileName?: string;
  agentController?: string;
  agentControllerConversationId?: string;
  agentControllerPermissionModeInput?: string;
  confirmDangerousAgentControllerPermissionMode?: boolean;
  model?: string;
  reasoningEffort?: string;
  workspaceMode?: string;
  workspacePath?: string;
}): Promise<
  PromptFlowResult<{
    profile: OpenMeldProfile;
    payload: ProfileUpdatePayload;
  }>
> {
  const profile = await resolveOpenMeldProfile({
    openMeldProfileId: input.profileId,
  });
  assertProfileAllowedInView({
    profileId: profile.openMeldProfileId,
    profileKind: profile.profileKind,
    resolvedView: input.resolvedView,
    action: "update",
  });

  const payload = await resolveProfileUpdatePayload({
    profile,
    allowPrompt: input.allowPrompt,
    resolvedView: input.resolvedView,
    profileName: input.profileName,
    agentController: input.agentController,
    agentControllerConversationId: input.agentControllerConversationId,
    agentControllerPermissionModeInput:
      input.agentControllerPermissionModeInput,
    confirmDangerousAgentControllerPermissionMode:
      input.confirmDangerousAgentControllerPermissionMode,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    workspaceMode: input.workspaceMode,
    workspacePath: input.workspacePath,
  });
  if (payload.status !== "submitted") {
    return payload;
  }

  return {
    status: "submitted",
    value: {
      profile,
      payload: payload.value,
    },
  };
}

function handleProfileUpdateExit(input: {
  status: "back" | "cancelled";
  allowBackToCaller: boolean;
}): "back" | undefined {
  if (input.status === "back" && input.allowBackToCaller) {
    return "back";
  }
  cancel("Cancelled.");
  return undefined;
}

async function applyProfileUpdatePatch(input: {
  profile: OpenMeldProfile;
  payload: ProfileUpdatePayload;
}): Promise<OpenMeldProfile> {
  const hasProfilePatch = Boolean(input.payload.profileName);
  const updated = hasProfilePatch
    ? await updateOpenMeldProfile({
        openMeldProfileId: input.profile.openMeldProfileId,
        ...(input.payload.profileName
          ? { profileName: input.payload.profileName }
          : {}),
      })
    : input.profile;
  await applyAgentProfileWorkspace({
    profile: updated,
    workspaceMode: input.payload.workspaceMode,
    customWorkspacePath: input.payload.customWorkspacePath,
  });
  await applyAgentProfileControllerBinding({
    agentControllerConversationId: input.payload.agentControllerConversationId,
    agentControllerRef: input.payload.agentControllerRef,
    modelId: input.payload.modelId,
    profile: updated,
    reasoningLevel: input.payload.reasoningLevel,
  });
  await applyAgentProfileControllerPermissionMode({
    agentControllerPermissionMode: input.payload.agentControllerPermissionMode,
    profile: updated,
  });
  return updated;
}

async function resolveProfileIdForUpdate(input: {
  explicitProfile: string | undefined;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
  presenter: ReturnType<typeof createPresenter>;
  visibleProfiles: OpenMeldProfile[];
  currentProfileId: string | null;
}): Promise<PromptFlowResult<string>> {
  const fromInput = String(input.explicitProfile ?? "").trim();
  if (fromInput) {
    return {
      status: "submitted",
      value: fromInput,
    };
  }
  const profileUpdateExamples = await resolveProfileUpdateCommandExamples();

  if (input.resolvedView === "agent") {
    if (input.visibleProfiles.length === 0) {
      throw createProfileActionGuideError(
        "update",
        "no agent profiles found; create one after signing in.",
        toProfileActionGuideExamples(profileUpdateExamples)
      );
    }
    throw createProfileActionGuideError(
      "update",
      "explicit profile argument is required in agent view.",
      toProfileActionGuideExamples(profileUpdateExamples)
    );
  }

  if (!input.allowPrompt) {
    emitProfileUpdateCandidatesForHuman({
      presenter: input.presenter,
      profiles: input.visibleProfiles,
      currentProfileId: input.currentProfileId,
      examples: profileUpdateExamples,
    });
    if (input.visibleProfiles.length === 0) {
      throw new Error(formatMessage(input.resolvedView, "profile.no_profiles"));
    }
    throw new Error(
      formatMessage(input.resolvedView, "profile.target.missing", {
        action: "update",
      })
    );
  }

  const selected = await promptSearchSelect({
    message: "Choose a profile to update",
    items: input.visibleProfiles.map((profile) =>
      buildProfileSearchItem({
        profile,
        current: input.currentProfileId,
        resolvedView: input.resolvedView,
      })
    ),
    maxVisible: 8,
    allowBack: true,
    backLabel: "Back",
  });
  if (selected.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }
  if (selected.status === "back") {
    return {
      status: "back",
    };
  }
  return {
    status: "submitted",
    value: selected.value,
  };
}

function emitProfileUpdateCandidatesForHuman(input: {
  presenter: ReturnType<typeof createPresenter>;
  profiles: OpenMeldProfile[];
  currentProfileId: string | null;
  examples: ProfileUpdateCommandExamples;
}): void {
  input.presenter.line({
    code: "profile.update.candidates.header",
    text: "Available profiles to update:",
  });
  if (input.profiles.length === 0) {
    input.presenter.line({
      code: "profile.update.candidates.empty",
      text: "- (none)",
    });
  }
  for (const profile of input.profiles) {
    const selected =
      profile.openMeldProfileId === input.currentProfileId ? " (selected)" : "";
    input.presenter.line({
      code: "profile.update.candidates.item",
      text:
        `- ${normalizeProfileDisplayName(profile)} (${profile.openMeldProfileId})${selected}` +
        ` · ${profile.profileKind} · updatable: ${resolveUpdatableFields(profile).join(", ")}`,
    });
  }

  const firstHuman = input.profiles.find(
    (profile) => profile.profileKind === "human"
  );
  const firstAgent = input.profiles.find(
    (profile) => profile.profileKind === "agent"
  );
  input.presenter.line({
    code: "profile.update.candidates.next",
    text: "Now: run one of these examples to continue update without interactive prompts:",
  });
  if (firstHuman) {
    input.presenter.line({
      code: "profile.update.candidates.next.item",
      text: `- ${formatOpenMeldCliCommand(
        `openmeld profiles update ${firstHuman.openMeldProfileId} --name "<new-name>"`
      )}`,
    });
  }
  if (firstAgent) {
    input.presenter.line({
      code: "profile.update.candidates.next.item",
      text: `- ${formatOpenMeldCliCommand(
        `openmeld setup --profile ${firstAgent.openMeldProfileId}`
      )}`,
    });
    input.presenter.line({
      code: "profile.update.candidates.next.item",
      text: `- ${formatOpenMeldCliCommand(
        `openmeld profiles update ${firstAgent.openMeldProfileId} --workspace-mode openmeld-managed`
      )}`,
    });
    input.presenter.line({
      code: "profile.update.candidates.next.item",
      text: `- ${formatOpenMeldCliCommand(
        `openmeld profiles update ${firstAgent.openMeldProfileId} --workspace-mode custom --workspace-path /absolute/path`
      )}`,
    });
  }
}

async function resolveProfileUpdatePayload(input: {
  profile: OpenMeldProfile;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
  profileName?: string;
  agentController?: string;
  agentControllerConversationId?: string;
  agentControllerPermissionModeInput?: string;
  confirmDangerousAgentControllerPermissionMode?: boolean;
  model?: string;
  reasoningEffort?: string;
  workspaceMode?: string;
  workspacePath?: string;
}): Promise<PromptFlowResult<ProfileUpdatePayload>> {
  const profileName = normalizeOptionalString(input.profileName);
  const explicitAgentController =
    await resolveExplicitAgentControllerPatchForProfile({
      agentController: input.agentController,
      agentControllerConversationId: input.agentControllerConversationId,
      profile: input.profile,
    });
  const explicitWorkspace = resolveExplicitWorkspacePatchForProfile({
    profile: input.profile,
    workspaceMode: input.workspaceMode,
    workspacePath: input.workspacePath,
  });
  const explicitModelSelection = resolveExplicitModelSelectionPatchForProfile({
    model: input.model,
    profile: input.profile,
    reasoningEffort: input.reasoningEffort,
  });
  const explicitAgentControllerPermissionMode =
    await resolveExplicitAgentControllerPermissionModePatchForProfile({
      agentControllerRef: explicitAgentController?.agentControllerRef,
      allowPrompt: input.allowPrompt,
      confirmDangerousAgentControllerPermissionMode:
        input.confirmDangerousAgentControllerPermissionMode,
      agentControllerPermissionModeInput:
        input.agentControllerPermissionModeInput,
      profile: input.profile,
    });

  if (
    profileName ||
    explicitAgentController ||
    explicitWorkspace ||
    explicitModelSelection ||
    explicitAgentControllerPermissionMode
  ) {
    return {
      status: "submitted",
      value: {
        ...(profileName ? { profileName } : {}),
        ...(explicitAgentController ?? {}),
        ...(explicitWorkspace ?? {}),
        ...(explicitModelSelection ?? {}),
        ...(explicitAgentControllerPermissionMode ?? {}),
        updatedFields: [
          ...(profileName ? ["profileName"] : []),
          ...(explicitAgentController?.updatedFields ?? []),
          ...(explicitWorkspace?.updatedFields ?? []),
          ...(explicitModelSelection?.updatedFields ?? []),
          ...(explicitAgentControllerPermissionMode?.updatedFields ?? []),
        ],
      },
    };
  }

  if (!input.allowPrompt) {
    throw new Error(
      formatMessage(input.resolvedView, "profile.update.missing_changes")
    );
  }

  return await promptProfileUpdatePayload(input.profile);
}

function resolveExplicitWorkspacePatchForProfile(input: {
  profile: OpenMeldProfile;
  workspaceMode?: string;
  workspacePath?: string;
}): {
  workspaceMode: "openmeld_managed" | "custom";
  customWorkspacePath?: string;
  updatedFields: string[];
} | null {
  const normalizedMode = normalizeWorkspaceModeInput(input.workspaceMode);
  const normalizedWorkspacePath = normalizeOptionalString(input.workspacePath);
  if (!(normalizedMode || normalizedWorkspacePath)) {
    return null;
  }

  if (input.profile.profileKind !== "agent") {
    throw new Error("Workspace can only be configured for agent profiles.");
  }
  if (!normalizedMode) {
    throw new Error(
      "--workspace-path can only be used with --workspace-mode custom."
    );
  }
  if (normalizedMode === "openmeld_managed") {
    if (normalizedWorkspacePath) {
      throw new Error(
        "--workspace-path can only be used with --workspace-mode custom."
      );
    }
    return {
      updatedFields: ["workspace"],
      workspaceMode: "openmeld_managed",
    };
  }
  if (!normalizedWorkspacePath) {
    throw new Error(
      "--workspace-path is required when --workspace-mode custom is used."
    );
  }
  return {
    customWorkspacePath: normalizedWorkspacePath,
    updatedFields: ["workspace"],
    workspaceMode: "custom",
  };
}

function resolveExplicitModelSelectionPatchForProfile(input: {
  model?: string;
  profile: OpenMeldProfile;
  reasoningEffort?: string;
}): {
  modelId: string;
  reasoningLevel?: string;
  updatedFields: string[];
} | null {
  const modelSelection = normalizeModelSelectionInput({
    model: input.model,
    reasoningEffort: input.reasoningEffort,
  });
  if (!modelSelection.hasAnyModelSelectionInput) {
    return null;
  }
  if (input.profile.profileKind !== "agent") {
    throw new Error(
      "Model selection can only be configured for agent profiles."
    );
  }
  if (!modelSelection.modelId) {
    throw new Error("--model is required.");
  }
  return {
    modelId: modelSelection.modelId,
    ...(modelSelection.reasoningLevel
      ? { reasoningLevel: modelSelection.reasoningLevel }
      : {}),
    updatedFields: ["modelSelection"],
  };
}

async function resolveExplicitAgentControllerPermissionModePatchForProfile(input: {
  agentControllerRef?: string;
  allowPrompt: boolean;
  confirmDangerousAgentControllerPermissionMode?: boolean;
  agentControllerPermissionModeInput?: string;
  profile: OpenMeldProfile;
}): Promise<{
  agentControllerPermissionMode: AgentControllerPermissionMode;
  updatedFields: string[];
} | null> {
  if (!normalizeOptionalString(input.agentControllerPermissionModeInput)) {
    return null;
  }
  if (input.profile.profileKind !== "agent") {
    throw new Error(
      "Agent Controller Permission Mode can only be configured for agent profiles."
    );
  }
  const currentBinding = input.agentControllerRef
    ? null
    : await resolveAgentProfilePrimaryAgentControllerReport({
        profile: input.profile,
      });
  const agentControllerRef =
    input.agentControllerRef ?? currentBinding?.agentControllerRef ?? null;
  if (!agentControllerRef) {
    throw new Error(
      "--agent-controller-permission-mode requires an existing Agent Profile Binding or --agent-controller."
    );
  }
  const controllerPermissionMode =
    await resolveAgentControllerPermissionModeInput({
      agentControllerRef,
      allowPrompt: input.allowPrompt,
      confirmDangerousAgentControllerPermissionMode:
        input.confirmDangerousAgentControllerPermissionMode,
      agentControllerPermissionModeInput:
        input.agentControllerPermissionModeInput,
      flagName: "--agent-controller-permission-mode",
    });
  if (!controllerPermissionMode.agentControllerPermissionMode) {
    throw new Error("--agent-controller-permission-mode is required.");
  }
  return {
    agentControllerPermissionMode:
      controllerPermissionMode.agentControllerPermissionMode,
    updatedFields: ["agentControllerPermissionMode"],
  };
}

async function resolveExplicitAgentControllerPatchForProfile(input: {
  agentController?: string;
  agentControllerConversationId?: string;
  profile: OpenMeldProfile;
}): Promise<{
  agentControllerRef: string;
  agentControllerConversationId?: string;
  updatedFields: string[];
} | null> {
  const agentController = normalizeOptionalString(input.agentController);
  const agentControllerConversationId = normalizeOptionalString(
    input.agentControllerConversationId
  );
  if (!(agentController || agentControllerConversationId)) {
    return null;
  }
  if (input.profile.profileKind !== "agent") {
    throw new Error(
      "Agent controller can only be configured for agent profiles."
    );
  }
  if (!agentController) {
    throw new Error(
      "--agent-controller-conversation-id requires --agent-controller."
    );
  }
  const parsed = parseAgentControllerRef(agentController);
  if (!parsed) {
    throw new Error("--agent-controller must use builtin:<id> or custom:<id>");
  }
  if (parsed.kind === "builtin") {
    await assertBuiltinAgentControllerRefRunnable(parsed.ref);
  }
  return {
    agentControllerRef: parsed.ref,
    ...(agentControllerConversationId ? { agentControllerConversationId } : {}),
    updatedFields: [
      "agentController",
      ...(agentControllerConversationId
        ? ["agentControllerConversationId"]
        : []),
    ],
  };
}

async function applyAgentProfileControllerBinding(input: {
  agentControllerConversationId?: string;
  agentControllerRef?: string;
  modelId?: string;
  profile: OpenMeldProfile;
  reasoningLevel?: string;
}): Promise<void> {
  const agentControllerRef = normalizeOptionalString(input.agentControllerRef);
  const hasModelSelectionPatch = input.modelId !== undefined;
  if (!(agentControllerRef || hasModelSelectionPatch)) {
    return;
  }
  if (input.profile.profileKind !== "agent") {
    throw new Error(
      "Agent controller can only be configured for agent profiles."
    );
  }
  if (!agentControllerRef && hasModelSelectionPatch) {
    const binding = await updateAgentProfilePrimaryBindingModelSelection({
      modelId: input.modelId ?? "",
      profile: input.profile,
      reasoningLevel: input.reasoningLevel,
    });
    if (binding.status !== "accepted") {
      throw new Error(
        formatAgentProfileBindingUpdateFailure(binding.reasonCodes)
      );
    }
    return;
  }
  const currentBinding = agentControllerRef
    ? null
    : await resolveAgentProfilePrimaryAgentControllerReport({
        profile: input.profile,
      });
  const resolvedAgentControllerRef =
    agentControllerRef ?? currentBinding?.agentControllerRef ?? null;
  if (!resolvedAgentControllerRef) {
    throw new Error(
      "--model requires an existing Agent Profile Binding or --agent-controller."
    );
  }
  const agentControllerConversationId =
    agentControllerRef === null
      ? (currentBinding?.primaryBinding.executionTarget
          ?.agentControllerConversationId ?? undefined)
      : input.agentControllerConversationId;
  const runtimeReportSubmission = await submitRuntimeAgentControllerReport({
    agentControllerRef: resolvedAgentControllerRef,
    diagnosticProfileId: input.profile.openMeldProfileId,
    localParticipationState: "ready",
    reasonCodes: ["runtime.agent_controller_report.ready"],
  });
  const binding = await ensureAgentProfileRuntimeBinding({
    agentControllerConversationId,
    modelId: input.modelId,
    profile: input.profile,
    reasoningLevel: input.reasoningLevel,
    runtimeReportSubmission,
    writeMode: "reconnect",
  });
  if (binding.status !== "accepted") {
    throw new Error(
      formatAgentProfileBindingUpdateFailure(binding.reasonCodes)
    );
  }
}

async function applyAgentProfileControllerPermissionMode(input: {
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  profile: OpenMeldProfile;
}): Promise<void> {
  if (!input.agentControllerPermissionMode) {
    return;
  }
  if (input.profile.profileKind !== "agent") {
    throw new Error(
      "Agent Controller Permission Mode can only be configured for agent profiles."
    );
  }
  const binding =
    await updateAgentProfilePrimaryBindingAgentControllerPermissionMode({
      agentControllerPermissionMode: input.agentControllerPermissionMode,
      profile: input.profile,
    });
  if (binding.status !== "accepted") {
    throw new Error(
      formatAgentProfileBindingUpdateFailure(binding.reasonCodes)
    );
  }
}

type ProfileUpdatePayload = {
  profileName?: string;
  agentControllerRef?: string;
  agentControllerConversationId?: string;
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  modelId?: string;
  reasoningLevel?: string;
  workspaceMode?: "openmeld_managed" | "custom";
  customWorkspacePath?: string;
  updatedFields: string[];
};

async function promptProfileUpdatePayload(
  profile: OpenMeldProfile
): Promise<PromptFlowResult<ProfileUpdatePayload>> {
  while (true) {
    const selectedField = await selectProfileUpdateField(profile);
    if (selectedField.status !== "submitted") {
      return selectedField;
    }

    const payloadByField: Record<
      UpdateFieldSelection,
      () => Promise<PromptFlowResult<ProfileUpdatePayload>>
    > = {
      agent_controller: () => promptAgentControllerPayload(profile),
      agent_controller_permission_mode: () =>
        promptAgentControllerPermissionModePayload(profile),
      model_selection: () => promptModelSelectionPayload(profile),
      name: () => promptProfileNamePayload(profile.profileName),
      workspace: () => promptWorkspacePayload(profile),
    };

    const payload = await payloadByField[selectedField.value]();
    if (payload.status === "back") {
      continue;
    }
    return payload;
  }
}

async function selectProfileUpdateField(
  profile: OpenMeldProfile
): Promise<PromptFlowResult<UpdateFieldSelection>> {
  while (true) {
    const selectedField = await select({
      message: "What do you want to update?",
      options: [
        {
          value: "name",
          label: "Profile name",
        },
        ...(profile.profileKind === "agent"
          ? ([
              {
                value: "agent_controller",
                label: "Agent controller",
              },
              {
                value: "agent_controller_permission_mode",
                label: "Agent Controller Permission Mode",
              },
              {
                value: "model_selection",
                label: "Model and reasoning level",
              },
              {
                value: "workspace",
                label: "Workspace",
              },
            ] as const)
          : []),
        {
          value: BACK_UPDATE_FIELD_SELECTION,
          label: "Back",
        },
      ],
    });

    if (isCancel(selectedField)) {
      return {
        status: "cancelled",
      };
    }
    if (selectedField === BACK_UPDATE_FIELD_SELECTION) {
      return {
        status: "back",
      };
    }

    return {
      status: "submitted",
      value: selectedField as UpdateFieldSelection,
    };
  }
}

async function promptWorkspacePayload(
  profile: OpenMeldProfile
): Promise<PromptFlowResult<ProfileUpdatePayload>> {
  if (profile.profileKind !== "agent") {
    throw new Error("Workspace can only be configured for agent profiles.");
  }
  while (true) {
    const selectedWorkspaceMode = await select({
      message: "Workspace",
      options: [
        {
          value: "openmeld_managed",
          label: "OpenMeld-managed workspace",
          hint: "Use the workspace OpenMeld manages for this profile.",
        },
        {
          value: "custom",
          label: "Custom folder",
          hint: "Use a different folder on this device.",
        },
        {
          value: BACK_UPDATE_FIELD_SELECTION,
          label: "Back",
        },
      ],
    });
    if (isCancel(selectedWorkspaceMode)) {
      return {
        status: "cancelled",
      };
    }
    if (selectedWorkspaceMode === BACK_UPDATE_FIELD_SELECTION) {
      return {
        status: "back",
      };
    }
    if (selectedWorkspaceMode === "openmeld_managed") {
      return {
        status: "submitted",
        value: {
          updatedFields: ["workspace"],
          workspaceMode: "openmeld_managed",
        },
      };
    }

    const workspacePath = await promptTextEntry({
      message: "Custom workspace path",
      placeholder: "/absolute/path",
      allowBack: true,
      backLabel: "Back",
      requiredMessage: "Custom workspace path is required.",
    });
    if (workspacePath.status === "cancelled") {
      return {
        status: "cancelled",
      };
    }
    if (workspacePath.status === "back") {
      continue;
    }
    const customWorkspacePath = normalizeOptionalString(workspacePath.value);
    if (!customWorkspacePath) {
      throw new Error("Custom workspace path is required.");
    }
    return {
      status: "submitted",
      value: {
        customWorkspacePath,
        updatedFields: ["workspace"],
        workspaceMode: "custom",
      },
    };
  }
}

async function promptAgentControllerPayload(
  profile: OpenMeldProfile
): Promise<PromptFlowResult<ProfileUpdatePayload>> {
  if (profile.profileKind !== "agent") {
    throw new Error(
      "Agent controller can only be configured for agent profiles."
    );
  }
  const agentController = await promptTextEntry({
    message: "Agent controller",
    placeholder: "builtin:codex",
    allowBack: true,
    backLabel: "Back",
    requiredMessage: "Agent controller is required.",
    validate: (value) =>
      parseAgentControllerRef(value)
        ? null
        : "Use builtin:<id> or custom:<id>.",
  });
  if (agentController.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }
  if (agentController.status === "back") {
    return {
      status: "back",
    };
  }

  const agentControllerConversationId = await promptTextEntry({
    message: "Agent controller conversation ID",
    description:
      "Optional private Agent Controller conversation ID for this Agent Profile.",
    placeholder: "optional",
    allowBack: true,
    allowEmpty: true,
    backLabel: "Back",
  });
  if (agentControllerConversationId.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }
  if (agentControllerConversationId.status === "back") {
    return {
      status: "back",
    };
  }

  const patch = await resolveExplicitAgentControllerPatchForProfile({
    agentController: agentController.value,
    agentControllerConversationId: agentControllerConversationId.value,
    profile,
  });
  if (!patch) {
    throw new Error("Agent controller is required.");
  }
  return {
    status: "submitted",
    value: patch,
  };
}

async function promptModelSelectionPayload(
  profile: OpenMeldProfile
): Promise<PromptFlowResult<ProfileUpdatePayload>> {
  if (profile.profileKind !== "agent") {
    throw new Error(
      "Model selection can only be configured for agent profiles."
    );
  }
  const primaryBinding = await resolveAgentProfilePrimaryAgentControllerReport({
    profile,
  });
  if (!primaryBinding) {
    throw new Error(
      "Connect an agent controller before editing model selection."
    );
  }
  const modelCatalog = await createModelCatalogReadSession().read();
  const capabilities = resolveAgentProfileEditCapabilities({
    agentControllerRef: primaryBinding.agentControllerRef,
    modelCatalog,
  });
  if (!capabilities.modelSelection.editable) {
    throw new Error(
      `Model selection is not supported by ${primaryBinding.agentControllerRef}.`
    );
  }

  const currentModelId =
    primaryBinding.primaryBinding.modelSelection?.modelId ?? null;
  const selectedModel = await select({
    message: "Model",
    options: [
      ...capabilities.modelSelection.models.map((model) => ({
        value: model.id,
        label: formatModelSelectionOptionLabel({
          model,
          currentModelId,
        }),
      })),
      {
        value: BACK_UPDATE_FIELD_SELECTION,
        label: "Back",
      },
    ],
  });
  if (isCancel(selectedModel)) {
    return {
      status: "cancelled",
    };
  }
  if (selectedModel === BACK_UPDATE_FIELD_SELECTION) {
    return {
      status: "back",
    };
  }

  const selectedModelId = String(selectedModel);
  const reasoningCapability = findReasoningCapabilityForModel({
    modelId: selectedModelId,
    models: capabilities.reasoningLevel.models,
  });
  if (!reasoningCapability?.editable) {
    return {
      status: "submitted",
      value: {
        modelId: selectedModelId,
        updatedFields: ["modelSelection"],
      },
    };
  }

  const currentReasoningLevel =
    currentModelId === selectedModelId
      ? (primaryBinding.primaryBinding.modelSelection?.reasoningLevel ?? null)
      : null;
  const selectedReasoningLevel = await select({
    message: "Reasoning level",
    options: [
      {
        value: "",
        label: "Use model default",
        hint: currentReasoningLevel ? undefined : "Current.",
      },
      ...reasoningCapability.levels.map((level) => ({
        value: level,
        label: formatReasoningLevelLabel(level),
        hint: level === currentReasoningLevel ? "Current." : undefined,
      })),
      {
        value: BACK_UPDATE_FIELD_SELECTION,
        label: "Back",
      },
    ],
  });
  if (isCancel(selectedReasoningLevel)) {
    return {
      status: "cancelled",
    };
  }
  if (selectedReasoningLevel === BACK_UPDATE_FIELD_SELECTION) {
    return {
      status: "back",
    };
  }

  const reasoningLevel = normalizeOptionalString(selectedReasoningLevel);
  return {
    status: "submitted",
    value: {
      modelId: selectedModelId,
      ...(reasoningLevel ? { reasoningLevel } : {}),
      updatedFields: ["modelSelection"],
    },
  };
}

async function promptAgentControllerPermissionModePayload(
  profile: OpenMeldProfile
): Promise<PromptFlowResult<ProfileUpdatePayload>> {
  if (profile.profileKind !== "agent") {
    throw new Error(
      "Agent Controller Permission Mode can only be configured for agent profiles."
    );
  }
  const primaryBinding = await resolveAgentProfilePrimaryAgentControllerReport({
    profile,
  });
  if (!primaryBinding) {
    throw new Error(
      "Connect an agent controller before editing Agent Controller Permission Mode."
    );
  }
  const capabilities = resolveAgentProfileEditCapabilities({
    agentControllerRef: primaryBinding.agentControllerRef,
    modelCatalog: null,
  });
  if (!capabilities.permissionMode.editable) {
    throw new Error(
      `Agent Controller Permission Mode is not supported by ${primaryBinding.agentControllerRef}.`
    );
  }
  const currentPolicy = resolveAgentControllerPermissionModeForController(
    primaryBinding.primaryBinding.agentControllerPermissionMode,
    { agentControllerRef: primaryBinding.agentControllerRef }
  );
  const fieldLabel = getAgentControllerPermissionModeFieldLabel({
    agentControllerRef: primaryBinding.agentControllerRef,
  });
  const selectedPolicy = await select({
    message: fieldLabel,
    options: [
      ...capabilities.permissionMode.options.map((option) => ({
        value: option.value,
        label: option.label,
        hint:
          option.value === currentPolicy
            ? `${option.description} Current.`
            : option.description,
      })),
      {
        value: BACK_UPDATE_FIELD_SELECTION,
        label: "Back",
      },
    ],
  });
  if (isCancel(selectedPolicy)) {
    return {
      status: "cancelled",
    };
  }
  if (selectedPolicy === BACK_UPDATE_FIELD_SELECTION) {
    return {
      status: "back",
    };
  }

  const controllerPermissionMode =
    await resolveAgentControllerPermissionModeInput({
      agentControllerRef: primaryBinding.agentControllerRef,
      allowPrompt: true,
      agentControllerPermissionModeInput: String(selectedPolicy),
      flagName: fieldLabel,
    });
  if (!controllerPermissionMode.agentControllerPermissionMode) {
    throw new Error(`${fieldLabel} is required.`);
  }
  return {
    status: "submitted",
    value: {
      agentControllerPermissionMode:
        controllerPermissionMode.agentControllerPermissionMode,
      updatedFields: ["agentControllerPermissionMode"],
    },
  };
}

function findReasoningCapabilityForModel(input: {
  modelId: string;
  models: AgentProfileReasoningLevelModelCapability[];
}): AgentProfileReasoningLevelModelCapability | null {
  return input.models.find((model) => model.modelId === input.modelId) ?? null;
}

function formatModelSelectionOptionLabel(input: {
  currentModelId: string | null;
  model: ModelCatalogModel;
}): string {
  return input.model.id === input.currentModelId
    ? `${input.model.displayName} (current)`
    : input.model.displayName;
}

function formatReasoningLevelLabel(level: string): string {
  return level
    .split("-")
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

async function promptProfileNamePayload(
  currentProfileName: string
): Promise<PromptFlowResult<ProfileUpdatePayload>> {
  const nextName = await promptTextEntry({
    message: "New profile name",
    placeholder: currentProfileName,
    allowBack: true,
    backLabel: "Back",
    requiredMessage: "Profile name is required.",
  });
  if (nextName.status === "cancelled") {
    return {
      status: "cancelled",
    };
  }
  if (nextName.status === "back") {
    return {
      status: "back",
    };
  }
  const profileName = normalizeOptionalString(nextName.value);
  if (!profileName) {
    throw new Error("profileName is required");
  }
  return {
    status: "submitted",
    value: {
      profileName,
      updatedFields: ["profileName"],
    },
  };
}

function emitNonPersistentSelectionWarning(input: {
  runtime: Awaited<ReturnType<typeof resolveRuntimeContext>>;
  presenter: ReturnType<typeof createPresenter>;
  selectionPersistent: boolean;
  cliContextSource?: string;
}): void {
  if (input.selectionPersistent) {
    return;
  }
  input.presenter.line({
    code: "profile.selection.non_persistent",
    text: formatMessage(
      input.runtime.resolvedView,
      "profile.selection.non_persistent"
    ),
    data: {
      persistent: false,
      ...(input.cliContextSource
        ? { cliContextSource: input.cliContextSource }
        : {}),
    },
  });
}

async function normalizeCreateLocalAgentSelectionInput(input: {
  profileKind: CreateProfileKind;
  agentController?: string;
  agentControllerConversationId?: string;
  controllerEnabled?: boolean;
}): Promise<{
  agentControllerRef: string;
  agentControllerConversationId?: string;
  controllerEnabled?: boolean;
} | null> {
  const normalized = normalizeAgentControllerArgumentInput({
    agentController: input.agentController,
    agentControllerConversationId: input.agentControllerConversationId,
    controllerEnabled: input.controllerEnabled,
  });
  if (!normalized.hasAnyAgentControllerInput) {
    return null;
  }

  if (input.profileKind !== "agent") {
    throw new Error("--agent-controller can only be used with --kind agent");
  }

  const agentController = normalized.agentController;
  if (!agentController) {
    throw new Error(
      "--agent-controller-conversation-id requires --agent-controller."
    );
  }

  const parsed = parseAgentControllerRef(agentController);
  if (!parsed) {
    throw new Error("--agent-controller must use builtin:<id> or custom:<id>");
  }

  if (parsed.kind === "builtin") {
    await assertBuiltinAgentControllerRefRunnable(parsed.ref);
  }

  return {
    agentControllerRef: parsed.ref,
    ...(normalized.agentControllerConversationId
      ? {
          agentControllerConversationId:
            normalized.agentControllerConversationId,
        }
      : {}),
    ...(normalized.hasControllerEnabled
      ? { controllerEnabled: normalized.controllerEnabled }
      : {}),
  };
}

async function resolveTargetProfile(input: {
  explicitProfile: string | undefined;
  action: ProfileAction;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
  cachedProfiles?: OpenMeldProfile[];
  guideExamples?: ProfileActionGuideExamples;
}): Promise<string | null> {
  const fromInput = String(input.explicitProfile ?? "").trim();
  if (fromInput) {
    return fromInput;
  }

  const profiles =
    input.cachedProfiles ??
    (await listVisibleProfilesForListByView(input.resolvedView));
  const current = await resolveCurrentProfileId({
    profiles,
    mutateSelection: input.allowPrompt,
  });
  if (profiles.length === 0) {
    if (input.resolvedView === "agent") {
      throw createProfileActionGuideError(
        input.action,
        "no profiles found; create one after signing in.",
        input.guideExamples
      );
    }
    throw new Error(formatMessage(input.resolvedView, "profile.no_profiles"));
  }

  if (!input.allowPrompt) {
    if (input.resolvedView === "agent") {
      throw createProfileActionGuideError(
        input.action,
        "explicit profile argument is required in agent view.",
        input.guideExamples
      );
    }
    throw new Error(
      formatMessage(input.resolvedView, "profile.target.missing", {
        action: input.action,
      })
    );
  }

  if (input.resolvedView === "human") {
    const selected = await promptSearchSelect({
      message: `Choose a profile to ${input.action}`,
      items: profiles.map((profile) =>
        buildProfileSearchItem({
          profile,
          current,
          resolvedView: input.resolvedView,
        })
      ),
      maxVisible: 8,
      allowBack: true,
      backLabel: "Exit",
    });
    if (selected.status === "cancelled") {
      cancel("Cancelled.");
      return null;
    }
    if (selected.status === "back") {
      return null;
    }
    return selected.value;
  }

  const selected = await select({
    message: `Choose a profile to ${input.action}`,
    options: [
      ...profiles.map((profile) => ({
        value: profile.openMeldProfileId,
        label: resolveProfileSelectLabel({
          profile,
          current,
          resolvedView: input.resolvedView,
        }),
        hint: resolveProfileSelectHint({
          profile,
          resolvedView: input.resolvedView,
        }),
      })),
      { value: EXIT_PROFILE_SELECTION, label: "Exit" },
    ],
  });
  if (isCancel(selected)) {
    cancel("Cancelled.");
    return null;
  }
  if (selected === EXIT_PROFILE_SELECTION) {
    return null;
  }
  return selected;
}

async function resolveTargetProfilesForDelete(input: {
  explicitProfile: string | undefined;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
  cachedProfiles?: OpenMeldProfile[];
  presenter: ReturnType<typeof createPresenter>;
}): Promise<string[] | null> {
  const fromInput = String(input.explicitProfile ?? "").trim();
  if (fromInput) {
    return [fromInput];
  }

  const profiles =
    input.cachedProfiles ??
    (await listVisibleProfilesForListByView(input.resolvedView));
  if (profiles.length === 0) {
    if (input.resolvedView === "agent") {
      throw createProfileActionGuideError(
        "delete",
        "no profiles found; create one after signing in."
      );
    }
    throw new Error(formatMessage(input.resolvedView, "profile.no_profiles"));
  }

  if (!input.allowPrompt) {
    if (input.resolvedView === "agent") {
      throw createProfileActionGuideError(
        "delete",
        "explicit profile argument is required in agent view."
      );
    }
    throw new Error(
      formatMessage(input.resolvedView, "profile.target.missing", {
        action: "delete",
      })
    );
  }

  const current = await resolveCurrentProfileId({
    profiles,
    mutateSelection: input.allowPrompt,
  });
  const deletableProfiles = profiles.filter(
    (profile) => !isProtectedDefaultHumanProfile(profile)
  );
  const protectedProfiles = profiles.filter((profile) =>
    isProtectedDefaultHumanProfile(profile)
  );
  if (deletableProfiles.length === 0) {
    throw new Error(
      "no deletable profiles: default human profile is protected"
    );
  }
  if (protectedProfiles.length > 0 && input.resolvedView === "human") {
    const protectedNames = protectedProfiles
      .map((profile) => normalizeProfileDisplayName(profile))
      .join(", ");
    input.presenter.line({
      code: "profile.delete.protected_default",
      text: pc.dim(
        `Protected: default profile cannot be deleted (${protectedNames}).`
      ),
    });
  }
  if (input.resolvedView === "human") {
    return promptHumanProfileDeleteSelection({
      profiles: deletableProfiles,
      current,
      resolvedView: input.resolvedView,
    });
  }

  const selected = await multiselect({
    message: "Choose profile(s) to delete",
    options: deletableProfiles.map((profile) => ({
      value: profile.openMeldProfileId,
      label: resolveProfileSelectLabel({
        profile,
        current,
        resolvedView: input.resolvedView,
      }),
      hint: resolveProfileDeleteHint({
        profile,
        resolvedView: input.resolvedView,
      }),
    })),
    required: true,
  });
  if (isCancel(selected)) {
    cancel("Cancelled.");
    return null;
  }

  const normalized = normalizeDeleteProfileSelection(selected);
  return normalized.length > 0 ? normalized : null;
}

async function promptHumanProfileDeleteSelection(input: {
  profiles: OpenMeldProfile[];
  current: string | null;
  resolvedView: "human";
}): Promise<string[] | null> {
  const selected = await promptSearchMultiselect({
    message: "Choose profile(s) to delete",
    items: input.profiles.map((profile) =>
      buildProfileSearchItem({
        profile,
        current: input.current,
        resolvedView: input.resolvedView,
        detail: resolveProfileDeleteHint({
          profile,
          resolvedView: input.resolvedView,
        }),
      })
    ),
    required: true,
    maxVisible: 8,
    allowBack: true,
    backLabel: "Exit",
  });
  if (selected.status === "cancelled") {
    cancel("Cancelled.");
    return null;
  }
  if (selected.status === "back") {
    return null;
  }
  const normalized = normalizeDeleteProfileSelection(selected.value);
  return normalized.length > 0 ? normalized : null;
}

async function listVisibleProfilesForListByView(
  resolvedView: "human" | "agent"
): Promise<OpenMeldProfile[]> {
  const profiles = await listOpenMeldProfiles();

  if (resolvedView === "human") {
    return profiles;
  }

  return profiles.filter((profile) =>
    isProfileKindAllowedInView({
      resolvedView,
      profileKind: profile.profileKind,
    })
  );
}

function assertProfileAllowedInView(input: {
  profileId: string;
  profileKind: OpenMeldProfile["profileKind"];
  resolvedView: "human" | "agent";
  action: ProfileAction;
}): void {
  if (input.resolvedView !== "agent") {
    return;
  }

  if (
    input.profileKind === "human" &&
    (input.action === "delete" || input.action === "update")
  ) {
    throw createProfileActionGuideError(
      input.action,
      `profile "${input.profileId}" is human; agent view can select or inspect human profiles, but human profile changes require human view.`
    );
  }

  if (
    isProfileKindAllowedInView({
      resolvedView: input.resolvedView,
      profileKind: input.profileKind,
    })
  ) {
    return;
  }

  throw createProfileActionGuideError(
    input.action,
    `profile "${input.profileId}" is ${input.profileKind}; agent view supports human and agent profiles only.`
  );
}

async function confirmDelete(input: {
  profiles: string[];
  force: boolean | undefined;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
}): Promise<boolean> {
  if (input.force) {
    return true;
  }
  if (!input.allowPrompt) {
    throw new Error(
      formatMessage(input.resolvedView, "profile.delete.force_required")
    );
  }

  const message =
    input.profiles.length === 1
      ? `Delete profile "${input.profiles[0]}"?`
      : `Delete ${input.profiles.length} profiles?`;
  const ok = await confirm({
    message,
    initialValue: false,
  });
  if (isCancel(ok)) {
    cancel("Cancelled.");
    return false;
  }
  return ok;
}

function normalizeDeleteProfileSelection(value: unknown): string[] {
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

async function resolveCurrentProfileId(input: {
  profiles: OpenMeldProfile[];
  mutateSelection: boolean;
}): Promise<string | null> {
  const { mutateSelection, profiles } = input;
  const selected = await getSelectedOpenMeldProfileId();
  if (
    selected &&
    profiles.some((item) => item.openMeldProfileId === selected)
  ) {
    return selected;
  }

  if (selected && mutateSelection) {
    await clearSelectedOpenMeldProfileId();
  }

  const fallbackHuman =
    profiles.find(
      (item) => item.profileKind === "human" && item.isDefault === true
    ) ?? profiles.find((item) => item.profileKind === "human");
  if (fallbackHuman) {
    if (mutateSelection) {
      await setSelectedOpenMeldProfileId(fallbackHuman.openMeldProfileId);
    }
    return fallbackHuman.openMeldProfileId;
  }

  const fallback = profiles[0]?.openMeldProfileId ?? null;
  if (fallback && mutateSelection) {
    await setSelectedOpenMeldProfileId(fallback);
  }
  return fallback;
}

async function resolveSelectedProfileIdForList(
  profiles: OpenMeldProfile[]
): Promise<string | null> {
  const selected = await getSelectedOpenMeldProfileId();
  if (!selected) {
    return null;
  }
  return profiles.some((item) => item.openMeldProfileId === selected)
    ? selected
    : null;
}

function buildProfileSearchItem(input: {
  profile: OpenMeldProfile;
  current: string | null;
  resolvedView: "human" | "agent";
  detail?: string;
}): {
  value: string;
  label: string;
  detail: string;
  searchText: string;
} {
  return {
    value: input.profile.openMeldProfileId,
    label: resolveProfileSelectLabel({
      profile: input.profile,
      current: input.current,
      resolvedView: input.resolvedView,
    }),
    detail:
      input.detail ??
      resolveProfileSelectHint({
        profile: input.profile,
        resolvedView: input.resolvedView,
      }),
    searchText: buildProfileSearchText(input.profile),
  };
}

function buildProfileSearchText(profile: OpenMeldProfile): string {
  return [
    profile.openMeldProfileId,
    normalizeOptionalString(profile.profileName),
    profile.profileKind,
    normalizeOptionalString(profile.ownerUserId),
    normalizeOptionalString(profile.ownerName),
    normalizeOptionalString(profile.source),
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function resolveProfileSelectLabel(input: {
  profile: OpenMeldProfile;
  current: string | null;
  resolvedView: "human" | "agent";
}): string {
  const displayName =
    input.resolvedView === "human"
      ? normalizeProfileDisplayName(input.profile)
      : input.profile.openMeldProfileId;
  if (input.profile.openMeldProfileId === input.current) {
    return `${displayName} (selected)`;
  }
  return displayName;
}

function resolveProfileSelectHint(input: {
  profile: OpenMeldProfile;
  resolvedView: "human" | "agent";
}): string {
  if (input.resolvedView === "human") {
    return `${input.profile.profileKind} · ${input.profile.openMeldProfileId}`;
  }
  return `${input.profile.profileKind} · ${normalizeProfileDisplayName(input.profile)}`;
}

function resolveProfileDeleteHint(input: {
  profile: OpenMeldProfile;
  resolvedView: "human" | "agent";
}): string {
  const base = resolveProfileSelectHint(input);
  if (!isProtectedDefaultHumanProfile(input.profile)) {
    return base;
  }
  return `${base} · default profile (cannot delete)`;
}

function formatProfileListLine(input: {
  memberAgent: ProfileMemberAgentParent | null;
  profile: OpenMeldProfile;
  selected: boolean;
  resolvedView: "human" | "agent";
}): string {
  const mark = input.selected ? "*" : " ";
  const suffix = input.selected ? " (selected)" : "";
  if (input.resolvedView === "agent") {
    return `${mark} ${input.profile.openMeldProfileId}${suffix}`;
  }

  const displayName = normalizeProfileDisplayName(input.profile);
  const memberAgent = input.memberAgent
    ? ` · Agent: ${formatProfileMemberAgentParent(input.memberAgent)}`
    : "";
  return `${mark} ${displayName}${suffix} · ${input.profile.profileKind} · ${input.profile.status} · id: ${input.profile.openMeldProfileId}${memberAgent}`;
}

function buildProfileListData(input: {
  profile: OpenMeldProfile;
  selected: boolean;
}): {
  profile: string;
  openMeldProfileId: string;
  profileName: string;
  profileKind: OpenMeldProfile["profileKind"];
  profileStatus: OpenMeldProfile["status"];
  status: OpenMeldProfile["status"];
  ownerUserId: string;
  ownerName?: string;
  source: string;
  isDefault: boolean;
  createdByUserId: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  selected: boolean;
  default: boolean;
} {
  const { profile, selected } = input;
  return {
    profile: profile.openMeldProfileId,
    openMeldProfileId: profile.openMeldProfileId,
    profileName: profile.profileName,
    profileKind: profile.profileKind,
    profileStatus: profile.status,
    status: profile.status,
    ownerUserId: profile.ownerUserId,
    ...(profile.ownerName ? { ownerName: profile.ownerName } : {}),
    source: profile.source,
    isDefault: profile.isDefault === true,
    createdByUserId: profile.createdByUserId,
    lastUsedAt: profile.lastUsedAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    selected,
    default: profile.isDefault === true,
  };
}

function normalizeProfileDisplayName(profile: OpenMeldProfile): string {
  const name = String(profile.profileName ?? "").trim();
  if (name.length > 0) {
    return name;
  }
  return profile.openMeldProfileId;
}

function normalizeAgentControllerArgumentInput(input: {
  agentController?: string;
  agentControllerConversationId?: string;
  controllerEnabled?: boolean;
}): {
  agentController: string;
  agentControllerConversationId?: string;
  controllerEnabled?: boolean;
  hasControllerEnabled: boolean;
  hasAnyAgentControllerInput: boolean;
} {
  const agentController = String(input.agentController ?? "").trim();
  const agentControllerConversationId = normalizeOptionalString(
    input.agentControllerConversationId
  );
  const hasControllerEnabled = typeof input.controllerEnabled === "boolean";
  const hasAnyAgentControllerInput =
    Boolean(agentController) ||
    Boolean(agentControllerConversationId) ||
    hasControllerEnabled;

  return {
    agentController,
    ...(agentControllerConversationId ? { agentControllerConversationId } : {}),
    ...(hasControllerEnabled
      ? { controllerEnabled: input.controllerEnabled }
      : {}),
    hasControllerEnabled,
    hasAnyAgentControllerInput,
  };
}

function resolveUpdatableFields(profile: OpenMeldProfile): string[] {
  if (profile.profileKind === "agent") {
    return [
      "Profile name",
      "Agent controller",
      "Agent Controller Permission Mode",
      "Model and reasoning level",
      "Workspace",
    ];
  }
  return ["Profile name"];
}

function isProtectedDefaultHumanProfile(profile: OpenMeldProfile): boolean {
  return profile.profileKind === "human" && profile.isDefault === true;
}

function assertProfileDeletable(profile: OpenMeldProfile): void {
  if (!isProtectedDefaultHumanProfile(profile)) {
    return;
  }
  throw new Error("default human profile is protected and cannot be deleted");
}

function renderProfileReadyCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  profile: OpenMeldProfile;
  state: "created" | "selected" | "updated";
  agentRuntimeState: Awaited<
    ReturnType<typeof resolveAgentProfileRuntimeState>
  >;
}): void {
  let stateLabel = "Updated";
  if (input.state === "created") {
    stateLabel = "Created";
  } else if (input.state === "selected") {
    stateLabel = "Selected";
  }
  const ownerName = String(input.profile.ownerName ?? "").trim();
  const rows: Array<{ label: string; value: string }> = [
    { label: "Result", value: stateLabel },
    { label: "Selected Now", value: "Yes" },
    { label: "Profile Name", value: input.profile.profileName },
    { label: "Profile Handle", value: `@${input.profile.profileHandle}` },
    { label: "Type", value: input.profile.profileKind },
    { label: "Profile ID", value: input.profile.openMeldProfileId },
    { label: "Status", value: input.profile.status },
    ...(ownerName
      ? [
          {
            label: "Account Name",
            value: ownerName,
          },
        ]
      : []),
    { label: "Account ID", value: input.profile.ownerUserId },
  ];

  if (input.profile.isDefault === true) {
    rows.push({ label: "Default for This Account", value: "Yes" });
  }
  rows.push(...buildProfileCreateWakeReadinessRows(input));
  rows.push(...buildAgentProfileStateRows(input.profile));
  rows.push(...buildAgentProfileRuntimeRows(input.agentRuntimeState));

  renderInfoCard({
    presenter: input.presenter,
    title:
      input.state === "created" && input.profile.profileKind === "agent"
        ? "Agent Profile Identity Created"
        : "Profile Created",
    codePrefix: "profile.created.card",
    rows,
    sanitize: true,
  });
}

function renderProfileSummaryCard(input: {
  presenter: ReturnType<typeof createPresenter>;
  profile: OpenMeldProfile;
  agentRuntimeState: Awaited<
    ReturnType<typeof resolveAgentProfileRuntimeState>
  >;
  memberAgent: ProfileMemberAgentParent | null;
}): void {
  const ownerName = String(input.profile.ownerName ?? "").trim();
  const rows: Array<{ label: string; value: string }> = [
    { label: "Profile Name", value: input.profile.profileName },
    { label: "Profile Handle", value: `@${input.profile.profileHandle}` },
    { label: "Type", value: input.profile.profileKind },
    { label: "Profile ID", value: input.profile.openMeldProfileId },
    { label: "Status", value: input.profile.status },
    ...(ownerName
      ? [
          {
            label: "Account Name",
            value: ownerName,
          },
        ]
      : []),
    { label: "Account ID", value: input.profile.ownerUserId },
  ];

  if (input.profile.isDefault === true) {
    rows.push({ label: "Default for This Account", value: "Yes" });
  }
  if (input.memberAgent) {
    rows.push({
      label: "Agent",
      value: formatProfileMemberAgentParent(input.memberAgent),
    });
  }
  rows.push(...buildAgentProfileStateRows(input.profile));
  rows.push(...buildAgentProfileRuntimeRows(input.agentRuntimeState));

  renderInfoCard({
    presenter: input.presenter,
    title: "Profile",
    codePrefix: "profile.show.card",
    rows,
    sanitize: true,
  });
}

function buildAgentCreateNextSteps(profile: OpenMeldProfile): string[] {
  if (profile.profileKind === "agent") {
    return [
      formatOpenMeldCliCommand(
        `openmeld space add-members <space-id> --member ${profile.openMeldProfileId} --profile <human-profile-id> --view agent`
      ),
    ];
  }

  return [
    formatOpenMeldCliCommand("openmeld profiles list --view agent"),
    formatOpenMeldCliCommand(
      `openmeld profiles set ${profile.openMeldProfileId} --view agent`
    ),
    formatOpenMeldCliCommand(
      `openmeld whoami --profile ${profile.openMeldProfileId} --view agent`
    ),
    formatOpenMeldCliCommand(
      `openmeld space create --profile ${profile.openMeldProfileId} --name <space-name> --view agent`
    ),
    formatOpenMeldCliCommand(
      `openmeld space join --profile ${profile.openMeldProfileId} <space-id> --view agent`
    ),
  ];
}

function buildAgentCreateWakeReadinessData(
  profile: OpenMeldProfile
): Record<string, unknown> {
  if (profile.profileKind !== "agent") {
    return {};
  }
  return {
    identityCreated: true,
    wakeReadinessVerified: false,
    wakeReadinessNote:
      "Profile creation creates the Space identity. Add it to a Space when the user wants this teammate to participate.",
  };
}

function buildProfileCreateWakeReadinessRows(input: {
  profile: OpenMeldProfile;
  state: "created" | "selected" | "updated";
}): Array<{ label: string; value: string }> {
  if (input.state !== "created" || input.profile.profileKind !== "agent") {
    return [];
  }
  return [
    {
      label: "Space identity",
      value: "Created",
    },
    {
      label: "Next",
      value:
        "Add this profile to a Space when the user wants this teammate to participate.",
    },
  ];
}

function buildAgentUpdateNextSteps(profile: OpenMeldProfile): string[] {
  if (profile.profileKind === "agent") {
    return [
      formatOpenMeldCliCommand(
        `openmeld profiles show ${profile.openMeldProfileId} --view agent`
      ),
      formatOpenMeldCliCommand(
        `openmeld space add-members <space-id> --member ${profile.openMeldProfileId} --profile <human-profile-id> --view agent`
      ),
    ];
  }

  return [
    formatOpenMeldCliCommand(
      `openmeld profiles show ${profile.openMeldProfileId} --view agent`
    ),
    formatOpenMeldCliCommand(
      `openmeld profiles update ${profile.openMeldProfileId} --name <new-name> --view agent`
    ),
    formatOpenMeldCliCommand("openmeld profiles list --view agent"),
  ];
}

async function applyAgentProfileWorkspace(input: {
  profile: OpenMeldProfile;
  workspaceMode?: "openmeld_managed" | "custom";
  customWorkspacePath?: string;
}): Promise<void> {
  if (!input.workspaceMode) {
    return;
  }
  if (input.profile.profileKind !== "agent") {
    throw new Error("Workspace can only be configured for agent profiles.");
  }
  if (input.workspaceMode === "openmeld_managed") {
    await setOpenMeldManagedProfileWorkspace({
      openMeldProfileId: input.profile.openMeldProfileId,
    });
    return;
  }
  if (!input.customWorkspacePath) {
    throw new Error(
      "--workspace-path is required when --workspace-mode custom is used."
    );
  }
  await setCustomProfileWorkspace({
    openMeldProfileId: input.profile.openMeldProfileId,
    customWorkspacePath: input.customWorkspacePath,
  });
}

async function listBindableBuiltinControllers(): Promise<
  Array<AgentTargetState & { targetKind: "builtin" }>
> {
  const states = await listAgentTargetStates();
  return resolveBindableBuiltinControllerCandidates(states);
}

function resolveBindableBuiltinControllerCandidates(
  states: readonly AgentTargetState[]
): Array<AgentTargetState & { targetKind: "builtin" }> {
  return states
    .filter(isBindableBuiltinControllerCandidate)
    .sort((left, right) =>
      compareAgentControllerRefsForDisplay(left.agentId, right.agentId)
    );
}

function isBindableBuiltinControllerCandidate(
  state: AgentTargetState
): state is AgentTargetState & { targetKind: "builtin" } {
  return (
    state.targetKind === "builtin" &&
    state.detected &&
    state.lifecycleStatus !== "suspended" &&
    state.runtimeSupported &&
    state.selectable &&
    state.launchStatus === "ready" &&
    state.launchContract !== null
  );
}

async function resolveBindableBuiltinController(
  agentControllerRef: string
): Promise<AgentTargetState & { targetKind: "builtin" }> {
  const normalizedAgentControllerRef = String(agentControllerRef).trim();
  const localAgentId = resolveLocalRegistryAgentIdFromAgentControllerRef({
    agentControllerRef: normalizedAgentControllerRef,
  });
  const controllers = await listBindableBuiltinControllers();
  const matchedController =
    controllers.find((controller) => controller.agentId === localAgentId) ??
    null;
  if (matchedController) {
    return matchedController;
  }

  const bindableControllerIds = controllers.map(
    (controller) => controller.agentId
  );
  throw new Error(
    bindableControllerIds.length > 0
      ? `Built-in agent controller '${normalizedAgentControllerRef}' is not runnable. Available built-in agent controllers: ${bindableControllerIds.join(", ")}`
      : `Built-in agent controller '${normalizedAgentControllerRef}' is not runnable. No built-in agent controllers are currently runnable.`
  );
}

async function assertBuiltinAgentControllerRefRunnable(
  agentControllerRef: string
): Promise<void> {
  await resolveBindableBuiltinController(agentControllerRef);
}

function resolveProfileUpdateCommandExamples(): ProfileUpdateCommandExamples {
  return {};
}

function toProfileActionGuideExamples(
  _input: ProfileUpdateCommandExamples
): ProfileActionGuideExamples {
  return {};
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeWorkspaceModeInput(
  value: unknown
): "openmeld_managed" | "custom" | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_");
  if (!normalized) {
    return null;
  }
  if (normalized === "openmeld_managed" || normalized === "custom") {
    return normalized;
  }
  throw new Error("--workspace-mode must be openmeld-managed|custom");
}

async function ensureProfileCommandAuthenticationOrCancel(input: {
  action: ProfileCommandAuthAction;
  runtime: RuntimeContext;
}): Promise<boolean> {
  if (input.runtime.resolvedView !== "human") {
    return true;
  }

  const evaluated = await evaluateCommandAuthentication();
  if (evaluated.status === "valid" && evaluated.session) {
    primeOpenMeldProfilesSessionCache(evaluated.session);
    return true;
  }

  const authenticated = await ensureCommandAuthenticationOrCancel({
    runtime: input.runtime,
    promptMessage: resolveProfileAuthPromptMessage(input.action),
    allowPrompt: canUseInteractivePrompts(input.runtime),
    evaluated,
  });
  if (authenticated) {
    const refreshed = await evaluateCommandAuthentication();
    if (refreshed.status === "valid" && refreshed.session) {
      primeOpenMeldProfilesSessionCache(refreshed.session);
    }
  }
  return authenticated;
}

function resolveProfileAuthPromptMessage(
  action: ProfileCommandAuthAction
): string {
  switch (action) {
    case "create":
      return buildCommandAuthenticationPromptMessage("creating a profile");
    case "list":
      return buildCommandAuthenticationPromptMessage("viewing your profiles");
    case "show":
      return buildCommandAuthenticationPromptMessage("showing a profile");
    case "set":
      return buildCommandAuthenticationPromptMessage("choosing a profile");
    case "update":
      return buildCommandAuthenticationPromptMessage("updating a profile");
    case "delete":
      return buildCommandAuthenticationPromptMessage("deleting a profile");
    default:
      return buildCommandAuthenticationPromptMessage();
  }
}
