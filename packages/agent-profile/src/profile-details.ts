import type {
  AuthProfileView,
  GetAgentExecutionReadinessResponse,
  GetAgentProfilePrimaryBindingResponse,
  ProfileDetailsField,
  ProfileDetailsFieldSource,
  ProfileDetailsFieldValueKind,
  ProfileDetailsFieldVisibility,
  ProfileDetailsSection,
  ProfileDetailsSnapshot,
  ProfileDetailsViewerScope,
} from "@openmeld/schemas/types";

export type ProfileDetailsSpaceMemberInput = {
  addedByDisplayName: string | null;
  addedByProfileId: string | null;
  agentControllerConversationId: string | null;
  agentControllerRef: string | null;
  availabilityPhase: string | null;
  availabilityReasonCode: string | null;
  availabilitySummary: string | null;
  availabilityTooltip: string | null;
  lastSeenLabel: string | null;
  mentionLabel: string | null;
  ownerDisplay: string | null;
  ownerUserId: string | null;
  profileId: string;
  profileKind: "agent" | "human";
  profileName: string;
  runtimeDeviceDisplayName: string | null;
  workingDirectory: string | null;
};

export type HumanProfileDetailsInput = {
  profileId: string;
  profileName: string;
  viewerScope: ProfileDetailsViewerScope;
};

const PROFILE_DETAILS_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

export function buildProfileDetailsSnapshotFromHumanProfile(
  input: HumanProfileDetailsInput
): ProfileDetailsSnapshot {
  return buildDetailsSnapshot({
    context: "account",
    profileId: input.profileId,
    profileKind: "human",
    profileName: input.profileName,
    sections: [buildAdvancedDetailsSection({ profileId: input.profileId })],
    viewerScope: input.viewerScope,
  });
}

export function buildProfileDetailsSnapshotFromAuthProfile(input: {
  agentControllerPermissionModeDetail: string | null;
  modelDetail: string | null;
  primaryBinding: GetAgentProfilePrimaryBindingResponse["binding"] | null;
  profile: AuthProfileView;
  readiness: GetAgentExecutionReadinessResponse | null;
}): ProfileDetailsSnapshot {
  const executionTarget = input.primaryBinding?.executionTarget ?? null;
  const bindingConversationId =
    executionTarget?.agentControllerConversationId ?? null;
  const observedConversationId =
    input.readiness?.agentExecutionReadiness.facts.providerConversation
      .agentControllerConversationId ?? null;
  const controllerConversationId =
    bindingConversationId ?? observedConversationId;
  const controllerConversationSource: ProfileDetailsFieldSource =
    bindingConversationId ? "binding" : "readiness";
  const wakeAvailability = input.readiness?.agentWakeAvailability ?? null;

  return buildDetailsSnapshot({
    context: "account",
    profileId: input.profile.openMeldProfileId,
    profileKind: input.profile.profileKind,
    profileName: input.profile.profileName,
    sections: [
      section("profile", "Profile", [
        textRow({
          id: "profile_type",
          label: "Profile type",
          source: "profile_identity",
          value: formatProfileKind(input.profile.profileKind),
        }),
        textRow({
          id: "handle",
          label: "Handle",
          source: "profile_identity",
          value: input.profile.profileHandle,
        }),
        textRow({
          id: "owner",
          label: "Owner",
          source: "profile_identity",
          value: input.profile.ownerName ?? input.profile.ownerUserId,
        }),
        textRow({
          id: "created_by",
          label: "Created by",
          source: "profile_identity",
          value: resolveProfileCreationActorLabel(input.profile),
        }),
        textRow({
          id: "created_from",
          label: "Created from",
          source: "profile_identity",
          value: formatProfileCreationSource(input.profile.source),
        }),
        textRow({
          id: "status",
          label: "Status",
          source: "profile_identity",
          value: formatProfileStatus(input.profile.status),
          valueKind: "status",
        }),
        textRow({
          id: "created_at",
          label: "Created",
          source: "profile_identity",
          value: formatProfileDetailsDate(input.profile.createdAt),
        }),
        textRow({
          id: "updated_at",
          label: "Updated",
          source: "profile_identity",
          value: formatProfileDetailsDate(input.profile.updatedAt),
        }),
      ]),
      buildConnectionSection({
        agentControllerRef:
          executionTarget?.agentControllerRef ??
          input.readiness?.agentControllerRef,
        controllerConversationId,
        controllerConversationSource,
        modelDetail: input.modelDetail,
        runtimeDeviceDisplayName: input.readiness?.runtimeDeviceDisplayName,
      }),
      buildAgentControllerPermissionModeSection({
        value: input.agentControllerPermissionModeDetail,
      }),
      buildWakeAvailabilitySection({
        label: wakeAvailability?.label,
        summary: wakeAvailability?.summary,
      }),
      buildAdvancedDetailsSection({
        bindingSource: input.primaryBinding?.resolutionSource,
        bindingState: input.primaryBinding?.bindingState,
        creationActorProfileId: input.profile.creationActorProfileId,
        profileId: input.profile.openMeldProfileId,
        wakePhase: wakeAvailability?.phase,
        wakeReasonCode: wakeAvailability?.reasonCode,
      }),
    ],
    viewerScope: "owner_self",
  });
}

