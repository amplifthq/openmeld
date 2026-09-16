import type { InboxVisibleConversation } from "@openmeld/schemas";
import type { InboxItem } from "@openmeld/schemas/types";

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
export function isInboxNotificationEligible(item: InboxItem): boolean {
  if (item.resolutionStatus === "resolved") {
    return false;
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
      item.sourceTarget.directMessage === true)
  );
}
