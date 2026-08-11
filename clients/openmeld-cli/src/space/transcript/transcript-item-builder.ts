import type { HelloAck, SignalEnvelope } from "@openmeld/protocol";
import {
  SPACE_MEMBER_JOIN_NOTICE_PURPOSE,
  SPACE_MEMBER_REMOVE_NOTICE_PURPOSE,
} from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import {
  buildSignalMessageReadProjection,
  buildSignalReplyWorkflowProjection,
  type SpaceReplyWorkflowProjection,
  type SpaceSignalIndex,
} from "@openmeld/space";
import { buildHumanFormattedMessage, formatTextEvent } from "../../ui/output";
import type { SpaceMentionHighlightIndex } from "../../ui/space-mention-highlight";
import { sanitizeTerminalDisplayText } from "../../ui/terminal-safe-text";
import { resolveNormalizedOwnerFields } from "../agent-output-contract";
import { isOpenMeldSystemProfileIdentity } from "../openmeld-system-profile";
import { buildHumanReplyContextLine } from "../read-projection/human-message-read-display";
import type {
  SpaceTranscriptFormattedMessage,
  SpaceTranscriptItem,
  SpaceTranscriptReplyRef,
} from "../state/space-screen-state";
import { resolveMembershipNoticeFromSignalEnvelope } from "./membership-notice";
import { resolveEnrichedTextRenderEvent } from "./transcript-owner-enrichment";
import { resolveTranscriptReplyRef } from "./transcript-reply-ref";

const SYSTEM_MESSAGE_GROUP_KEY = "system";
const PRESENCE_HUMAN_AVATAR = "👤";
const PRESENCE_AGENT_AVATAR = "🤖";

export type TranscriptSessionProfileIdentity = {
  kind: "human" | "agent";
  openMeldProfileId: string;
  ownerUserId?: string;
  ownerName?: string;
};

export type TranscriptThreadIndicator = {
  threadId: string;
  replyCount: number;
};

// Assemble transcript items from shared read/workflow projections plus
// render-facing metadata. This file must not re-own shared semantics.
export function buildHumanTranscriptItemFromEvent(input: {
  event: SignalEnvelope | HelloAck;
  mentionHighlightIndex?: SpaceMentionHighlightIndex | null;
  ownerDisplayNameByUserId: Map<string, string>;
  selfProfileId: string;
  sessionProfileIdentity: TranscriptSessionProfileIdentity;
  signalIndex?: SpaceSignalIndex | null;
  spaceId?: string;
  spaceMembersSnapshot?: SpaceMembersSnapshot | null;
  threadSummary?: TranscriptThreadIndicator | null;
}): SpaceTranscriptItem | null {
  const enrichedEvent = resolveEnrichedTextRenderEvent({
    event: input.event,
    ownerDisplayNameByUserId: input.ownerDisplayNameByUserId,
    sessionProfileIdentity: input.sessionProfileIdentity,
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });
  const messageReadProjection = isSignalEnvelope(enrichedEvent)
    ? buildSignalMessageReadProjection({
        signal: enrichedEvent,
        membersSnapshot: input.spaceMembersSnapshot,
        signalIndex: input.signalIndex ?? null,
      })
    : null;
  const replyWorkflowProjection = isSignalEnvelope(enrichedEvent)
    ? buildSignalReplyWorkflowProjection({
        signal: enrichedEvent,
        membersSnapshot: input.spaceMembersSnapshot,
        signalIndex: input.signalIndex ?? null,
      })
    : null;
  const line = formatTextEvent(enrichedEvent, {
    view: "human",
    selfProfileId: input.selfProfileId,
    mentionHighlightIndex: input.mentionHighlightIndex,
    replyLine: buildHumanReplyContextLine(
      replyWorkflowProjection?.replyToContext ?? null
    ),
    spaceMembersSnapshot: input.spaceMembersSnapshot,
  });
  if (!line) {
    return null;
  }

  const formattedMessage = shouldBuildHumanFormattedMessage(enrichedEvent)
    ? buildHumanFormattedMessage({
        event: enrichedEvent,
        mentionHighlightIndex: input.mentionHighlightIndex,
        messageReadProjection,
        spaceMembersSnapshot: input.spaceMembersSnapshot,
      })
    : null;

  return buildSpaceTranscriptItem({
    event: enrichedEvent,
    line,
    formattedMessage: attachThreadIndicatorLine({
      formattedMessage,
      spaceId: input.spaceId,
      threadSummary: input.threadSummary ?? null,
    }),
    messageReadProjection,
    replyWorkflowProjection,
  });
}

