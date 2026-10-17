import type { AccountSidebarPreferences } from "@openmeld/schemas";
import type {
	Conversation,
	ConversationSection,
} from "./conversation-sidebar-model";

// The Center Agent is org-owned; the possessive only names the viewer's own
// private sessions. The name is the default Human Profile name, which the
// Account display name keeps in sync, so a rename updates it optimistically.
export function centerAgentEntryTitle(viewerName?: string | null): string {
	const name = viewerName?.trim();
	return name ? `${name}’s Center Agent` : "Center Agent";
}

export type CenterAgentSidebarEntries = {
	conversations: Conversation[];
	/** Maps every collapsed session Space to the entry row that represents it. */
	entryIdBySessionId: ReadonlyMap<string, string>;
};

// The viewer's active private Center Agent sessions share one sidebar entry.
// Archived sessions keep their own rows so the Archived filter still finds them.
// The entry keeps the session that already owns its saved position, so pins,
// groups and manual order survive when another session becomes the latest one.
export function collapseCenterAgentSessions(input: {
	conversations: readonly Conversation[];
	archivedIds: readonly string[];
	sections: readonly ConversationSection[];
	title: string;
}): CenterAgentSidebarEntries {
	const archived = new Set(input.archivedIds);
	const sessionsByAgent = new Map<string, Conversation[]>();
	const conversations: Conversation[] = [];
	for (const conversation of input.conversations) {
		if (
			conversation.kind === "direct-message" &&
			conversation.chat.session &&
			!archived.has(conversation.spaceId)
		) {
			const key = conversation.chat.centerAgentProfileId ?? "";
			sessionsByAgent.set(key, [
				...(sessionsByAgent.get(key) ?? []),
				conversation,
			]);
		} else {
			conversations.push(conversation);
		}
	}
	const savedOrder = input.sections.flatMap((section) => section.spaceIds);
	const entryIdBySessionId = new Map<string, string>();
	for (const sessions of sessionsByAgent.values()) {
		const latest = sessions.reduce((current, candidate) =>
			candidate.activity > current.activity ? candidate : current
		);
		if (latest.kind !== "direct-message") {
			continue;
		}
		const sessionIds = sessions.map((session) => session.spaceId);
		const entryId =
			savedOrder.find((id) => sessionIds.includes(id)) ?? latest.spaceId;
		for (const id of sessionIds) {
			entryIdBySessionId.set(id, entryId);
		}
		conversations.push({
			...latest,
			spaceId: entryId,
			title: input.title,
			sessionSpaceIds: sessionIds,
			sessionTitles: sessions.map((session) => session.title),
		});
	}
	return { conversations, entryIdBySessionId };
}

/** Combines per-Space evidence so the entry reflects all of its sessions. */
export function mergeBySidebarEntry<Value>(
	source: ReadonlyMap<string, Value>,
	entryIdBySessionId: ReadonlyMap<string, string>,
	merge: (current: Value, next: Value) => Value
): Map<string, Value> {
	const merged = new Map<string, Value>();
	for (const [spaceId, value] of source) {
		const id = entryIdBySessionId.get(spaceId) ?? spaceId;
		const current = merged.get(id);
		merged.set(id, current === undefined ? value : merge(current, value));
	}
	return merged;
}

type SpaceIdSection = { spaceIds: string[] };

function withoutIds<Section extends SpaceIdSection>(
	section: Section,
	removed: ReadonlySet<string>
): Section {
	return {
		...section,
		spaceIds: section.spaceIds.filter((id) => !removed.has(id)),
	};
}

/**
 * Before the entry is moved or unpinned, drop the other sessions' saved
 * positions so a stale pin or group cannot pull the entry back.
 */
export function keepOnlyCenterAgentEntryPosition(
	preferences: AccountSidebarPreferences,
	sessionIds: readonly string[],
	entryId: string
): AccountSidebarPreferences {
	const removed = new Set(sessionIds.filter((id) => id !== entryId));
	if (removed.size === 0) {
		return preferences;
	}
	const strip = <
		Value extends {
			pinned: SpaceIdSection;
			spaces: SpaceIdSection;
			groups: SpaceIdSection[];
		},
	>(
		value: Value
	): Value => ({
		...value,
		pinned: withoutIds(value.pinned, removed),
		spaces: withoutIds(value.spaces, removed),
		groups: value.groups.map((group) => withoutIds(group, removed)),
	});
	return {
		...preferences,
		pinned: withoutIds(preferences.pinned, removed),
		...(preferences.chats ? { chats: strip(preferences.chats) } : {}),
		...(preferences.messages ? { messages: strip(preferences.messages) } : {}),
	};
}
