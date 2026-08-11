import { isCancel, select, text } from "@clack/prompts";
import type { AgentControllerPermissionMode } from "@openmeld/schemas/types";
import {
  createOpenMeldAgentProfile,
  createOpenMeldHumanProfile,
  getOpenMeldProfileCapabilities,
  type OpenMeldProfile,
} from "../config/openmeld-profiles-api";
import { assertAdditionalHumanProfileCreationEnabled } from "../config/profile-creation-capability";
import { resolveOpenMeldProfileOrNull } from "../config/resolve-openmeld-profile";
import { resolveLocalAgentControllerReportInput } from "../local-service/reporting/local-agent-controller-report-resolution";
import { submitRuntimeAgentControllerReport } from "../local-service/reporting/runtime-agent-controller-reporting-submission";
import { createProfileCreateGuideError } from "../runtime/dual-view-guide-catalog";
import { ensureAgentProfileRuntimeBinding } from "../system/ensure-agent-profile-runtime-binding";
import { promptTextEntry } from "../ui/text-entry";

const CREATE_PROFILE_KIND_EXIT_VALUE = "__create_profile_kind_exit__";
const CREATE_PROFILE_KIND_BACK_VALUE = "__create_profile_kind_back__";

export type CreateProfileKind = "human" | "agent";
export const DEFAULT_CREATE_PROFILE_NAME_PLACEHOLDERS = {
  human: "openmeld-ceo",
  agent: "my-codex-researcher",
} as const satisfies Record<CreateProfileKind, string>;
export type CreateProfilePromptResult<T> =
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

type CreateProfileNamePlaceholderResolver =
  | Partial<Record<CreateProfileKind, string>>
  | ((profileKind: CreateProfileKind) => string | undefined);

export type CreateProfileLocalAgentSelection = {
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  agentControllerConversationId?: string;
  agentControllerRef?: string;
  controllerEnabled?: boolean;
  modelId?: string;
  reasoningLevel?: string;
};

export function normalizeCreateProfileKind(
  value: string | undefined
): CreateProfileKind | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "human" || normalized === "agent") {
    return normalized;
  }
  throw new Error("invalid --kind value: use human|agent");
}

export function assertCreateProfileKindAllowedInView(input: {
  profileKind: CreateProfileKind;
  resolvedView: "human" | "agent";
}): void {
  if (input.resolvedView === "agent" && input.profileKind === "human") {
    throw createProfileCreateGuideError(
      "agent view cannot create human profiles; switch to human view for human profile creation."
    );
  }
}

export async function resolveCreateProfileKind(input: {
  explicitKind: string | undefined;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
  promptMessage?: string;
  allowBack?: boolean;
  backLabel?: string;
  exitLabel?: string;
}): Promise<CreateProfilePromptResult<CreateProfileKind>> {
  const explicitKind = normalizeCreateProfileKind(input.explicitKind);
  if (explicitKind) {
    assertCreateProfileKindAllowedInView({
      profileKind: explicitKind,
      resolvedView: input.resolvedView,
    });
    if (explicitKind === "human") {
      await assertAdditionalHumanProfileCreationAvailable(input.resolvedView);
    }
    return {
      status: "submitted",
      value: explicitKind,
    };
  }

  if (!input.allowPrompt) {
    if (input.resolvedView === "agent") {
      throw createProfileCreateGuideError(
        "agent view requires explicit --kind and only supports creating agent profiles."
      );
    }
    throw new Error(
      "missing required argument '--kind <human|agent>' for openmeld profile create"
    );
  }

  const { additionalHumanProfileCreationEnabled } =
    await resolveAdditionalHumanProfileCreationCapability(input.resolvedView);
  const kindOptions =
    input.resolvedView === "agent" || !additionalHumanProfileCreationEnabled
      ? [
          {
            value: "agent",
            label: "Agent",
          },
        ]
      : [
          {
            value: "human",
            label: "Human",
          },
          {
            value: "agent",
            label: "Agent",
          },
        ];
  const selectedKind = await select({
    message: input.promptMessage ?? "Profile kind",
    options: [
      ...kindOptions,
      {
        value:
          input.allowBack === true
            ? CREATE_PROFILE_KIND_BACK_VALUE
            : CREATE_PROFILE_KIND_EXIT_VALUE,
        label:
          input.allowBack === true
            ? (input.backLabel ?? "Back")
            : (input.exitLabel ?? "Exit"),
      },
    ],
  });
  if (isCancel(selectedKind)) {
    return {
      status: "cancelled",
    };
  }
  if (selectedKind === CREATE_PROFILE_KIND_BACK_VALUE) {
    return {
      status: "back",
    };
  }
  if (selectedKind === CREATE_PROFILE_KIND_EXIT_VALUE) {
    return {
      status: "cancelled",
    };
  }

  if (!(selectedKind === "human" || selectedKind === "agent")) {
    throw new Error("invalid profile kind selection");
  }
  if (selectedKind === "human" && !additionalHumanProfileCreationEnabled) {
    assertAdditionalHumanProfileCreationEnabled({
      additionalHumanProfileCreationEnabled,
    });
  }
  assertCreateProfileKindAllowedInView({
    profileKind: selectedKind,
    resolvedView: input.resolvedView,
  });
  return {
    status: "submitted",
    value: selectedKind,
  };
}

