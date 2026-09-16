import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSpaceUnread } from "./use-space-unread";

describe("useSpaceUnread", () => {
	it("keeps the main boundary separate from Thread targets", () => {
		const { result } = renderHook(() =>
			useSpaceUnread({
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
			count: 1,
			firstSignalId: "main-message",
			isReady: true,
		});
	});
});
