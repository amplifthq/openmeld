import type { SignalEnvelope } from "@openmeld/protocol";
import {
  AGENT_REPLY_FINAL_PURPOSE,
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
import type { SignalPublishContext } from "./types";

const DEFAULT_SPACE_LABEL = "Space";
const DEFAULT_UPDATE_PREVIEW = "There is a new update in this Space.";

export function buildSpaceInboxProjectionOutboxRecord(input: {
  activeMemberRecords: readonly SpaceMemberRecord[];
  nowMs: number;
  organizationId: string;
  signal: SignalEnvelope;
  signalContext?: SignalPublishContext;
  spaceName: string | null;
  threadRootAuthorUserId?: string | null;
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
  const referencedProfileIds = resolveReferencedProfileIds(signal);
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
      referencedProfileIds,
      threadRootAuthorUserId: input.threadRootAuthorUserId ?? null,
    });
  const audience = resolveAudience({
    authorUserId,
    explicitlyTargetedRecipientUserIds,
    signal,
    wakeRequesterUserId: input.wakeRequesterUserId ?? null,
  });
  if (!audience) {
    return null;
  }
  const isTerminalWakeFailure =
    signal.type === "signal.system_notice" &&
    signal.data.noticeType === "terminal_failure";
  const memberRecordsByUserId = groupRecipientMemberRecords({
    activeMemberRecords: input.activeMemberRecords,
    allowedRecipientUserIds: audience.allowedRecipientUserIds,
    authorUserId,
  });
  const candidates: InboxSourceCandidate[] = [];

  for (const [recipientUserId, recipientMembers] of memberRecordsByUserId) {
    const isReference = recipientMembers.some((member) =>
      referencedProfileIds.has(member.profileId)
    );
    const kind = isReference ? "space_reference" : audience.kind;
    const isThreadRootAuthor =
      !isReference &&
      normalizeText(input.threadRootAuthorUserId) === recipientUserId;
    candidates.push(
      inboxSourceCandidateSchema.parse({
        attention: "update",
        contextLabel: spaceLabel,
        importance: isTerminalWakeFailure ? "urgent" : "normal",
        kind,
        occurredAtMs: Math.max(0, signal.ts),
        organizationId: requireText(input.organizationId, "organizationId"),
        preview,
        recipientUserId,
        sourceKey: requireText(signal.id, "signal.id"),
        sourceKind: "space_signal",
        sourceTarget: {
          kind: "space",
          signalId: signal.id,
          spaceId: signal.spaceId,
          ...(input.signalContext?.threadContext?.rootSignalId
            ? {
                threadRootSignalId:
                  input.signalContext.threadContext.rootSignalId,
              }
            : {}),
        },
        title: buildTitle({
          actorName,
          isReference,
          isTerminalWakeFailure,
          isThreadRootAuthor,
          kind,
          spaceLabel,
        }),
      })
    );
  }

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

function groupRecipientMemberRecords(input: {
  activeMemberRecords: readonly SpaceMemberRecord[];
  allowedRecipientUserIds: ReadonlySet<string> | null;
  authorUserId: string | null;
}): Map<string, SpaceMemberRecord[]> {
  const byUserId = new Map<string, SpaceMemberRecord[]>();
  for (const member of input.activeMemberRecords) {
    const userId = normalizeText(member.ownerUserIdSnapshot);
    if (
      member.status !== "active" ||
      member.profileKindSnapshot !== "human" ||
      !userId ||
      userId === input.authorUserId ||
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

function resolveReferencedProfileIds(signal: SignalEnvelope): Set<string> {
  if (signal.type !== "signal.text") {
    return new Set();
  }
  return new Set(signal.data.messageEnvelope?.referenceTargets ?? []);
}

function resolveAudience(input: {
  authorUserId: string | null;
  explicitlyTargetedRecipientUserIds: ReadonlySet<string>;
  signal: Extract<
    SignalEnvelope,
    { type: "signal.status" | "signal.system_notice" | "signal.text" }
  >;
  wakeRequesterUserId: string | null;
}): {
  allowedRecipientUserIds: ReadonlySet<string> | null;
  kind: InboxSourceCandidate["kind"];
} | null {
  if (
    input.signal.type === "signal.text" &&
    input.signal.profile.kind === "human"
  ) {
    // If the human author cannot be mapped to an active owner, notifying the
    // whole Space could notify the author as well. Fail closed.
    return input.authorUserId
      ? { allowedRecipientUserIds: null, kind: "space_message" }
      : null;
  }
  const wakeRequesterUserId = normalizeText(input.wakeRequesterUserId);
  if (
    input.signal.type === "signal.text" &&
    (input.signal.profile.kind === "agent" ||
      input.signal.data.meta?.purpose === AGENT_REPLY_FINAL_PURPOSE)
  ) {
    const recipientUserIds = new Set(input.explicitlyTargetedRecipientUserIds);
    if (wakeRequesterUserId) {
      recipientUserIds.add(wakeRequesterUserId);
    }
    if (recipientUserIds.size === 0) {
      return null;
    }
    return {
      allowedRecipientUserIds: recipientUserIds,
      kind: "agent_reply",
    };
  }
  if (!wakeRequesterUserId) {
    return null;
  }
  if (
    input.signal.type === "signal.system_notice" &&
    (input.signal.data.noticeType === "policy_blocked" ||
      input.signal.data.noticeType === "terminal_failure" ||
      input.signal.data.noticeType === "wake_stopped" ||
      input.signal.data.noticeType === "stay_silent")
  ) {
    return {
      allowedRecipientUserIds: new Set([wakeRequesterUserId]),
      kind: "wake_outcome",
    };
  }
  if (
    input.signal.type === "signal.status" &&
    input.signal.data.status !== "working"
  ) {
    return {
      allowedRecipientUserIds: new Set([wakeRequesterUserId]),
      kind: "wake_outcome",
    };
  }
  return null;
}

function resolveExplicitlyTargetedRecipientUserIds(input: {
  activeMemberRecords: readonly SpaceMemberRecord[];
  referencedProfileIds: ReadonlySet<string>;
  threadRootAuthorUserId: string | null;
}): Set<string> {
  const recipientUserIds = new Set<string>();
  const threadRootAuthorUserId = normalizeText(input.threadRootAuthorUserId);
  if (threadRootAuthorUserId) {
    recipientUserIds.add(threadRootAuthorUserId);
  }
  for (const member of input.activeMemberRecords) {
    const ownerUserId = normalizeText(member.ownerUserIdSnapshot);
    if (
      member.status === "active" &&
      member.profileKindSnapshot === "human" &&
      ownerUserId &&
      input.referencedProfileIds.has(member.profileId)
    ) {
      recipientUserIds.add(ownerUserId);
    }
  }
  return recipientUserIds;
}

function buildTitle(input: {
  actorName: string;
  isReference: boolean;
  isTerminalWakeFailure: boolean;
  isThreadRootAuthor: boolean;
  kind: InboxSourceCandidate["kind"];
  spaceLabel: string;
}): string {
  if (input.isReference) {
    return truncateInboxText(
      `${input.actorName} referenced you in ${input.spaceLabel}`,
      INBOX_TITLE_MAX_CHARS
    );
  }
  if (input.isThreadRootAuthor) {
    return truncateInboxText(
      `${input.actorName} replied to your thread in ${input.spaceLabel}`,
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
