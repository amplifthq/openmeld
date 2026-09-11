import type { InboxItem } from "@openmeld/schemas/types";
import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";

export function resolveInboxItemIndicator(item: InboxItem) {
	if (
		item.attention === "action_required" &&
		item.resolutionStatus === "open"
	) {
		return "danger";
	}
	if (item.readAt !== null) {
		return null;
	}
	if (item.importance === "urgent" && item.resolutionStatus === "open") {
		return "warning";
	}
	return "unread";
}

export function resolveInboxAttentionLabel(
	tone: "danger" | "warning" | null | undefined
) {
	if (tone === "danger") {
		return "Needs action";
	}
	if (tone === "warning") {
		return "Urgent updates";
	}
	return null;
}

export function resolveInboxIndicatorClassName(
	tone: "danger" | "warning" | null | undefined
) {
	return tone
		? resolveStatusToneIndicatorClassName(tone, "solid")
		: "bg-unread";
}

export function resolveInboxAttentionTone(input: {
	unresolvedActionCount?: number;
	unreadUrgentUpdateCount?: number;
}): "danger" | "warning" | null {
	if ((input.unresolvedActionCount ?? 0) > 0) {
		return "danger";
	}
	if ((input.unreadUrgentUpdateCount ?? 0) > 0) {
		return "warning";
	}
	return null;
}