// Attach a dimmed thread-indicator sub-line under a message that roots a
// thread, e.g. "↳ 3 replies · openmeld space thread <spaceId> <threadId>". Rendered
// as its own wrapped line below the message body (not joined into the meta
// tags), so the full thread id survives narrow terminals.
function attachThreadIndicatorLine(input: {
  formattedMessage: SpaceTranscriptFormattedMessage | null;
  spaceId: string | undefined;
  threadSummary: TranscriptThreadIndicator | null;
}): SpaceTranscriptFormattedMessage | null {
  const { formattedMessage, spaceId, threadSummary } = input;
  if (!(formattedMessage && threadSummary && spaceId)) {
    return formattedMessage;
  }
  if (threadSummary.replyCount <= 0) {
    return formattedMessage;
  }
  const replyNoun = threadSummary.replyCount === 1 ? "reply" : "replies";
  const safeSpaceId = sanitizeTerminalDisplayText(spaceId);
  const safeThreadId = sanitizeTerminalDisplayText(threadSummary.threadId);
  const indicatorLine = `↳ ${String(threadSummary.replyCount)} ${replyNoun} · openmeld space thread ${safeSpaceId} ${safeThreadId}`;
  return {
    ...formattedMessage,
    threadIndicatorLine: indicatorLine,
  };
}

export function resolveTextLineGroupKey(
  event: SignalEnvelope | HelloAck
): string {
  if (isSystemRenderedHumanViewEvent(event)) {
    return SYSTEM_MESSAGE_GROUP_KEY;
  }
  return resolveProfileGroupKey(event.profile, event.type);
}

export function buildSpaceTranscriptItem(input: {
  event: SignalEnvelope | HelloAck;
  line: string;
  formattedMessage?: SpaceTranscriptFormattedMessage | null;
  messageReadProjection?: SpaceTranscriptItem["messageReadProjection"] | null;
  replyWorkflowProjection?: SpaceReplyWorkflowProjection | null;
}): SpaceTranscriptItem {
  const groupKey = resolveTextLineGroupKey(input.event);
  const profile = buildTranscriptItemProfileSnapshot(input.event);
  const systemPurpose = resolveTranscriptItemSystemPurpose(input.event);
  const replyRef = isSignalEnvelope(input.event)
    ? resolveTranscriptReplyRef({
        event: input.event,
        messageReadProjection: input.messageReadProjection ?? null,
      })
    : undefined;
  if (isSignalEnvelope(input.event)) {
    return buildSignalEnvelopeTranscriptItem({
      event: input.event,
      formattedMessage: input.formattedMessage ?? undefined,
      groupKey,
      line: input.line,
      messageReadProjection: input.messageReadProjection ?? undefined,
      profile,
      replyWorkflowProjection: input.replyWorkflowProjection ?? undefined,
      replyRef,
      systemPurpose: systemPurpose ?? undefined,
    });
  }
  return {
    line: input.line,
    groupKey,
    kind: "system_notice",
    formattedMessage: input.formattedMessage ?? undefined,
    ...(input.messageReadProjection
      ? { messageReadProjection: input.messageReadProjection }
      : {}),
    ...(input.replyWorkflowProjection
      ? { replyWorkflowProjection: input.replyWorkflowProjection }
      : {}),
    profile,
    systemPurpose,
  };
}

