import type { SignalEnvelope } from "@openmeld/protocol";
import {
  INBOX_CONTEXT_LABEL_MAX_CHARS,
  INBOX_PREVIEW_MAX_CHARS,
  INBOX_TITLE_MAX_CHARS,
  inboxSourceCandidateSchema,
  sanitizeSignalTextPreview,
} from "@openmeld/schemas";
import type { InboxSourceCandidate } from "@openmeld/schemas/types";
import { truncateInboxText } from "../../inbox/application/inbox-text";
import type { SpaceInboxProjectionOutboxRecord } from "../infrastructure/sql/space-inbox-projection-outbox-repo";
import type { SpaceMemberRecord } from "../infrastructure/sql/space-member-repo";
import {
  isFormalSpaceUpdateSignal,
  resolveFormalSpaceUpdateActorName,
  resolveFormalSpaceUpdateActorProfileId,
  resolveFormalSpaceUpdatePreviewText,
} from "../rules/formal-space-update";
import { resolveSpaceInboxAgentAddressing } from "./space-inbox-agent-addressing";
import type { SignalPublishContext } from "./types";

const DEFAULT_SPACE_LABEL = "Space";
const DEFAULT_UPDATE_PREVIEW = "There is a new update in this Space.";

export function buildSpaceReactionInboxProjectionOutboxRecord(input: {
  actor: SpaceMemberRecord;
  author: SpaceMemberRecord | null;
  emoji: string;
  nowMs: number;
  organizationId: string;
  signal: Extract<SignalEnvelope, { type: "signal.text" }>;
  spaceName: string | null;
  threadRootSignalId?: string;
  version: number;
}): SpaceInboxProjectionOutboxRecord | null {
  const recipientUserId = input.author?.ownerUserIdSnapshot;
  if (
    !recipientUserId ||
    input.author?.status !== "active" ||
    input.author.profileKindSnapshot !== "human" ||
    recipientUserId === input.actor.ownerUserIdSnapshot
  ) {
    return null;
  }
  const sourceKey = `reaction:${input.signal.id}:${input.version}`;
  const candidate = inboxSourceCandidateSchema.parse({
    attention: "update",
    importance: "normal",
    kind: "space_message",
    occurredAtMs: input.nowMs,
    organizationId: input.organizationId,
    recipientUserId,
    contextLabel: truncateInboxText(
      input.spaceName || DEFAULT_SPACE_LABEL,
      INBOX_CONTEXT_LABEL_MAX_CHARS
    ),
    title: truncateInboxText(
      `${input.actor.profileNameSnapshot} reacted ${input.emoji} to your message`,
      INBOX_TITLE_MAX_CHARS
    ),
    preview: buildPreview(input.signal),
    sourceKind: "space_signal",
    sourceKey,
    sourceTarget: {
      kind: "space",
      spaceId: input.signal.spaceId,
      signalId: input.signal.id,
      ...(input.threadRootSignalId
        ? { threadRootSignalId: input.threadRootSignalId }
        : {}),
    },
  });
  return {
    attemptCount: 0,
    candidates: [candidate],
    completedAtMs: null,
    createdAtMs: input.nowMs,
    lastErrorCode: null,
    nextRetryAtMs: null,
    projectionId: sourceKey,
    signalId: input.signal.id,
    spaceId: input.signal.spaceId,
    status: "pending",
    updatedAtMs: input.nowMs,
  };
}

