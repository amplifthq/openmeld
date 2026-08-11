import { describe, expect, it } from "vitest";
import { mergeSpaceGraphNodeState } from "./space-graph-node-state";

describe("mergeSpaceGraphNodeState", () => {
	it("keeps stable coordinates when the graph topology is unchanged", () => {
		const nodes = mergeSpaceGraphNodeState({
			currentNodes: [
				{ id: "message:current", position: { x: 40, y: 80 }, selected: true },
				{ id: "reply:current", position: { x: 400, y: 80 } },
			],
			projectedNodes: [
				{ id: "message:current", position: { x: 80, y: 120 } },
				{ id: "reply:current", position: { x: 440, y: 120 } },
			],
		});

		expect(nodes).toEqual([
			{ id: "message:current", position: { x: 40, y: 80 }, selected: true },
			{
				id: "reply:current",
				position: { x: 400, y: 80 },
				selected: undefined,
			},
		]);
	});

	it("uses one fresh canonical layout when earlier history changes the topology", () => {
		const nodes = mergeSpaceGraphNodeState({
			currentNodes: [
				{ id: "message:current", position: { x: 40, y: 80 }, selected: true },
				{ id: "reply:current", position: { x: 400, y: 80 } },
			],
			projectedNodes: [
				{ id: "message:earlier", position: { x: 0, y: 0 } },
				{ id: "message:current", position: { x: 0, y: 260 } },
				{ id: "reply:current", position: { x: 360, y: 260 } },
			],
		});

		expect(nodes).toEqual([
			{ id: "message:earlier", position: { x: 0, y: 0 } },
			{
				id: "message:current",
				position: { x: 0, y: 260 },
				selected: true,
			},
			{
				id: "reply:current",
				position: { x: 360, y: 260 },
				selected: undefined,
			},
		]);
	});
});
