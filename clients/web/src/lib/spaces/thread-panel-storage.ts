import {
	readBrowserPreference,
	removeBrowserPreference,
	writeBrowserPreference,
} from "./browser-preference-storage";

export function readSpaceThreadPanelSelection(input: {
	spaceId: string;
}): string | null {
	const storageKey = resolveSpaceThreadPanelSelectionStorageKey(input);
	const rawValue = readBrowserPreference(storageKey);
	if (rawValue === null) {
		return null;
	}

	const threadId = rawValue.trim();
	if (threadId) {
		return threadId;
	}

	console.warn("Ignoring invalid space Thread panel storage entry.", {
		storageKey,
	});
	removeBrowserPreference(storageKey);
	return null;
}

export function writeSpaceThreadPanelSelection(input: {
	spaceId: string;
	threadId: string;
}) {
	const threadId = input.threadId.trim();
	if (!threadId) {
		throw new Error("Space Thread panel storage requires a Thread id.");
	}

	writeBrowserPreference(
		resolveSpaceThreadPanelSelectionStorageKey(input),
		threadId
	);
}

export function clearSpaceThreadPanelSelection(input: { spaceId: string }) {
	removeBrowserPreference(resolveSpaceThreadPanelSelectionStorageKey(input));
}

export function resolveSpaceThreadPanelSelectionStorageKey(input: {
	spaceId: string;
}): string {
	const spaceId = input.spaceId.trim();
	if (!spaceId) {
		throw new Error("Space Thread panel storage requires a Space id.");
	}

	return `openmeld.space.thread-panel.active-thread:${spaceId}`;
}
