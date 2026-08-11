import { cancel, isCancel, note, select } from "@clack/prompts";
import {
  createOpenMeldHumanProfile,
  listOpenMeldProfiles,
  type OpenMeldProfile,
  resolveOpenMeldProfile,
} from "../config/openmeld-profiles-api";
import { resolveOpenMeldProfileOrNull } from "../config/resolve-openmeld-profile";
import { toProfileKind } from "../lib/profile-kind";
import {
  type AgentProfileSetupResult,
  persistAgentTransportSelection,
  resolveAgentProfileSetup,
} from "../profile/agent-setup-flow";
import {
  createProfileByKind,
  resolveCreateProfileKind,
  resolveCreateProfileName,
} from "../profile/create-flow";
import { formatAgentOverviewPayload } from "../runtime/agent-overview-payload";
import {
  formatInlineOpenMeldCliCommands,
  formatOpenMeldCliCommand,
} from "../runtime/cli-entry-command";
import { createStartAgentIdentityGuideError } from "../runtime/dual-view-guide-catalog";
import { formatMessage } from "../runtime/messages";
import type { createPresenter } from "../runtime/presenter/index";
import type { RuntimeContext } from "../runtime/types";
import { prepareLocalAgentReadiness } from "../system/local-agent-readiness-preparation";
import { promptSearchSelect, type SearchSelectItem } from "../ui/search-select";
import { formatTransportModeDisplay } from "../ui/transport-mode-display";

const START_ACTION_USE_DEFAULT = "__start_action_use_default__";
const START_ACTION_CREATE = "__start_action_create__";
const START_ACTION_SELECT = "__start_action_select__";
const START_ACTION_EXIT = "__start_action_exit__";
const START_AGENT_CONTROLLER_RULE_NOTE =
  "When creating or updating an agent profile, use the agent controller that matches your current runtime agent when supported. If your runtime agent is unsupported, continue without an agent controller and tell the user clearly.";

type StartPresenter = ReturnType<typeof createPresenter>;

type StartCreateProfileInput = {
  kind: "human" | "agent";
  profileName: string;
};

type StartProfileContext = {
  runtime: RuntimeContext;
  presenter: StartPresenter;
  interactive: boolean;
};

export async function ensureDefaultHumanProfile(input: {
  runtime: RuntimeContext;
  presenter: StartPresenter;
}): Promise<OpenMeldProfile> {
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "start.default_profile.ensure",
      payload: {
        status: "in_progress",
      },
    });
  }

  const profile = await resolveOpenMeldProfile({
    profileKind: "human",
  });

  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "start.default_profile.ensure",
      payload: {
        status: "done",
        profile,
      },
    });
  }

  return profile;
}

export function emitStartAgentOverview(input: {
  runtime: RuntimeContext;
  presenter: StartPresenter;
}): void {
  if (input.runtime.resolvedView !== "agent") {
    return;
  }

  const guide = createStartAgentIdentityGuideError().guide;
  input.presenter.data({
    code: "start.agent_overview",
    payload: formatAgentOverviewPayload({
      summary:
        "Use `openmeld start --view agent` to select or create an OpenMeld Agent Profile and return explicit Space commands.",
      requiredArguments: guide.agentRequiredArgs ?? [],
      optionalArguments: guide.agentOptionalArgs ?? [],
      commands: guide.agentCommands ?? [],
      stages: ["check_arguments", "authenticate", "profile", "space_entry"],
      notes: [...(guide.notes ?? []), START_AGENT_CONTROLLER_RULE_NOTE],
      humanActionRequired: {
        possible: true,
        steps: guide.humanSteps ?? [],
      },
    }),
  });
}

export function ensureStartAgentIdentityPreflight(input: {
  runtime: RuntimeContext;
  profile?: string;
  profileId?: string;
  kind?: string;
  profileName?: string;
  agentName?: string;
}): void {
  if (input.runtime.resolvedView !== "agent") {
    return;
  }

  const inspection = inspectStartAgentIdentityInput(input);
  if (inspection.status === "valid") {
    return;
  }

  throwStartAgentIdentityGuide({
    summary: inspection.summary,
  });
}