export function buildProfileDetailsSnapshotFromSpaceMember(input: {
  agentControllerPermissionModeDetail: string | null;
  entry: ProfileDetailsSpaceMemberInput;
  modelDetail: string | null;
  viewerScope: ProfileDetailsViewerScope;
}): ProfileDetailsSnapshot {
  return buildDetailsSnapshot({
    context: "space",
    profileId: input.entry.profileId,
    profileKind: input.entry.profileKind,
    profileName: input.entry.profileName,
    sections: [
      section("profile", "Profile", [
        textRow({
          id: "profile_type",
          label: "Profile type",
          source: "profile_identity",
          value: formatProfileKind(input.entry.profileKind),
        }),
        textRow({
          id: "owner",
          label: "Owner",
          source: "profile_identity",
          value: input.entry.ownerDisplay ?? input.entry.ownerUserId,
        }),
      ]),
      section("space_membership", "Space membership", [
        copyableRow({
          id: "mention_as",
          label: "Mention as",
          source: "space_membership",
          successMessage: "Mention copied.",
          value: input.entry.mentionLabel,
        }),
        textRow({
          id: "added_by",
          label: "Added by",
          source: "space_membership",
          value: input.entry.addedByDisplayName,
        }),
        textRow({
          id: "last_seen",
          label: "Last seen",
          source: "space_membership",
          value: input.entry.lastSeenLabel,
        }),
      ]),
      buildConnectionSection({
        agentControllerRef: input.entry.agentControllerRef,
        controllerConversationId: input.entry.agentControllerConversationId,
        controllerConversationSource: "local_runtime",
        modelDetail: input.modelDetail,
        runtimeDeviceDisplayName: input.entry.runtimeDeviceDisplayName,
      }),
      buildAgentControllerPermissionModeSection({
        value: input.agentControllerPermissionModeDetail,
      }),
      buildWakeAvailabilitySection({
        label: input.entry.availabilityTooltip,
        summary: input.entry.availabilitySummary,
      }),
      buildAdvancedDetailsSection({
        addedByProfileId: input.entry.addedByProfileId,
        profileId: input.entry.profileId,
        wakePhase: input.entry.availabilityPhase,
        wakeReasonCode: input.entry.availabilityReasonCode,
        workspaceDirectory: input.entry.workingDirectory,
      }),
    ],
    viewerScope: input.viewerScope,
  });
}

export function formatProfileKind(profileKind: "agent" | "human"): string {
  return profileKind === "agent" ? "Agent Profile" : "Human Profile";
}

function buildConnectionSection(input: {
  agentControllerRef: string | null | undefined;
  controllerConversationId: string | null | undefined;
  controllerConversationSource: ProfileDetailsFieldSource;
  modelDetail: string | null | undefined;
  runtimeDeviceDisplayName: string | null | undefined;
}): ProfileDetailsSection | null {
  return section("connection", "Connection", [
    textRow({
      id: "agent_controller",
      label: "Agent controller",
      source: "agent_controller",
      value: input.agentControllerRef,
      visibility: "owner_self",
    }),
    copyableRow({
      id: "controller_conversation_id",
      label: "Controller conversation ID",
      source: input.controllerConversationSource,
      successMessage: "Controller conversation ID copied.",
      value: input.controllerConversationId,
      valueKind: "identifier",
      visibility: "owner_self",
    }),
    textRow({
      id: "computer",
      label: "Computer",
      source: "local_runtime",
      value: input.runtimeDeviceDisplayName,
      visibility: "owner_self",
    }),
    textRow({
      id: "model",
      label: "Model",
      source: "binding",
      value: input.modelDetail,
      visibility: "owner_self",
    }),
  ]);
}