async function assertAdditionalHumanProfileCreationAvailable(
  resolvedView: "human" | "agent"
): Promise<void> {
  const capability =
    await resolveAdditionalHumanProfileCreationCapability(resolvedView);
  assertAdditionalHumanProfileCreationEnabled({
    additionalHumanProfileCreationEnabled:
      capability.additionalHumanProfileCreationEnabled,
    cause: capability.failure,
  });
}

async function resolveAdditionalHumanProfileCreationCapability(
  resolvedView: "human" | "agent"
): Promise<{
  additionalHumanProfileCreationEnabled: boolean;
  failure: unknown | null;
}> {
  if (resolvedView === "agent") {
    return {
      additionalHumanProfileCreationEnabled: false,
      failure: null,
    };
  }
  try {
    return {
      ...(await getOpenMeldProfileCapabilities()),
      failure: null,
    };
  } catch (error) {
    console.warn(
      "[openmeld.profile_capabilities.read_failed]",
      toProfileCapabilityFailureDiagnostic(error)
    );
    return {
      additionalHumanProfileCreationEnabled: false,
      failure: error,
    };
  }
}

function toProfileCapabilityFailureDiagnostic(error: unknown): {
  cause: string | null;
  code: string | null;
  endpoint: string | null;
  message: string;
  name: string;
  status: number | null;
} {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : null;
  const cause = record?.cause;
  return {
    cause: cause instanceof Error ? cause.message : null,
    code: typeof record?.code === "string" ? record.code : null,
    endpoint: typeof record?.endpoint === "string" ? record.endpoint : null,
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : typeof error,
    status: typeof record?.status === "number" ? record.status : null,
  };
}

export async function resolveCreateProfileName(input: {
  explicitProfileName: string | undefined;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
  profileKind?: CreateProfileKind;
  promptMessage?: string;
  promptPlaceholder?: string;
  allowBack?: boolean;
  backLabel?: string;
}): Promise<CreateProfilePromptResult<string>> {
  const fromInput = String(input.explicitProfileName ?? "").trim();
  if (fromInput) {
    return {
      status: "submitted",
      value: fromInput,
    };
  }

  if (!input.allowPrompt) {
    if (input.resolvedView === "agent") {
      throw createProfileCreateGuideError(
        "agent view requires explicit profile name (<profileName> or --name)."
      );
    }
    throw new Error(
      "missing required argument 'profileName' for openmeld profile create"
    );
  }

  const promptPlaceholder =
    input.promptPlaceholder ??
    (input.profileKind
      ? DEFAULT_CREATE_PROFILE_NAME_PLACEHOLDERS[input.profileKind]
      : DEFAULT_CREATE_PROFILE_NAME_PLACEHOLDERS.agent);

  if (input.allowBack === true) {
    const value = await promptTextEntry({
      message: input.promptMessage ?? "Profile name",
      placeholder: promptPlaceholder,
      allowBack: true,
      backLabel: input.backLabel ?? "Back",
      requiredMessage: "Profile name is required.",
    });
    if (value.status === "cancelled") {
      return {
        status: "cancelled",
      };
    }
    if (value.status === "back") {
      return {
        status: "back",
      };
    }
    return {
      status: "submitted",
      value: value.value.trim(),
    };
  }

  const value = await text({
    message: input.promptMessage ?? "Profile name",
    placeholder: promptPlaceholder,
  });
  if (isCancel(value)) {
    return {
      status: "cancelled",
    };
  }

  const profileName = String(value ?? "").trim();
  if (!profileName) {
    throw new Error("profileName is required");
  }

  return {
    status: "submitted",
    value: profileName,
  };
}

export async function resolveCreateProfileIdentity(input: {
  explicitKind: string | undefined;
  explicitProfileName: string | undefined;
  allowPrompt: boolean;
  resolvedView: "human" | "agent";
  kindPromptMessage?: string;
  namePromptMessage?: string;
  namePromptPlaceholder?: CreateProfileNamePlaceholderResolver;
  allowBackFromKind?: boolean;
  kindBackLabel?: string;
  kindExitLabel?: string;
  allowBackFromNameToKind?: boolean;
  nameBackLabel?: string;
}): Promise<
  CreateProfilePromptResult<{
    profileKind: CreateProfileKind;
    profileName: string;
  }>
