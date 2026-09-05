import type { AccountSpaceIndexItem } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AccountSpaceItem,
	hasAccountSpaceItems,
	listAccountSpaceItems,
	setAccountSpaceItemPinned,
} from "./account-spaces";
import { OPENMELD_WELCOMING_SPACE_PURPOSE } from "./welcoming-space";

const { listAccountSpaceIndexMock, upsertProfileSpaceHistoryMock } = vi.hoisted(
	() => ({
		listAccountSpaceIndexMock: vi.fn(),
		upsertProfileSpaceHistoryMock: vi.fn(),
	})
);

vi.mock("./account-space-index", () => ({
	listAccountSpaceIndex: (
		...args: Parameters<typeof listAccountSpaceIndexMock>
	) => listAccountSpaceIndexMock(...args),
}));

vi.mock("#/lib/onboarding/upsert-profile-space-history", () => ({
	upsertProfileSpaceHistory: (
		...args: Parameters<typeof upsertProfileSpaceHistoryMock>
	) => upsertProfileSpaceHistoryMock(...args),
}));

describe("hasAccountSpaceItems", () => {
	it("returns true only when pinned or unpinned spaces exist", () => {
		expect(hasAccountSpaceItems(null)).toBe(false);
		expect(
			hasAccountSpaceItems({
				pinnedItems: [],
				spaceItems: [],
			})
		).toBe(false);
		expect(
			hasAccountSpaceItems({
				pinnedItems: [createAccountSpaceItem()],
				spaceItems: [],
			})
		).toBe(true);
		expect(
			hasAccountSpaceItems({
				pinnedItems: [],
				spaceItems: [createAccountSpaceItem()],
			})
		).toBe(true);
	});
});

describe("listAccountSpaceItems", () => {
	beforeEach(() => {
		listAccountSpaceIndexMock.mockReset();
	});

	it("reads the shared account space index and keeps the Web item shape", async () => {
		listAccountSpaceIndexMock.mockResolvedValue({
			pinnedItems: [createIndexItem({ pinnedAt: "2026-04-14T00:00:00.000Z" })],
			recentlyDeletedItems: [],
			spaceItems: [
				createIndexItem({
					directMessageConvertedAt: "2026-04-15T00:00:00.000Z",
					lastSeenTs: 1_765_843_200_000,
					spaceId: "space-b",
					spaceName: "Beta",
					spacePurpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
				}),
			],
		});

		const items = await listAccountSpaceItems({ profileId: " human-default " });

		expect(listAccountSpaceIndexMock).toHaveBeenCalledWith({
			data: {
				includeDirectMessageProfileIds: true,
				includePurposes: true,
				limit: 500,
				profileId: "human-default",
				scope: "account",
			},
		});
		expect(items).toEqual({
			pinnedItems: [
				{
					activeAgentCount: null,
					activeHumanCount: null,
					activeMemberCount: null,
					directMessageConvertedAt: null,
					directMessageProfileIds: null,
					joinedProfiles: [
						{
							lastJoinedAt: "2026-04-12T00:00:00.000Z",
							pinnedAt: "2026-04-14T00:00:00.000Z",
							profileId: "human-default",
							profileName: "Mira",
						},
					],
					lastJoinedAt: "2026-04-12T00:00:00.000Z",
					lastSeenTs: null,
					openProfileId: "human-default",
					openProfileName: "Mira",
					organizationId: "org-acme",
					pinnedAt: "2026-04-14T00:00:00.000Z",
					pinnedProfileIds: ["human-default"],
					spaceId: "space-a",
					spaceName: "Alpha",
					spacePurpose: null,
					visibility: "private",
				},
			],
			recentlyDeletedItems: [],
			spaceItems: [
				{
					activeAgentCount: null,
					activeHumanCount: null,
					activeMemberCount: null,
					directMessageConvertedAt: "2026-04-15T00:00:00.000Z",
					directMessageProfileIds: null,
					joinedProfiles: [
						{
							lastJoinedAt: "2026-04-12T00:00:00.000Z",
							pinnedAt: null,
							profileId: "human-default",
							profileName: "Mira",
						},
					],
					lastJoinedAt: "2026-04-12T00:00:00.000Z",
					lastSeenTs: 1_765_843_200_000,
					openProfileId: "human-default",
					openProfileName: "Mira",
					organizationId: "org-acme",
					pinnedAt: null,
					pinnedProfileIds: [],
					spaceId: "space-b",
					spaceName: "Beta",
					spacePurpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
					visibility: "private",
				},
			],
		});
	});

	it("fails closed when profileId is blank", async () => {
		await expect(listAccountSpaceItems({ profileId: " " })).rejects.toThrow(
			"Account spaces require a profile ID."
		);
		expect(listAccountSpaceIndexMock).not.toHaveBeenCalled();
	});
});