function buildAgentControllerPermissionModeSection(input: {
  value: string | null | undefined;
}): ProfileDetailsSection | null {
  return section(
    "agent_controller_permission_mode",
    "Agent Controller Permission Mode",
    [
      textRow({
        id: "agent_controller_permission_mode",
        label: "Permissions mode",
        source: "binding",
        value: input.value,
      }),
    ]
  );
}

function buildWakeAvailabilitySection(input: {
  label: string | null | undefined;
  summary: string | null | undefined;
}): ProfileDetailsSection | null {
  return section("wake_availability", "Wake availability", [
    textRow({
      id: "wake_availability",
      label: "Wake availability",
      source: "readiness",
      value: input.label,
      valueKind: "status",
    }),
    textRow({
      id: "wake_summary",
      label: "Summary",
      source: "readiness",
      value: input.summary,
    }),
  ]);
}

function buildAdvancedDetailsSection(input: {
  addedByProfileId?: string | null;
  bindingSource?: string | null;
  bindingState?: string | null;
  creationActorProfileId?: string | null;
  profileId: string;
  wakePhase?: string | null;
  wakeReasonCode?: string | null;
  workspaceDirectory?: string | null;
}): ProfileDetailsSection | null {
  return section("advanced", "Advanced details", [
    copyableRow({
      id: "profile_id",
      label: "Profile ID",
      source: "profile_identity",
      successMessage: "Profile ID copied.",
      value: input.profileId,
      valueKind: "identifier",
    }),
    copyableRow({
      id: "added_by_profile_id",
      label: "Added by profile ID",
      source: "space_membership",
      successMessage: "Profile ID copied.",
      value: input.addedByProfileId,
      valueKind: "identifier",
    }),
    copyableRow({
      id: "created_by_profile_id",
      label: "Created by profile ID",
      source: "profile_identity",
      successMessage: "Profile ID copied.",
      value: input.creationActorProfileId,
      valueKind: "identifier",
      visibility: "owner_self",
    }),
    copyableRow({
      id: "workspace_directory",
      label: "Workspace directory",
      preserveWhitespace: true,
      source: "local_runtime",
      successMessage: "Workspace directory copied.",
      value: input.workspaceDirectory,
      valueKind: "path",
      visibility: "owner_self",
    }),
    textRow({
      id: "binding_state",
      label: "Binding state",
      source: "binding",
      value: formatSnakeCaseValue(input.bindingState),
      valueKind: "status",
      visibility: "owner_self",
    }),
    textRow({
      id: "binding_source",
      label: "Binding source",
      source: "binding",
      value: formatSnakeCaseValue(input.bindingSource),
      visibility: "owner_self",
    }),
    textRow({
      id: "wake_phase",
      label: "Wake phase",
      source: "readiness",
      value: formatSnakeCaseValue(input.wakePhase),
      valueKind: "status",
      visibility: "owner_self",
    }),
    textRow({
      id: "wake_reason_code",
      label: "Wake reason code",
      source: "readiness",
      value: input.wakeReasonCode,
      valueKind: "identifier",
      visibility: "owner_self",
    }),
  ]);
}

function resolveProfileCreationActorLabel(
  profile: Pick<
    AuthProfileView,
    "creationActorProfileId" | "ownerName" | "ownerUserId" | "source"
  >
): string | null {
  switch (profile.source) {
    case "center_agent_create":
      return "Center Agent";
    case "local_agent_create":
      return "Local agent";
    case "auth_bootstrap":
    case "migration":
      return "OpenMeld";
    case "cli_create":
    case "web_create":
      return profile.ownerName ?? profile.ownerUserId;
    default:
      return profile.creationActorProfileId
        ? (profile.ownerName ?? profile.ownerUserId)
        : null;
  }
}

