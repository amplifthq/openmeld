const SPACE_MEMBERS_PANEL_OPEN_VALUE = "open";
const SPACE_MEMBERS_PANEL_CLOSED_VALUE = "closed";

export function readSpaceMembersPanelOpen(input: {
	spaceId: string;
}): boolean | null {
	if (typeof window === "undefined") {
		return null;
	}

	const storageKey = resolveSpaceMembersPanelOpenStorageKey(input);
	const rawValue = window.localStorage.getItem(storageKey);
	if (!rawValue) {
		return null;
	}

	if (rawValue === SPACE_MEMBERS_PANEL_OPEN_VALUE) {
		return true;
	}

	if (rawValue === SPACE_MEMBERS_PANEL_CLOSED_VALUE) {
		return false;
	}

	console.warn("Ignoring invalid space members panel storage entry.", {
		storageKey,
	});
	window.localStorage.removeItem(storageKey);

	return null;
}

export function writeSpaceMembersPanelOpen(input: {
	open: boolean;
	spaceId: string;
}) {
	if (typeof window === "undefined") {
		return;
	}

	window.localStorage.setItem(
		resolveSpaceMembersPanelOpenStorageKey(input),
		input.open
			? SPACE_MEMBERS_PANEL_OPEN_VALUE
			: SPACE_MEMBERS_PANEL_CLOSED_VALUE
	);
}

export function resolveSpaceMembersPanelOpenStorageKey(input: {
	spaceId: string;
}): string {
	const spaceId = input.spaceId.trim();
	if (!spaceId) {
		throw new Error("Space members panel storage requires a space id.");
	}

	return `openmeld.space.members-panel.open:${spaceId}`;
}
