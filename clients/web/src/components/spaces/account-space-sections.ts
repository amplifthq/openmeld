import type { SpaceInboxSummaryItem } from "@openmeld/schemas/types";
import { isDirectMessageSpace } from "@openmeld/space";
import type {
	AccountSpaceItem,
	AccountSpaceSections,
} from "#/lib/spaces/account-spaces";
import { isWelcomingSpacePurpose } from "#/lib/spaces/welcoming-space";

// A successful pin mutation can still be waiting for the Space Index projection.
// Keep that optimistic choice on the in-memory query item for one bounded owner
// convergence window. Non-enumerable symbols stay out of persisted data and payloads.
const ACCOUNT_SPACE_PIN_OVERLAY = Symbol("account-space-pin-overlay");
const ACCOUNT_SPACE_PIN_OVERLAY_CLEARS = Symbol(
	"account-space-pin-overlay-clears"
);
const ACCOUNT_SPACE_PIN_OVERLAY_MAX_AGE_MS = 60_000;

type AccountSpacePinOverlay = {
	baselinePinnedAt: string | null;
	baselineProfileIds: readonly string[];
	expiresAtMs: number;
	pinnedAt: string | null;
	profileIds: readonly string[];
};

type AccountSpaceItemWithPinOverlay = AccountSpaceItem & {
	[ACCOUNT_SPACE_PIN_OVERLAY]?: AccountSpacePinOverlay;
};

type AccountSpaceSectionsWithPinOverlayClears = AccountSpaceSections & {
	[ACCOUNT_SPACE_PIN_OVERLAY_CLEARS]?: ReadonlySet<string>;
};

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

