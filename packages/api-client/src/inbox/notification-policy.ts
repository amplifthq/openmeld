import type { InboxItem } from "@openmeld/schemas/types";

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
