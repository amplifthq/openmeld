import type {
  HelloAck,
  SignalEnvelope,
  SignalTextReplyTo,
  SpaceMeta,
} from "@openmeld/protocol";
import {
  AGENT_REPLY_PREVIEW_END_PURPOSE,
  AGENT_REPLY_PREVIEW_PURPOSE,
  AGENT_REPLYING_END_PURPOSE,
  AGENT_REPLYING_PURPOSE,
  CONVERSATION_CONTINUITY_WARNING_PURPOSE,
  DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
  DISPATCH_ACTIVITY_FAILED_PURPOSE,
  DISPATCH_ACTIVITY_RETRYING_PURPOSE,
  normalizeOptionalWorkingDirectory,
  SPACE_MEMBER_JOIN_NOTICE_PURPOSE,
  SPACE_MEMBER_REMOVE_NOTICE_PURPOSE,
} from "@openmeld/schemas";
import type {
  AgentControllerConversationRef,
  AgentProfileBindingModelSelection,
  SpaceMemberAgentSnapshot,
  SpaceMemberHumanSnapshot,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
  buildSpaceMemberAgentPresencePresentation,
  resolveSpaceMemberAgentOwnerWakeDiagnosticsView,
} from "@openmeld/space";
import pc from "picocolors";
import { resolveRegistryOriginLaunchCommand } from "../agents/registry-source";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import { resolveLinkAccessLabel } from "../space/access-presentation";
import { resolveNormalizedOwnerFields } from "../space/agent-output-contract";
import {
  resolvePrimarySpaceMentionLabel,
  resolveSpaceMentionLabelState,
} from "../space/mention-label-state";
import { isOpenMeldSystemProfileIdentity } from "../space/openmeld-system-profile";
import { buildHumanMessageRelationLines } from "../space/read-projection/human-message-read-display";
import { buildHumanReplyCuePreview } from "../space/reply-cue-preview";
import {
  buildSpaceDisplayProjection,
  buildSpaceMetadataFields,
  formatSpaceDisplayValue,
  resolveSpaceDisplayName,
} from "../space/space-display-projection";
import { buildUnifiedCardFrame } from "./card-frame";
import { resolveControllerDisplayName } from "./controller-display";
import { renderPositiveAccentText } from "./positive-accent";
import {
  colorizeAgentLabel,
  colorizeDisplayProfileLabel,
  colorizePersonLabel,
  resolveDisplayProfileIdentity,
} from "./profile-label-color";
import {
  buildPublicSpaceWarningLines,
  resolvePublicSpaceExposure,
} from "./public-space-warning";
import {
  highlightSpaceMentions,
  type SpaceMentionHighlightIndex,
} from "./space-mention-highlight";
import { sanitizeTerminalDisplayText } from "./terminal-safe-text";

export type OutputMode = "ndjson" | "text";
export type HumanFormattedMessage = {
  bodyLines: readonly string[];
  relationLines: readonly string[];
  metaLines: readonly string[];
  headerBadge?: string | null;
};
type ResolvedView = "human" | "agent";
type TextEventFormatOptions = {
  view: ResolvedView;
  selfProfileId?: string;
  mentionHighlightIndex?: SpaceMentionHighlightIndex | null;
  replyLine?: string | null;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
};
type ProfileIdentityLike =
  | {
      profileName?: string | null;
      kind?: string | null;
      profileId?: string | null;
      ownerUserId?: string | null;
      owner?: string | null;
      ownerName?: string | null;
      agentControllerRef?: string | null;
      agentControllerConversationId?: string | null;
      agentControllerConversation?: AgentControllerConversationRef | null;
      modelSelection?: AgentProfileBindingModelSelection | null;
      workingDirectory?: string | null;
    }
  | undefined;
type SystemNoticeMentionHint = {
  mentionLabel: string;
  agentControllerRef?: string;
  profileId?: string;
  profileName?: string;
};
type SystemNoticeProfileHighlight = {
  label: string;
  renderedLabel: string;
};

const AGENT_CONTEXT_HIDDEN_TOKENS = new Set([
  "pending",
  "no-context",
  "none",
  "unknown",
]);
const MENTION_DISPATCH_HINT_META_PURPOSE = "mention_dispatch_hint";
const MENTION_FAILURE_HINT_PREFIX = 'Mention skipped for "';
const MENTION_FAILURE_HINT_LEGACY_PREFIX = "Mention skipped. Try this:";
const SYSTEM_BROADCAST_LABEL = pc.cyan("📣 system");
const AGENT_SPEAKER_AVATAR = "🤖";
const HUMAN_SPEAKER_AVATAR = "👤";
const HUMAN_REPLY_CUE_PREVIEW_MAX_VISIBLE_WIDTH = 28;

const sanitizeSingleLineText = (
  value: string | number | null | undefined
): string => sanitizeTerminalDisplayText(value, "single-line");

const sanitizeMultilineText = (
  value: string | number | null | undefined
): string => sanitizeTerminalDisplayText(value, "multi-line");

const sanitizeTrimmedSingleLineText = (
  value: string | number | null | undefined
): string => sanitizeSingleLineText(value).trim();

export function formatInputPrompt(
  profileIdentity: {
    profileName?: string;
    kind?: string;
    profileId?: string;
    ownerUserId?: string;
    ownerName?: string;
  },
  options?: {
    spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  }
): string {
  const profileName = resolveHumanProfileLabel(profileIdentity);
  const profileKind = resolveHumanProfileKind(profileIdentity);
  const suffix = profileKind ? ` (${profileKind})` : "";
  const label = `${profileName}${suffix}`;
  return `- ${colorizeDisplayProfileLabel({
    label,
    profileIdentity,
    spaceMembersSnapshot: options?.spaceMembersSnapshot,
  })}: `;
}

export function formatCatchupMarker(view: ResolvedView): string {
  if (view === "human") {
    return `* ${SYSTEM_BROADCAST_LABEL}: Conversation after you left.`;
  }
  return "system: conversation_after_you_left";
}

export function formatTextEvent(
  event: SignalEnvelope | HelloAck,
  options: TextEventFormatOptions
): string | null {
  switch (event.type) {
    case "system.hello.ack":
      return formatHelloAck(event, options);
    case "presence.join":
      return formatPresenceJoin(event, options);
    case "presence.quit":
      return formatPresenceQuit(event, options);
    case "signal.text":
      return formatSignalText(event, options);
    case "signal.status":
      return formatSignalStatus(event, options);
    case "signal.system_notice":
      return formatSignalSystemNotice(event, options);
    default:
      return null;
  }
}

type ConnectIntroInput = {
  accessMode?: SpaceMeta["accessMode"];
  spaceId: string;
  spaceName?: string;
  spaceCreatedAt?: string;
  spaceCreatorName?: string;
  spaceCreatorId?: string;
  passwordProtected?: boolean;
  profileId: string;
  profileName: string;
  profileKind?: "human" | "agent" | "system";
  ownerUserId?: string;
  ownerName?: string;
  agentControllerRef?: string;
  agentControllerConversationId?: string;
  agentControllerConversation?: AgentControllerConversationRef | null;
  modelSelection?: AgentProfileBindingModelSelection | null;
  workingDirectory?: string;
  spaceMembersSnapshot?: SpaceMembersSnapshot;
  gatewayUrl: string;
  stdio: boolean;
  visibility?: SpaceMeta["visibility"];
};

export function formatConnectIntro(input: ConnectIntroInput): string[] {
  return [
    "",
    ...buildSpaceInfoCardLines({
      gatewayUrl: input.gatewayUrl,
      modeLabel: input.stdio ? "interactive chat" : "watch-only stream",
      accessMode: input.accessMode,
      passwordProtected: input.passwordProtected,
      spaceCreatedAt: input.spaceCreatedAt,
      spaceCreatorId: input.spaceCreatorId,
      spaceCreatorName: input.spaceCreatorName,
      spaceId: input.spaceId,
      spaceName: input.spaceName,
      spaceMembersSnapshot: input.spaceMembersSnapshot,
      visibility: input.visibility,
    }),
    ...(input.spaceMembersSnapshot
      ? ["", ...buildSpaceMembersCardLines(input.spaceMembersSnapshot)]
      : []),
    "",
    ...buildProfileCardLines({
      agentControllerConversationId: input.agentControllerConversationId,
      agentControllerRef: input.agentControllerRef,
      profileId: input.profileId,
      profileKind: input.profileKind,
      profileName: input.profileName,
      ownerUserId: input.ownerUserId,
      ownerName: input.ownerName,
      agentControllerConversation: input.agentControllerConversation,
      modelSelection: input.modelSelection,
      workingDirectory: input.workingDirectory,
      spaceMembersSnapshot: input.spaceMembersSnapshot,
    }),
    "",
  ];
}

export type ConnectIntroCardRow = {
  label: string;
  value: string;
};

export type SpaceInfoFact = {
  label: string;
  value: string;
};

export type SpaceInfoCardInput = {
  accessMode?: SpaceMeta["accessMode"];
  gatewayUrl: string;
  modeLabel: string;
  passwordProtected?: boolean;
  spaceCreatedAt?: string;
  spaceCreatorId?: string;
  spaceCreatorName?: string;
  spaceId: string;
  spaceName?: string;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  visibility?: SpaceMeta["visibility"];
};

export type SpaceInfoData = {
  facts: readonly SpaceInfoFact[];
  joinCommand: string;
  publicWarningLines: readonly string[];
};

