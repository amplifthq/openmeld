export type SpaceConversationPosition = {
	anchorSignalId: string;
	offsetFromVisibleTop: number;
};

const SPACE_CONVERSATION_POSITION_PREFIX =
	"openmeld:space-conversation-position:v2:";

export function readSpaceConversationPosition(
	key: string
): SpaceConversationPosition | null {
	try {
		const raw = window.sessionStorage.getItem(
			`${SPACE_CONVERSATION_POSITION_PREFIX}${key}`
		);
		if (!raw) {
			return null;
		}
		const value = JSON.parse(raw) as Partial<SpaceConversationPosition>;
		return typeof value.anchorSignalId === "string" &&
			typeof value.offsetFromVisibleTop === "number" &&
			Number.isFinite(value.offsetFromVisibleTop)
			? {
					anchorSignalId: value.anchorSignalId,
					offsetFromVisibleTop: value.offsetFromVisibleTop,
				}
			: null;
	} catch {
		return null;
	}
}

export function writeSpaceConversationPosition(
	key: string,
	position: SpaceConversationPosition
): void {
	try {
		window.sessionStorage.setItem(
			`${SPACE_CONVERSATION_POSITION_PREFIX}${key}`,
			JSON.stringify(position)
		);
	} catch {
		// Scroll memory is an enhancement; locked-down storage must not block chat.
	}
}