export function buildSpaceInboxProjectionOutboxRecord(input: {
  activeMemberRecords: readonly SpaceMemberRecord[];
  directMessage?: boolean;
  firstContactAgentProfileIds?: readonly string[];
  nowMs: number;
  organizationId: string;
  signal: SignalEnvelope;
  signalContext?: SignalPublishContext;
  spaceName: string | null;
  replyRecipientUserId?: string | null;
  threadParticipantProfileIds?: readonly string[];
  wakeRequesterUserId?: string | null;
}): SpaceInboxProjectionOutboxRecord | null {
  if (!isFormalSpaceUpdateSignal(input.signal)) {
    return null;
  }

  const signal = input.signal;
  const actorProfileId = resolveFormalSpaceUpdateActorProfileId(signal);
  const authorUserId = resolveHumanAuthorUserId(
    input.activeMemberRecords,
    actorProfileId
  );
  const mentionedProfileIds = resolveMentionedProfileIds(signal);
  const mentionedOwnerIds = resolveMentionedOwnerUserIds(
    input,
    mentionedProfileIds
  );
  const addressing = resolveSpaceInboxAgentAddressing(input);
  const spaceLabel = truncateInboxText(
    normalizeText(input.spaceName) ?? DEFAULT_SPACE_LABEL,
    INBOX_CONTEXT_LABEL_MAX_CHARS
  );
  const actorName =
    truncateInboxText(
      resolveFormalSpaceUpdateActorName(signal) ?? "Someone",
      INBOX_TITLE_MAX_CHARS
    ) || "Someone";
  const preview = buildPreview(signal);
  const explicitlyTargetedRecipientUserIds =
    resolveExplicitlyTargetedRecipientUserIds({
      activeMemberRecords: input.activeMemberRecords,
      directMessage: input.directMessage,
      mentionedOwnerIds,
      replyRecipientUserId: input.replyRecipientUserId ?? null,
    });
  const audience = resolveAudience({
    authorUserId,
    signal,
  });
  if (!audience) {
    return null;
  }
  // A Space membership is not a subscription to every conversation in it.
  const threadParticipantUserIds = resolveThreadParticipantUserIds(input);
  const isTerminalWakeFailure =
    signal.type === "signal.system_notice" &&
    signal.data.noticeType === "terminal_failure";
  const focusSignalId = resolveSpaceInboxFocusSignalId(signal);
  const memberRecordsByUserId = groupRecipientMemberRecords({
    activeMemberRecords: input.activeMemberRecords,
    allowedRecipientUserIds: restrictThreadAudience(
      threadParticipantUserIds,
      explicitlyTargetedRecipientUserIds,
      input.wakeRequesterUserId ?? null
    ),
    authorUserId,
    authorHasRead:
      signal.type === "signal.text" && signal.data.meta?.authorHasRead === true,
  });
  const candidates: InboxSourceCandidate[] = [];

  for (const recipientUserId of memberRecordsByUserId.keys()) {
    const isAuthor = recipientUserId === authorUserId;
    const isMention = !isAuthor && mentionedOwnerIds.has(recipientUserId);
    const kind = isMention ? "space_mention" : audience.kind;
    const isReplyRecipient =
      !(isMention || isAuthor) &&
      normalizeText(input.replyRecipientUserId) === recipientUserId;
    candidates.push(
      inboxSourceCandidateSchema.parse({
        attention: "update",
        contextLabel: spaceLabel,
        importance:
          isTerminalWakeFailure && recipientUserId === input.wakeRequesterUserId
            ? "urgent"
            : "normal",
        kind,
        occurredAtMs: Math.max(0, signal.ts),
        organizationId: requireText(input.organizationId, "organizationId"),
        preview,
        recipientUserId,
        sourceKey: requireText(signal.id, "signal.id"),
        sourceKind: "space_signal",
        sourceFacts: {
          version: 1,
          agentProfileIds: addressing.agentProfileIds,
          recipientReasons: humanRecipientReasons({
            isAuthor,
            isMention,
            isReplyRecipient,
            inThread: input.signalContext?.threadContext !== undefined,
            isRequester: recipientUserId === input.wakeRequesterUserId,
            directMessage: input.directMessage,
          }),
        },
        sourceTarget: {
          directMessage: input.directMessage,
          kind: "space",
          signalId: focusSignalId,
          spaceId: signal.spaceId,
          ...(isReplyRecipient && { replyToRecipient: true }),
          threadRootSignalId: input.signalContext?.threadContext?.rootSignalId,
        },
        title: buildTitle({
          actorName,
          isMention,
          isTerminalWakeFailure,
          isReplyRecipient,
          kind,
          spaceLabel,
        }),
      })
    );
  }

  candidates.push(
    ...buildOrganizationMentionCandidates({
      input,
      authorUserId,
      actorName,
      candidates,
      focusSignalId,
      signal,
    })
  );
  candidates.push(
    ...buildAgentOwnerCandidates(input, {
      signal,
      authorUserId,
      actorName,
      spaceLabel,
      preview,
      focusSignalId,
    })
  );
  if (candidates.length === 0) {
    return null;
  }
  return {
    attemptCount: 0,
    candidates,
    completedAtMs: null,
    createdAtMs: input.nowMs,
    lastErrorCode: null,
    nextRetryAtMs: null,
    projectionId: requireText(signal.id, "signal.id"),
    signalId: requireText(signal.id, "signal.id"),
    spaceId: requireText(signal.spaceId, "signal.spaceId"),
    status: "pending",
    updatedAtMs: input.nowMs,
  };
}

