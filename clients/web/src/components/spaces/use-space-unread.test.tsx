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

	it("can establish the boundary after an initially empty ready snapshot", () => {
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

		expect(result.current.firstSignalId).toBe("late-loaded-unread");
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
});
