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

export function isInboxNotificationEligible(
  item: InboxItem,
  mode: InboxConversationNotificationMode = "mentions_and_replies"
): boolean {
  if (item.resolutionStatus === "resolved") {
    return false;
  }
  if (inboxMessageNotificationSpaceId(item)) {
    if (mode === "muted") {
      return false;
    }
    if (mode === "all_messages") {
      return true;
    }
  }
  if (item.importance === "urgent") {
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
