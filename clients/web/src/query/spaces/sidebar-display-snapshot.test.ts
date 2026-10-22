import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { agentDirectMessageSessionQueryKeys } from "#/query/organizations/agent-direct-message-sessions";
import { centerAgentSessionsQueryOptions } from "#/query/organizations/center-agent-sessions";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import {
	readSidebarDisplaySnapshot,
	seedSidebarDisplaySnapshot,
	sidebarDisplaySnapshotQueryKey,
} from "./sidebar-display-snapshot";

const item = {
	activeAgentCount: null,
	activeHumanCount: null,
	activeMemberCount: null,
	directMessageConvertedAt: null,
	directMessageProfileIds: ["human", "agent"],
	joinedProfiles: [
		{
			lastJoinedAt: "2026-10-01T00:00:00.000Z",
			pinnedAt: null,
			profileId: "human",
			profileName: "Felix",
		},
	],
	lastJoinedAt: "2026-10-01T00:00:00.000Z",
	lastSeenTs: 12,
	messagePreview: {
		profileId: "agent",
		signalId: "signal",
		text: "Done.",
		timestamp: 12,
	},
	openProfileId: "human",
	openProfileName: "Felix",
	organizationId: "org",
	pinnedAt: null,
	pinnedProfileIds: [],
	spaceCreatedAt: "2026-10-01T00:00:00.000Z",
	spaceId: "space",
	spaceName: "Felix and Codex",
	spacePurpose: null,
	spaceUpdatedAt: null,
	visibility: "private",
};

const sessions = {
	generatedAt: "2026-10-01T00:00:00.000Z",
	nextCursor: null,
	organizationId: "org",
	sessions: [],
};

describe("sidebar display snapshot", () => {
	it("seeds the sidebar reads on a new page and marks them stale", () => {
		const live = new QueryClient();
		live.setQueryData(accountSpaceQueryKeys.items("human", "account"), {
			pinnedItems: [],
			recentlyDeletedItems: [
				{
					deletedAt: "2026-10-01T00:00:00.000Z",
					deletedByProfileName: null,
					spaceId: "gone",
					spaceName: null,
				},
			],
			spaceItems: [item],
		});
		live.setQueryData(
			centerAgentSessionsQueryOptions("org", "human").queryKey,
			{
				pageParams: [undefined],
				pages: [sessions],
			}
		);
		const snapshot = readSidebarDisplaySnapshot(live, {
			organizationId: "org",
			profileId: "human",
		});
		expect(snapshot?.accountSpaces?.spaceItems).toEqual([item]);

		const refreshed = new QueryClient();
		refreshed.setQueryData(
			sidebarDisplaySnapshotQueryKey("account", "org"),
			JSON.parse(JSON.stringify(snapshot))
		);
		seedSidebarDisplaySnapshot(refreshed, {
			organizationId: "org",
			ownerAccountId: "account",
		});
		const itemsKey = accountSpaceQueryKeys.items("human", "account");
		// A deleted-Space notice is shown once, so the copy does not keep it.
		expect(refreshed.getQueryData(itemsKey)).toEqual({
			pinnedItems: [],
			recentlyDeletedItems: [],
			spaceItems: [item],
		});
		expect(refreshed.getQueryState(itemsKey)?.isInvalidated).toBe(true);
		expect(
			refreshed.getQueryData(
				centerAgentSessionsQueryOptions("org", "human").queryKey
			)
		).toEqual({ pageParams: [undefined], pages: [sessions] });
	});

	it("does not replace data a read already has", () => {
		const client = new QueryClient();
		const itemsKey = accountSpaceQueryKeys.items("human", "account");
		const current = { pinnedItems: [], spaceItems: [] };
		client.setQueryData(itemsKey, current);
		client.setQueryData(sidebarDisplaySnapshotQueryKey("account", "org"), {
			accountSpaces: {
				pinnedItems: [],
				recentlyDeletedItems: [],
				spaceItems: [item],
			},
			agentSessions: [],
			centerAgentSessions: null,
			memberAgents: null,
			profileDirectory: null,
			profileId: "human",
			version: 1,
		});
		seedSidebarDisplaySnapshot(client, {
			organizationId: "org",
			ownerAccountId: "account",
		});
		expect(client.getQueryData(itemsKey)).toBe(current);
	});

	it("keeps the newest MemberAgent Sessions when the list is too long", () => {
		const live = new QueryClient();
		live.setQueryData(accountSpaceQueryKeys.items("human", "account"), {
			pinnedItems: [],
			spaceItems: [item],
		});
		live.setQueryData(agentDirectMessageSessionQueryKeys.memberAgents("org"), {
			generatedAt: "2026-10-01T00:00:00.000Z",
			organizationId: "org",
			memberProfileId: "human",
			sessions: Array.from({ length: 2001 }, (_, index) => ({
				spaceId: `space-${index}`,
				agentProfileId: "agent",
				name: null,
				archivedAt: null,
			})),
			nextCursor: null,
		});

		const snapshot = readSidebarDisplaySnapshot(live, {
			organizationId: "org",
			profileId: "human",
		});

		expect(snapshot?.memberAgentSessions?.sessions).toHaveLength(2000);
		expect(snapshot?.memberAgentSessions?.sessions[0]?.spaceId).toBe("space-0");
	});
});
