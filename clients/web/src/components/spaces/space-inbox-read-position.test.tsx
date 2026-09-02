import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaceInboxReadPosition } from "./use-space-inbox-read-position";

const {
	invalidateInboxFactsMock,
	markCurrentSpaceInboxReadThroughMock,
	queryClient,
} = vi.hoisted(() => ({
	invalidateInboxFactsMock: vi.fn(),
	markCurrentSpaceInboxReadThroughMock: vi.fn(),
	queryClient: {},
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
	invalidateInboxFacts: invalidateInboxFactsMock,
	spaceInboxUnreadTargetsQueryOptions: vi.fn(() => ({})),
}));

describe("useSpaceInboxReadPosition", () => {
	beforeEach(() => {
		invalidateInboxFactsMock.mockReset().mockResolvedValue(undefined);
		markCurrentSpaceInboxReadThroughMock
			.mockReset()
			.mockResolvedValue(undefined);
	});

	it("persists the visible read position for any Space", async () => {
		const { result } = renderHook(() =>
			useSpaceInboxReadPosition({
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
		expect(invalidateInboxFactsMock).toHaveBeenCalledWith({
			organizationId: "org-acme",
			queryClient,
		});
	});

	it("does not write without an Organization identity", async () => {
		const { result } = renderHook(() =>
			useSpaceInboxReadPosition({
				organizationId: null,
				spaceId: "space-project",
			})
		);

		await result.current.markReadThrough(42);
		expect(markCurrentSpaceInboxReadThroughMock).not.toHaveBeenCalled();
		expect(invalidateInboxFactsMock).not.toHaveBeenCalled();
	});
});