export type SpaceMembersPanelSectionId = "humans" | "agents";

export type SpaceMembersPanelItemSource = {
  id: string;
  mentionLabel: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  profileId: string;
  profileKind:
    | SpaceMemberHumanSnapshot["profileKind"]
    | SpaceMemberAgentSnapshot["profileKind"];
  profileName: string;
  renderedLines: readonly string[];
  searchKey: string;
};

export type SpaceMembersPanelSectionSource = {
  id: SpaceMembersPanelSectionId;
  items: readonly SpaceMembersPanelItemSource[];
  title: string;
};

export type SpaceMembersPanelSource = {
  sections: readonly SpaceMembersPanelSectionSource[];
};

type ProfileCardInput = {
  agentControllerConversationId?: string;
  agentControllerRef?: string;
  profileId: string;
  profileKind?: "human" | "agent" | "system";
  profileName: string;
  ownerUserId?: string;
  ownerName?: string;
  agentControllerConversation?: AgentControllerConversationRef | null;
  modelSelection?: AgentProfileBindingModelSelection | null;
  workingDirectory?: string;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
};

export function buildSpaceInfoCardLines(input: SpaceInfoCardInput): string[] {
  const rows = buildSpaceInfoRows(input);
  return buildConnectIntroCardLines({
    title: "🛰️ Space Info",
    rows,
    minContentWidth: 76,
  });
}

export function buildSpaceInfoPanelLines(input: SpaceInfoCardInput): string[] {
  return buildConnectIntroRowLines(buildSpaceInfoRows(input));
}

export function buildSpaceInfoData(input: SpaceInfoCardInput): SpaceInfoData {
  const projection = buildSpaceDisplayProjection({
    spaceId: input.spaceId,
    spaceName: input.spaceName,
    creatorProfileId: input.spaceCreatorId,
    creatorProfileName: input.spaceCreatorName,
    spaceCreatedAt: input.spaceCreatedAt,
    passwordProtected: input.passwordProtected,
  });
  const accessFacts = {
    accessMode: input.accessMode,
    passwordProtected: input.passwordProtected,
    visibility: input.visibility,
  };
  const publicExposure = resolvePublicSpaceExposure(accessFacts);
  const gatewayUrl = sanitizeTrimmedSingleLineText(input.gatewayUrl);
  const metadataFacts = buildSpaceMetadataFields({
    projection,
    includeCreatedAt: true,
  }).map<SpaceInfoFact>((field) => {
    if (field.id !== "spaceCreator") {
      return {
        label: field.label,
        value: field.value,
      };
    }

    return {
      label: field.label,
      value:
        projection.creatorDisplayName && projection.creatorProfileId
          ? colorizePersonLabel(
              projection.creatorDisplayName,
              {
                profileId: projection.creatorProfileId,
                profileName: projection.creatorDisplayName,
              },
              {
                spaceMembersSnapshot: input.spaceMembersSnapshot,
              }
            )
          : formatSpaceDisplayValue(projection.creatorDisplayName, "(unknown)"),
    };
  });

  return {
    facts: [
      {
        label: "Space Name",
        value: resolveSpaceDisplayName(projection.spaceName, "(unnamed)"),
      },
      ...metadataFacts,
      {
        label: "Link access",
        value: resolveLinkAccessLabel(accessFacts),
      },
      {
        label: "Gateway URL",
        value: gatewayUrl,
      },
      {
        label: "Mode",
        value: sanitizeTrimmedSingleLineText(input.modeLabel) || "(unknown)",
      },
    ],
    joinCommand: formatOpenMeldCliCommand(
      `openmeld space join ${input.spaceId}`
    ),
    publicWarningLines: publicExposure
      ? buildPublicSpaceWarningLines(publicExposure)
      : [],
  };
}

export function buildSpaceInfoRows(
  input: SpaceInfoCardInput
): ConnectIntroCardRow[] {
  const spaceInfo = buildSpaceInfoData(input);

  const rows: ConnectIntroCardRow[] = [
    ...spaceInfo.facts,
    {
      label: "",
      value: "",
    },
    {
      label: "To join this space, run:",
      value: "",
    },
    {
      label: pc.cyan(spaceInfo.joinCommand),
      value: "",
    },
  ];

  if (spaceInfo.publicWarningLines.length > 0) {
    rows.push(
      {
        label: "",
        value: "",
      },
      ...spaceInfo.publicWarningLines.map((line) => ({
        label: line,
        value: "",
      }))
    );
  }

  return rows;
}

export function buildProfileCardLines(input: ProfileCardInput): string[] {
  const profileIdentity: ProfileIdentityLike = {
    agentControllerConversationId: input.agentControllerConversationId,
    agentControllerRef: input.agentControllerRef,
    kind: input.profileKind,
    ownerUserId: input.ownerUserId,
    ownerName: input.ownerName,
    profileId: input.profileId,
    profileName: input.profileName,
    agentControllerConversation: input.agentControllerConversation,
    modelSelection: input.modelSelection,
    workingDirectory: input.workingDirectory,
  };
  const rows = buildProfileRows({
    input,
    profileIdentity,
  });
  return buildConnectIntroCardLines({
    title: "👤 Your profile in this space",
    rows,
    minContentWidth: 76,
  });
}

function buildProfileRows(input: {
  input: ProfileCardInput;
  profileIdentity: ProfileIdentityLike;
}): ConnectIntroCardRow[] {
  const ownerUserId = sanitizeTrimmedSingleLineText(input.input.ownerUserId);
  const ownerName = sanitizeTrimmedSingleLineText(input.input.ownerName);
  const rows: ConnectIntroCardRow[] = [
    {
      label: "Profile Name",
      value: colorizeDisplayProfileLabel({
        label: resolveHumanProfileName(input.profileIdentity),
        profileIdentity: input.profileIdentity,
        spaceMembersSnapshot: input.input.spaceMembersSnapshot,
      }),
    },
    {
      label: "Profile ID",
      value: sanitizeTrimmedSingleLineText(input.input.profileId),
    },
    {
      label: "Type",
      value: resolveHumanProfileKind(input.profileIdentity) || "unknown",
    },
  ];

  if (ownerName) {
    rows.push({
      label: "Owner Name",
      value: colorizePersonLabel(
        ownerName,
        {
          ownerUserId: ownerUserId || input.input.profileId,
          ownerName,
          profileName: ownerName,
        },
        {
          spaceMembersSnapshot: input.input.spaceMembersSnapshot,
        }
      ),
    });
  }

  if (ownerUserId && ownerUserId !== ownerName) {
    rows.push({
      label: "Owner",
      value: ownerUserId,
    });
  }

  const agentControllerRef = resolveAgentControllerRef(input.profileIdentity);
  if (agentControllerRef) {
    const controllerDisplay = resolveControllerDisplayName(agentControllerRef);
    rows.push({
      label: "Agent Controller",
      value: controllerDisplay
        ? colorizeAgentLabel(
            controllerDisplay,
            {
              agentControllerRef,
              profileId: input.profileIdentity?.profileId,
              profileName: input.profileIdentity?.profileName,
            },
            {
              spaceMembersSnapshot: input.input.spaceMembersSnapshot,
            }
          )
        : agentControllerRef,
    });
  }

  const originDisplay = agentControllerRef
    ? resolveAgentOriginDisplay({
        agentControllerRef,
        agentControllerConversationId: resolveAgentControllerConversationId(
          input.profileIdentity
        ),
        model: resolveProfileModelId(input.profileIdentity),
        workingDirectory: resolveWorkingDirectory(input.profileIdentity),
      })
    : resolveAgentControllerConversationId(input.profileIdentity);
  if (originDisplay) {
    rows.push({
      label: "Origin",
      value: originDisplay,
    });
  }

  return rows;
}

export function buildSpaceMembersCardLines(
  snapshot: SpaceMembersSnapshot
): string[] {
  const rowTextList = buildSpaceMembersPanelLines(snapshot);
  const frame = buildUnifiedCardFrame({
    title: "👥 Space Members",
    rowTextList,
    minContentWidth: 76,
  });
  return [frame.top, frame.empty, ...frame.rows, frame.empty, frame.bottom];
}

export function buildSpaceMembersLoadingCardLines(): string[] {
  const frame = buildUnifiedCardFrame({
    title: "👥 Space Members",
    rowTextList: buildSpaceMembersLoadingPanelLines(),
    minContentWidth: 76,
  });
  return [frame.top, frame.empty, ...frame.rows, frame.empty, frame.bottom];
}

export function buildSpaceMembersPanelLines(
  snapshot: SpaceMembersSnapshot
): string[] {
  const source = buildSpaceMembersPanelSource(snapshot);
  const rows: string[] = [];
  for (const section of source.sections) {
    if (section.items.length === 0) {
      continue;
    }
    if (rows.length > 0) {
      rows.push("");
    }
    rows.push(pc.bold(section.title));
    for (const item of section.items) {
      rows.push(...item.renderedLines);
    }
  }
  if (rows.length === 0) {
    rows.push(pc.dim("No members yet."));
  }
  return rows;
}

export function buildSpaceMembersPanelSource(
  snapshot: SpaceMembersSnapshot
): SpaceMembersPanelSource {
  return {
    sections: [
      buildSpaceMembersPanelSectionSource({
        id: "agents",
        members: snapshot.agents,
        snapshot,
        title: "🤖 Agents",
      }),
      buildSpaceMembersPanelSectionSource({
        id: "humans",
        members: snapshot.humans,
        snapshot,
        title: "👤 Humans",
      }),
    ].filter((section) => section.items.length > 0),
  };
}

