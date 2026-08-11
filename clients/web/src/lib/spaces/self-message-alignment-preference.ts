export const SPACE_SELF_MESSAGE_ALIGNMENT_STORAGE_KEY =
	"openmeld.space.self-message-alignment";
export const SPACE_SELF_MESSAGE_ALIGNMENT_ATTRIBUTE =
	"data-space-self-message-alignment";

export type SpaceSelfMessageAlignment = "left" | "right";

export const DEFAULT_SPACE_SELF_MESSAGE_ALIGNMENT: SpaceSelfMessageAlignment =
	"right";

export function readSpaceSelfMessageAlignmentPreference(): SpaceSelfMessageAlignment {
	if (typeof window === "undefined") {
		return DEFAULT_SPACE_SELF_MESSAGE_ALIGNMENT;
	}

	const storedValue = window.localStorage.getItem(
		SPACE_SELF_MESSAGE_ALIGNMENT_STORAGE_KEY
	);
	if (!storedValue) {
		return DEFAULT_SPACE_SELF_MESSAGE_ALIGNMENT;
	}
	if (isSpaceSelfMessageAlignment(storedValue)) {
		return storedValue;
	}

	console.warn("Ignoring invalid Space self-message alignment preference.", {
		storageKey: SPACE_SELF_MESSAGE_ALIGNMENT_STORAGE_KEY,
		storedValue,
	});
	window.localStorage.removeItem(SPACE_SELF_MESSAGE_ALIGNMENT_STORAGE_KEY);
	return DEFAULT_SPACE_SELF_MESSAGE_ALIGNMENT;
}

export function writeSpaceSelfMessageAlignmentPreference(
	alignment: SpaceSelfMessageAlignment
): void {
	if (typeof window === "undefined") {
		return;
	}

	window.localStorage.setItem(
		SPACE_SELF_MESSAGE_ALIGNMENT_STORAGE_KEY,
		alignment
	);
	document.documentElement.setAttribute(
		SPACE_SELF_MESSAGE_ALIGNMENT_ATTRIBUTE,
		alignment
	);
}

function isSpaceSelfMessageAlignment(
	value: string
): value is SpaceSelfMessageAlignment {
	return value === "left" || value === "right";
}

export const SPACE_SELF_MESSAGE_ALIGNMENT_BOOTSTRAP_SCRIPT = `(() => {
	const root = document.documentElement;
	const attribute = ${JSON.stringify(SPACE_SELF_MESSAGE_ALIGNMENT_ATTRIBUTE)};
	const storageKey = ${JSON.stringify(SPACE_SELF_MESSAGE_ALIGNMENT_STORAGE_KEY)};
	const fallback = ${JSON.stringify(DEFAULT_SPACE_SELF_MESSAGE_ALIGNMENT)};
	try {
		const storedValue = window.localStorage.getItem(storageKey);
		const alignment = storedValue === "left" || storedValue === "right"
			? storedValue
			: fallback;
		root.setAttribute(attribute, alignment);
		if (storedValue && storedValue !== alignment) {
			console.warn("Ignoring invalid Space self-message alignment preference.", {
				storageKey,
				storedValue,
			});
			window.localStorage.removeItem(storageKey);
		}
	} catch (error) {
		root.setAttribute(attribute, fallback);
		console.warn("Failed to restore the Space self-message alignment preference.", error);
	}
})();`;