export function resolveAccountSpaceViewerProfileId(input: {
	currentProfileId: string;
	item: AccountSpaceItem;
}): string {
	return input.item.joinedProfiles.some(
		(profile) => profile.profileId === input.currentProfileId
	)
		? input.currentProfileId
		: input.item.openProfileId;
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

export function applyOptimisticAccountSpacePinUpdate(
	current: AccountSpaceSections,
	variables: {
		item: AccountSpaceItem;
		pinnedAt: string | null;
		profileIds: readonly string[];
	}
): AccountSpaceSections {
	return applyAccountSpacePinOverlay(current, variables.item, {
		baselinePinnedAt: variables.item.pinnedAt,
		baselineProfileIds: variables.item.pinnedProfileIds,
		expiresAtMs: Date.now() + ACCOUNT_SPACE_PIN_OVERLAY_MAX_AGE_MS,
		pinnedAt: variables.pinnedAt,
		profileIds: variables.profileIds,
	});
}

export function restoreAccountSpaceItemAfterPinFailure(
	current: AccountSpaceSections,
	previousItem: AccountSpaceItem | null,
	spaceId: string
): AccountSpaceSections {
	const spaceKey = normalizeSpaceKey(spaceId);
	const currentItem = findAccountSpaceItem(current, spaceId);
	const nextItems = [...current.pinnedItems, ...current.spaceItems].filter(
		(item) => normalizeSpaceKey(item.spaceId) !== spaceKey
	);
	if (currentItem && readAccountSpacePinOverlay(currentItem) === null) {
		// The owner projection advanced while the mutation was pending. Keep it
		// intact instead of restoring any part of the stale pre-mutation snapshot.
		nextItems.push(currentItem);
	} else if (currentItem && previousItem) {
		// Polling can refresh names, membership, and last-seen truth while the
		// optimistic Pin overlay is active. Roll back only the fields that the
		// optimistic update changed and retain every refreshed owner field.
		nextItems.push({
			...currentItem,
			pinnedAt: previousItem.pinnedAt,
			pinnedProfileIds: previousItem.pinnedProfileIds,
		});
	} else if (previousItem) {
		nextItems.push(previousItem);
	}

	const sections = buildAccountSpacePinSections(current, nextItems);
	Object.defineProperty(sections, ACCOUNT_SPACE_PIN_OVERLAY_CLEARS, {
		configurable: true,
		value: new Set([spaceKey]),
	});
	return sections;
}

export function preserveOptimisticAccountSpacePinUpdates(
	previous: unknown,
	incoming: unknown
): unknown {
	if (!(isAccountSpaceSections(previous) && isAccountSpaceSections(incoming))) {
		return incoming;
	}

	const incomingItems = [...incoming.pinnedItems, ...incoming.spaceItems];
	if (incomingItems.some((item) => readAccountSpacePinOverlay(item) !== null)) {
		return incoming;
	}

	const clearedSpaceKeys =
		(incoming as AccountSpaceSectionsWithPinOverlayClears)[
			ACCOUNT_SPACE_PIN_OVERLAY_CLEARS
		] ?? new Set<string>();
	let next = { ...incoming };
	for (const previousItem of [
		...previous.pinnedItems,
		...previous.spaceItems,
	]) {
		const overlay = readAccountSpacePinOverlay(previousItem);
		const spaceKey = normalizeSpaceKey(previousItem.spaceId);
		if (
			!overlay ||
			clearedSpaceKeys.has(spaceKey) ||
			Date.now() >= overlay.expiresAtMs
		) {
			continue;
		}
		const ownerItem = findAccountSpaceItem(next, previousItem.spaceId);
		if (
			!ownerItem ||
			accountSpacePinStateMatches(
				ownerItem,
				overlay.pinnedAt,
				overlay.profileIds
			) ||
			!accountSpacePinStateMatches(
				ownerItem,
				overlay.baselinePinnedAt,
				overlay.baselineProfileIds
			)
		) {
			continue;
		}
		next = applyAccountSpacePinOverlay(next, ownerItem, overlay);
	}
	return next;
}

function applyAccountSpacePinOverlay(
	current: AccountSpaceSections,
	item: AccountSpaceItem,
	overlay: AccountSpacePinOverlay
): AccountSpaceSections {
	const nextItem: AccountSpaceItemWithPinOverlay = {
		...item,
		pinnedAt: overlay.pinnedAt,
		pinnedProfileIds: overlay.pinnedAt ? overlay.profileIds : [],
	};
	Object.defineProperty(nextItem, ACCOUNT_SPACE_PIN_OVERLAY, {
		configurable: true,
		value: overlay,
	});
	const nextItems = [...current.pinnedItems, ...current.spaceItems].filter(
		(currentItem) =>
			normalizeSpaceKey(currentItem.spaceId) !==
			normalizeSpaceKey(nextItem.spaceId)
	);
	nextItems.push(nextItem);

	return buildAccountSpacePinSections(current, nextItems);
}

function buildAccountSpacePinSections(
	current: AccountSpaceSections,
	items: readonly AccountSpaceItem[]
): AccountSpaceSections {
	return {
		pinnedItems: sortAccountSpaceItems(
			items.filter((item) => item.pinnedAt !== null)
		),
		recentlyDeletedItems: current.recentlyDeletedItems,
		spaceItems: sortAccountSpaceItems(
			items.filter((item) => item.pinnedAt === null)
		),
	};
}

function readAccountSpacePinOverlay(
	item: AccountSpaceItem
): AccountSpacePinOverlay | null {
	return (
		(item as AccountSpaceItemWithPinOverlay)[ACCOUNT_SPACE_PIN_OVERLAY] ?? null
	);
}

function accountSpacePinStateMatches(
	item: AccountSpaceItem,
	pinnedAt: string | null,
	profileIds: readonly string[]
): boolean {
	if (item.pinnedAt !== pinnedAt) {
		return false;
	}
	const ownerProfileIds = [...item.pinnedProfileIds].sort();
	const expectedProfileIds = [...(pinnedAt === null ? [] : profileIds)].sort();
	return (
		ownerProfileIds.length === expectedProfileIds.length &&
		ownerProfileIds.every(
			(profileId, index) => profileId === expectedProfileIds[index]
		)
	);
}

function findAccountSpaceItem(
	sections: AccountSpaceSections,
	spaceId: string
): AccountSpaceItem | null {
	const spaceKey = normalizeSpaceKey(spaceId);
	return (
		sections.pinnedItems.find(
			(item) => normalizeSpaceKey(item.spaceId) === spaceKey
		) ??
		sections.spaceItems.find(
			(item) => normalizeSpaceKey(item.spaceId) === spaceKey
		) ??
		null
	);
}

function isAccountSpaceSections(value: unknown): value is AccountSpaceSections {
	return (
		typeof value === "object" &&
		value !== null &&
		"pinnedItems" in value &&
		Array.isArray(value.pinnedItems) &&
		"spaceItems" in value &&
		Array.isArray(value.spaceItems)
	);
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

function normalizeSpaceKey(value: string): string {
	return value.trim().toLowerCase();
}
