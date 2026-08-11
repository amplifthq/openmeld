export const SPACE_CONVERSATION_LAYOUT_STORAGE_KEY =
	"openmeld.space.conversation-layout";
export const SPACE_CONVERSATION_LAYOUT_ATTRIBUTE =
	"data-space-conversation-layout";

export type SpaceConversationLayout = "centered" | "full-width";

export const DEFAULT_SPACE_CONVERSATION_LAYOUT: SpaceConversationLayout =
	"centered";

export function readSpaceConversationLayoutPreference(): SpaceConversationLayout {
	if (typeof window === "undefined") {
		return DEFAULT_SPACE_CONVERSATION_LAYOUT;
	}

	const storedValue = window.localStorage.getItem(
		SPACE_CONVERSATION_LAYOUT_STORAGE_KEY
	);
	if (!storedValue) {
		return DEFAULT_SPACE_CONVERSATION_LAYOUT;
	}
	if (isSpaceConversationLayout(storedValue)) {
		return storedValue;
	}

	console.warn("Ignoring invalid Space conversation layout preference.", {
		storageKey: SPACE_CONVERSATION_LAYOUT_STORAGE_KEY,
		storedValue,
	});
	window.localStorage.removeItem(SPACE_CONVERSATION_LAYOUT_STORAGE_KEY);
	return DEFAULT_SPACE_CONVERSATION_LAYOUT;
}

export function writeSpaceConversationLayoutPreference(
	layout: SpaceConversationLayout
): void {
	if (typeof window === "undefined") {
		return;
	}

	window.localStorage.setItem(SPACE_CONVERSATION_LAYOUT_STORAGE_KEY, layout);
	document.documentElement.setAttribute(
		SPACE_CONVERSATION_LAYOUT_ATTRIBUTE,
		layout
	);
}

function isSpaceConversationLayout(
	value: string
): value is SpaceConversationLayout {
	return value === "centered" || value === "full-width";
}

export const SPACE_CONVERSATION_LAYOUT_BOOTSTRAP_SCRIPT = `(() => {
	const root = document.documentElement;
	const attribute = ${JSON.stringify(SPACE_CONVERSATION_LAYOUT_ATTRIBUTE)};
	const storageKey = ${JSON.stringify(SPACE_CONVERSATION_LAYOUT_STORAGE_KEY)};
	const fallback = ${JSON.stringify(DEFAULT_SPACE_CONVERSATION_LAYOUT)};
	try {
		const storedValue = window.localStorage.getItem(storageKey);
		const layout = storedValue === "centered" || storedValue === "full-width"
			? storedValue
			: fallback;
		root.setAttribute(attribute, layout);
		if (storedValue && storedValue !== layout) {
			console.warn("Ignoring invalid Space conversation layout preference.", {
				storageKey,
				storedValue,
			});
			window.localStorage.removeItem(storageKey);
		}
	} catch (error) {
		root.setAttribute(attribute, fallback);
		console.warn("Failed to restore the Space conversation layout preference.", error);
	}
})();`;
