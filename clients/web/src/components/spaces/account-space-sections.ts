import type { SpaceInboxSummaryItem } from "@openmeld/schemas/types";
import { isDirectMessageSpace } from "@openmeld/space";
import type {
	AccountSpaceItem,
	AccountSpaceSections,
} from "#/lib/spaces/account-spaces";
import { isWelcomingSpacePurpose } from "#/lib/spaces/welcoming-space";

export type AccountSpacePresentationSections = {
	directMessageItems: readonly AccountSpaceItem[];
	pinnedItems: readonly AccountSpaceItem[];
	spaceItems: readonly AccountSpaceItem[];
};

export type SpaceUnreadById = ReadonlyMap<
	string,
	Pick<SpaceInboxSummaryItem, "latestUnreadOccurredAtMs" | "unreadCount">
>;

export type AccountSpaceTrailingStatus = "pinned" | "unread" | "working" | null;

export function resolveAccountSpaceTrailingStatus(input: {
	hasActiveWake: boolean;
	hasUnread: boolean;
	isPinned: boolean;
}): AccountSpaceTrailingStatus {
	if (input.hasUnread) {
		return "unread";
	}
	if (input.hasActiveWake) {
		return "working";
	}
	if (input.isPinned) {
		return "pinned";
	}
	return null;
}

export function selectAccountSpaceSections(input: {
	currentOrganizationId: string;
	sections: AccountSpaceSections;
	unreadBySpaceId?: SpaceUnreadById;
}): AccountSpacePresentationSections {
	const pinnedItems = input.sections.pinnedItems.filter(
		(item) => item.organizationId === input.currentOrganizationId
	);
	const spaceItems = input.sections.spaceItems.filter(
		(item) => item.organizationId === input.currentOrganizationId
	);
	const allItems = [...pinnedItems, ...spaceItems];
	const isManagedSpecialSpace = (item: AccountSpaceItem) =>
		isWelcomingSpacePurpose(item.spacePurpose) || isDirectMessageItem(item);

	return {
		directMessageItems: sortAccountSpaceItems(
			allItems.filter((item) => isDirectMessageItem(item))
		),
		pinnedItems: pinnedItems.filter((item) => !isManagedSpecialSpace(item)),
		spaceItems: sortAccountSpaceItemsByUnread(
			spaceItems.filter((item) => !isManagedSpecialSpace(item)),
			input.unreadBySpaceId
		),
	};
}

export function isDirectMessageItem(item: AccountSpaceItem): boolean {
	return isDirectMessageSpace({
		activeMemberCount: item.activeMemberCount,
		directMessageConvertedAt: item.directMessageConvertedAt,
		purpose: item.spacePurpose,
	});
}

export function isNewlyJoinedAccountSpace(item: AccountSpaceItem): boolean {
	if (item.lastSeenTs === undefined) {
		// An older persisted Web cache can omit lastSeenTs. Fail closed until the
		// foreground refresh supplies the authoritative owner projection.
		return false;
	}
	return item.lastSeenTs === null;
}

export function prioritizeNewlyJoinedAccountSpaces(
	items: readonly AccountSpaceItem[]
): AccountSpaceItem[] {
	return [...items].sort((left, right) => {
		const leftIsNew = isNewlyJoinedAccountSpace(left);
		const rightIsNew = isNewlyJoinedAccountSpace(right);
		if (leftIsNew !== rightIsNew) {
			return leftIsNew ? -1 : 1;
		}
		if (leftIsNew && rightIsNew) {
			return (
				resolveTimestamp(right.lastJoinedAt) -
				resolveTimestamp(left.lastJoinedAt)
			);
		}
		return 0;
	});
}

export function sortAccountSpaceItems(
	items: readonly AccountSpaceItem[]
): AccountSpaceItem[] {
	return [...items].sort(compareAccountSpaceItems);
}

export function sortAccountSpaceItemsByUnread(
	items: readonly AccountSpaceItem[],
	unreadBySpaceId: SpaceUnreadById | undefined
): AccountSpaceItem[] {
	return [...items].sort((left, right) => {
		const leftUnread = unreadBySpaceId?.get(left.spaceId);
		const rightUnread = unreadBySpaceId?.get(right.spaceId);
		if (leftUnread && !rightUnread) {
			return -1;
		}
		if (!leftUnread && rightUnread) {
			return 1;
		}
		if (leftUnread && rightUnread) {
			const unreadRecencyDelta =
				rightUnread.latestUnreadOccurredAtMs -
				leftUnread.latestUnreadOccurredAtMs;
			if (unreadRecencyDelta !== 0) {
				return unreadRecencyDelta;
			}
		}
		return compareAccountSpaceItems(left, right);
	});
}

function compareAccountSpaceItems(
	left: AccountSpaceItem,
	right: AccountSpaceItem
): number {
	const pinnedDelta =
		resolveTimestamp(right.pinnedAt) - resolveTimestamp(left.pinnedAt);
	if (pinnedDelta !== 0) {
		return pinnedDelta;
	}

	const joinedDelta =
		resolveTimestamp(right.lastJoinedAt) - resolveTimestamp(left.lastJoinedAt);
	if (joinedDelta !== 0) {
		return joinedDelta;
	}

	const nameDelta = left.spaceName.localeCompare(right.spaceName, "en-US");
	if (nameDelta !== 0) {
		return nameDelta;
	}

	return left.spaceId.localeCompare(right.spaceId, "en-US");
}

function resolveTimestamp(value: string | null): number {
	const timestamp = Date.parse(value ?? "");
	return Number.isFinite(timestamp) ? timestamp : 0;
}
