import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaceInboxReadPosition } from "./use-space-inbox-read-position";

const {
	invalidateInboxFactsMock,
	markCurrentSpaceInboxReadThroughMock,
	optimisticallyMarkSpaceInboxReadThroughMock,
	queryClient,
	rollbackMock,
} = vi.hoisted(() => ({
	invalidateInboxFactsMock: vi.fn(),
	markCurrentSpaceInboxReadThroughMock: vi.fn(),
	optimisticallyMarkSpaceInboxReadThroughMock: vi.fn(),
	queryClient: {
		cancelQueries: vi.fn(),
		fetchQuery: vi.fn(),
		invalidateQueries: vi.fn(),
	},
	rollbackMock: vi.fn(),
}));

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query"
	);
	return {
		...actual,
		useQuery: () => ({
			data: {
				targets: [],
				totalUnreadCount: 0,
			},
			isSuccess: true,
		}),
		useQueryClient: () => queryClient,
	};
});

vi.mock("#/lib/organizations/inbox", () => ({
	markCurrentSpaceInboxReadThrough: markCurrentSpaceInboxReadThroughMock,
}));

vi.mock("#/query/organizations/inbox", () => ({
	inboxQueryKeys: {
		organization: (organizationId: string) => ["inbox", organizationId],
		spaceUnreadTargets: (organizationId: string, spaceId: string) => [
			"inbox",
			organizationId,
			"space-unread-targets",
			spaceId,
		],
	},
	invalidateInboxFacts: invalidateInboxFactsMock,
	spaceInboxSummaryQueryOptions: vi.fn(() => ({})),
	spaceInboxUnreadTargetsQueryOptions: vi.fn(() => ({})),
}));

vi.mock("#/query/organizations/inbox-read-through-cache", () => ({
	optimisticallyMarkSpaceInboxReadThrough:
		optimisticallyMarkSpaceInboxReadThroughMock,
}));

