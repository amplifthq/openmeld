import type { AccountSidebarPreferences } from "@openmeld/schemas";
import { EMPTY_CHAT_PREFERENCES } from "#/lib/organizations/center-agent-chat-preferences";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import type { resolveDirectMessagePresentation } from "./direct-message-presentation";

/** Import the former split lists once; subsequent writes retire messages. */
export function mergeChatPreferences(
	preferences: AccountSidebarPreferences | undefined,
	items: readonly Pick<AccountSpaceItem, "spaceId" | "pinnedAt">[]
): NonNullable<AccountSidebarPreferences["chats"]> {
	const chats = preferences?.chats ?? EMPTY_CHAT_PREFERENCES;
	const messages = preferences?.messages;
	// Ordinary DM pin membership stays with Space Index, as it does in Spaces.
	// Chat preferences own session pins and the ordering of both kinds of rows.
	const accountIds = new Set(items.map((item) => item.spaceId));
	const accountPins = new Set(
		items.filter((item) => item.pinnedAt).map((item) => item.spaceId)
	);
	const unique = (ids: readonly string[]) => [...new Set(ids)];
	const groups = chats.groups.map((group) => ({
		...group,
		spaceIds: [...group.spaceIds],
	}));
	const assigned = new Set(groups.flatMap((group) => group.spaceIds));
	let sort = chats.spaces.sort;
	if (messages) {
		sort =
			chats.spaces.sort === "manual" || messages.spaces.sort === "manual"
				? "manual"
				: "priority";
	}
	for (const group of messages?.groups ?? []) {
		const ids = group.spaceIds.filter((id) => !assigned.has(id));
		for (const id of ids) {
			assigned.add(id);
		}
		const existing = groups.find((candidate) => candidate.id === group.id);
		if (existing) {
			existing.spaceIds.push(...ids);
		} else {
			groups.push({ ...group, spaceIds: ids });
		}
	}
	return {
		...chats,
		groups,
		pinned: {
			...chats.pinned,
			spaceIds: unique([
				...chats.pinned.spaceIds.filter(
					(id) => !accountIds.has(id) || accountPins.has(id)
				),
				...(messages?.pinned.spaceIds ?? []).filter(
					(id) => !accountIds.has(id) || accountPins.has(id)
				),
				...accountPins,
			]),
		},
		spaces: {
			sort,
			spaceIds: unique([
				...chats.spaces.spaceIds,
				...(messages?.spaces.spaceIds ?? []),
			]),
		},
	};
}

export type Chat = {
	messagePreview?: AccountSpaceItem["messagePreview"];
	recentMessagePreviews?: AccountSpaceItem["recentMessagePreviews"];
	spaceId: string;
	name: string | null;
	createdAt: string | null;
	viewerProfileId?: string;
	peer?: ReturnType<typeof resolveDirectMessagePresentation>["peer"];
	participants?: ReturnType<
		typeof resolveDirectMessagePresentation
	>["participants"];
	profileKind?: string;
	session?: boolean;
	centerAgentProfileName?: string;
	centerAgentProfileId?: string;
	centerAgentAvatarStyle?: import("@openmeld/schemas/types").AuthProfileView["avatarStyle"];
};

/** Ordinary Human–Agent chats use Core's Session archive, including colleagues' Agents. */
export function chatSessionAgentProfileId(chat: Chat): string | null {
	return !chat.session && chat.peer?.profileKind === "agent"
		? chat.peer.profileId
		: null;
}

export function isChatArchived(input: {
	chat: Chat;
	memberAgentsEnabled: boolean;
	personalArchivedIds: readonly string[];
	sessionArchivedIds: ReadonlySet<string>;
}): boolean {
	return input.memberAgentsEnabled && chatSessionAgentProfileId(input.chat)
		? input.sessionArchivedIds.has(input.chat.spaceId)
		: input.personalArchivedIds.includes(input.chat.spaceId);
}
