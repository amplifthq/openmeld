export type SpaceConversationPosition = {
	anchorSignalId: string;
	offsetFromVisibleTop: number;
};

const SPACE_CONVERSATION_POSITION_PREFIX =
	"openmeld:space-conversation-position:v2:";
const SAVED_POSITION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function readSpaceConversationPosition(
	key: string
): SpaceConversationPosition | null {
	try {
		let raw = window.sessionStorage.getItem(
			`${SPACE_CONVERSATION_POSITION_PREFIX}${key}`
		);
		if (!raw) {
			const saved = window.localStorage.getItem(
				`${SPACE_CONVERSATION_POSITION_PREFIX}${key}`
			);
			if (saved) {
				const record = JSON.parse(saved) as {
					savedAt?: number;
					position?: SpaceConversationPosition;
				};
				if (
					typeof record.savedAt === "number" &&
					Date.now() - record.savedAt < SAVED_POSITION_MAX_AGE_MS
				) {
					raw = JSON.stringify(record.position);
				}
			}
		}
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
	try {
		window.localStorage.setItem(
			`${SPACE_CONVERSATION_POSITION_PREFIX}${key}`,
			JSON.stringify({ savedAt: Date.now(), position })
		);
	} catch {
		// Session-local restoration still works when durable storage is unavailable.
	}
}

export function clearSpaceConversationPositions(suffix?: string): void {
	for (const storageName of ["sessionStorage", "localStorage"] as const) {
		try {
			const storage = window[storageName];
			for (const key of Object.keys(storage)) {
				if (
					key.startsWith(SPACE_CONVERSATION_POSITION_PREFIX) &&
					(!suffix || key.endsWith(suffix))
				) {
					storage.removeItem(key);
				}
			}
		} catch {
			/* Storage availability must not block the auth boundary. */
		}
	}
}