describe("useSpaceInboxReadPosition", () => {
	beforeEach(() => {
		queryClient.cancelQueries.mockReset().mockResolvedValue(undefined);
		queryClient.invalidateQueries.mockReset().mockResolvedValue(undefined);
		queryClient.fetchQuery.mockReset().mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 100,
					spaceId: "space-project",
					unreadCount: 3,
				},
			],
		});
		invalidateInboxFactsMock.mockReset().mockResolvedValue(undefined);
		markCurrentSpaceInboxReadThroughMock
			.mockReset()
			.mockResolvedValue(undefined);
		rollbackMock.mockReset();
		optimisticallyMarkSpaceInboxReadThroughMock
			.mockReset()
			.mockReturnValue({ rollback: rollbackMock });
	});

	it("persists the visible read position for any Space", async () => {
		const { result } = renderHook(() =>
			useSpaceInboxReadPosition({
				destination: "ordinary-space",
				organizationId: "org-acme",
				profileId: "profile-felix",
				spaceId: "space-project",
			})
		);

		expect(result.current.isReady).toBe(true);
		await result.current.markReadThrough(42);

		expect(markCurrentSpaceInboxReadThroughMock).toHaveBeenCalledWith({
			organizationId: "org-acme",
			spaceId: "space-project",
			throughOccurredAtMs: 42,
		});
		expect(optimisticallyMarkSpaceInboxReadThroughMock).toHaveBeenCalledWith({
			destination: "ordinary-space",
			organizationId: "org-acme",
			queryClient,
			spaceId: "space-project",
			throughOccurredAtMs: 42,
		});
		expect(queryClient.cancelQueries).toHaveBeenCalledWith({
			queryKey: ["inbox", "org-acme"],
		});
		expect(rollbackMock).not.toHaveBeenCalled();
		expect(invalidateInboxFactsMock).toHaveBeenCalledWith({
			organizationId: "org-acme",
			queryClient,
		});
	});

	it("treats a saved read position as success when the Inbox refresh fails", async () => {
		invalidateInboxFactsMock.mockRejectedValueOnce(new Error("refresh failed"));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { result } = renderHook(() =>
			useSpaceInboxReadPosition({
				destination: "ordinary-space",
				organizationId: "org-acme",
				profileId: "profile-felix",
				spaceId: "space-project",
			})
		);

		await expect(result.current.markReadThrough(42)).resolves.toBeUndefined();

		expect(markCurrentSpaceInboxReadThroughMock).toHaveBeenCalledOnce();
		expect(rollbackMock).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});

	it("refreshes stale unread targets instead of failing when the summary has no unread", async () => {
		queryClient.fetchQuery.mockResolvedValueOnce({
			organizationId: "org-acme",
			spaces: [],
		});
		const { result } = renderHook(() =>
			useSpaceInboxReadPosition({
				destination: "ordinary-space",
				organizationId: "org-acme",
				profileId: "profile-felix",
				spaceId: "space-project",
			})
		);

		await expect(result.current.prepareCatchUpMain()).resolves.toBeNull();

		expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["inbox", "org-acme", "space-unread-targets", "space-project"],
		});
		expect(markCurrentSpaceInboxReadThroughMock).not.toHaveBeenCalled();
	});

	it("does not write without an Organization identity", async () => {
		const { result } = renderHook(() =>
			useSpaceInboxReadPosition({
				destination: "ordinary-space",
				organizationId: null,
				profileId: "profile-felix",
				spaceId: "space-project",
			})
		);

		await result.current.markReadThrough(42);
		expect(markCurrentSpaceInboxReadThroughMock).not.toHaveBeenCalled();
		expect(invalidateInboxFactsMock).not.toHaveBeenCalled();
	});

	it("restores the optimistic projection when persistence fails", async () => {
		markCurrentSpaceInboxReadThroughMock.mockRejectedValueOnce(
			new Error("offline")
		);
		const { result } = renderHook(() =>
			useSpaceInboxReadPosition({
				destination: "center-agent",
				organizationId: "org-acme",
				profileId: "profile-felix",
				spaceId: "space-project",
			})
		);

		await expect(result.current.markReadThrough(42)).rejects.toThrow("offline");

		expect(rollbackMock).toHaveBeenCalledOnce();
		expect(invalidateInboxFactsMock).toHaveBeenCalledWith({
			organizationId: "org-acme",
			queryClient,
		});
	});

	it("freezes the server cutoff before navigation and reuses it for retry", async () => {
		markCurrentSpaceInboxReadThroughMock
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(undefined);
		const { result } = renderHook(() =>
			useSpaceInboxReadPosition({
				destination: "ordinary-space",
				organizationId: "org-acme",
				profileId: "profile-felix",
				spaceId: "space-project",
			})
		);

		const firstCommit = await result.current.prepareCatchUpMain();
		queryClient.fetchQuery.mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 200,
					spaceId: "space-project",
					unreadCount: 4,
				},
			],
		});
		await expect(firstCommit?.commit()).rejects.toThrow("offline");
		const retryCommit = await result.current.prepareCatchUpMain();
		await retryCommit?.commit();

		expect(queryClient.fetchQuery).toHaveBeenCalledOnce();
		expect(markCurrentSpaceInboxReadThroughMock).toHaveBeenCalledTimes(2);
		expect(markCurrentSpaceInboxReadThroughMock).toHaveBeenNthCalledWith(1, {
			organizationId: "org-acme",
			spaceId: "space-project",
			throughOccurredAtMs: 100,
		});
		expect(markCurrentSpaceInboxReadThroughMock).toHaveBeenNthCalledWith(2, {
			organizationId: "org-acme",
			spaceId: "space-project",
			throughOccurredAtMs: 100,
		});
	});

	it("discards an abandoned cutoff instead of reusing it as a retry", async () => {
		const { result } = renderHook(() =>
			useSpaceInboxReadPosition({
				destination: "ordinary-space",
				organizationId: "org-acme",
				profileId: "profile-felix",
				spaceId: "space-project",
			})
		);

		const abandoned = await result.current.prepareCatchUpMain();
		abandoned?.abandon();
		await result.current.prepareCatchUpMain();

		expect(queryClient.fetchQuery).toHaveBeenCalledTimes(2);
		expect(markCurrentSpaceInboxReadThroughMock).not.toHaveBeenCalled();
	});

	it("does not start a prepared catch-up write after the Space scope changes", async () => {
		const { result, rerender } = renderHook(
			(input: { organizationId: string; profileId: string; spaceId: string }) =>
				useSpaceInboxReadPosition({
					destination: "ordinary-space",
					organizationId: input.organizationId,
					profileId: input.profileId,
					spaceId: input.spaceId,
				}),
			{
				initialProps: {
					organizationId: "org-acme",
					profileId: "profile-felix",
					spaceId: "space-project",
				},
			}
		);
		const commit = await result.current.prepareCatchUpMain();

		rerender({
			organizationId: "org-acme",
			profileId: "profile-other",
			spaceId: "space-project",
		});
		await commit?.commit();

		expect(markCurrentSpaceInboxReadThroughMock).not.toHaveBeenCalled();
	});

	it("abandons catch-up preparation when the Space changes during the summary read", async () => {
		let resolveSummary: ((value: unknown) => void) | undefined;
		queryClient.fetchQuery.mockReturnValue(
			new Promise((resolve) => {
				resolveSummary = resolve;
			})
		);
		const { result, rerender } = renderHook(
			(input: { organizationId: string; profileId: string; spaceId: string }) =>
				useSpaceInboxReadPosition({
					destination: "ordinary-space",
					organizationId: input.organizationId,
					profileId: input.profileId,
					spaceId: input.spaceId,
				}),
			{
				initialProps: {
					organizationId: "org-acme",
					profileId: "profile-felix",
					spaceId: "space-project",
				},
			}
		);
		const preparation = result.current.prepareCatchUpMain();

		rerender({
			organizationId: "org-other",
			profileId: "profile-other",
			spaceId: "space-other",
		});
		resolveSummary?.({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 100,
					spaceId: "space-project",
					unreadCount: 3,
				},
			],
		});

		await expect(preparation).resolves.toBeNull();
		expect(markCurrentSpaceInboxReadThroughMock).not.toHaveBeenCalled();
	});
});
