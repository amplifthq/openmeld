import type { InboxItem } from "@openmeld/schemas/types";
import { resolveStatusToneIndicatorClassName } from "@openmeld/ui/lib/status-tone";

export function resolveInboxItemIndicator(item: InboxItem) {
	if (
		item.attention === "action_required" &&
		item.resolutionStatus === "open"
	) {
		return "warning";
	}
	if (item.readAt !== null) {
		return null;
	}
	if (
		item.attention === "update" &&
		(item.importance === "urgent" ||
			(item.sourceFacts?.firstContactAgentProfileIds?.length ?? 0) > 0)
	) {
		return "warning";
	}
	return "unread";
}

export function resolveInboxAttentionLabel(
	tone: "danger" | "warning" | null | undefined
) {
	if (tone === "danger") {
		return "Error";
	}
	if (tone === "warning") {
		return "Priority attention";
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
}): "warning" | null {
	if ((input.unresolvedActionCount ?? 0) > 0) {
		return "warning";
	}
	if ((input.unreadUrgentUpdateCount ?? 0) > 0) {
		return "warning";
	}
	return null;
}
