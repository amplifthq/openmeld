import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

type TutorialTimelineItem = Pick<
	SpaceTimelineItem,
	| "id"
	| "actorProfileId"
	| "deliveryState"
	| "isAgentFinalReply"
	| "agentStreamState"
	| "replyToSignalId"
	| "wakeSourceSignalId"
	| "wakeTargetProfileIds"
>;

export function hasTutorialReply(input: {
	items: readonly TutorialTimelineItem[];
	centerId: string;
	profileId: string;
}): boolean {
	const sentMessages = new Set(
		input.items
			.filter(
				(item) =>
					item.actorProfileId === input.profileId &&
					item.deliveryState === "sent" &&
					item.wakeTargetProfileIds.includes(input.centerId)
			)
			.map((item) => item.id)
	);
	return input.items.some(
		(item) =>
			item.actorProfileId === input.centerId &&
			item.deliveryState === "sent" &&
			item.isAgentFinalReply &&
			!item.agentStreamState &&
			((item.replyToSignalId !== null &&
				sentMessages.has(item.replyToSignalId)) ||
				(item.wakeSourceSignalId !== null &&
					sentMessages.has(item.wakeSourceSignalId)))
	);
}