function buildSignalEnvelopeTranscriptItem(input: {
  event: SignalEnvelope;
  formattedMessage?: SpaceTranscriptFormattedMessage;
  groupKey: string;
  line: string;
  messageReadProjection?: SpaceTranscriptItem["messageReadProjection"];
  profile: SpaceTranscriptItem["profile"];
  replyWorkflowProjection?: SpaceTranscriptItem["replyWorkflowProjection"];
  replyRef?: SpaceTranscriptReplyRef;
  systemPurpose: string | undefined;
}): SpaceTranscriptItem {
  const baseItem = buildSignalTranscriptItemBase(input);
  if (
    input.event.type === "presence.join" ||
    input.event.type === "presence.quit"
  ) {
    return {
      ...baseItem,
      kind: "presence",
      presenceAction: input.event.type === "presence.join" ? "join" : "left",
      actorProfileId: normalizeTranscriptActorProfileId(input.event.profile),
      actorKind: resolveTranscriptActorKind(input.event.profile?.kind),
      actorLabel: resolveTranscriptActorLabel(input.event.profile),
      actorAvatar: resolveTranscriptActorAvatar(input.event.profile?.kind),
    };
  }

  const membershipNotice = resolveMembershipNoticeFromSignalEnvelope(
    input.event
  );
  if (membershipNotice) {
    return {
      ...baseItem,
      kind: "membership_notice",
      membershipNotice,
    };
  }

  if (input.event.type === "signal.system_notice") {
    return {
      ...baseItem,
      kind: "system_notice",
      ...(input.replyRef ? { replyRef: input.replyRef } : {}),
    };
  }

  return {
    ...baseItem,
    kind:
      input.groupKey === SYSTEM_MESSAGE_GROUP_KEY ? "system_notice" : "message",
    ...(input.groupKey === SYSTEM_MESSAGE_GROUP_KEY || !input.replyRef
      ? {}
      : { replyRef: input.replyRef }),
  };
}

function buildSignalTranscriptItemBase(input: {
  event: SignalEnvelope;
  formattedMessage?: SpaceTranscriptFormattedMessage;
  groupKey: string;
  line: string;
  messageReadProjection?: SpaceTranscriptItem["messageReadProjection"];
  profile: SpaceTranscriptItem["profile"];
  replyWorkflowProjection?: SpaceTranscriptItem["replyWorkflowProjection"];
  systemPurpose: string | undefined;
}): Omit<SpaceTranscriptItem, "kind"> {
  return {
    line: input.line,
    groupKey: input.groupKey,
    formattedMessage: input.formattedMessage,
    ...(input.messageReadProjection
      ? { messageReadProjection: input.messageReadProjection }
      : {}),
    ...(input.replyWorkflowProjection
      ? { replyWorkflowProjection: input.replyWorkflowProjection }
      : {}),
    profile: input.profile,
    systemPurpose: input.systemPurpose,
    ts: input.event.ts,
  };
}

function isSignalEnvelope(
  event: SignalEnvelope | HelloAck
): event is SignalEnvelope {
  return "id" in event && typeof event.id === "string";
}

function resolveProfileGroupKey(
  profile: SignalEnvelope["profile"] | HelloAck["profile"] | undefined,
  fallbackType: string
): string {
  const profileId = String(profile?.profileId ?? "").trim();
  if (profileId) {
    return `profile-id:${profileId}`;
  }

  const profileName = String(profile?.profileName ?? "").trim();
  const profileKind = String(profile?.kind ?? "").trim();
  if (profileName || profileKind) {
    return `profile:${profileKind || "unknown"}:${profileName || "unknown"}`;
  }
  return `event:${fallbackType}`;
}

function isSystemRenderedHumanViewEvent(
  event: SignalEnvelope | HelloAck
): boolean {
  if (event.type === "system.hello.ack") {
    return true;
  }
  if (!isSignalEnvelope(event)) {
    return false;
  }
  if (event.type === "presence.join" || event.type === "presence.quit") {
    return true;
  }
  return isSystemRenderedHumanViewSignalEvent(event);
}

function shouldBuildHumanFormattedMessage(
  event: SignalEnvelope | HelloAck
): event is Extract<SignalEnvelope, { type: "signal.text" | "signal.status" }> {
  return (
    isSignalEnvelope(event) &&
    (event.type === "signal.text" || event.type === "signal.status") &&
    !isSystemRenderedHumanViewEvent(event)
  );
}

