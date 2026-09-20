import type { InboxFeedCategory } from "@openmeld/schemas/types";

export const INBOX_TABS = [
	{ label: "All", view: "all" },
	{ label: "Mentions", view: "mentions" },
	{ label: "Needs action", view: "needs_action" },
	{ label: "Needs review", view: "needs_review" },
] as const satisfies readonly { label: string; view: InboxFeedCategory }[];
