import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSpaceGraphLayout } from "./use-space-graph-layout";

describe("useSpaceGraphLayout", () => {
	it("keeps dragged node positions while the same Space remains open", () => {
		const { result, rerender } = renderHook(
			({ spaceId }) => useSpaceGraphLayout(spaceId),
			{ initialProps: { spaceId: "space-1" } }
		);

		act(() => {
			result.current.onNodePositionChange("message:one", { x: 420, y: 180 });
		});
		rerender({ spaceId: "space-1" });

		expect(result.current.nodePositions.get("message:one")).toEqual({
			x: 420,
			y: 180,
		});
	});

	it("does not carry a layout into a different Space", () => {
		const { result, rerender } = renderHook(
			({ spaceId }) => useSpaceGraphLayout(spaceId),
			{ initialProps: { spaceId: "space-1" } }
		);

		act(() => {
			result.current.onNodePositionChange("message:one", { x: 420, y: 180 });
		});
		rerender({ spaceId: "space-2" });

		expect(result.current.nodePositions.size).toBe(0);
	});

	it("clears every dragged position when the layout is reset", () => {
		const { result } = renderHook(() => useSpaceGraphLayout("space-1"));

		act(() => {
			result.current.onNodePositionChange("message:one", { x: 420, y: 180 });
			result.current.onNodePositionChange("message:two", { x: 840, y: 360 });
		});
		expect(result.current.nodePositions.size).toBe(2);

		act(() => {
			result.current.onResetNodePositions();
		});

		expect(result.current.nodePositions.size).toBe(0);
	});
});
