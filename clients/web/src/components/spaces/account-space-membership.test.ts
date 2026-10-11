import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	type AccountSpaceSections,
	createAcceptedAccountSpaceItem,
	resolveAccountSpaceRecency,
} from "#/lib/spaces/account-spaces";
import {
	accountSpaceQueryKeys,
	updateAccountSpaceAcceptedMembership,
} from "#/query/spaces/account-spaces";
import {
	applyAcceptedAccountSpaceMembership,
	reconcileAccountSpaceSections,
	removeAccountSpaceFromSections,
} from "./account-space-sections";
import {
	optimisticallyRemoveSpaceFromListCaches,
	restoreSpaceListCaches,
} from "./space-list-cache";

const joinedAt = "2026-10-09T08:00:00.000Z";
const item = createAcceptedAccountSpaceItem({
	spaceId: "new-space",
	name: "New project",
	organizationId: "team",
	visibility: "private",
	profileId: "human",
	profileName: "Avery",
	joinedAt,
	createdAt: joinedAt,
});
const empty: AccountSpaceSections = { pinnedItems: [], spaceItems: [] };

describe("accepted Space membership", () => {
	it("shows an empty new Space before a stale index catches up and stops retaining it after convergence", () => {
		const accepted = applyAcceptedAccountSpaceMembership(empty, item);
		const lagging = reconcileAccountSpaceSections(
			accepted,
			empty
		) as AccountSpaceSections;
		expect(lagging.spaceItems.map((entry) => entry.spaceId)).toEqual([
			"new-space",
		]);
		const confirmed = reconcileAccountSpaceSections(lagging, {
			...empty,
			spaceItems: [{ ...item }],
		});
		expect(reconcileAccountSpaceSections(confirmed, empty)).toEqual(empty);
	});
	it("does not resurrect a membership when the user leaves immediately after creating it", () => {
		const accepted = applyAcceptedAccountSpaceMembership(empty, item);
		expect(
			reconcileAccountSpaceSections(
				accepted,
				removeAccountSpaceFromSections(accepted, item.spaceId)
			)
		).toEqual(empty);
	});
	it("removes a pending Leave immediately and restores it on rejection", async () => {
		const client = new QueryClient();
		const key = accountSpaceQueryKeys.items("human", "account");
		client.setQueryDefaults(key, {
			structuralSharing: reconcileAccountSpaceSections,
		});
		updateAccountSpaceAcceptedMembership(client, "human", item);
		const removal = await optimisticallyRemoveSpaceFromListCaches({
			queryClient: client,
			organizationId: "team",
			spaceId: item.spaceId,
		});
		expect(client.getQueryData(key)).toMatchObject(empty);
		restoreSpaceListCaches(client, "team", removal);
		expect(
			client
				.getQueryData<AccountSpaceSections>(key)
				?.spaceItems.map((entry) => entry.spaceId)
		).toEqual(["new-space"]);
		client.clear();
	});
	it("uses join time even when a newly joined Space has old messages", () => {
		expect(
			resolveAccountSpaceRecency({
				...item,
				spaceCreatedAt: "2026-01-01T00:00:00.000Z",
				messagePreview: {
					signalId: "old",
					profileId: "peer",
					timestamp: Date.parse("2026-02-01T00:00:00.000Z"),
					text: "Old decision",
				},
			})
		).toBe(Date.parse(joinedAt));
	});
});