/** Non-members receive only the mention receipt, never the Space preview. */
function buildOrganizationMentionCandidates(context: {
  input: Parameters<typeof buildSpaceInboxProjectionOutboxRecord>[0];
  authorUserId: string | null;
  actorName: string;
  candidates: readonly InboxSourceCandidate[];
  focusSignalId: string;
  signal: SignalEnvelope;
}): InboxSourceCandidate[] {
  const { input, authorUserId, actorName, focusSignalId, signal } = context;
  const candidates: InboxSourceCandidate[] = [];
  const recipientIds = new Set(
    context.candidates.map((candidate) => candidate.recipientUserId)
  );
  for (const target of input.signalContext?.resolvedHumanMentions ?? []) {
    if (
      target.scope !== "organization" ||
      target.ownerUserId === authorUserId ||
      recipientIds.has(target.ownerUserId)
    ) {
      continue;
    }
    recipientIds.add(target.ownerUserId);
    candidates.push(
      inboxSourceCandidateSchema.parse({
        attention: "update",
        contextLabel: "Organization mention",
        importance: "normal",
        kind: "space_mention",
        occurredAtMs: Math.max(0, signal.ts),
        organizationId: input.organizationId,
        preview:
          "You were mentioned as an Organization member in a Space you had not joined. Opening it does not grant access.",
        recipientUserId: target.ownerUserId,
        sourceKey: signal.id,
        sourceKind: "space_signal",
        sourceFacts: {
          version: 1,
          recipientReasons: ["human_mention"],
          organizationMentionProfileId: target.profileId,
        },
        sourceTarget: {
          kind: "space",
          spaceId: signal.spaceId,
          signalId: focusSignalId,
        },
        title: truncateInboxText(
          `${actorName} mentioned you`,
          INBOX_TITLE_MAX_CHARS
        ),
      })
    );
  }
  return candidates;
}

function humanRecipientReasons(input: {
  isAuthor: boolean;
  isMention: boolean;
  isReplyRecipient: boolean;
  inThread: boolean;
  isRequester: boolean;
  directMessage?: boolean;
}): NonNullable<InboxSourceCandidate["sourceFacts"]>["recipientReasons"] {
  if (input.isAuthor) {
    return ["space_member"];
  }
  return [
    ...(input.isMention ? ["human_mention" as const] : []),
    ...(input.inThread && input.isReplyRecipient
      ? ["thread_reply" as const]
      : []),
    ...(input.isRequester ? ["requester" as const] : []),
    ...(input.directMessage ? ["direct_message" as const] : []),
    "space_member",
  ];
}

function resolveThreadParticipantUserIds(
  input: Parameters<typeof buildSpaceInboxProjectionOutboxRecord>[0]
): Set<string> | null {
  if (input.signalContext?.threadPlacement !== "thread") {
    return null;
  }
  return new Set(
    input.activeMemberRecords.flatMap((member) =>
      member.ownerUserIdSnapshot &&
      input.threadParticipantProfileIds?.includes(member.profileId)
        ? [member.ownerUserIdSnapshot]
        : []
    )
  );
}

function restrictThreadAudience(
  participants: ReadonlySet<string> | null,
  explicitlyTargetedRecipientUserIds: ReadonlySet<string>,
  requesterUserId: string | null
): ReadonlySet<string> | null {
  if (!participants) {
    return null;
  }
  return new Set([
    ...participants,
    ...explicitlyTargetedRecipientUserIds,
    ...(requesterUserId ? [requesterUserId] : []),
  ]);
}

function resolveSpaceInboxFocusSignalId(
  signal: Extract<
    SignalEnvelope,
    { type: "signal.status" | "signal.system_notice" | "signal.text" }
  >
): string {
  if (
    signal.type === "signal.system_notice" &&
    (signal.data.noticeType === "terminal_failure" ||
      signal.data.noticeType === "wake_stopped")
  ) {
    return normalizeText(signal.data.replyTo?.signalId) ?? signal.id;
  }
  return signal.id;
}

function groupRecipientMemberRecords(input: {
  activeMemberRecords: readonly SpaceMemberRecord[];
  allowedRecipientUserIds: ReadonlySet<string> | null;
  authorUserId: string | null;
  authorHasRead: boolean;
}): Map<string, SpaceMemberRecord[]> {
  const byUserId = new Map<string, SpaceMemberRecord[]>();
  for (const member of input.activeMemberRecords) {
    const userId = normalizeText(member.ownerUserIdSnapshot);
    if (
      member.status !== "active" ||
      member.profileKindSnapshot !== "human" ||
      !userId ||
      (userId === input.authorUserId && input.authorHasRead) ||
      (input.allowedRecipientUserIds !== null &&
        !input.allowedRecipientUserIds.has(userId))
    ) {
      continue;
    }
    const current = byUserId.get(userId) ?? [];
    current.push(member);
    byUserId.set(userId, current);
  }
  return byUserId;
}