function isSystemRenderedHumanViewSignalEvent(event: SignalEnvelope): boolean {
  if (event.type === "signal.status") {
    return isOpenMeldSystemProfileIdentity(event.profile);
  }

  if (event.type !== "signal.text") {
    return false;
  }

  if (isOpenMeldSystemProfileIdentity(event.profile)) {
    return true;
  }
  const meta = resolveSignalTextMetaFromEnvelope(event);
  const purpose = String(meta?.purpose ?? "").trim();
  return (
    purpose === SPACE_MEMBER_JOIN_NOTICE_PURPOSE ||
    purpose === SPACE_MEMBER_REMOVE_NOTICE_PURPOSE
  );
}

function resolveSignalTextMetaFromEnvelope(
  event: SignalEnvelope
): Record<string, unknown> | null {
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

function buildTranscriptItemProfileSnapshot(
  event: SignalEnvelope | HelloAck
): SpaceTranscriptItem["profile"] {
  const rawProfile = isSignalEnvelope(event) ? event.profile : null;
  const rawProfileRecord =
    rawProfile && typeof rawProfile === "object"
      ? (rawProfile as Record<string, unknown>)
      : null;
  const profileName = sanitizeTerminalDisplayText(
    rawProfile?.profileName,
    "single-line"
  ).trim();
  const normalizedOwner = resolveNormalizedOwnerFields({
    ownerUserId:
      typeof rawProfileRecord?.ownerUserId === "string"
        ? rawProfileRecord.ownerUserId
        : undefined,
    ownerName: rawProfile?.ownerName,
    owner:
      typeof rawProfileRecord?.owner === "string"
        ? rawProfileRecord.owner
        : undefined,
  });
  return {
    kind:
      rawProfile?.kind === "human" ||
      rawProfile?.kind === "agent" ||
      rawProfile?.kind === "system"
        ? rawProfile.kind
        : "unknown",
    profileId: normalizeTranscriptActorProfileId(rawProfile ?? undefined),
    profileName: profileName || "unknown",
    ownerUserId: normalizedOwner.ownerUserId ?? null,
    ownerName: normalizedOwner.ownerName ?? null,
    agentControllerRef:
      sanitizeTerminalDisplayText(
        typeof rawProfileRecord?.agentControllerRef === "string"
          ? rawProfileRecord.agentControllerRef
          : rawProfile?.agentControllerRef,
        "single-line"
      ).trim() || null,
  };
}

function resolveTranscriptItemSystemPurpose(
  event: SignalEnvelope | HelloAck
): string | null {
  if (!isSignalEnvelope(event)) {
    return null;
  }
  if (event.type === "signal.text") {
    const meta = resolveSignalTextMetaFromEnvelope(event);
    return typeof meta?.purpose === "string" ? meta.purpose : null;
  }
  if (event.type === "signal.system_notice") {
    const noticeType =
      event.data && typeof event.data.noticeType === "string"
        ? event.data.noticeType.trim()
        : "";
    return noticeType
      ? `signal.system_notice:${noticeType}`
      : "signal.system_notice";
  }
  return null;
}

function resolveTranscriptActorKind(
  kind: unknown
): SpaceTranscriptItem["actorKind"] {
  return kind === "human" || kind === "agent" ? kind : "unknown";
}

function resolveTranscriptActorAvatar(kind: unknown): string {
  if (kind === "agent") {
    return PRESENCE_AGENT_AVATAR;
  }
  return PRESENCE_HUMAN_AVATAR;
}

function resolveTranscriptActorLabel(
  profileIdentity: SignalEnvelope["profile"] | undefined
): string {
  const label = sanitizeTerminalDisplayText(
    profileIdentity?.profileName,
    "single-line"
  ).trim();
  return label || "unknown";
}

function normalizeTranscriptActorProfileId(
  profileIdentity: SignalEnvelope["profile"] | undefined
): string {
  return sanitizeTerminalDisplayText(
    profileIdentity?.profileId,
    "single-line"
  ).trim();
}
