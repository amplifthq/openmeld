import type { SpaceInboxUnreadTarget } from "@openmeld/schemas/types";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSpaceUnread } from "./use-space-unread";

describe("useSpaceUnread", () => {
	it("keeps the main boundary separate from Thread targets", () => {
		const { result } = renderHook(() =>
			useSpaceUnread({
				identity: "space:profile",
				isReady: true,
				targets: [
					{
						occurredAtMs: 40,
						signalId: "main-message",
						threadRootSignalId: null,
					},
					{
						occurredAtMs: 50,
						signalId: "thread-reply",
						threadRootSignalId: "root",
					},
				],
			})
		);
		expect(result.current).toMatchObject({
			firstSignalId: "main-message",
			isReady: true,
		});
	});

	it("freezes the first unread boundary for the visit", () => {
		const { result, rerender } = renderHook(
			({ targets }) =>
				useSpaceUnread({
					identity: "space:profile",
					isReady: true,
					targets,
				}),
			{
				initialProps: {
					targets: [
						{
							occurredAtMs: 40,
							signalId: "first-unread",
							threadRootSignalId: null,
						},
						{
							occurredAtMs: 50,
							signalId: "second-unread",
							threadRootSignalId: null,
						},
					],
				},
			}
		);

		rerender({
			targets: [
				{
					occurredAtMs: 50,
					signalId: "second-unread",
					threadRootSignalId: null,
				},
			],
		});

		expect(result.current.firstSignalId).toBe("first-unread");
	});

	it("does not mark arrivals during an already open visit as new", () => {
		const { result, rerender } = renderHook(
			({ targets }) =>
				useSpaceUnread({
					identity: "space:profile",
					isReady: true,
					targets,
				}),
			{ initialProps: { targets: [] as SpaceInboxUnreadTarget[] } }
		);

		rerender({
			targets: [
				{
					occurredAtMs: 40,
					signalId: "late-loaded-unread",
					threadRootSignalId: null,
				},
			],
		});

		expect(result.current.firstSignalId).toBeNull();
	});

	it("resets the boundary when the visit identity changes", () => {
		const { result, rerender } = renderHook(
			({ identity, signalId }) =>
				useSpaceUnread({
					identity,
					isReady: true,
					targets: [
						{
							occurredAtMs: 40,
							signalId,
							threadRootSignalId: null,
						},
					],
				}),
			{ initialProps: { identity: "space-a:profile", signalId: "a" } }
		);

		rerender({ identity: "space-b:profile", signalId: "b" });

		expect(result.current.firstSignalId).toBe("b");
	});
	it("waits for an existing unread target before capturing the entry boundary", () => {
		const { result, rerender } = renderHook(
			({ targets }: { targets: SpaceInboxUnreadTarget[] }) =>
				useSpaceUnread({
					identity: "same",
					isReady: true,
					scopes: [{ threadRootSignalId: null, unreadCount: 1 }],
					targets,
				}),
			{ initialProps: { targets: [] as SpaceInboxUnreadTarget[] } }
		);
		rerender({
			targets: [
				{ signalId: "entry-unread", occurredAtMs: 1, threadRootSignalId: null },
			],
		});
		expect(result.current.firstSignalId).toBe("entry-unread");
	});
	it("removes a read boundary without introducing another during the visit", () => {
		const old = { signalId: "old", occurredAtMs: 1, threadRootSignalId: null };
		const { result, rerender } = renderHook(
			({ targets }: { targets: SpaceInboxUnreadTarget[] }) =>
				useSpaceUnread({ identity: "same", isReady: true, targets }),
			{ initialProps: { targets: [old] } }
		);
		rerender({ targets: [] });
		expect(result.current.firstSignalId).toBeNull();
		rerender({ targets: [{ ...old, signalId: "new", occurredAtMs: 2 }] });
		expect(result.current.firstSignalId).toBeNull();
	});
});
