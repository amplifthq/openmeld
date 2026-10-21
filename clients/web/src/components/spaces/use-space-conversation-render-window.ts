import { useCallback, useMemo, useState } from "react";
import type { SpaceConversationEntry } from "#/lib/spaces/presentation";

/**
 * Entries mounted when a conversation opens. Mounting every loaded entry made
 * a cached Space switch render and lay out its whole retained history in one
 * frame; the latest entries fill any viewport.
 */
export const SPACE_CONVERSATION_INITIAL_RENDERED_ENTRIES = 40;
/** Older entries mounted each time the reader nears the top. */
export const SPACE_CONVERSATION_RENDER_WINDOW_STEP = 30;
/** Context kept above an entry that must be mounted, such as a jump target. */
const REQUIRED_ENTRY_LEADING_CONTEXT = 5;

type RenderWindowPin = {
	/** Resets the window for a different conversation or history window. */
	scopeKey: string;
	/** First signal of the first mounted entry; stable across appends. */
	firstSignalId: string;
	/** Mounted from the oldest loaded entry, so prepended history mounts too. */
	followsStart: boolean;
};

export type SpaceConversationRenderWindow = {
	/** True when loaded entries above the window are not mounted yet. */
	hasHiddenEntries: boolean;
	/** True when this loaded signal belongs to an entry above the window. */
	isHiddenSignal: (signalId: string) => boolean;
	/** Mounts the next older step. Returns false when nothing is hidden. */
	revealEarlier: () => boolean;
	/** Mounts entries down to this loaded signal. Returns false if not needed. */
	revealSignal: (signalId: string) => boolean;
	/** Index of the first mounted entry. */
	startIndex: number;
};

/**
 * Mounts a window of the newest conversation entries and grows it toward
 * older history on demand, without unmounting anything that was mounted.
 *
 * The window is anchored to a signal, not a count, so live appends never
 * unmount the reader's rows. Growing it prepends DOM, which the message
 * scroller already compensates for exactly like loading an earlier page.
 * Required signals (a saved reading anchor, a linked message) are always
 * mounted in the same render, so restoration and focus never miss them.
 */
export function useSpaceConversationRenderWindow(input: {
	entries: readonly SpaceConversationEntry[];
	requiredSignalIds: readonly (string | null | undefined)[];
	scopeKey: string;
}): SpaceConversationRenderWindow {
	const entryIndexBySignalId = useMemo(
		() => indexConversationEntrySignals(input.entries),
		[input.entries]
	);
	const [pin, setPin] = useState<RenderWindowPin | null>(null);
	const pinnedIndex =
		pin?.scopeKey === input.scopeKey
			? entryIndexBySignalId.get(pin.firstSignalId)
			: undefined;
	let startIndex = Math.max(
		0,
		input.entries.length - SPACE_CONVERSATION_INITIAL_RENDERED_ENTRIES
	);
	if (pinnedIndex !== undefined) {
		startIndex = pin?.followsStart ? 0 : pinnedIndex;
	}
	for (const signalId of input.requiredSignalIds) {
		const index = signalId ? entryIndexBySignalId.get(signalId) : undefined;
		if (index !== undefined) {
			startIndex = Math.min(
				startIndex,
				Math.max(0, index - REQUIRED_ENTRY_LEADING_CONTEXT)
			);
		}
	}
	const nextPin = resolveRenderWindowPin({
		entries: input.entries,
		scopeKey: input.scopeKey,
		startIndex,
	});
	if (nextPin && !isSameRenderWindowPin(pin, nextPin)) {
		// Adjusting state from the previous render: React re-runs this
		// component before rendering children, so no extra commit happens.
		setPin(nextPin);
	}

	const revealFrom = useCallback(
		(nextStartIndex: number) => {
			const revealedPin = resolveRenderWindowPin({
				entries: input.entries,
				scopeKey: input.scopeKey,
				startIndex: nextStartIndex,
			});
			if (revealedPin) {
				setPin(revealedPin);
			}
		},
		[input.entries, input.scopeKey]
	);
	const revealEarlier = useCallback(() => {
		if (startIndex === 0) {
			return false;
		}
		revealFrom(Math.max(0, startIndex - SPACE_CONVERSATION_RENDER_WINDOW_STEP));
		return true;
	}, [revealFrom, startIndex]);
	const revealSignal = useCallback(
		(signalId: string) => {
			const index = entryIndexBySignalId.get(signalId);
			if (index === undefined || index >= startIndex) {
				return false;
			}
			revealFrom(Math.max(0, index - REQUIRED_ENTRY_LEADING_CONTEXT));
			return true;
		},
		[entryIndexBySignalId, revealFrom, startIndex]
	);
	const isHiddenSignal = useCallback(
		(signalId: string) => {
			const index = entryIndexBySignalId.get(signalId);
			return index !== undefined && index < startIndex;
		},
		[entryIndexBySignalId, startIndex]
	);
	return {
		hasHiddenEntries: startIndex > 0,
		isHiddenSignal,
		revealEarlier,
		revealSignal,
		startIndex,
	};
}

function resolveRenderWindowPin(input: {
	entries: readonly SpaceConversationEntry[];
	scopeKey: string;
	startIndex: number;
}): RenderWindowPin | null {
	const entry = input.entries[input.startIndex];
	if (!entry) {
		return null;
	}
	return {
		firstSignalId: resolveConversationEntrySignalIds(entry)[0] ?? "",
		followsStart: input.startIndex === 0,
		scopeKey: input.scopeKey,
	};
}

function isSameRenderWindowPin(
	left: RenderWindowPin | null,
	right: RenderWindowPin
): boolean {
	return (
		left?.scopeKey === right.scopeKey &&
		left.firstSignalId === right.firstSignalId &&
		left.followsStart === right.followsStart
	);
}

function indexConversationEntrySignals(
	entries: readonly SpaceConversationEntry[]
): ReadonlyMap<string, number> {
	const indexBySignalId = new Map<string, number>();
	entries.forEach((entry, index) => {
		for (const signalId of resolveConversationEntrySignalIds(entry)) {
			if (!indexBySignalId.has(signalId)) {
				indexBySignalId.set(signalId, index);
			}
		}
	});
	return indexBySignalId;
}

/** The first id is the entry's own; a compaction marker also names its source. */
function resolveConversationEntrySignalIds(
	entry: SpaceConversationEntry
): readonly string[] {
	if (entry.kind === "system_event") {
		return [entry.item.id];
	}
	if (entry.kind === "conversation_compaction") {
		return [entry.id, entry.sourceSignalId];
	}
	return entry.run.items.map((item) => item.id);
}
