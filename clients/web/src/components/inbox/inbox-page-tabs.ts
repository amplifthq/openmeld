import type { InboxFeedCategory } from "@openmeld/schemas/types";

export const INBOX_TABS = [
	{ label: "To do", view: "todo" },
	{ label: "Activity", view: "all" },
	{ label: "Mentions", view: "mentions" },
	{ label: "Needs action", view: "needs_action" },
	{ label: "Needs review", view: "needs_review" },
] as const satisfies readonly { label: string; view: InboxFeedCategory }[];
