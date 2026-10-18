import type { AccountSidebarPreferences } from "@openmeld/schemas";
import type { Conversation } from "./conversation-sidebar-model";
import type { SpaceSidebarActiveWakeSummary } from "./space-active-wake-presentation";

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
// The entry is the session it opens: the one with the newest unread message,
// otherwise the most recently active one. Its id, URL and evidence all agree;
// it sorts by the latest activity across its sessions.
// Saved positions of any of its sessions apply to it (see aliasSpaceIds).
export function collapseCenterAgentSessions(input: {
	conversations: readonly Conversation[];
	archivedIds: readonly string[];
	latestUnreadAtBySpaceId: ReadonlyMap<string, number>;
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
	const entryIdBySessionId = new Map<string, string>();
	const unreadAt = (session: Conversation) =>
		input.latestUnreadAtBySpaceId.get(session.spaceId) ?? -1;
	const opensBefore = (candidate: Conversation, current: Conversation) =>
		unreadAt(candidate) === unreadAt(current)
			? candidate.activity > current.activity
			: unreadAt(candidate) > unreadAt(current);
	for (const sessions of sessionsByAgent.values()) {
		const entry = sessions.reduce((current, candidate) =>
			opensBefore(candidate, current) ? candidate : current
		);
		if (entry.kind !== "direct-message") {
			continue;
		}
		const sessionIds = sessions.map((session) => session.spaceId);
		for (const id of sessionIds) {
			entryIdBySessionId.set(id, entry.spaceId);
		}
		conversations.push({
			...entry,
			title: input.title,
			activity: Math.max(...sessions.map((session) => session.activity)),
			sessionSpaceIds: sessionIds,
			sessionUrlBySpaceId: new Map(
				sessions.map((session) => [session.spaceId, session.url])
			),
		});
	}
	return { conversations, entryIdBySessionId };
}

/** Rewrites saved session positions onto their entry, keeping the first. */
export function aliasSpaceIds(
	ids: readonly string[],
	entryIdBySessionId: ReadonlyMap<string, string>
): string[] {
	return [...new Set(ids.map((id) => entryIdBySessionId.get(id) ?? id))];
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

/** Adds the entry's sessions' in-flight Wakes so the orb counts all of them. */
export function mergeActiveWakeSummaries(
	current: SpaceSidebarActiveWakeSummary,
	next: SpaceSidebarActiveWakeSummary
): SpaceSidebarActiveWakeSummary {
	const targets = new Map(
		(current.activeTargets ?? []).map((target) => [target.profileId, target])
	);
	for (const target of next.activeTargets ?? []) {
		const existing = targets.get(target.profileId);
		targets.set(
			target.profileId,
			existing
				? {
						...existing,
						activeWakeCount: existing.activeWakeCount + target.activeWakeCount,
						profileName: existing.profileName ?? target.profileName,
					}
				: target
		);
	}
	const statuses = [...(current.statuses ?? []), ...(next.statuses ?? [])];
	// The summary keeps the Space (and focus) of the session whose work the
	// indicator opens: one waiting on the viewer first, otherwise the first.
	const lead = !awaitsViewer(current) && awaitsViewer(next) ? next : current;
	return {
		...lead,
		activeWakeCount: current.activeWakeCount + next.activeWakeCount,
		...(current.activeTargets || next.activeTargets
			? { activeTargets: [...targets.values()] }
			: {}),
		...(statuses.length > 0 ? { statuses } : {}),
		...(current.hasMore || next.hasMore ? { hasMore: true } : {}),
	};
}

function awaitsViewer(summary: SpaceSidebarActiveWakeSummary): boolean {
	return (
		summary.statuses?.some(
			(status) =>
				status.kind === "needs_input" || status.kind === "waiting_for_owner"
		) ?? false
	);
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
