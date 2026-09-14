import type { OrganizationSpaceDirectoryWithMemberCountsResponse } from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { AccountSpaceSections } from "#/lib/spaces/account-spaces";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import {
	optimisticallyRemoveSpaceFromListCaches,
	restoreSpaceListCaches,
} from "./space-delete-cache";

describe("Space delete list caches", () => {
	it("removes the Space from sidebar and Browse caches, then restores exact snapshots", async () => {
		const queryClient = new QueryClient();
		const accountKey = accountSpaceQueryKeys.items("human-1", "account");
		const organizationKey = organizationQueryKeys.spaces("org-1");
		const accountSpaces = createAccountSpaces();
		const organizationSpaces = createOrganizationSpaces();
		queryClient.setQueryData(accountKey, accountSpaces);
		queryClient.setQueryData(organizationKey, organizationSpaces);

		const snapshot = await optimisticallyRemoveSpaceFromListCaches({
			organizationId: "org-1",
			queryClient,
			spaceId: "space-delete",
		});

		expect(
			queryClient.getQueryData<AccountSpaceSections>(accountKey)
		).toMatchObject({
			pinnedItems: [],
			spaceItems: [{ spaceId: "space-keep" }],
		});
		expect(
			queryClient
				.getQueryData<OrganizationSpaceDirectoryWithMemberCountsResponse>(
					organizationKey
				)
				?.spaces.map((space) => space.spaceId)
		).toEqual(["space-keep"]);

		restoreSpaceListCaches(queryClient, "org-1", snapshot);
		expect(queryClient.getQueryData(accountKey)).toEqual(accountSpaces);
		expect(queryClient.getQueryData(organizationKey)).toEqual(
			organizationSpaces
		);
	});
});

function createAccountSpaces(): AccountSpaceSections {
	return {
		pinnedItems: [createAccountSpace("space-delete")],
		spaceItems: [createAccountSpace("space-keep")],
	};
}

function createAccountSpace(
	spaceId: string
): AccountSpaceSections["spaceItems"][number] {
	return {
		activeAgentCount: 0,
		activeHumanCount: 1,
		activeMemberCount: 1,
		joinedProfiles: [],
		lastJoinedAt: "2026-09-15T00:00:00.000Z",
		openProfileId: "human-1",
		openProfileName: "Felix",
		organizationId: "org-1",
		pinnedAt: null,
		pinnedProfileIds: [],
		spaceId,
		spaceName: spaceId,
		spacePurpose: null,
		visibility: "private",
	};
}

function createOrganizationSpaces(): OrganizationSpaceDirectoryWithMemberCountsResponse {
	return {
		generatedAt: "2026-09-15T00:00:00.000Z",
		organizationId: "org-1",
		spaces: ["space-delete", "space-keep"].map((spaceId) => ({
			activeMemberCount: 1,
			joined: true,
			lastJoinedAt: null,
			name: spaceId,
			organizationId: "org-1",
			spaceCreatedAt: null,
			spaceId,
			spaceUpdatedAt: null,
			updatedAt: "2026-09-15T00:00:00.000Z",
			visibility: "private" as const,
		})),
	};
}
