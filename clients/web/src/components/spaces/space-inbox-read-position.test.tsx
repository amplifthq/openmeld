import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inboxQueryKeys } from "#/query/organizations/inbox";
import { useSpaceInboxReadPosition } from "./use-space-inbox-read-position";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("#/lib/organizations/inbox", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/lib/organizations/inbox")>()),
	mutateCurrentSpaceInboxRead: mutate,
}));
const first = {
	itemId: "first",
	signalId: "first",
	occurredAtMs: 10,
	threadRootSignalId: null,
};
const later = {
	itemId: "later",
	signalId: "later",
	occurredAtMs: 20,
	threadRootSignalId: "root",
};
function setup() {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	const key = inboxQueryKeys.spaceUnreadTargets("org", "space");
	client.setQueryData(key, {
		organizationId: "org",
		spaceId: "space",
		targets: [first, later],
		totalUnreadCount: 2,
		hasMoreTargets: false,
	});
	// Keep the test at the mutation boundary: cached facts are refreshed by the real query invalidation.
	const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
	const hook = renderHook(
		() =>
			useSpaceInboxReadPosition({
				organizationId: "org",
				profileId: "profile",
				spaceId: "space",
				destination: "ordinary-space",
			}),
		{
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		}
	);
	return { ...hook, client, key, invalidate };
}
beforeEach(() =>
	mutate
		.mockReset()
		.mockResolvedValue({ operation: "read", markedReadCount: 1 })
);
describe("Space unread writes", () => {
	it("acknowledges a viewed thread reply without clearing an earlier main update", async () => {
		const { result, client, key } = setup();
		await act(() => result.current.markViewed([later]));
		expect(mutate).toHaveBeenCalledWith({
			organizationId: "org",
			body: {
				operation: "read",
				spaceId: "space",
				items: [{ itemId: "later", occurredAtMs: 20 }],
			},
		});
		expect(client.getQueryData(key)).toMatchObject({
			targets: [first],
			totalUnreadCount: 1,
		});
	});
	it("restores unread facts after a failed write and permits retry", async () => {
		mutate.mockRejectedValueOnce(new Error("offline"));
		const { result, client, key } = setup();
		await act(async () => {
			await expect(result.current.markViewed([later])).rejects.toThrow(
				"offline"
			);
		});
		expect(client.getQueryData(key)).toMatchObject({
			targets: [first, later],
			totalUnreadCount: 2,
		});
		await act(() => result.current.markViewed([later]));
		expect(client.getQueryData(key)).toMatchObject({
			targets: [first],
			totalUnreadCount: 1,
		});
	});
	it("does not clear anything until confirmed and retries the same frozen selection", async () => {
		mutate.mockResolvedValueOnce({
			operation: "prepare",
			snapshotId: "frozen",
			unreadCount: 2,
		});
		const { result } = setup();
		const selection = await result.current.prepareMarkAllRead();
		expect(mutate).toHaveBeenCalledTimes(1);
		mutate.mockRejectedValueOnce(new Error("offline"));
		await expect(selection.commit()).rejects.toThrow("offline");
		await selection.commit();
		expect(mutate.mock.calls.slice(1)).toEqual(
			new Array(2).fill([
				{
					organizationId: "org",
					body: { operation: "clear", spaceId: "space", snapshotId: "frozen" },
				},
			])
		);
	});
	it("does not turn a successful durable read into a failed write when refreshing fails", async () => {
		const { result, invalidate } = setup();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		invalidate.mockRejectedValue(new Error("refresh offline"));
		await act(async () => {
			await expect(result.current.markViewed([later])).resolves.toBeUndefined();
		});
		expect(mutate).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});
});