> {
  while (true) {
    const profileKind = await resolveCreateProfileKind({
      explicitKind: input.explicitKind,
      allowPrompt: input.allowPrompt,
      resolvedView: input.resolvedView,
      promptMessage: input.kindPromptMessage,
      allowBack: input.allowBackFromKind === true,
      backLabel: input.kindBackLabel,
      exitLabel: input.kindExitLabel,
    });
    if (profileKind.status !== "submitted") {
      return profileKind;
    }

    const profileName = await resolveCreateProfileName({
      explicitProfileName: input.explicitProfileName,
      allowPrompt: input.allowPrompt,
      resolvedView: input.resolvedView,
      profileKind: profileKind.value,
      promptMessage: input.namePromptMessage,
      promptPlaceholder: resolveCreateProfileNamePlaceholder({
        source: input.namePromptPlaceholder,
        profileKind: profileKind.value,
      }),
      allowBack: input.allowBackFromNameToKind === true,
      backLabel: input.nameBackLabel,
    });
    if (profileName.status === "back") {
      continue;
    }
    if (profileName.status !== "submitted") {
      return profileName;
    }

    return {
      status: "submitted",
      value: {
        profileKind: profileKind.value,
        profileName: profileName.value,
      },
    };
  }
}

export async function createProfileByKind(input: {
  profileName: string;
  profileKind: CreateProfileKind;
  localAgentSelection?: CreateProfileLocalAgentSelection;
}): Promise<OpenMeldProfile> {
  // OPENMELD_SETUP_TO_WAKE_PATH: HIGHEST_FACT user-confirmed-profile
  // Runtime discovery must not auto-create Agent Profiles. Agent Profiles come
  // from user intent, either directly or through a Setup Agent the user approved.
  const creatorProfileId = await resolveCurrentCreatorProfileId();
  if (input.profileKind === "human") {
    if (input.localAgentSelection) {
      throw new Error("--agent-controller can only be used with --kind agent");
    }
    return createOpenMeldHumanProfile({
      profileName: input.profileName,
      ...(creatorProfileId ? { creatorProfileId } : {}),
    });
  }
  const created = await createOpenMeldAgentProfile({
    profileName: input.profileName,
    ...(creatorProfileId ? { creatorProfileId } : {}),
  });
  if (input.localAgentSelection?.controllerEnabled !== false) {
    await bindCreatedAgentProfileToLocalRuntime({
      localAgentSelection: input.localAgentSelection,
      profile: created,
    });
  }
  return created;
}

async function bindCreatedAgentProfileToLocalRuntime(input: {
  localAgentSelection: CreateProfileLocalAgentSelection | undefined;
  profile: OpenMeldProfile;
}): Promise<void> {
  if (!input.localAgentSelection) {
    return;
  }
  const agentControllerRef = resolveCreateProfileAgentControllerRef(
    input.localAgentSelection
  );
  if (!agentControllerRef) {
    return;
  }
  const runtimeReportSubmission = await submitRuntimeAgentControllerReport(
    await resolveLocalAgentControllerReportInput({
      agentControllerRef,
      diagnosticProfileId: input.profile.openMeldProfileId,
      requireEnabled: false,
    })
  );
  await ensureAgentProfileRuntimeBinding({
    agentControllerPermissionMode:
      input.localAgentSelection.agentControllerPermissionMode,
    agentControllerConversationId:
      input.localAgentSelection.agentControllerConversationId,
    confirmLocalExecutionEvidence: false,
    modelId: input.localAgentSelection.modelId,
    profile: input.profile,
    reasoningLevel: input.localAgentSelection.reasoningLevel,
    runtimeReportSubmission,
  });
}

function resolveCreateProfileAgentControllerRef(
  selection: CreateProfileLocalAgentSelection
): string | null {
  return normalizeOptionalText(selection.agentControllerRef);
}

async function resolveCurrentCreatorProfileId(): Promise<string | null> {
  const currentProfile = await resolveOpenMeldProfileOrNull({
    allowDefaultFallback: true,
    allowUnauthenticated: true,
    persistSelection: false,
  }).catch(() => null);
  return currentProfile?.openMeldProfileId ?? null;
}

function resolveCreateProfileNamePlaceholder(input: {
  source?: CreateProfileNamePlaceholderResolver;
  profileKind: CreateProfileKind;
}): string | undefined {
  if (!input.source) {
    return undefined;
  }
  if (typeof input.source === "function") {
    return input.source(input.profileKind);
  }
  return input.source[input.profileKind];
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
