import type { InboxVisibleConversation } from "@openmeld/schemas";
import type {
  InboxConversationNotificationMode,
  InboxItem,
} from "@openmeld/schemas/types";

/** Same rendered conversation projection in Web and native delivery. */
export function isInboxItemVisibleConversation(
  item: InboxItem,
  conversation: InboxVisibleConversation | null
): boolean {
  if (!conversation) {
    return false;
  }
  const target = item.sourceTarget;
  if (target.kind === "center_agent") {
    return (
      target.spaceId === conversation.spaceId &&
      conversation.threadRootSignalId === null
    );
  }
  if (target.kind === "space") {
    return (
      target.spaceId === conversation.spaceId &&
      (target.threadRootSignalId ?? null) === conversation.threadRootSignalId
    );
  }
  if (target.kind === "agent_interaction") {
    return (
      target.threadRootSignalId !== undefined &&
      target.spaceId === conversation.spaceId &&
      target.threadRootSignalId === conversation.threadRootSignalId
    );
  }
  return false;
}

/** Client delivery policy over Core facts; never an Inbox writer. */
export function inboxMessageNotificationSpaceId(
  item: InboxItem
): string | undefined {
  if (item.attention !== "update") {
    return undefined;
  }
  if (
    item.sourceTarget.kind !== "space" &&
    item.sourceTarget.kind !== "center_agent"
  ) {
    return undefined;
  }
  if (
    ![
      "space_message",
      "space_mention",
      "agent_reply",
      "wake_outcome",
      "center_agent_update",
    ].includes(item.kind)
  ) {
    return undefined;
  }
  return item.sourceTarget.spaceId;
}

function isDirectMessageRecipient(item: InboxItem): boolean {
  return item.sourceFacts
    ? item.sourceFacts.recipientReasons.includes("direct_message")
    : item.sourceTarget.kind === "center_agent";
}

function isLegacyOwnerObservation(item: InboxItem): boolean {
  return (
    !item.sourceFacts &&
    item.attention === "update" &&
    item.sourceTarget.kind === "space" &&
    item.sourceTarget.agentOwnerActivity === true &&
    item.sourceTarget.replyToRecipient !== true &&
    (item.kind === "space_message" || item.kind === "agent_reply")
  );
}

export function isInboxNotificationEligible(
  item: InboxItem,
  mode: InboxConversationNotificationMode = "mentions_and_replies"
): boolean {
  if (
    item.resolutionStatus === "resolved" ||
    item.sourceTarget.kind === "desktop_update"
  ) {
    return false;
  }
  // Pre-facts owner observations may arrive from a delayed old outbox. The
  // retired urgent flag and directMessage marker do not make them direct alerts.
  if (isLegacyOwnerObservation(item)) {
    return false;
  }
  const ownerOnly =
    item.sourceFacts?.recipientReasons.every(
      (reason) => reason === "agent_owner"
    ) === true;
  const firstContact =
    (item.sourceFacts?.firstContactAgentProfileIds?.length ?? 0) > 0;
  if (
    ownerOnly &&
    item.attention === "update" &&
    !firstContact &&
    item.importance !== "urgent"
  ) {
    return false;
  }
  if (inboxMessageNotificationSpaceId(item)) {
    if (mode === "muted") {
      return false;
    }
    if (mode === "all_messages") {
      return true;
    }
    if (isDirectMessageRecipient(item)) {
      return true;
    }
  }
  if (item.importance === "urgent") {
    return true;
  }
  if (firstContact) {
    return true;
  }
  if (
    item.attention === "action_required" &&
    item.resolutionStatus === "open"
  ) {
    return true;
  }
  return (
    item.kind === "space_mention" ||
    item.kind === "agent_reply" ||
    item.kind === "wake_outcome" ||
    (item.kind === "space_message" &&
      item.sourceTarget.kind === "space" &&
      (item.sourceTarget.directMessage === true ||
        item.sourceTarget.replyToRecipient === true))
  );
}
