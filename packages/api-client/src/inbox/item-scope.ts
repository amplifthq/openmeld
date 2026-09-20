import type { InboxItem } from "@openmeld/schemas/types";

/** Response-scope validation only. Core still owns recipient/source access. */
export function isInboxItemInOrganizationScope(
  item: Pick<InboxItem, "organizationId" | "sourceTarget">,
  organizationId: string
): boolean {
  if (item.organizationId !== null) {
    return item.organizationId === organizationId;
  }
  return (
    item.sourceTarget.kind === "computer_connection" ||
    item.sourceTarget.kind === "desktop_update"
  );
}
