import type { AccountSidebarPreferences } from "@openmeld/schemas";

// Personal organization of private chats. These settings never change access,
// execution, or the underlying Space identity.
export const EMPTY_CHAT_PREFERENCES: NonNullable<
	AccountSidebarPreferences["chats"]
> = {
	pinned: { sort: "manual", spaceIds: [] },
	spaces: { sort: "priority", spaceIds: [] },
	groups: [],
	archivedIds: [],
	titles: {},
};