function resolveHumanAuthorUserId(
  activeMemberRecords: readonly SpaceMemberRecord[],
  actorProfileId: string | null
): string | null {
  if (!actorProfileId) {
    return null;
  }
  const author = activeMemberRecords.find(
    (member) =>
      member.status === "active" &&
      member.profileKindSnapshot === "human" &&
      member.profileId === actorProfileId
  );
  return normalizeText(author?.ownerUserIdSnapshot);
}

function resolveMentionedProfileIds(signal: SignalEnvelope): Set<string> {
  if (signal.type !== "signal.text") {
    return new Set();
  }
  return new Set(signal.data.messageEnvelope?.mentionTargets ?? []);
}

function resolveAudience(input: {
  authorUserId: string | null;
  signal: Extract<
    SignalEnvelope,
    { type: "signal.status" | "signal.system_notice" | "signal.text" }
  >;
}): {
  kind: InboxSourceCandidate["kind"];
} | null {
  if (
    input.signal.type === "signal.text" &&
    input.signal.profile.kind === "human"
  ) {
    // Attribution must resolve to a current Human owner before projection.
    return input.authorUserId ? { kind: "space_message" } : null;
  }
  if (input.signal.type === "signal.text") {
    return {
      kind:
        input.signal.profile.kind === "agent" ? "agent_reply" : "space_message",
    };
  }
  if (
    input.signal.type === "signal.status" &&
    input.signal.data.status === "working"
  ) {
    return null;
  }
  return { kind: "wake_outcome" };
}

function resolveMentionedOwnerUserIds(
  input: Parameters<typeof buildSpaceInboxProjectionOutboxRecord>[0],
  mentionedProfileIds: ReadonlySet<string>
): Set<string> {
  const owners = new Set(
    input.signalContext?.resolvedHumanMentions?.map(
      (target) => target.ownerUserId
    ) ?? []
  );
  for (const member of input.activeMemberRecords) {
    if (
      member.status === "active" &&
      member.profileKindSnapshot === "human" &&
      member.ownerUserIdSnapshot &&
      mentionedProfileIds.has(member.profileId)
    ) {
      owners.add(member.ownerUserIdSnapshot);
    }
  }
  return owners;
}
function resolveExplicitlyTargetedRecipientUserIds(input: {
  directMessage?: boolean;
  activeMemberRecords: readonly SpaceMemberRecord[];
  mentionedOwnerIds: ReadonlySet<string>;
  replyRecipientUserId: string | null;
}): Set<string> {
  const recipientUserIds = new Set(input.mentionedOwnerIds);
  const replyRecipientUserId = normalizeText(input.replyRecipientUserId);
  if (replyRecipientUserId) {
    recipientUserIds.add(replyRecipientUserId);
  }
  for (const member of input.activeMemberRecords) {
    const ownerUserId = normalizeText(member.ownerUserIdSnapshot);
    if (
      member.status === "active" &&
      member.profileKindSnapshot === "human" &&
      ownerUserId &&
      input.directMessage
    ) {
      recipientUserIds.add(ownerUserId);
    }
  }
  return recipientUserIds;
}

function buildTitle(input: {
  actorName: string;
  isMention: boolean;
  isTerminalWakeFailure: boolean;
  isReplyRecipient: boolean;
  kind: InboxSourceCandidate["kind"];
  spaceLabel: string;
}): string {
  if (input.isMention) {
    return truncateInboxText(
      `${input.actorName} mentioned you in ${input.spaceLabel}`,
      INBOX_TITLE_MAX_CHARS
    );
  }
  if (input.isReplyRecipient) {
    return truncateInboxText(
      `${input.actorName} replied to you in ${input.spaceLabel}`,
      INBOX_TITLE_MAX_CHARS
    );
  }
  if (input.isTerminalWakeFailure) {
    return truncateInboxText(
      `Agent couldn't finish in ${input.spaceLabel}`,
      INBOX_TITLE_MAX_CHARS
    );
  }
  if (input.kind === "wake_outcome") {
    return truncateInboxText(
      `Agent update in ${input.spaceLabel}`,
      INBOX_TITLE_MAX_CHARS
    );
  }
  if (input.kind === "agent_reply") {
    return truncateInboxText(
      `${input.actorName} replied in ${input.spaceLabel}`,
      INBOX_TITLE_MAX_CHARS
    );
  }
  return truncateInboxText(
    `New message in ${input.spaceLabel}`,
    INBOX_TITLE_MAX_CHARS
  );
}