export function buildSpaceMembersLoadingPanelLines(): string[] {
  return ["Members are still loading."];
}

function formatSpaceMemberCardRows(
  member: SpaceMemberHumanSnapshot | SpaceMemberAgentSnapshot,
  snapshot: SpaceMembersSnapshot
): string[] {
  const profileId = sanitizeTrimmedSingleLineText(member.profileId);
  const coloredProfileName = colorizeDisplayProfileLabel({
    label: member.profileName,
    profileIdentity: member,
    spaceMembersSnapshot: snapshot,
  });
  const rows = [`${coloredProfileName} ${pc.dim(`· ${profileId}`)}`];

  if (member.profileKind === "human") {
    const metadataLine = buildSpaceMemberHumanMetadataLine(member);
    if (metadataLine) {
      rows.push(`  ${metadataLine}`);
    }
    const relatedAgentsLine = buildHumanRelatedAgentsLine({
      profileIdentity: {
        kind: "human",
        profileId: member.profileId,
        profileName: member.profileName,
        ownerUserId: member.ownerUserId ?? undefined,
        ownerName: member.ownerName ?? undefined,
      },
      spaceMembersSnapshot: snapshot,
    });
    if (relatedAgentsLine) {
      rows.push(`  ${pc.dim(relatedAgentsLine)}`);
    }
    return rows;
  }

  const metadataLine = buildSpaceMemberAgentMetadataLine(member, snapshot);
  if (metadataLine) {
    rows.push(`  ${metadataLine}`);
  }
  const statusLine = buildSpaceMemberAgentStatusLine(member, snapshot);
  if (statusLine) {
    rows.push(`  ${statusLine}`);
  }
  return rows;
}

function buildSpaceMembersPanelSectionSource(input: {
  id: SpaceMembersPanelSectionId;
  members: readonly (SpaceMemberHumanSnapshot | SpaceMemberAgentSnapshot)[];
  snapshot: SpaceMembersSnapshot;
  title: string;
}): SpaceMembersPanelSectionSource {
  return {
    id: input.id,
    items: input.members.map((member) =>
      buildSpaceMembersPanelItemSource(member, input.snapshot)
    ),
    title: input.title,
  };
}

function buildSpaceMembersPanelItemSource(
  member: SpaceMemberHumanSnapshot | SpaceMemberAgentSnapshot,
  snapshot: SpaceMembersSnapshot
): SpaceMembersPanelItemSource {
  const mentionLabels = resolveSpaceMentionLabelState({
    profileId: member.profileId,
    snapshot,
  });
  return {
    id: sanitizeTrimmedSingleLineText(member.profileId),
    ownerUserId:
      "ownerUserId" in member
        ? sanitizeTrimmedSingleLineText(member.ownerUserId)
        : null,
    ownerName:
      "ownerName" in member
        ? sanitizeTrimmedSingleLineText(member.ownerName)
        : null,
    profileId: sanitizeTrimmedSingleLineText(member.profileId),
    profileKind: member.profileKind,
    profileName: sanitizeTrimmedSingleLineText(member.profileName),
    renderedLines: formatSpaceMemberCardRows(member, snapshot),
    searchKey: buildSpaceMembersPanelItemSearchKey(member, mentionLabels),
    mentionLabel: mentionLabels?.primaryMentionLabel ?? null,
  };
}

function buildSpaceMembersPanelItemSearchKey(
  member: SpaceMemberHumanSnapshot | SpaceMemberAgentSnapshot,
  mentionLabels: {
    exactMentionLabels: readonly string[];
    primaryMentionLabel: string;
  } | null
): string {
  const searchValues = [
    member.profileName,
    member.profileId,
    "ownerName" in member ? member.ownerName : null,
    "ownerUserId" in member ? member.ownerUserId : null,
    ...(mentionLabels?.exactMentionLabels ?? []),
  ];

  return searchValues
    .map((value) => sanitizeTrimmedSingleLineText(value))
    .filter((value) => value.length > 0)
    .join(" ")
    .toLowerCase();
}

function buildSpaceMemberHumanMetadataLine(
  member: SpaceMemberHumanSnapshot
): string | null {
  const segments: string[] = [];
  segments.push(pc.dim(resolveHumanMemberRoleLabel(member)));
  if (member.liveNow) {
    segments.push(colorizeLiveNowLabel());
  }
  const seenLabel = resolveSpaceMemberSeenLabel(member);
  if (seenLabel) {
    segments.push(pc.dim(seenLabel));
  }
  return joinStyledMetadataSegments(segments);
}

function buildSpaceMemberAgentMetadataLine(
  member: SpaceMemberAgentSnapshot,
  snapshot: SpaceMembersSnapshot
): string | null {
  const segments: string[] = [];
  const ownerDisplay =
    sanitizeTrimmedSingleLineText(member.ownerName) ||
    sanitizeTrimmedSingleLineText(member.ownerUserId);
  if (ownerDisplay) {
    segments.push(pc.dim(`owner: ${ownerDisplay}`));
  }
  const addedByDisplay = resolveAgentAddedByDisplay({
    agentSnapshot: member,
    spaceMembersSnapshot: snapshot,
  });
  if (addedByDisplay) {
    segments.push(pc.dim(`added by: ${addedByDisplay.label}`));
  }
  return segments.length > 0 ? pc.dim(segments.join(" · ")) : null;
}

function buildSpaceMemberAgentStatusLine(
  member: SpaceMemberAgentSnapshot,
  snapshot: SpaceMembersSnapshot
): string | null {
  const segments: string[] = [];
  const controllerDisplay = resolveControllerDisplayName(
    sanitizeTrimmedSingleLineText(member.agentControllerRef)
  );
  const mentionSegment = formatSpaceMemberMentionSegment(member, snapshot);
  if (mentionSegment) {
    segments.push(mentionSegment);
  }
  const manualSegment = formatSpaceMemberManualParticipationSegment(member);
  if (manualSegment) {
    segments.push(pc.dim(manualSegment));
  } else {
    const presence = buildSpaceMemberAgentPresencePresentation(member);
    if (presence.status === "offline" || presence.status === "unavailable") {
      segments.push(pc.dim(presence.shortLabel));
    }
  }
  if (controllerDisplay) {
    segments.push(
      `${pc.dim("via ")}${colorizeAgentLabel(
        controllerDisplay,
        {
          agentControllerRef: member.agentControllerRef,
          profileId: member.profileId,
          profileName: member.profileName,
        },
        {
          spaceMembersSnapshot: snapshot,
        }
      )}`
    );
  }
  if (member.liveNow) {
    segments.push(colorizeLiveNowLabel());
  }
  const seenLabel = resolveSpaceMemberSeenLabel(member);
  if (seenLabel) {
    segments.push(pc.dim(seenLabel));
  }
  return joinStyledMetadataSegments(segments);
}

function formatSpaceMemberManualParticipationSegment(
  member: SpaceMemberAgentSnapshot
): string | null {
  const readiness =
    resolveSpaceMemberAgentOwnerWakeDiagnosticsView(member)
      .agentExecutionReadiness ?? null;
  if (!readiness) {
    return null;
  }
  if (hasManualParticipationOnlyReason(readiness.reasonCodes)) {
    return "manual join/send only";
  }
  return null;
}

function hasManualParticipationOnlyReason(
  reasonCodes: readonly string[]
): boolean {
  return reasonCodes.some(
    (reasonCode) =>
      reasonCode === "agent_profile_binding.missing" ||
      reasonCode === "profile.unbound"
  );
}

function formatSpaceMemberMentionSegment(
  member: SpaceMemberAgentSnapshot,
  snapshot: SpaceMembersSnapshot
): string | null {
  const mentionLabel = resolvePrimarySpaceMentionLabel({
    profileId: member.profileId,
    snapshot,
  });
  if (!mentionLabel) {
    return null;
  }
  const highlightedMentionLabel = colorizeAgentLabel(
    `@${mentionLabel}(wake)`,
    {
      agentControllerRef: member.agentControllerRef,
      profileId: member.profileId,
      profileName: member.profileName,
    },
    {
      spaceMembersSnapshot: snapshot,
    }
  );
  return `${pc.dim("mention: ")}${highlightedMentionLabel}`;
}

function joinStyledMetadataSegments(segments: string[]): string | null {
  return segments.length > 0 ? segments.join(pc.dim(" · ")) : null;
}

function buildConnectIntroCardLines(input: {
  title: string;
  rows: ConnectIntroCardRow[];
  minContentWidth?: number;
}): string[] {
  const rowTextList = buildConnectIntroRowLines(input.rows);
  const frame = buildUnifiedCardFrame({
    title: input.title,
    rowTextList,
    minContentWidth: input.minContentWidth ?? 56,
  });
  return [frame.top, frame.empty, ...frame.rows, frame.empty, frame.bottom];
}

function buildConnectIntroRowLines(
  rows: readonly ConnectIntroCardRow[]
): string[] {
  return rows.map((row) => `${row.label}  ${row.value}`);
}

