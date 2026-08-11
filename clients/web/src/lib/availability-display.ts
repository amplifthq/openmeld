// One vocabulary for the availability words users see. Surface-specific
// mappers (wake availability, execution targets, presence badges, execution
// status rows) switch on their own server enums but must pick display words
// from here, so the same fact never renders different words on different
// pages. The canonical per-availability copy (badgeLabel/tooltip/summary)
// still comes from @openmeld/agent-runtime; this list only
// covers words that web-side mappers spell out themselves.
export const AVAILABILITY_DISPLAY_LABELS = {
	available: "Available",
	availableForWake: "Available for Wake",
	blocked: "Blocked",
	checking: "Checking",
	live: "Live",
	needsRepair: "Needs repair",
	offline: "Offline",
	partial: "Partial",
	unavailable: "Unavailable",
	unknown: "Unknown",
} as const;
