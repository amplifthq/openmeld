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
	queryClient: { cancelQueries: vi.fn() },
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
	},
	invalidateInboxFacts: invalidateInboxFactsMock,
	spaceInboxUnreadTargetsQueryOptions: vi.fn(() => ({})),
}));

vi.mock("#/query/organizations/inbox-read-through-cache", () => ({
	optimisticallyMarkSpaceInboxReadThrough:
		optimisticallyMarkSpaceInboxReadThroughMock,
}));

describe("useSpaceInboxReadPosition", () => {
	beforeEach(() => {
		queryClient.cancelQueries.mockReset().mockResolvedValue(undefined);
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

	it("does not write without an Organization identity", async () => {
		const { result } = renderHook(() =>
			useSpaceInboxReadPosition({
				destination: "ordinary-space",
				organizationId: null,
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
});
