import { useSyncExternalStore } from "react";
import {
	readBrowserPreference,
	writeBrowserPreference,
} from "./browser-preference-storage";

const SEEN_EVENT = "openmeld:file-revision-seen";

export type FileReadScope = {
	organizationSlug?: string;
	profileId?: string;
	spaceId: string;
	fileId: string;
};

function storageKey(scope: FileReadScope): string {
	return `openmeld:file-revision-seen:${JSON.stringify([scope.organizationSlug ?? "", scope.profileId ?? "", scope.spaceId, scope.fileId])}`;
}

export function readSeenFileRevision(scope: FileReadScope): number {
	const value = Number(readBrowserPreference(storageKey(scope)));
	return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function markFileRevisionSeen(
	scope: FileReadScope,
	revision: number
): void {
	if (
		!(
			scope.profileId &&
			Number.isSafeInteger(revision) &&
			revision > readSeenFileRevision(scope)
		)
	) {
		return;
	}
	writeBrowserPreference(storageKey(scope), String(revision));
	window.dispatchEvent(new Event(SEEN_EVENT));
}

function subscribe(listener: () => void) {
	window.addEventListener("storage", listener);
	window.addEventListener(SEEN_EVENT, listener);
	return () => {
		window.removeEventListener("storage", listener);
		window.removeEventListener(SEEN_EVENT, listener);
	};
}

export function useSeenFileRevision(scope: FileReadScope): number {
	return useSyncExternalStore(
		subscribe,
		() => readSeenFileRevision(scope),
		() => 0
	);
}

export function hasUnseenPinnedFileUpdate(input: {
	pinnedAt: string;
	revisionCreatedAt: string;
	latestRevision: number;
	seenRevision: number;
}): boolean {
	return (
		input.latestRevision > input.seenRevision &&
		Date.parse(input.revisionCreatedAt) > Date.parse(input.pinnedAt)
	);
}
