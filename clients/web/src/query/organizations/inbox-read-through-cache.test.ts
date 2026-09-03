import type {
	CenterAgentInboxSummaryResponse,
	InboxSummaryResponse,
	SpaceInboxSummaryResponse,
	SpaceInboxUnreadTargetsResponse,
} from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { inboxQueryKeys } from "./inbox";
import { optimisticallyMarkSpaceInboxReadThrough } from "./inbox-read-through-cache";

const ORGANIZATION_ID = "org-acme";
const SPACE_ID = "space-project";

describe("optimisticallyMarkSpaceInboxReadThrough", () => {
	it("removes only the viewed main targets from every matching unread indicator", () => {
		const queryClient = createInboxQueryClient();

		optimisticallyMarkSpaceInboxReadThrough({
			destination: "ordinary-space",
			organizationId: ORGANIZATION_ID,
			queryClient,
			spaceId: SPACE_ID,
			throughOccurredAtMs: 20,
		});

		expect(readTargets(queryClient)).toMatchObject({
			targets: [
				{
					occurredAtMs: 30,
					signalId: "thread-message",
					threadRootSignalId: "thread-root",
				},
			],
			totalUnreadCount: 1,
		});
		expect(readSpaceSummary(queryClient)).toEqual({
			ordinarySpaceUnreadCount: 0,
			organizationId: ORGANIZATION_ID,
			spaces: [
				{
					latestUnreadOccurredAtMs: 30,
					spaceId: SPACE_ID,
					unreadCount: 1,
				},
			],
		});
		expect(readInboxSummary(queryClient).totalUnreadCount).toBe(4);
		expect(readCenterAgentSummary(queryClient).unreadCount).toBe(2);
	});

	it("clears the Home indicator for the current Center Agent conversation", () => {
		const queryClient = createInboxQueryClient();

		optimisticallyMarkSpaceInboxReadThrough({
			destination: "center-agent",
			organizationId: ORGANIZATION_ID,
			queryClient,
			spaceId: SPACE_ID,
			throughOccurredAtMs: 20,
		});

		expect(readCenterAgentSummary(queryClient).unreadCount).toBe(1);
		expect(readSpaceSummary(queryClient).ordinarySpaceUnreadCount).toBe(1);
	});

	it("leaves outer destinations unchanged for a person Direct Message", () => {
		const queryClient = createInboxQueryClient();

		optimisticallyMarkSpaceInboxReadThrough({
			destination: "direct-message",
			organizationId: ORGANIZATION_ID,
			queryClient,
			spaceId: SPACE_ID,
			throughOccurredAtMs: 20,
		});

		expect(readCenterAgentSummary(queryClient).unreadCount).toBe(2);
		expect(readSpaceSummary(queryClient).ordinarySpaceUnreadCount).toBe(1);
		expect(readSpaceSummary(queryClient).spaces[0]?.unreadCount).toBe(1);
	});

	it("rolls back only while the optimistic value is still current", () => {
		const queryClient = createInboxQueryClient();
		const update = optimisticallyMarkSpaceInboxReadThrough({
			destination: "ordinary-space",
			organizationId: ORGANIZATION_ID,
			queryClient,
			spaceId: SPACE_ID,
			throughOccurredAtMs: 20,
		});
		const newerTargets = {
			...readTargets(queryClient),
			targets: [
				{
					occurredAtMs: 40,
					signalId: "new-message",
					threadRootSignalId: null,
				},
			],
			totalUnreadCount: 1,
		};
		queryClient.setQueryData(
			inboxQueryKeys.spaceUnreadTargets(ORGANIZATION_ID, SPACE_ID),
			newerTargets
		);

		update.rollback();

		expect(readTargets(queryClient)).toEqual(newerTargets);
		expect(readSpaceSummary(queryClient).ordinarySpaceUnreadCount).toBe(1);
	});
});

function createInboxQueryClient(): QueryClient {
	const queryClient = new QueryClient();
	const targets: SpaceInboxUnreadTargetsResponse = {
		hasMoreTargets: false,
		organizationId: ORGANIZATION_ID,
		spaceId: SPACE_ID,
		targets: [
			{
				occurredAtMs: 20,
				signalId: "main-message",
				threadRootSignalId: null,
			},
			{
				occurredAtMs: 30,
				signalId: "thread-message",
				threadRootSignalId: "thread-root",
			},
		],
		totalUnreadCount: 2,
	};
	const spaceSummary: SpaceInboxSummaryResponse = {
		ordinarySpaceUnreadCount: 1,
		organizationId: ORGANIZATION_ID,
		spaces: [
			{
				latestUnreadOccurredAtMs: 30,
				spaceId: SPACE_ID,
				unreadCount: 2,
			},
		],
	};
	const inboxSummary: InboxSummaryResponse = {
		organizationId: ORGANIZATION_ID,
		totalUnreadCount: 5,
		unresolvedActionCount: 1,
	};
	const centerAgentSummary: CenterAgentInboxSummaryResponse = {
		organizationId: ORGANIZATION_ID,
		unreadCount: 2,
	};
	queryClient.setQueryData(
		inboxQueryKeys.spaceUnreadTargets(ORGANIZATION_ID, SPACE_ID),
		targets
	);
	queryClient.setQueryData(
		inboxQueryKeys.spaceSummary(ORGANIZATION_ID),
		spaceSummary
	);
	queryClient.setQueryData(
		inboxQueryKeys.summary(ORGANIZATION_ID),
		inboxSummary
	);
	queryClient.setQueryData(
		inboxQueryKeys.centerAgentSummary(ORGANIZATION_ID),
		centerAgentSummary
	);
	return queryClient;
}

function readTargets(queryClient: QueryClient) {
	const data = queryClient.getQueryData<SpaceInboxUnreadTargetsResponse>(
		inboxQueryKeys.spaceUnreadTargets(ORGANIZATION_ID, SPACE_ID)
	);
	if (!data) {
		throw new Error("Expected cached Space Inbox unread targets.");
	}
	return data;
}

function readSpaceSummary(queryClient: QueryClient) {
	const data = queryClient.getQueryData<SpaceInboxSummaryResponse>(
		inboxQueryKeys.spaceSummary(ORGANIZATION_ID)
	);
	if (!data) {
		throw new Error("Expected cached Space Inbox summary.");
	}
	return data;
}

function readInboxSummary(queryClient: QueryClient) {
	const data = queryClient.getQueryData<InboxSummaryResponse>(
		inboxQueryKeys.summary(ORGANIZATION_ID)
	);
	if (!data) {
		throw new Error("Expected cached Inbox summary.");
	}
	return data;
}

function readCenterAgentSummary(queryClient: QueryClient) {
	const data = queryClient.getQueryData<CenterAgentInboxSummaryResponse>(
		inboxQueryKeys.centerAgentSummary(ORGANIZATION_ID)
	);
	if (!data) {
		throw new Error("Expected cached Center Agent Inbox summary.");
	}
	return data;
}