describe("setAccountSpaceItemPinned", () => {
	beforeEach(() => {
		upsertProfileSpaceHistoryMock.mockReset();
	});

	it("updates pinnedAt for the requested profile records", async () => {
		upsertProfileSpaceHistoryMock.mockResolvedValue([]);

		await setAccountSpaceItemPinned({
			pinnedAt: null,
			profileIds: [" human-default ", "agent-runner", "human-default"],
			spaceId: " space-a ",
		});

		expect(upsertProfileSpaceHistoryMock).toHaveBeenCalledWith({
			data: {
				items: [{ profileId: "human-default" }, { profileId: "agent-runner" }],
				pinnedAt: null,
				spaceId: "space-a",
			},
		});
	});
});

function createIndexItem(
	overrides: Partial<Omit<AccountSpaceIndexItem, "spacePurpose">> & {
		spacePurpose?: string | null;
	} = {}
): AccountSpaceIndexItem {
	return {
		...createIndexItemBase(),
		...overrides,
		joinedProfiles:
			overrides.joinedProfiles ??
			createIndexItemBase({
				pinnedAt: overrides.pinnedAt ?? null,
			}).joinedProfiles,
		pinnedProfileIds:
			overrides.pinnedProfileIds ??
			(overrides.pinnedAt ? ["human-default"] : []),
	};
}

function createIndexItemBase(
	overrides: { pinnedAt?: string | null } = {}
): AccountSpaceIndexItem {
	const pinnedAt = overrides.pinnedAt ?? null;
	return {
		creatorKind: "human",
		creatorOwnerUserId: "user-1",
		creatorProfileId: "human-default",
		creatorProfileName: "Mira",
		directMessageConvertedAt: null,
		gatewayHost: "openmeld.test",
		joinedProfiles: [
			{
				lastJoinedAt: "2026-04-12T00:00:00.000Z",
				pinnedAt,
				profileId: "human-default",
				profileName: "Mira",
			},
		],
		lastJoinedAt: "2026-04-12T00:00:00.000Z",
		lastSeenTs: null,
		openProfileId: "human-default",
		openProfileName: "Mira",
		organizationId: "org-acme",
		pinnedAt,
		pinnedProfileIds: pinnedAt ? ["human-default"] : [],
		spaceCreatedAt: null,
		spaceId: "space-a",
		spaceName: "Alpha",
		spacePurpose: null,
		spaceUpdatedAt: null,
		status: "active",
		updatedAt: "2026-04-12T00:00:00.000Z",
		visibility: "private",
	};
}

function createAccountSpaceItem(
	overrides: Partial<AccountSpaceItem> = {}
): AccountSpaceItem {
	return {
		joinedProfiles: [
			{
				lastJoinedAt: "2026-04-01T00:00:00.000Z",
				pinnedAt: null,
				profileId: "human-default",
				profileName: "Mira",
			},
		],
		lastJoinedAt: "2026-04-01T00:00:00.000Z",
		openProfileId: "human-default",
		openProfileName: "Mira",
		organizationId: "org-acme",
		pinnedAt: null,
		pinnedProfileIds: [],
		spaceId: "space-a",
		spaceName: "Alpha",
		spacePurpose: null,
		visibility: "private",
		...overrides,
		activeAgentCount: overrides.activeAgentCount ?? null,
		activeHumanCount: overrides.activeHumanCount ?? null,
		activeMemberCount: overrides.activeMemberCount ?? null,
	};
}
