import { describe, expect, it } from "vitest";
import {
	buildSpaceGraphLayout,
	type SpaceGraphLayoutNodeSize,
} from "./space-graph-layout";

describe("buildSpaceGraphLayout", () => {
	it("lays each relationship left to right and stacks unrelated relationships vertically", () => {
		const nodeSizes = new Map<string, SpaceGraphLayoutNodeSize>([
			["message:first", { height: 220, width: 288 }],
			["wake:first:codex", { height: 96, width: 208 }],
			["message:first-reply", { height: 176, width: 288 }],
			["message:second", { height: 260, width: 288 }],
			["message:second-reply", { height: 176, width: 288 }],
		]);
		const layout = buildSpaceGraphLayout({
			edges: [
				{ source: "message:first", target: "wake:first:codex" },
				{ source: "wake:first:codex", target: "message:first-reply" },
				{ source: "message:second", target: "message:second-reply" },
			],
			nodeSizes,
			nodes: [
				{ createdAtMs: 100, id: "message:first" },
				{ createdAtMs: 100, id: "wake:first:codex" },
				{ createdAtMs: 110, id: "message:first-reply" },
				{ createdAtMs: 200, id: "message:second" },
				{ createdAtMs: 210, id: "message:second-reply" },
			],
		});

		expect(layout.components).toHaveLength(2);
		expect(positionOf(layout, "message:first").x).toBeLessThan(
			positionOf(layout, "wake:first:codex").x
		);
		expect(positionOf(layout, "wake:first:codex").x).toBeLessThan(
			positionOf(layout, "message:first-reply").x
		);
		expect(positionOf(layout, "message:second").x).toBeLessThan(
			positionOf(layout, "message:second-reply").x
		);

		const [firstComponent, secondComponent] = layout.components;
		expect(firstComponent).toBeDefined();
		expect(secondComponent).toBeDefined();
		expect(secondComponent?.bounds.y).toBeGreaterThan(
			(firstComponent?.bounds.y ?? 0) + (firstComponent?.bounds.height ?? 0)
		);
		expect(layout.initialFocusNodeIds).toEqual([
			"message:second",
			"message:second-reply",
		]);
		expect(findOverlaps(layout.positions, nodeSizes)).toEqual([]);
	});

	it("produces the same positions when timeline input order changes", () => {
		const nodeSizes = new Map<string, SpaceGraphLayoutNodeSize>([
			["message:source", { height: 176, width: 288 }],
			["wake:source:claude", { height: 96, width: 208 }],
			["wake:source:codex", { height: 96, width: 208 }],
		]);
		const nodes = [
			{ createdAtMs: 100, id: "message:source" },
			{ createdAtMs: 100, id: "wake:source:claude" },
			{ createdAtMs: 100, id: "wake:source:codex" },
		];
		const edges = [
			{ source: "message:source", target: "wake:source:codex" },
			{ source: "message:source", target: "wake:source:claude" },
		];

		const forward = buildSpaceGraphLayout({ edges, nodeSizes, nodes });
		const reversed = buildSpaceGraphLayout({
			edges: [...edges].reverse(),
			nodeSizes,
			nodes: [...nodes].reverse(),
		});

		expect([...reversed.positions]).toEqual([...forward.positions]);
	});

	it("focuses the relationship with the latest activity, not the newest start", () => {
		const nodeSizes = new Map<string, SpaceGraphLayoutNodeSize>([
			["message:older", { height: 176, width: 288 }],
			["message:older-reply", { height: 176, width: 288 }],
			["message:newer", { height: 176, width: 288 }],
		]);

		const layout = buildSpaceGraphLayout({
			edges: [{ source: "message:older", target: "message:older-reply" }],
			nodeSizes,
			nodes: [
				{ createdAtMs: 100, id: "message:older" },
				{ createdAtMs: 300, id: "message:older-reply" },
				{ createdAtMs: 200, id: "message:newer" },
			],
		});

		expect(layout.initialFocusNodeIds).toEqual([
			"message:older",
			"message:older-reply",
		]);
	});
});

function positionOf(
	layout: ReturnType<typeof buildSpaceGraphLayout>,
	nodeId: string
) {
	const position = layout.positions.get(nodeId);
	if (!position) {
		throw new Error(`Expected a position for ${nodeId}.`);
	}
	return position;
}

function findOverlaps(
	positions: ReadonlyMap<string, { x: number; y: number }>,
	nodeSizes: ReadonlyMap<string, SpaceGraphLayoutNodeSize>
): string[] {
	const overlaps: string[] = [];
	const nodeIds = [...positions.keys()];
	for (let leftIndex = 0; leftIndex < nodeIds.length; leftIndex += 1) {
		for (
			let rightIndex = leftIndex + 1;
			rightIndex < nodeIds.length;
			rightIndex += 1
		) {
			const leftId = nodeIds[leftIndex];
			const rightId = nodeIds[rightIndex];
			if (!(leftId && rightId)) {
				continue;
			}
			const leftPosition = positions.get(leftId);
			const rightPosition = positions.get(rightId);
			const leftSize = nodeSizes.get(leftId);
			const rightSize = nodeSizes.get(rightId);
			if (!(leftPosition && rightPosition && leftSize && rightSize)) {
				throw new Error(
					"Expected every layout node to have a position and size."
				);
			}
			const nodesOverlap =
				leftPosition.x < rightPosition.x + rightSize.width &&
				leftPosition.x + leftSize.width > rightPosition.x &&
				leftPosition.y < rightPosition.y + rightSize.height &&
				leftPosition.y + leftSize.height > rightPosition.y;
			if (nodesOverlap) {
				overlaps.push(`${leftId} overlaps ${rightId}`);
			}
		}
	}
	return overlaps;
}