function formatProfileCreationSource(source: string): string | null {
  switch (source) {
    case "auth_bootstrap":
      return "OpenMeld setup";
    case "web_create":
      return "OpenMeld Web";
    case "cli_create":
      return "OpenMeld CLI";
    case "local_agent_create":
      return "Local agent";
    case "center_agent_create":
      return "Center Agent";
    case "migration":
      return "OpenMeld migration";
    default:
      return formatSnakeCaseValue(source);
  }
}

function buildDetailsSnapshot(input: {
  context: ProfileDetailsSnapshot["context"];
  profileId: string;
  profileKind: ProfileDetailsSnapshot["profileKind"];
  profileName: string;
  sections: readonly (ProfileDetailsSection | null)[];
  viewerScope: ProfileDetailsViewerScope;
}): ProfileDetailsSnapshot {
  const visibleSections = input.sections
    .map((section) => redactDetailsSectionForViewer(section, input.viewerScope))
    .filter((section): section is ProfileDetailsSection => section !== null);

  return {
    context: input.context,
    profileId: input.profileId,
    profileKind: input.profileKind,
    profileName: input.profileName,
    sections: visibleSections,
    viewerScope: input.viewerScope,
  };
}

function redactDetailsSectionForViewer(
  section: ProfileDetailsSection | null,
  viewerScope: ProfileDetailsViewerScope
): ProfileDetailsSection | null {
  if (section === null) {
    return null;
  }
  if (viewerScope === "owner_self") {
    return section;
  }

  const rows = section.rows.filter((row) => row.visibility !== "owner_self");
  return rows.length > 0 ? { ...section, rows } : null;
}

function section(
  id: ProfileDetailsSection["id"],
  title: string,
  rows: readonly (ProfileDetailsField | null)[]
): ProfileDetailsSection | null {
  const visibleRows = rows.filter(
    (row): row is ProfileDetailsField => row !== null
  );
  return visibleRows.length > 0 ? { id, rows: visibleRows, title } : null;
}

function textRow(input: {
  id: string;
  label: string;
  preserveWhitespace?: boolean;
  source: ProfileDetailsFieldSource;
  value: string | null | undefined;
  valueKind?: ProfileDetailsFieldValueKind;
  visibility?: ProfileDetailsFieldVisibility;
}): ProfileDetailsField | null {
  const normalized = normalizeDetailsValue(input.value, {
    preserveWhitespace: input.preserveWhitespace,
  });
  return normalized
    ? {
        copy: null,
        id: input.id,
        label: input.label,
        source: input.source,
        value: normalized,
        valueKind: input.valueKind ?? "text",
        visibility: input.visibility ?? "all_viewers",
      }
    : null;
}

function copyableRow(input: {
  id: string;
  label: string;
  preserveWhitespace?: boolean;
  source: ProfileDetailsFieldSource;
  successMessage: string;
  value: string | null | undefined;
  valueKind?: ProfileDetailsFieldValueKind;
  visibility?: ProfileDetailsFieldVisibility;
}): ProfileDetailsField | null {
  const normalized = normalizeDetailsValue(input.value, {
    preserveWhitespace: input.preserveWhitespace,
  });
  return normalized
    ? {
        copy: {
          label: `Copy ${input.label}`,
          successMessage: input.successMessage,
        },
        id: input.id,
        label: input.label,
        source: input.source,
        value: normalized,
        valueKind: input.valueKind ?? "text",
        visibility: input.visibility ?? "all_viewers",
      }
    : null;
}

function normalizeDetailsValue(
  value: string | null | undefined,
  options: { preserveWhitespace?: boolean }
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = options.preserveWhitespace ? value : value.trim();
  return normalized.length > 0 ? normalized : null;
}

function formatProfileStatus(status: AuthProfileView["status"]): string {
  return status === "active" ? "Active" : "Disabled";
}

function formatProfileDetailsDate(
  value: string | null | undefined
): string | null {
  const normalized = normalizeDetailsValue(value, {});
  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return PROFILE_DETAILS_DATE_FORMATTER.format(date);
}

function formatSnakeCaseValue(value: string | null | undefined): string | null {
  const normalized = normalizeDetailsValue(value, {});
  if (!normalized) {
    return null;
  }
  return normalized
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