export function shouldEnsureDefaultHumanProfile(input: {
  resolvedView: RuntimeContext["resolvedView"];
  profile?: string;
  profileId?: string;
  kind?: string;
  profileName?: string;
  agentName?: string;
}): boolean {
  if (input.resolvedView !== "human") {
    return false;
  }

  const explicitProfile =
    normalizeOptionalString(input.profileId) ??
    normalizeOptionalString(input.profile);
  if (explicitProfile) {
    return false;
  }

  return resolveCreateProfileInputFromArgs(input) === null;
}

export function renderDefaultHumanProfileCard(input: {
  runtime: RuntimeContext;
  presenter: StartPresenter;
  profile: OpenMeldProfile;
}): void {
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "start.default_profile",
      payload: {
        profile: input.profile,
      },
    });
    return;
  }

  note(
    [
      "In OpenMeld, a profile is your identity in Spaces.",
      `Currently using: ${input.profile.profileName}`,
      `Type: ${formatStartProfileKindLabel(input.profile.profileKind)}`,
    ].join("\n"),
    "Your current OpenMeld Identity",
    {
      format: (value) => value,
    }
  );
}

export async function resolveStartSelectedProfile(input: {
  profile?: string;
  profileId?: string;
  kind?: string;
  profileName?: string;
  agentName?: string;
  runtime: RuntimeContext;
  presenter: StartPresenter;
  interactive: boolean;
  defaultHumanProfile: OpenMeldProfile | null;
  allowBack?: boolean;
}): Promise<OpenMeldProfile | "back" | null> {
  const profileFromArguments =
    await resolveStartSelectedProfileFromArguments(input);
  if (profileFromArguments.handled) {
    return profileFromArguments.profile ?? null;
  }

  if (!input.defaultHumanProfile) {
    throw new Error("default human profile unavailable");
  }

  if (!input.interactive) {
    return input.defaultHumanProfile;
  }

  return promptForInteractiveHumanStartProfileSelection({
    defaultHumanProfile: input.defaultHumanProfile,
    runtime: input.runtime,
    presenter: input.presenter,
    interactive: input.interactive,
    allowBack: input.allowBack === true,
  });
}

export function renderSelectedProfile(input: {
  runtime: RuntimeContext;
  presenter: StartPresenter;
  profile: OpenMeldProfile;
  selectionPersistent?: boolean;
}): void {
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "start.profile.selected",
      payload: {
        profile: input.profile,
      },
    });
    return;
  }

  note(
    [
      `Profile Name: ${input.profile.profileName}`,
      `Type: ${formatStartProfileKindLabel(input.profile.profileKind)}`,
      ...(input.selectionPersistent === false
        ? [
            "This choice only applies to this session.",
            `Next: Use ${formatOpenMeldCliCommand("openmeld profiles set")} if you want OpenMeld to keep using this profile next time.`,
          ]
        : []),
    ].join("\n"),
    "OpenMeld Profile Selected"
  );
}

