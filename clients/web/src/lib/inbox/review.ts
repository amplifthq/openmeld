import type { InboxItem } from "@openmeld/schemas/types";

export function isInboxReview(item: InboxItem): boolean {
	return (
		item.attention === "action_required" &&
		item.resolutionStatus === "open" &&
		(item.sourceFacts?.requestCategory === "review" ||
			(!item.sourceFacts?.requestCategory &&
				(item.kind === "document_review" ||
					item.kind === "organization_request")))
	);
}