function formatHumanSpeaker(
  profileIdentity: ProfileIdentityLike,
  input?: {
    includeKind?: boolean;
    spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  }
): string {
  const profileName = resolveHumanProfileLabel(profileIdentity);
  const profileKind = resolveHumanProfileKind(profileIdentity);
  const label =
    input?.includeKind && profileKind
      ? `${profileName} (${profileKind})`
      : profileName;
  const speaker = colorizeDisplayProfileLabel({
    label,
    profileIdentity,
    spaceMembersSnapshot: input?.spaceMembersSnapshot,
  });
  if (profileKind === "agent") {
    return `${AGENT_SPEAKER_AVATAR} ${speaker}`;
  }
  if (profileKind === "human") {
    return `${HUMAN_SPEAKER_AVATAR} ${speaker}`;
  }
  return speaker;
}

function formatHelloAck(
  event: HelloAck,
  options: TextEventFormatOptions
): string {
  if (options.view === "human") {
    const acknowledgedName = colorizeDisplayProfileLabel({
      label: resolveHumanProfileLabel(event.profile),
      profileIdentity: event.profile,
      spaceMembersSnapshot: options.spaceMembersSnapshot,
    });
    return `* ${SYSTEM_BROADCAST_LABEL}: connected as ${acknowledgedName}.`;
  }
  const profileDescriptor = resolveAgentViewProfileDescriptor(event.profile);
  return `${pc.cyan("system")}: hello.ack ${profileDescriptor}`;
}

function formatPresenceJoin(
  event: SignalEnvelope,
  options: TextEventFormatOptions
): string {
  if (options.view === "human") {
    return formatHumanSystemPresenceLine({
      profileIdentity: event.profile,
      spaceMembersSnapshot: options.spaceMembersSnapshot,
      verb: "joined the space.",
    });
  }
  return `${pc.green("+")} ${resolveAgentViewProfileDescriptor(event.profile)}`;
}

function formatPresenceQuit(
  event: SignalEnvelope,
  options: TextEventFormatOptions
): string {
  if (options.view === "human") {
    return formatHumanSystemPresenceLine({
      profileIdentity: event.profile,
      spaceMembersSnapshot: options.spaceMembersSnapshot,
      verb: "left the space.",
    });
  }
  return `${pc.red("-")} ${resolveAgentViewProfileDescriptor(event.profile)}`;
}

function formatSignalText(
  event: SignalEnvelope,
  options: TextEventFormatOptions
): string | null {
  if (event.type !== "signal.text") {
    return null;
  }
  if (isTransientSignalTextHintClearEvent(event)) {
    return null;
  }
  const textEvent = event;
  const text =
    typeof textEvent.data.text === "string"
      ? sanitizeMultilineText(textEvent.data.text)
      : "";
  const isTransientHint = isTransientSignalTextHint(event);
  if (isTransientHint) {
    return null;
  }
  const renderedSystemNotice = resolveRenderedSystemNotice(
    event,
    options.spaceMembersSnapshot ?? null
  );
  if (renderedSystemNotice) {
    if (options.view === "human") {
      return `* ${SYSTEM_BROADCAST_LABEL}: ${appendRenderedSystemNoticeMentionHint(
        {
          text: highlightSystemNoticeProfileNames({
            text: renderedSystemNotice.text,
            highlights: renderedSystemNotice.highlights,
          }),
          wakeHint: renderedSystemNotice.wakeHint,
          spaceMembersSnapshot: options.spaceMembersSnapshot,
        }
      )}`;
    }
    return `${pc.cyan("system")}: ${appendRenderedSystemNoticeMentionHint({
      text: renderedSystemNotice.text,
      wakeHint: renderedSystemNotice.wakeHint,
      spaceMembersSnapshot: options.spaceMembersSnapshot,
    })}`;
  }
  if (options.view === "human" && isMentionFailureHintSignalText(event, text)) {
    return null;
  }
  if (
    options.view === "human" &&
    isOpenMeldSystemProfileIdentity(event.profile)
  ) {
    return formatHumanSystemBroadcastLine(text);
  }
  if (options.view === "human") {
    const formattedMessage = buildHumanFormattedMessage({
      event,
      mentionHighlightIndex: options.mentionHighlightIndex,
      spaceMembersSnapshot: options.spaceMembersSnapshot,
    });
    if (!formattedMessage) {
      return null;
    }
    const ts = formatSignalTimestamp(event.ts);
    const speaker = formatHumanSpeaker(event.profile, {
      spaceMembersSnapshot: options.spaceMembersSnapshot,
    });
    const [primaryBodyLine = "", ...bodyDetailLines] =
      formattedMessage.bodyLines;
    const detailLines = [
      ...bodyDetailLines,
      ...(options.replyLine ? [options.replyLine] : []),
      ...formattedMessage.metaLines,
    ];
    if (detailLines.length === 0) {
      return `- ${speaker} ${ts}: ${primaryBodyLine}`;
    }
    return [`- ${speaker} ${ts}: ${primaryBodyLine}`, ...detailLines].join(
      "\n"
    );
  }
  const label = resolveAgentViewProfileDescriptor(event.profile);
  return `${pc.bold(label)}: ${text}`;
}

function formatSignalStatus(
  event: SignalEnvelope,
  options: TextEventFormatOptions
): string | null {
  if (event.type !== "signal.status") {
    return null;
  }
  const text = sanitizeMultilineText(event.data.text).trim();
  if (!text) {
    return null;
  }
  if (options.view === "human") {
    if (isOpenMeldSystemProfileIdentity(event.profile)) {
      return formatHumanSystemBroadcastLine(text);
    }
    const formattedMessage = buildHumanFormattedMessage({
      event,
      mentionHighlightIndex: options.mentionHighlightIndex,
      spaceMembersSnapshot: options.spaceMembersSnapshot,
    });
    if (!formattedMessage) {
      return null;
    }
    const ts = formatSignalTimestamp(event.ts);
    const speaker = formatHumanSpeaker(event.profile, {
      spaceMembersSnapshot: options.spaceMembersSnapshot,
    });
    const statusBadge = buildHumanStatusBadge(event.data.status);
    const [primaryBodyLine = "", ...bodyDetailLines] =
      formattedMessage.bodyLines;
    const leadingLine = statusBadge
      ? `- ${speaker} ${ts} ${statusBadge}: ${primaryBodyLine}`
      : `- ${speaker} ${ts}: ${primaryBodyLine}`;
    const detailLines = [
      ...bodyDetailLines,
      ...(options.replyLine ? [options.replyLine] : []),
      ...formattedMessage.metaLines,
    ];
    if (detailLines.length === 0) {
      return leadingLine;
    }
    return [leadingLine, ...detailLines].join("\n");
  }

  const label = resolveAgentViewProfileDescriptor(event.profile);
  return `${pc.bold(label)} ${pc.dim(`[status: ${event.data.status}]`)}: ${text}`;
}

function formatHumanSystemBroadcastLine(text: string): string | null {
  const normalizedText = text.trim();
  return normalizedText
    ? `* ${SYSTEM_BROADCAST_LABEL}: ${normalizedText}`
    : null;
}

function formatSignalSystemNotice(
  event: SignalEnvelope,
  options: TextEventFormatOptions
): string | null {
  if (event.type !== "signal.system_notice") {
    return null;
  }
  const text = sanitizeMultilineText(event.data.text).trim();
  if (!text) {
    return null;
  }

  if (options.view === "human") {
    const detailLines = buildHumanSystemNoticeLines({
      event,
      replyLine: options.replyLine ?? null,
      spaceMembersSnapshot: options.spaceMembersSnapshot,
    });
    const [primaryLine = text, ...restLines] = detailLines;
    return [`* ${SYSTEM_BROADCAST_LABEL}: ${primaryLine}`, ...restLines].join(
      "\n"
    );
  }

  const label = resolveAgentViewProfileDescriptor(event.profile);
  const detailLines = buildVisibleSystemNoticeReasonLines(event);
  return [`${pc.bold(label)}: ${text}`, ...detailLines].join("\n");
}

export function buildHumanFormattedMessage(input: {
  event: SignalEnvelope;
  mentionHighlightIndex?: SpaceMentionHighlightIndex | null;
  messageReadProjection?: Parameters<typeof buildHumanMessageRelationLines>[0];
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): HumanFormattedMessage | null {
  const text = resolveHumanFormattedMessageBodyText(input);
  if (text === null) {
    return null;
  }
  const highlightedText = highlightHumanChatMentions({
    text,
    mentionHighlightIndex: input.mentionHighlightIndex,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });
  return {
    bodyLines: highlightedText.split("\n"),
    relationLines:
      input.event.type === "signal.text"
        ? buildHumanMessageRelationLines(input.messageReadProjection ?? null)
        : [],
    metaLines: [
      ...buildHumanViewStatusMetadataLines(input.event),
      ...buildHumanViewMessageMetadataLines({
        profileIdentity: input.event.profile,
        spaceMembersSnapshot: input.spaceMembersSnapshot,
      }),
      ...buildHumanViewTraceMetadataLines(input.event),
    ],
    headerBadge: resolveHumanMessageHeaderBadge(input.event),
  };
}

function buildHumanViewTraceMetadataLines(event: SignalEnvelope): string[] {
  if (
    !(
      event.type === "signal.text" ||
      event.type === "signal.status" ||
      event.type === "signal.system_notice"
    )
  ) {
    return [];
  }

  const traceCommands = buildHumanViewTraceCommands(event);
  if (traceCommands.length === 0) {
    return [];
  }
  return traceCommands.map((command) => pc.dim(`trace: ${command}`));
}

function buildHumanViewTraceCommands(event: SignalEnvelope): string[] {
  const meta = readObjectField(event.data, "meta");
  const dispatchId =
    readStringField(event.data, "dispatchId") ??
    readStringField(meta, "dispatchId");
  if (dispatchId) {
    return [
      formatOpenMeldCliCommand(
        `openmeld service trace --space ${event.spaceId} --dispatch ${dispatchId} --view agent`
      ),
    ];
  }

  const clientMessageId = readStringField(meta, "clientMessageId");
  if (!clientMessageId) {
    return [];
  }
  const targetProfileIds = readStringArrayField(
    readObjectField(event.data, "messageEnvelope"),
    "activationTargets"
  );
  return targetProfileIds.map((targetProfileId) =>
    formatOpenMeldCliCommand(
      `openmeld service trace --space ${event.spaceId} --client-message ${clientMessageId} --target-profile ${targetProfileId} --view agent`
    )
  );
}

function readObjectField(
  value: unknown,
  field: string
): Record<string, unknown> | null {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const nested = (value as Record<string, unknown>)[field];
  return nested && typeof nested === "object"
    ? (nested as Record<string, unknown>)
    : null;
}

function readStringField(value: unknown, field: string): string | null {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[field];
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

function readStringArrayField(value: unknown, field: string): string[] {
  if (!(value && typeof value === "object")) {
    return [];
  }
  const raw = (value as Record<string, unknown>)[field];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item) => {
    if (typeof item !== "string") {
      return [];
    }
    const normalized = item.trim();
    return normalized.length > 0 ? [normalized] : [];
  });
}

