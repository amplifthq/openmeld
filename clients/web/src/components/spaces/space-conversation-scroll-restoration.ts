const SPACE_CONVERSATION_SCROLL_RESTORATION_PREFIX = "space-conversation";

export function buildSpaceConversationScrollRestorationId(
	spaceId: string
): string;
export function buildSpaceConversationScrollRestorationId(
	spaceId: undefined
): undefined;
export function buildSpaceConversationScrollRestorationId(
	spaceId: string | undefined
): string | undefined {
	return spaceId
		? `${SPACE_CONVERSATION_SCROLL_RESTORATION_PREFIX}:${spaceId}`
		: undefined;
}