function buildPreview(
  signal: Extract<
    SignalEnvelope,
    { type: "signal.status" | "signal.system_notice" | "signal.text" }
  >
): string {
  const sourceText = resolveFormalSpaceUpdatePreviewText(signal);
  const sanitized = sourceText ? sanitizeSignalTextPreview(sourceText) : null;
  return truncateInboxText(
    normalizeText(sanitized) ?? DEFAULT_UPDATE_PREVIEW,
    INBOX_PREVIEW_MAX_CHARS
  );
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${field} is required for Space Inbox projection`);
  }
  return normalized;
}

function normalizeText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function buildAgentOwnerCandidates(
  input: Parameters<typeof buildSpaceInboxProjectionOutboxRecord>[0],
  context: {
    signal: SignalEnvelope;
    authorUserId: string | null;
    actorName: string;
    spaceLabel: string;
    preview: string;
    focusSignalId: string;
  }
): InboxSourceCandidate[] {
  const {
    signal,
    authorUserId,
    actorName,
    spaceLabel,
    preview,
    focusSignalId,
  } = context;
  if (signal.type !== "signal.text") {
    return [];
  }
  const isAgentReply = signal.profile.kind === "agent";
  if (!(isAgentReply || (signal.profile.kind === "human" && authorUserId))) {
    return [];
  }
  const addressing = resolveSpaceInboxAgentAddressing(input);
  let title = input.directMessage
    ? `${actorName} messaged your agent`
    : `${actorName} addressed your agent in ${spaceLabel}`;
  if (isAgentReply) {
    title = `${actorName} replied in ${spaceLabel}`;
  }
  const candidates: InboxSourceCandidate[] = [];
  // Candidate eligibility is resolved against current Agent identity before delivery.
  // Keep ordinary recipients too; the outbox selects one item per recipient.
  const agentsByOwner = new Map<string, string[]>();
  for (const member of input.activeMemberRecords) {
    if (
      member.status !== "active" ||
      member.profileKindSnapshot !== "agent" ||
      !member.ownerUserIdSnapshot ||
      member.ownerUserIdSnapshot === authorUserId ||
      !addressing.agentProfileIds.includes(member.profileId)
    ) {
      continue;
    }
    const ids = agentsByOwner.get(member.ownerUserIdSnapshot) ?? [];
    ids.push(member.profileId);
    agentsByOwner.set(member.ownerUserIdSnapshot, ids);
  }
  const threadParticipants = resolveThreadParticipantUserIds(input);
  for (const [recipientUserId, personalAgentProfileIds] of agentsByOwner) {
    const mentionedAgentProfileIds = personalAgentProfileIds
      .filter((id) =>
        addressing.explicitlyAddressedAgentProfileIds.includes(id)
      )
      .sort();
    if (
      threadParticipants &&
      !threadParticipants.has(recipientUserId) &&
      mentionedAgentProfileIds.length === 0 &&
      !input.directMessage
    ) {
      continue;
    }
    const firstContactAgentProfileIds = personalAgentProfileIds
      .filter(
        (id) =>
          addressing.initiatingAgentProfileIds.includes(id) &&
          input.firstContactAgentProfileIds?.includes(id)
      )
      .sort();
    candidates.push(
      inboxSourceCandidateSchema.parse({
        attention: "update",
        importance: "normal",
        kind: isAgentReply ? "agent_reply" : "space_message",
        contextLabel: spaceLabel,
        organizationId: input.organizationId,
        recipientUserId,
        sourceKey: signal.id,
        sourceKind: "space_signal",
        sourceFacts: {
          version: 1,
          agentProfileIds: addressing.agentProfileIds,
          personalAgentProfileIds: personalAgentProfileIds.sort(),
          mentionedAgentProfileIds,
          firstContactAgentProfileIds,
          recipientReasons: ["agent_owner"],
        },
        occurredAtMs: Math.max(0, signal.ts),
        preview,
        title: truncateInboxText(title, INBOX_TITLE_MAX_CHARS),
        sourceTarget: {
          kind: "space",
          agentOwnerActivity: true,
          spaceId: signal.spaceId,
          signalId: focusSignalId,
          directMessage: input.directMessage,
          ...(input.signalContext?.threadContext?.rootSignalId
            ? {
                threadRootSignalId:
                  input.signalContext.threadContext.rootSignalId,
              }
            : {}),
        },
      })
    );
  }
  return candidates;
}