export function emitStartSelectionPersistenceWarning(input: {
  presenter: StartPresenter;
  runtime: RuntimeContext;
  selectionPersistent: boolean;
  cliContextSource?: string;
}): void {
  if (input.selectionPersistent) {
    return;
  }

  if (input.runtime.resolvedView === "human") {
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

export function buildStartMetadataLine(
  parts: Array<string | null | undefined>
): string {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" · ");
}

async function resolveStartSelectedProfileFromArguments(input: {
  profile?: string;
  profileId?: string;
  kind?: string;
  profileName?: string;
  agentName?: string;
  runtime: RuntimeContext;
  presenter: StartPresenter;
  interactive: boolean;
}): Promise<{
  handled: boolean;
  profile?: OpenMeldProfile | null;
}> {
  if (input.runtime.resolvedView === "agent") {
    const inspection = inspectStartAgentIdentityInput(input);
    if (inspection.status === "error") {
      throwStartAgentIdentityGuide({
        summary: inspection.summary,
      });
    }
  }

  const explicitProfile = await resolveExplicitStartProfile({
    profile: input.profile,
    profileId: input.profileId,
  });
  if (explicitProfile) {
    validateStartProfileAgainstView({
      resolvedView: input.runtime.resolvedView,
      profile: explicitProfile,
    });
    return {
      handled: true,
      profile: explicitProfile,
    };
  }

  const createProfileInput = resolveCreateProfileInputFromArgs(input);
  if (createProfileInput) {
    validateStartProfileCreationAgainstView({
      resolvedView: input.runtime.resolvedView,
      createProfileInput,
    });
    const createdProfile = await createProfileForStart(createProfileInput, {
      runtime: input.runtime,
      presenter: input.presenter,
      interactive: input.interactive,
    });
    return {
      handled: true,
      profile: createdProfile === "back" ? null : createdProfile,
    };
  }

  if (input.runtime.resolvedView === "agent") {
    throwStartAgentIdentityGuide({
      summary:
        "openmeld start in agent view requires explicit agent profile selection or creation arguments.",
    });
  }

  return {
    handled: false,
  };
}

function resolveExplicitStartProfile(input: {
  profile?: string;
  profileId?: string;
}): Promise<OpenMeldProfile | null> {
  const explicitProfileId = normalizeOptionalString(input.profileId);
  if (explicitProfileId) {
    return resolveOpenMeldProfile({
      openMeldProfileId: explicitProfileId,
    });
  }

  const explicitProfile = normalizeOptionalString(input.profile);
  if (!explicitProfile) {
    return Promise.resolve(null);
  }

  return resolveOpenMeldProfile({
    openMeldProfileId: explicitProfile,
  }).catch(async () => {
    const profiles = await listOpenMeldProfiles();
    const matched = profiles.find(
      (profile) =>
        profile.profileName.toLowerCase() === explicitProfile.toLowerCase()
    );
    if (matched) {
      return matched;
    }

    throw new Error(`OpenMeld profile not found: ${explicitProfile}`);
  });
}

function validateStartProfileAgainstView(input: {
  resolvedView: RuntimeContext["resolvedView"];
  profile: OpenMeldProfile;
}): void {
  if (input.resolvedView !== "agent" || input.profile.profileKind === "agent") {
    return;
  }

  throwStartAgentIdentityGuide({
    summary: `agent view cannot use ${input.profile.profileKind} profile '${input.profile.profileName}'. pass an agent profile id/name, or switch to human view.`,
  });
}

function validateStartProfileCreationAgainstView(input: {
  resolvedView: RuntimeContext["resolvedView"];
  createProfileInput: StartCreateProfileInput;
}): void {
  if (
    input.resolvedView !== "agent" ||
    input.createProfileInput.kind === "agent"
  ) {
    return;
  }

  throwStartAgentIdentityGuide({
    summary:
      "agent view cannot create human profiles. use --kind agent, or switch to human view.",
  });
}

async function promptForInteractiveHumanStartProfileSelection(input: {
  defaultHumanProfile: OpenMeldProfile;
  runtime: RuntimeContext;
  presenter: StartPresenter;
  interactive: boolean;
  allowBack: boolean;
}): Promise<OpenMeldProfile | "back" | null> {
  const { actionOptions, alternativeProfiles } =
    await buildStartProfileActionContext(input.defaultHumanProfile, {
      allowBack: input.allowBack,
    });

  while (true) {
    const action = await select({
      message: "Which profile do you want to use?",
      initialValue: START_ACTION_USE_DEFAULT,
      options: actionOptions,
    });
    const resolvedAction = await resolveInteractiveStartProfileAction({
      action,
      defaultHumanProfile: input.defaultHumanProfile,
      runtime: input.runtime,
      presenter: input.presenter,
      interactive: input.interactive,
      alternativeProfiles,
      allowBack: input.allowBack,
    });
    if (resolvedAction.status === "repeat") {
      continue;
    }
    if (resolvedAction.status === "back") {
      return "back";
    }
    return resolvedAction.profile;
  }
}

async function buildStartProfileActionContext(
  defaultHumanProfile: OpenMeldProfile,
  input: {
    allowBack: boolean;
  }
): Promise<{
  actionOptions: Array<{
    value: string;
    label: string;
  }>;
  alternativeProfiles: OpenMeldProfile[];
}> {
  const profiles = await listOpenMeldProfiles();
  const alternativeProfiles = profiles.filter(
    (profile) =>
      profile.openMeldProfileId !== defaultHumanProfile.openMeldProfileId
  );

  return {
    actionOptions: [
      {
        value: START_ACTION_USE_DEFAULT,
        label: `Continue as ${defaultHumanProfile.profileName}`,
      },
      ...(alternativeProfiles.length > 0
        ? [
            {
              value: START_ACTION_SELECT,
              label: "Use another profile",
            },
          ]
        : []),
      {
        value: START_ACTION_CREATE,
        label: "Create a new profile",
      },
      {
        value: START_ACTION_EXIT,
        label: input.allowBack ? "Back" : "Exit",
      },
    ],
    alternativeProfiles,
  };
}

async function resolveInteractiveStartProfileAction(input: {
  action: string | symbol;
  defaultHumanProfile: OpenMeldProfile;
  runtime: RuntimeContext;
  presenter: StartPresenter;
  interactive: boolean;
  alternativeProfiles: OpenMeldProfile[];
  allowBack: boolean;
}): Promise<
  | {
      status: "repeat";
    }
  | {
      status: "back";
    }
  | {
      status: "resolved";
      profile: OpenMeldProfile | null;
    }
> {
  if (isCancel(input.action)) {
    cancel("Cancelled.");
    return {
      status: "resolved",
      profile: null,
    };
  }
  if (input.action === START_ACTION_EXIT) {
    if (input.allowBack) {
      return {
        status: "back",
      };
    }
    cancel("Cancelled.");
    return {
      status: "resolved",
      profile: null,
    };
  }

  if (input.action === START_ACTION_USE_DEFAULT) {
    return {
      status: "resolved",
      profile: input.defaultHumanProfile,
    };
  }

  if (input.action === START_ACTION_SELECT) {
    return resolveInteractiveStartProfileSearchSelection({
      alternativeProfiles: input.alternativeProfiles,
    });
  }

  const createdProfile = await promptCreateProfileForStart({
    runtime: input.runtime,
    presenter: input.presenter,
    interactive: input.interactive,
  });
  if (createdProfile === "back") {
    return {
      status: "repeat",
    };
  }
  return {
    status: "resolved",
    profile: createdProfile,
  };
}

async function resolveInteractiveStartProfileSearchSelection(input: {
  alternativeProfiles: OpenMeldProfile[];
}): Promise<
  | {
      status: "repeat";
    }
  | {
      status: "resolved";
      profile: OpenMeldProfile | null;
    }
> {
  const selectedProfile = await promptSelectOpenMeldProfile(
    input.alternativeProfiles
  );
  if (selectedProfile.status === "cancelled") {
    cancel("Cancelled.");
    return {
      status: "resolved",
      profile: null,
    };
  }
  if (selectedProfile.status === "back") {
    return {
      status: "repeat",
    };
  }

  return {
    status: "resolved",
    profile: selectedProfile.profile,
  };
}

function resolveCreateProfileInputFromArgs(input: {
  kind?: string;
  profileName?: string;
  agentName?: string;
}): StartCreateProfileInput | null {
  const kind = parseStartProfileKind(input.kind);
  const profileName =
    normalizeOptionalString(input.profileName) ??
    (kind === "agent" ? normalizeOptionalString(input.agentName) : null);
  if (!(kind && profileName)) {
    return null;
  }

  return {
    kind,
    profileName,
  };
}

function inspectStartAgentIdentityInput(input: {
  profile?: string;
  profileId?: string;
  kind?: string;
  profileName?: string;
  agentName?: string;
}):
  | {
      status: "valid";
    }
  | {
      status: "error";
      summary: string;
    } {
  const explicitProfile =
    normalizeOptionalString(input.profileId) ??
    normalizeOptionalString(input.profile);
  if (explicitProfile) {
    return {
      status: "valid",
    };
  }

  const rawKind = normalizeOptionalString(input.kind);
  const parsedKind = parseStartProfileKind(input.kind);
  const rawProfileName = normalizeOptionalString(input.profileName);
  const rawAgentName = normalizeOptionalString(input.agentName);

  if (parsedKind === "human") {
    return {
      status: "error",
      summary:
        "agent view cannot create human profiles. use --kind agent, or switch to human view.",
    };
  }

  if (rawKind && parsedKind === null) {
    return {
      status: "error",
      summary:
        "openmeld start in agent view only supports --kind agent when creating a new profile.",
    };
  }

  if (parsedKind === "agent") {
    if (rawProfileName || rawAgentName) {
      return {
        status: "valid",
      };
    }
    return {
      status: "error",
      summary:
        "openmeld start in agent view requires --profile-name <name> or --agent-name <name> when using --kind agent.",
    };
  }

  if (rawProfileName || rawAgentName) {
    return {
      status: "error",
      summary:
        "openmeld start in agent view requires --kind agent when creating a new profile by name.",
    };
  }

  return {
    status: "error",
    summary:
      "openmeld start in agent view requires explicit agent profile selection or creation arguments.",
  };
}

function parseStartProfileKind(
  value: string | undefined
): "human" | "agent" | null {
  const parsed = toProfileKind(value);
  if (parsed === "human" || parsed === "agent") {
    return parsed;
  }
  return null;
}

async function promptSelectOpenMeldProfile(
  profiles: OpenMeldProfile[]
): Promise<
  | {
      status: "selected";
      profile: OpenMeldProfile;
    }
  | {
      status: "back";
    }
  | {
      status: "cancelled";
    }
> {
  if (profiles.length === 0) {
    return {
      status: "back",
    };
  }

  const selected = await promptSearchSelect({
    message: "Choose a profile",
    items: profiles.map(buildStartProfileSearchItem),
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

  const profileId = String(selected.value).trim();
  return {
    status: "selected",
    profile: await resolveOpenMeldProfile({
      openMeldProfileId: profileId,
    }),
  };
}

function buildStartProfileSearchItem(
  profile: OpenMeldProfile
): SearchSelectItem<string> {
  const detail = buildStartMetadataLine([
    profile.profileKind,
    profile.openMeldProfileId,
  ]);
  return {
    value: profile.openMeldProfileId,
    label: profile.profileName,
    detail,
    searchText: [
      profile.profileName,
      profile.profileKind,
      profile.openMeldProfileId,
    ].join(" "),
  };
}

async function promptCreateProfileForStart(
  context: StartProfileContext
): Promise<OpenMeldProfile | "back" | null> {
  while (true) {
    const kindResult = await resolveCreateProfileKind({
      explicitKind: undefined,
      allowPrompt: true,
      resolvedView: context.runtime.resolvedView,
      allowBack: true,
      backLabel: "Back",
    });
    if (kindResult.status === "cancelled") {
      cancel("Cancelled.");
      return null;
    }
    if (kindResult.status === "back") {
      return "back";
    }

    while (true) {
      const profileNameResult = await resolveCreateProfileName({
        explicitProfileName: undefined,
        allowPrompt: true,
        resolvedView: context.runtime.resolvedView,
        profileKind: kindResult.value,
        promptMessage: "Profile name",
        promptPlaceholder:
          kindResult.value === "agent" ? "my-codex-researcher" : "openmeld-ceo",
        allowBack: true,
        backLabel: "Back",
      });
      if (profileNameResult.status === "cancelled") {
        cancel("Cancelled.");
        return null;
      }
      if (profileNameResult.status === "back") {
        break;
      }

      const created = await createProfileForStart(
        {
          kind: kindResult.value,
          profileName: profileNameResult.value,
        },
        context,
        {
          allowBackToCaller: true,
        }
      );
      if (created === "back") {
        continue;
      }
      return created;
    }
  }
}

async function createProfileForStart(
  input: StartCreateProfileInput,
  context: StartProfileContext,
  options?: {
    allowBackToCaller?: boolean;
  }
): Promise<OpenMeldProfile | "back" | null> {
  const creatorProfileId = await resolveCurrentCreatorProfileId();
  if (input.kind === "agent") {
    const setup = await resolveStartAgentProfileSetup(context, {
      allowBackToCaller: options?.allowBackToCaller === true,
    });
    if (setup.status === "cancelled") {
      cancel("Cancelled.");
      return null;
    }
    if (setup.status === "back") {
      return "back";
    }
    const created = await createProfileByKind({
      profileName: input.profileName,
      profileKind: "agent",
      ...(setup.status === "configured"
        ? {
            localAgentSelection: {
              agentControllerRef: setup.agentControllerRef,
              controllerEnabled: true,
            },
          }
        : {}),
    });
    if (setup.status === "configured") {
      await persistAgentTransportSelection({
        agentControllerRef: setup.agentControllerRef,
        transportMode: setup.transportMode,
      });
    }
    const preparation = await prepareLocalAgentReadiness({
      profiles: [created],
      interactive: false,
    });
    const preparedProfile = preparation.profiles[0] ?? created;
    await emitStartAgentProfileSetup({
      runtime: context.runtime,
      presenter: context.presenter,
      setup,
      profile: preparedProfile,
    });
    return preparedProfile;
  }

  return createOpenMeldHumanProfile({
    profileName: input.profileName,
    ...(creatorProfileId ? { creatorProfileId } : {}),
  });
}

async function resolveCurrentCreatorProfileId(): Promise<string | null> {
  const currentProfile = await resolveOpenMeldProfileOrNull({
    allowDefaultFallback: true,
    allowUnauthenticated: true,
    persistSelection: false,
  }).catch(() => null);
  return currentProfile?.openMeldProfileId ?? null;
}

function resolveStartAgentProfileSetup(
  context: StartProfileContext,
  input?: {
    allowBackToCaller?: boolean;
  }
): Promise<AgentProfileSetupResult> {
  return resolveAgentProfileSetup({
    interactive:
      context.runtime.resolvedView === "human" && context.interactive,
    useAutoSelectionWhenNonInteractive: true,
    selectControllerMessage: "Choose an agent controller for this profile.",
    selectTransportModeMessage:
      "How should this profile connect to its agent controller?",
    selectResponsePolicyMessage: "When should this profile auto-reply?",
    skipControllerOptionLabel: "Skip for now",
    allowBackToCaller: input?.allowBackToCaller === true,
  });
}

function emitStartAgentProfileSetup(input: {
  runtime: RuntimeContext;
  presenter: StartPresenter;
  setup: AgentProfileSetupResult;
  profile: OpenMeldProfile;
}): void {
  const setupCommand = buildStartSetupProfileCommand({
    profileId: input.profile.openMeldProfileId,
    resolvedView: input.runtime.resolvedView,
  });
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "start.profile.agent_setup",
      payload:
        input.setup.status === "configured"
          ? {
              status: "configured",
              profileId: input.profile.openMeldProfileId,
              controller: {
                ref: input.setup.agentControllerRef,
                displayName: input.setup.controllerDisplayName,
              },
              transportMode: input.setup.transportMode,
              responsePolicy: input.setup.responsePolicy,
              selectionMode: input.setup.selectionMode,
            }
          : {
              status: input.setup.status,
              profileId: input.profile.openMeldProfileId,
              ...(input.setup.status === "skipped_no_enabled_controllers" &&
              input.setup.reason
                ? { reason: input.setup.reason }
                : {}),
              nextSteps: [setupCommand],
            },
    });
    return;
  }

  if (input.setup.status === "configured") {
    note(
      [
        `Agent: ${input.setup.controllerDisplayName} (${input.setup.agentControllerRef})`,
        `Connection Type: ${formatTransportModeDisplay(input.setup.transportMode)}`,
        `Replies: ${input.setup.responsePolicy}`,
      ].join("\n"),
      "Agent Profile Setup"
    );
    return;
  }

  const skippedReason =
    input.setup.status === "skipped_no_enabled_controllers"
      ? `No enabled agent controller is available on this computer. Run \`${setupCommand}\` when this computer is ready for local agent setup.`
      : "Skipped by user.";
  note(
    [
      skippedReason,
      formatInlineOpenMeldCliCommands(
        "You can assign an agent controller later with `openmeld profiles update`."
      ),
    ].join("\n"),
    "Agent Profile Setup"
  );
}

function buildStartSetupProfileCommand(input: {
  profileId: string;
  resolvedView: RuntimeContext["resolvedView"];
}): string {
  return formatOpenMeldCliCommand(
    input.resolvedView === "agent"
      ? `openmeld setup --profile ${input.profileId} --view agent`
      : `openmeld setup --profile ${input.profileId}`
  );
}

function throwStartAgentIdentityGuide(input: { summary: string }): never {
  throw createStartAgentIdentityGuideError(input.summary);
}

function formatStartProfileKindLabel(
  profileKind: OpenMeldProfile["profileKind"]
): string {
  return profileKind === "agent" ? "AI agent" : "human";
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
