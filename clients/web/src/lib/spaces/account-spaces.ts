import type {
	AccountSpaceIndexItem,
	AccountSpaceIndexResponse,
	SpaceOrganizationVisibility,
	UpsertProfileSpaceHistoryResponse,
} from "@openmeld/schemas/types";
import { upsertProfileSpaceHistory } from "#/lib/onboarding/upsert-profile-space-history";
import { listAccountSpaceIndex } from "./account-space-index";

const ACCOUNT_SPACE_INDEX_LIMIT = 500;

export type AccountSpaceJoinedProfile = {
	lastJoinedAt: string;
	pinnedAt: string | null;
	profileId: string;
	profileName: string;
};

export type AccountSpaceItem = {
	spaceCreatedAt?: string | null;
	spaceUpdatedAt?: string | null;
	directMessageProfileIds?: readonly [string, string] | null;
	joinedProfiles: readonly AccountSpaceJoinedProfile[];
	lastJoinedAt: string;
	// Optional only for older persisted query-cache entries created before this
	// projection was preserved by the Web adapter. Fresh owner responses include it.
	lastSeenTs?: number | null;
	openProfileId: string;
	openProfileName: string;
	organizationId: string;
	pinnedAt: string | null;
	pinnedProfileIds: readonly string[];
	spaceId: string;
	spaceName: string;
	visibility: SpaceOrganizationVisibility;
	spacePurpose: string | null;
	activeAgentCount: number | null;
	activeHumanCount: number | null;
	activeMemberCount: number | null;
	directMessageConvertedAt?: string | null;
};

export type RecentlyDeletedSpaceItem = {
	deletedAt: string;
	deletedByProfileName: string | null;
	spaceId: string;
	spaceName: string | null;
};

export type AccountSpaceSections = {
	pinnedItems: readonly AccountSpaceItem[];
	// Optional so older cached/optimistic shapes (and test fixtures) stay valid; the
	// adapter always supplies it. Consumers must default to [] when reading.
	recentlyDeletedItems?: readonly RecentlyDeletedSpaceItem[];
	spaceItems: readonly AccountSpaceItem[];
};

export function hasAccountSpaceItems(
	sections:
		| Pick<AccountSpaceSections, "pinnedItems" | "spaceItems">
		| null
		| undefined
): boolean {
	return (
		(sections?.pinnedItems.length ?? 0) + (sections?.spaceItems.length ?? 0) > 0
	);
}

export async function listAccountSpaceItems(input: {
	profileId: string;
	scope?: "account" | "profile";
}): Promise<AccountSpaceSections> {
	const profileId = input.profileId.trim();
	if (!profileId) {
		throw new Error("Account spaces require a profile ID.");
	}

	return toAccountSpaceSections(
		await listAccountSpaceIndex({
			data: {
				includeDirectMessageProfileIds: true,
				includePurposes: true,
				limit: ACCOUNT_SPACE_INDEX_LIMIT,
				profileId,
				scope: input.scope ?? "account",
			},
		})
	);
}

export async function setAccountSpaceItemPinned(input: {
	pinnedAt: string | null;
	profileIds: readonly string[];
	spaceId: string;
}): Promise<readonly UpsertProfileSpaceHistoryResponse[]> {
	const spaceId = input.spaceId.trim();
	if (!spaceId) {
		throw new Error("Pinned space update requires a space ID.");
	}

	const profileIds = uniqueStrings(
		input.profileIds.map((profileId) => profileId.trim()).filter(Boolean)
	);
	if (profileIds.length === 0) {
		throw new Error("Pinned space update requires at least one profile ID.");
	}

	return await upsertProfileSpaceHistory({
		data: {
			items: profileIds.map((profileId) => ({ profileId })),
			pinnedAt: input.pinnedAt,
			spaceId,
		},
	});
}

function toAccountSpaceSections(
	index: AccountSpaceIndexResponse
): AccountSpaceSections {
	return {
		pinnedItems: index.pinnedItems.map(toAccountSpaceItem),
		recentlyDeletedItems: (index.recentlyDeletedItems ?? []).map((item) => ({
			deletedAt: item.deletedAt,
			deletedByProfileName: item.deletedByProfileName,
			spaceId: item.spaceId,
			spaceName: item.spaceName,
		})),
		spaceItems: index.spaceItems.map(toAccountSpaceItem),
	};
}

function toAccountSpaceItem(item: AccountSpaceIndexItem): AccountSpaceItem {
	return {
		spaceCreatedAt: item.spaceCreatedAt,
		spaceUpdatedAt: item.spaceUpdatedAt,
		directMessageProfileIds: item.directMessageProfileIds ?? null,
		joinedProfiles: item.joinedProfiles,
		lastJoinedAt: item.lastJoinedAt,
		lastSeenTs: item.lastSeenTs,
		openProfileId: item.openProfileId,
		openProfileName: item.openProfileName,
		organizationId: item.organizationId,
		pinnedAt: item.pinnedAt,
		pinnedProfileIds: item.pinnedProfileIds,
		spaceId: item.spaceId,
		spaceName: item.spaceName,
		visibility: item.visibility,
		spacePurpose: item.spacePurpose ?? null,
		activeAgentCount: item.activeAgentCount ?? null,
		activeHumanCount: item.activeHumanCount ?? null,
		activeMemberCount: item.activeMemberCount ?? null,
		directMessageConvertedAt: item.directMessageConvertedAt ?? null,
	};
}

function uniqueStrings(values: readonly string[]): string[] {
	return Array.from(new Set(values));
}