function resolveHumanMessageHeaderBadge(event: SignalEnvelope): string | null {
  if (event.type !== "signal.status") {
    return null;
  }
  return buildTranscriptStatusBadge(event.data.status);
}

function resolveHumanFormattedMessageBodyText(input: {
  event: SignalEnvelope;
  mentionHighlightIndex?: SpaceMentionHighlightIndex | null;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string | null {
  if (isOpenMeldSystemProfileIdentity(input.event.profile)) {
    return null;
  }
  if (input.event.type === "signal.text") {
    const event = input.event;
    if (isTransientSignalTextHintClearEvent(input.event)) {
      return null;
    }
    const text =
      typeof event.data.text === "string"
        ? sanitizeMultilineText(event.data.text)
        : "";
    if (isTransientSignalTextHint(input.event)) {
      return null;
    }
    if (
      resolveRenderedSystemNotice(
        input.event,
        input.spaceMembersSnapshot ?? null
      )
    ) {
      return null;
    }
    if (isMentionFailureHintSignalText(input.event, text)) {
      return null;
    }
    return text;
  }
  if (input.event.type === "signal.status") {
    const text = sanitizeMultilineText(input.event.data.text).trim();
    return text || null;
  }
  return null;
}

function buildHumanSystemNoticeLines(input: {
  event: Extract<SignalEnvelope, { type: "signal.system_notice" }>;
  replyLine?: string | null;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string[] {
  const lines = [
    sanitizeMultilineText(input.event.data.text).trim(),
    ...buildVisibleSystemNoticeReasonLines(input.event),
  ];
  const replyLine =
    input.replyLine ?? buildHumanReplyReferenceLine(input.event.data.replyTo);
  if (replyLine) {
    lines.push(replyLine);
  }
  lines.push(...buildHumanSystemNoticeMetadataLines(input));
  return lines.filter((line) => line.trim().length > 0);
}

function buildHumanSystemNoticeMetadataLines(input: {
  event: Extract<SignalEnvelope, { type: "signal.system_notice" }>;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string[] {
  const actorProfileIdentity = resolveSystemNoticeActorProfileIdentity(input);
  if (actorProfileIdentity) {
    return buildHumanViewMessageMetadataLines({
      profileIdentity: actorProfileIdentity,
      spaceMembersSnapshot: input.spaceMembersSnapshot,
    });
  }
  return buildHumanViewMessageMetadataLines({
    profileIdentity: input.event.profile,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });
}

function buildVisibleSystemNoticeReasonLines(
  event: Extract<SignalEnvelope, { type: "signal.system_notice" }>
): string[] {
  const reason = resolveVisibleStaySilentReason(event);
  if (!reason) {
    return [];
  }
  const [firstLine, ...restLines] = reason.split("\n");
  return [
    `agent reason: ${firstLine}`,
    ...restLines.map((line) => `  ${line}`),
  ];
}

function resolveVisibleStaySilentReason(
  event: Extract<SignalEnvelope, { type: "signal.system_notice" }>
): string | null {
  if (event.data.noticeType !== "stay_silent") {
    return null;
  }

  const reason = sanitizeMultilineText(event.data.reason).trim();
  if (!reason) {
    return null;
  }

  const text = sanitizeMultilineText(event.data.text).trim();
  if (systemNoticeTextAlreadyIncludesReason({ reason, text })) {
    return null;
  }
  return reason;
}

function systemNoticeTextAlreadyIncludesReason(input: {
  text: string;
  reason: string;
}): boolean {
  const normalizedText = input.text.toLowerCase();
  const normalizedReason = input.reason.toLowerCase();
  return (
    normalizedReason.length > 0 && normalizedText.includes(normalizedReason)
  );
}

function buildHumanViewStatusMetadataLines(event: SignalEnvelope): string[] {
  if (event.type !== "signal.status") {
    return [];
  }
  return [];
}

function buildTranscriptStatusBadge(status: string): string {
  return `status: ${status}`;
}

function buildHumanStatusBadge(status: string): string {
  return `[${buildTranscriptStatusBadge(status)}]`;
}

function buildHumanReplyReferenceLine(
  replyTo: SignalTextReplyTo | undefined
): string | null {
  if (!replyTo) {
    return null;
  }
  const profileName = sanitizeTrimmedSingleLineText(replyTo.profileName);
  const previewText = buildHumanReplyCuePreview(
    String(replyTo.previewText ?? ""),
    HUMAN_REPLY_CUE_PREVIEW_MAX_VISIBLE_WIDTH
  );
  if (profileName && previewText) {
    return pc.dim(`reply to ${profileName} · ${previewText}`);
  }
  if (profileName) {
    return pc.dim(`reply to ${profileName}`);
  }
  return null;
}

function highlightHumanChatMentions(input: {
  text: string;
  mentionHighlightIndex?: SpaceMentionHighlightIndex | null;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string {
  return highlightSpaceMentions({
    text: input.text,
    index: input.mentionHighlightIndex,
    render: (mentionText, profileIdentity) =>
      colorizeDisplayProfileLabel({
        label: mentionText,
        profileIdentity,
        spaceMembersSnapshot: input.spaceMembersSnapshot,
      }),
  });
}

function isMentionFailureHintSignalText(
  event: SignalEnvelope,
  text: string
): boolean {
  const meta = resolveSignalTextMeta(event);
  const purpose = String(meta?.purpose ?? "").trim();
  if (purpose === MENTION_DISPATCH_HINT_META_PURPOSE) {
    return true;
  }
  if (purpose.length > 0) {
    return false;
  }

  // Legacy fallback: hide old-format hint text only when emitted by OpenMeld System.
  if (!isOpenMeldSystemProfileIdentity(event.profile)) {
    return false;
  }

  const normalized = text.trimStart();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith(MENTION_FAILURE_HINT_PREFIX) ||
    normalized.startsWith(MENTION_FAILURE_HINT_LEGACY_PREFIX)
  );
}

function isTransientSignalTextHint(event: SignalEnvelope): boolean {
  const rawMeta = resolveSignalTextMeta(event);
  if (!rawMeta) {
    return false;
  }
  if (rawMeta.transient !== true) {
    return false;
  }
  const purpose = String(rawMeta.purpose ?? "").trim();
  if (!purpose) {
    return true;
  }
  return (
    purpose === AGENT_REPLYING_PURPOSE ||
    purpose === CONVERSATION_CONTINUITY_WARNING_PURPOSE ||
    purpose === AGENT_REPLY_PREVIEW_PURPOSE ||
    purpose === DISPATCH_ACTIVITY_DISPATCHING_PURPOSE ||
    purpose === DISPATCH_ACTIVITY_RETRYING_PURPOSE ||
    purpose === DISPATCH_ACTIVITY_FAILED_PURPOSE
  );
}

function isTransientSignalTextHintClearEvent(event: SignalEnvelope): boolean {
  const rawMeta = resolveSignalTextMeta(event);
  if (rawMeta?.transient !== true) {
    return false;
  }
  const purpose = String(rawMeta.purpose ?? "").trim();
  return (
    purpose === AGENT_REPLYING_END_PURPOSE ||
    purpose === AGENT_REPLY_PREVIEW_END_PURPOSE
  );
}

function resolveSignalTextMeta(
  event: SignalEnvelope
): Record<string, unknown> | null {
  if (event.type !== "signal.text") {
    return null;
  }
  if (
    !event.data ||
    typeof event.data !== "object" ||
    Array.isArray(event.data)
  ) {
    return null;
  }
  const meta = (event.data as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  return meta as Record<string, unknown>;
}

function readSignalMetaText(
  meta: Record<string, unknown>,
  key: string
): string {
  const value = meta[key];
  return typeof value === "string" || typeof value === "number"
    ? sanitizeTrimmedSingleLineText(value)
    : "";
}

function resolveSpaceMembershipNoticeText(
  event: SignalEnvelope,
  spaceMembersSnapshot: SpaceMembersSnapshot | null
): {
  text: string;
  wakeHint: SystemNoticeMentionHint | null;
  highlights: SystemNoticeProfileHighlight[];
} | null {
  if (event.type !== "signal.text") {
    return null;
  }
  const textEvent = event;
  const meta = resolveSignalTextMeta(event);
  if (!meta || meta.transient === true) {
    return null;
  }
  const purpose = String(meta.purpose ?? "").trim();
  let action: "member_added" | "member_removed" | null = null;
  if (purpose === SPACE_MEMBER_JOIN_NOTICE_PURPOSE) {
    action = "member_added";
  } else if (purpose === SPACE_MEMBER_REMOVE_NOTICE_PURPOSE) {
    action = "member_removed";
  }
  if (!action) {
    return null;
  }
  const rawText = textEvent.data.text;
  const text =
    typeof rawText === "string" ? sanitizeTrimmedSingleLineText(rawText) : "";
  if (!text) {
    return null;
  }
  const actorLabel = readSignalMetaText(
    meta,
    action === "member_added" ? "addedByDisplayName" : "removedByDisplayName"
  );
  const actorProfileId = readSignalMetaText(
    meta,
    action === "member_added" ? "addedByProfileId" : "removedByProfileId"
  );
  const targetProfileId = readSignalMetaText(meta, "targetProfileId");
  const targetProfileName = readSignalMetaText(meta, "targetProfileName");
  const targetProfileKind = readSignalMetaText(meta, "targetProfileKind");
  const actorProfileIdentity = resolveDisplayProfileIdentity({
    profileIdentity: {
      kind: event.profile?.kind,
      profileId:
        actorProfileId ||
        sanitizeTrimmedSingleLineText(event.profile?.profileId) ||
        undefined,
      profileName:
        actorLabel ||
        sanitizeTrimmedSingleLineText(event.profile?.profileName) ||
        undefined,
      ...(() => {
        const profileRecord =
          event.profile && typeof event.profile === "object"
            ? (event.profile as Record<string, unknown>)
            : null;
        const normalizedOwner = resolveNormalizedOwnerFields({
          ownerUserId:
            typeof profileRecord?.ownerUserId === "string"
              ? profileRecord.ownerUserId
              : undefined,
          ownerName: event.profile?.ownerName,
          owner:
            typeof profileRecord?.owner === "string"
              ? profileRecord.owner
              : undefined,
        });
        return {
          ...(normalizedOwner.ownerUserId
            ? { ownerUserId: normalizedOwner.ownerUserId }
            : {}),
          ...(normalizedOwner.ownerName
            ? { ownerName: normalizedOwner.ownerName }
            : {}),
        };
      })(),
    },
    spaceMembersSnapshot,
  });
  const targetProfileIdentity = resolveDisplayProfileIdentity({
    profileIdentity: {
      profileId: targetProfileId || undefined,
      profileName: targetProfileName,
      kind:
        targetProfileKind === "agent" || targetProfileKind === "human"
          ? targetProfileKind
          : undefined,
    },
    spaceMembersSnapshot,
  });
  return {
    text,
    wakeHint:
      action === "member_added"
        ? resolveSpaceMemberJoinNoticeWakeHint(meta, spaceMembersSnapshot)
        : null,
    highlights: [
      ...(actorLabel
        ? [
            {
              label: actorLabel,
              renderedLabel: colorizeDisplayProfileLabel({
                label: actorLabel,
                profileIdentity: actorProfileIdentity,
                spaceMembersSnapshot,
              }),
            } satisfies SystemNoticeProfileHighlight,
          ]
        : []),
      ...(targetProfileName
        ? [
            {
              label: targetProfileName,
              renderedLabel: colorizeDisplayProfileLabel({
                label: targetProfileName,
                profileIdentity: targetProfileIdentity,
                spaceMembersSnapshot,
              }),
            } satisfies SystemNoticeProfileHighlight,
          ]
        : []),
    ],
  };
}

function resolveRenderedSystemNotice(
  event: SignalEnvelope,
  spaceMembersSnapshot: SpaceMembersSnapshot | null
): {
  text: string;
  wakeHint: SystemNoticeMentionHint | null;
  highlights: SystemNoticeProfileHighlight[];
} | null {
  return resolveSpaceMembershipNoticeText(event, spaceMembersSnapshot);
}

function resolveSpaceMemberJoinNoticeWakeHint(
  meta: Record<string, unknown>,
  spaceMembersSnapshot: SpaceMembersSnapshot | null
): SystemNoticeMentionHint | null {
  if (readSignalMetaText(meta, "targetProfileKind") !== "agent") {
    return null;
  }
  const profileId = readSignalMetaText(meta, "targetProfileId");
  const snapshotAgent =
    profileId && spaceMembersSnapshot
      ? (spaceMembersSnapshot.agents.find(
          (agent) => agent.profileId === profileId
        ) ?? null)
      : null;
  const persistedTargetMentionLabel = sanitizeTrimmedSingleLineText(
    readSignalMetaText(meta, "targetMentionLabel")
  );
  const legacyMentionLabel = sanitizeTrimmedSingleLineText(
    readSignalMetaText(meta, "mentionLabel")
  );
  const mentionLabel =
    persistedTargetMentionLabel ||
    legacyMentionLabel ||
    resolvePrimarySpaceMentionLabel({
      profileId,
      snapshot: spaceMembersSnapshot,
    }) ||
    sanitizeTrimmedSingleLineText(
      readSignalMetaText(meta, "targetProfileName")
    ) ||
    sanitizeTrimmedSingleLineText(profileId);
  if (!mentionLabel) {
    return null;
  }

  return {
    mentionLabel,
    ...(snapshotAgent?.agentControllerRef
      ? { agentControllerRef: snapshotAgent.agentControllerRef }
      : {}),
    ...(profileId ? { profileId } : {}),
    ...(snapshotAgent?.profileName
      ? { profileName: snapshotAgent.profileName }
      : {}),
  };
}

function appendRenderedSystemNoticeMentionHint(input: {
  text: string;
  wakeHint: SystemNoticeMentionHint | null;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string {
  if (!input.text) {
    return "";
  }
  if (!input.wakeHint) {
    return input.text;
  }
  return `${input.text} ${formatInlineMentionHint(
    input.wakeHint,
    input.spaceMembersSnapshot ?? null
  )}`;
}

function formatInlineMentionHint(
  input: SystemNoticeMentionHint,
  spaceMembersSnapshot: SpaceMembersSnapshot | null
): string {
  const highlightedMentionLabel = colorizeAgentLabel(
    `\`@${input.mentionLabel}(wake)\``,
    {
      agentControllerRef: input.agentControllerRef,
      profileId: input.profileId,
      profileName: input.profileName ?? input.mentionLabel,
    },
    {
      spaceMembersSnapshot,
    }
  );
  return `${pc.dim("· Mention as ")}${highlightedMentionLabel}`;
}

function formatHumanSystemPresenceLine(input: {
  profileIdentity: ProfileIdentityLike;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  verb: string;
}): string {
  const speaker = formatHumanSystemPresenceSpeaker({
    profileIdentity: input.profileIdentity,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });
  return `* ${SYSTEM_BROADCAST_LABEL}: ${speaker}${pc.dim(` ${input.verb}`)}`;
}

function formatHumanSystemPresenceSpeaker(input: {
  profileIdentity: ProfileIdentityLike;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string {
  const profileIdentity = resolveDisplayProfileIdentity({
    profileIdentity: input.profileIdentity,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });
  const label = colorizeDisplayProfileLabel({
    label: resolveHumanProfileLabel(profileIdentity),
    profileIdentity,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });
  const kind = resolveHumanProfileKind(profileIdentity);
  if (kind === "agent") {
    return `${AGENT_SPEAKER_AVATAR} ${label}`;
  }
  if (kind === "human") {
    return `${HUMAN_SPEAKER_AVATAR} ${label}`;
  }
  return label;
}

function highlightSystemNoticeProfileNames(input: {
  text: string;
  highlights: SystemNoticeProfileHighlight[];
}): string {
  const normalizedText = sanitizeTrimmedSingleLineText(input.text);
  if (!normalizedText) {
    return "";
  }
  const matches: Array<{
    start: number;
    end: number;
    renderedLabel: string;
  }> = [];

  for (const highlight of input.highlights) {
    const label = sanitizeTrimmedSingleLineText(highlight.label);
    if (!label) {
      continue;
    }
    let searchIndex = 0;
    while (searchIndex < normalizedText.length) {
      const start = normalizedText.indexOf(label, searchIndex);
      if (start < 0) {
        break;
      }
      matches.push({
        start,
        end: start + label.length,
        renderedLabel: highlight.renderedLabel,
      });
      searchIndex = start + label.length;
    }
  }

  if (matches.length === 0) {
    return normalizedText;
  }

  matches.sort((left, right) => {
    if (left.start !== right.start) {
      return left.start - right.start;
    }
    return right.end - left.end;
  });

  let cursor = 0;
  let output = "";
  for (const match of matches) {
    if (match.start < cursor) {
      continue;
    }
    output += normalizedText.slice(cursor, match.start);
    output += match.renderedLabel;
    cursor = match.end;
  }
  output += normalizedText.slice(cursor);
  return output;
}

function resolveAgentViewProfileDescriptor(
  profileIdentity: ProfileIdentityLike
): string {
  const profileId =
    sanitizeTrimmedSingleLineText(profileIdentity?.profileId) || "unknown";
  const metadata = resolveAgentViewProfileMetadata(profileIdentity);
  return metadata.length > 0
    ? `${profileId} (${metadata.join(", ")})`
    : profileId;
}

function resolveHumanProfileName(profileIdentity: ProfileIdentityLike): string {
  const name = sanitizeTrimmedSingleLineText(profileIdentity?.profileName);
  return name || "unknown";
}

function resolveHumanProfileLabel(
  profileIdentity: ProfileIdentityLike
): string {
  return resolveHumanProfileName(profileIdentity);
}

function resolveHumanProfileKind(
  profileIdentity: ProfileIdentityLike
): "human" | "agent" | "" {
  const normalizedKind = sanitizeTrimmedSingleLineText(profileIdentity?.kind);
  if (normalizedKind === "human" || normalizedKind === "agent") {
    return normalizedKind;
  }
  return "";
}

function resolveHumanReadableOwner(
  profileIdentity: ProfileIdentityLike
): string {
  const normalizedOwner = resolveNormalizedOwnerFields({
    ownerUserId: profileIdentity?.ownerUserId,
    ownerName: profileIdentity?.ownerName,
    owner: profileIdentity?.owner,
  });
  const ownerName = sanitizeTrimmedSingleLineText(normalizedOwner.ownerName);
  if (ownerName) {
    return ownerName;
  }
  const ownerUserId = sanitizeTrimmedSingleLineText(
    normalizedOwner.ownerUserId
  );
  if (ownerUserId) {
    return ownerUserId;
  }
  return "";
}

function buildHumanViewMessageMetadataLines(input: {
  profileIdentity: ProfileIdentityLike;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string[] {
  const profileKind = resolveHumanProfileKind(input.profileIdentity);
  if (profileKind === "agent") {
    return buildHumanAgentMessageMetadataLines(input);
  }
  if (profileKind === "human") {
    return buildHumanMemberMessageMetadataLines({
      profileIdentity: input.profileIdentity,
      spaceMembersSnapshot: input.spaceMembersSnapshot,
    });
  }
  return [];
}

function buildHumanAgentMessageMetadataLines(input: {
  profileIdentity: ProfileIdentityLike;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string[] {
  const agentSnapshot = findAgentSpaceMemberSnapshot(input);
  const agentControllerRef =
    resolveAgentControllerRef(input.profileIdentity) ||
    sanitizeTrimmedSingleLineText(agentSnapshot?.agentControllerRef);
  const controllerDisplay = resolveControllerDisplayName(agentControllerRef);
  const metadataSegments = [
    controllerDisplay
      ? `${pc.dim("agent via ")}${colorizeAgentLabel(
          controllerDisplay,
          {
            agentControllerRef,
            profileId: agentSnapshot?.profileId,
            profileName: agentSnapshot?.profileName,
          },
          {
            spaceMembersSnapshot: input.spaceMembersSnapshot,
          }
        )}`
      : pc.dim("agent"),
  ];
  const ownerDisplay =
    resolveHumanReadableOwner(input.profileIdentity) ||
    sanitizeTrimmedSingleLineText(agentSnapshot?.ownerName) ||
    sanitizeTrimmedSingleLineText(agentSnapshot?.ownerUserId);
  if (ownerDisplay) {
    metadataSegments.push(pc.dim(`owner: ${ownerDisplay}`));
  }

  const addedByDisplay = resolveAgentAddedByDisplay({
    agentSnapshot,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });
  if (addedByDisplay) {
    metadataSegments.push(pc.dim(`added by: ${addedByDisplay.label}`));
  }

  const lines = [joinStyledMetadataSegments(metadataSegments) ?? ""];
  // Origin metadata is sensitive. If the event payload already omitted it, do
  // not rehydrate it from a members snapshot side channel.
  const originDisplay = agentControllerRef
    ? resolveAgentOriginDisplay({
        agentControllerRef,
        agentControllerConversationId: resolveAgentControllerConversationId(
          input.profileIdentity
        ),
        model: resolveProfileModelId(input.profileIdentity),
        workingDirectory: resolveWorkingDirectory(input.profileIdentity),
      })
    : resolveAgentControllerConversationId(input.profileIdentity);
  if (originDisplay) {
    lines.push(pc.dim(`origin: ${originDisplay}`));
  }
  return lines;
}

function resolveSystemNoticeActorProfileIdentity(input: {
  event: Extract<SignalEnvelope, { type: "signal.system_notice" }>;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): ProfileIdentityLike | null {
  const actorProfileId = sanitizeTrimmedSingleLineText(
    input.event.data.actorProfileId
  );
  if (!actorProfileId) {
    return null;
  }

  const actorSnapshot =
    input.spaceMembersSnapshot?.agents.find(
      (agent) =>
        agent.status === "active" &&
        sanitizeTrimmedSingleLineText(agent.profileId) === actorProfileId
    ) ?? null;
  if (!actorSnapshot) {
    return {
      kind: "agent",
      profileId: actorProfileId,
    };
  }

  return {
    kind: "agent",
    profileId: actorSnapshot.profileId,
    profileName: actorSnapshot.profileName,
    ownerUserId: actorSnapshot.ownerUserId,
    ownerName: actorSnapshot.ownerName,
    agentControllerRef: actorSnapshot.agentControllerRef,
    modelSelection: actorSnapshot.modelSelection,
  };
}

function buildHumanMemberMessageMetadataLines(input: {
  profileIdentity: ProfileIdentityLike;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string[] {
  const humanSnapshot = findHumanSpaceMemberSnapshot({
    profileIdentity: input.profileIdentity,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });

  const metadataSegments = ["human"];
  if (humanSnapshot) {
    metadataSegments.push(resolveHumanMemberRoleLabel(humanSnapshot));
    const seenLabel = resolveSpaceMemberSeenLabel(humanSnapshot);
    if (seenLabel) {
      metadataSegments.push(seenLabel);
    }
  }

  const lines = [pc.dim(metadataSegments.join(" · "))];
  const relatedAgentsLine = buildHumanRelatedAgentsLine({
    profileIdentity: input.profileIdentity,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });
  if (relatedAgentsLine) {
    lines.push(relatedAgentsLine);
  }
  return lines;
}

function findHumanSpaceMemberSnapshot(input: {
  profileIdentity: ProfileIdentityLike;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): SpaceMemberHumanSnapshot | null {
  const snapshot = input.spaceMembersSnapshot;
  if (!snapshot) {
    return null;
  }

  const profileId = sanitizeTrimmedSingleLineText(
    input.profileIdentity?.profileId
  );
  if (profileId) {
    const activeMatch = snapshot.humans.find(
      (member) =>
        member.status === "active" &&
        sanitizeTrimmedSingleLineText(member.profileId) === profileId
    );
    if (activeMatch) {
      return activeMatch;
    }
  }

  const profileName = resolveHumanProfileName(input.profileIdentity);
  if (!profileName) {
    return null;
  }

  return (
    snapshot.humans.find(
      (member) =>
        member.status === "active" &&
        areCaseInsensitiveMatches(member.profileName, profileName)
    ) ?? null
  );
}

function findAgentSpaceMemberSnapshot(input: {
  profileIdentity: ProfileIdentityLike;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): SpaceMemberAgentSnapshot | null {
  const snapshot = input.spaceMembersSnapshot;
  if (!snapshot) {
    return null;
  }

  const profileId = sanitizeTrimmedSingleLineText(
    input.profileIdentity?.profileId
  );
  if (profileId) {
    const activeMatch = snapshot.agents.find(
      (member) =>
        member.status === "active" &&
        sanitizeTrimmedSingleLineText(member.profileId) === profileId
    );
    if (activeMatch) {
      return activeMatch;
    }
  }

  const profileName = resolveHumanProfileName(input.profileIdentity);
  if (!profileName) {
    return null;
  }

  return (
    snapshot.agents.find(
      (member) =>
        member.status === "active" &&
        areCaseInsensitiveMatches(member.profileName, profileName)
    ) ?? null
  );
}

function resolveHumanMemberRoleLabel(member: SpaceMemberHumanSnapshot): string {
  return member.memberSource === "space_creator" ? "space creator" : "member";
}

function resolveSpaceMemberSeenLabel(member: {
  lastSeenLabel?: string | null;
  liveNow?: boolean;
}): string {
  const seenLabel = sanitizeTrimmedSingleLineText(member.lastSeenLabel);
  if (seenLabel) {
    const normalizedSeenLabel = seenLabel.toLowerCase();
    if (
      normalizedSeenLabel === "left" ||
      normalizedSeenLabel.startsWith("left ")
    ) {
      return "";
    }
    return normalizedSeenLabel;
  }
  return member.liveNow ? "seen now" : "";
}

function buildHumanRelatedAgentsLine(input: {
  profileIdentity: ProfileIdentityLike;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): string | null {
  const snapshot = input.spaceMembersSnapshot;
  if (!snapshot) {
    return null;
  }

  const ownedAgents = snapshot.agents.filter(
    (agent) =>
      agent.status === "active" &&
      isAgentOwnedByHumanProfile(agent, input.profileIdentity)
  );
  if (ownedAgents.length > 0) {
    return `${pc.dim("owns: ")}${ownedAgents
      .map((agent) =>
        formatPlainRelatedAgentHandle(agent, input.spaceMembersSnapshot ?? null)
      )
      .join(pc.dim(" · "))}`;
  }

  const humanProfileId = sanitizeTrimmedSingleLineText(
    input.profileIdentity?.profileId
  );
  if (!humanProfileId) {
    return null;
  }

  const addedAgents = snapshot.agents.filter(
    (agent) =>
      agent.status === "active" &&
      sanitizeTrimmedSingleLineText(agent.addedByProfileId) === humanProfileId
  );
  if (addedAgents.length === 0) {
    return null;
  }

  return `${pc.dim("added: ")}${addedAgents
    .map((agent) =>
      formatRelatedAgentHandle(agent, input.spaceMembersSnapshot ?? null)
    )
    .join(pc.dim(" · "))}`;
}

function colorizeLiveNowLabel(): string {
  return renderPositiveAccentText("live now");
}

function isAgentOwnedByHumanProfile(
  agent: SpaceMemberAgentSnapshot,
  profileIdentity: ProfileIdentityLike
): boolean {
  const humanOwnerUserId = sanitizeTrimmedSingleLineText(
    profileIdentity?.ownerUserId
  );
  const agentOwnerUserId = sanitizeTrimmedSingleLineText(agent.ownerUserId);
  if (humanOwnerUserId && agentOwnerUserId) {
    return humanOwnerUserId === agentOwnerUserId;
  }

  const ownerName = sanitizeTrimmedSingleLineText(agent.ownerName);
  if (!ownerName) {
    return false;
  }

  const humanOwnerName = sanitizeTrimmedSingleLineText(
    profileIdentity?.ownerName
  );
  if (humanOwnerName) {
    return areCaseInsensitiveMatches(ownerName, humanOwnerName);
  }

  return areCaseInsensitiveMatches(
    ownerName,
    resolveHumanProfileName(profileIdentity)
  );
}

function resolveAgentAddedByDisplay(input: {
  agentSnapshot: SpaceMemberAgentSnapshot | null;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
}): {
  label: string;
  ownerUserId: string | null;
  ownerName: string | null;
  profileId: string | null;
} | null {
  const addedByDisplay = sanitizeTrimmedSingleLineText(
    input.agentSnapshot?.addedByDisplayName
  );
  if (addedByDisplay) {
    return {
      label: addedByDisplay,
      ownerUserId: null,
      ownerName: null,
      profileId:
        sanitizeTrimmedSingleLineText(input.agentSnapshot?.addedByProfileId) ||
        null,
    };
  }

  const addedByProfileId = sanitizeTrimmedSingleLineText(
    input.agentSnapshot?.addedByProfileId
  );
  if (!(addedByProfileId && input.spaceMembersSnapshot)) {
    return null;
  }

  const humanSnapshot = input.spaceMembersSnapshot.humans.find(
    (member) =>
      member.status === "active" &&
      sanitizeTrimmedSingleLineText(member.profileId) === addedByProfileId
  );
  const label = sanitizeTrimmedSingleLineText(humanSnapshot?.profileName);
  if (!label) {
    return null;
  }
  return {
    label,
    ownerUserId: humanSnapshot?.ownerUserId ?? null,
    ownerName: humanSnapshot?.ownerName ?? null,
    profileId: humanSnapshot?.profileId ?? null,
  };
}

function areCaseInsensitiveMatches(
  left: string | number | null | undefined,
  right: string | number | null | undefined
): boolean {
  const normalizedLeft = sanitizeTrimmedSingleLineText(left).toLowerCase();
  if (!normalizedLeft) {
    return false;
  }
  return normalizedLeft === sanitizeTrimmedSingleLineText(right).toLowerCase();
}

function formatRelatedAgentHandle(
  agent: SpaceMemberAgentSnapshot,
  spaceMembersSnapshot: SpaceMembersSnapshot | null
): string {
  const token =
    resolvePrimarySpaceMentionLabel({
      profileId: agent.profileId,
      snapshot: spaceMembersSnapshot,
    }) ||
    sanitizeTrimmedSingleLineText(agent.profileName) ||
    sanitizeTrimmedSingleLineText(agent.profileId);
  if (!token) {
    return "@unknown-agent";
  }
  const handle = token.startsWith("@") ? token : `@${token}`;
  return colorizeAgentLabel(
    handle,
    {
      agentControllerRef: agent.agentControllerRef,
      profileId: agent.profileId,
      profileName: agent.profileName,
    },
    {
      spaceMembersSnapshot,
    }
  );
}

function formatPlainRelatedAgentHandle(
  agent: SpaceMemberAgentSnapshot,
  spaceMembersSnapshot?: SpaceMembersSnapshot | null
): string {
  const token =
    resolvePrimarySpaceMentionLabel({
      profileId: agent.profileId,
      snapshot: spaceMembersSnapshot ?? null,
    }) ||
    sanitizeTrimmedSingleLineText(agent.profileName) ||
    sanitizeTrimmedSingleLineText(agent.profileId);
  if (!token) {
    return "@unknown-agent";
  }
  return token.startsWith("@") ? token : `@${token}`;
}

function resolveAgentViewProfileMetadata(
  profileIdentity: ProfileIdentityLike
): string[] {
  if (!profileIdentity || typeof profileIdentity !== "object") {
    return [];
  }

  const record = profileIdentity as Record<string, unknown>;
  const metadata: string[] = [];
  const normalizedOwner = resolveNormalizedOwnerFields({
    ownerUserId: record.ownerUserId,
    ownerName: record.ownerName,
    owner: record.owner,
  });
  const preferredKeys = [
    "kind",
    "profileName",
    "agentControllerRef",
    "agentControllerConversationId",
  ] as const;
  const skippedKeys = new Set<string>(["profileId", "owner"]);

  for (const key of preferredKeys) {
    const formattedValue = formatAgentViewMetadataValue(record[key]);
    if (!formattedValue) {
      continue;
    }
    metadata.push(`${key}=${formattedValue}`);
    skippedKeys.add(key);
  }

  if (normalizedOwner.ownerName) {
    metadata.splice(2, 0, `ownerName=${normalizedOwner.ownerName}`);
    skippedKeys.add("ownerName");
    skippedKeys.add("ownerUserId");
  } else if (normalizedOwner.ownerUserId) {
    const recordOwnerUserId =
      typeof record.ownerUserId === "string" ? record.ownerUserId : undefined;
    const ownerLabel =
      typeof record.owner === "string" &&
      !sanitizeTrimmedSingleLineText(recordOwnerUserId)
        ? "owner"
        : "ownerUserId";
    metadata.splice(2, 0, `${ownerLabel}=${normalizedOwner.ownerUserId}`);
    skippedKeys.add("ownerUserId");
  }

  const additionalKeys = Object.keys(record)
    .filter((key) => !skippedKeys.has(key))
    .sort((left, right) => left.localeCompare(right));
  for (const key of additionalKeys) {
    const formattedValue = formatAgentViewMetadataValue(record[key]);
    if (!formattedValue) {
      continue;
    }
    metadata.push(`${key}=${formattedValue}`);
  }

  return metadata;
}

function formatAgentViewMetadataValue(value: unknown): string {
  if (typeof value === "string") {
    const normalized = sanitizeTrimmedSingleLineText(value);
    return normalized.length > 0 ? normalized : "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveAgentControllerConversationId(
  profileIdentity: ProfileIdentityLike
): string {
  if (resolveHumanProfileKind(profileIdentity) !== "agent") {
    return "";
  }
  const normalized =
    sanitizeTrimmedSingleLineText(
      profileIdentity?.agentControllerConversation
        ?.agentControllerConversationId
    ) ||
    sanitizeTrimmedSingleLineText(
      profileIdentity?.agentControllerConversationId
    );
  if (!normalized) {
    return "";
  }
  if (AGENT_CONTEXT_HIDDEN_TOKENS.has(normalized.toLowerCase())) {
    return "";
  }
  return normalized;
}

function resolveAgentControllerRef(
  profileIdentity: ProfileIdentityLike
): string {
  if (resolveHumanProfileKind(profileIdentity) !== "agent") {
    return "";
  }
  return sanitizeTrimmedSingleLineText(profileIdentity?.agentControllerRef);
}

function resolveAgentOriginDisplay(input: {
  agentControllerRef: string;
  agentControllerConversationId?: string | null;
  model?: string | null;
  workingDirectory?: string | null;
}): string {
  const model = sanitizeTrimmedSingleLineText(input.model);
  return sanitizeTrimmedSingleLineText(
    resolveRegistryOriginLaunchCommand({
      agentControllerRef: input.agentControllerRef,
      agentControllerConversationId: input.agentControllerConversationId,
      ...(model ? { model } : {}),
      workingDirectory: input.workingDirectory,
    }) ??
      input.agentControllerConversationId ??
      ""
  );
}

function resolveProfileModelId(profileIdentity: ProfileIdentityLike): string {
  if (resolveHumanProfileKind(profileIdentity) !== "agent") {
    return "";
  }
  return sanitizeTrimmedSingleLineText(
    profileIdentity?.modelSelection?.modelId
  );
}

function resolveWorkingDirectory(profileIdentity: ProfileIdentityLike): string {
  if (resolveHumanProfileKind(profileIdentity) !== "agent") {
    return "";
  }
  return (
    normalizeOptionalWorkingDirectory(profileIdentity?.workingDirectory) ?? ""
  );
}

function formatSignalTimestamp(ts: number): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return pc.dim("00000000 00:00");
  }
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return pc.dim(`${year}${month}${day} ${hour}:${minute}`);
}
