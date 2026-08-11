import { Graph, layout } from "@dagrejs/dagre";

const COMPONENT_GAP = 160;
const NODE_GAP = 56;
const RANK_GAP = 112;

export type SpaceGraphLayoutNodeSize = {
	height: number;
	width: number;
};

type SpaceGraphLayoutNode = {
	createdAtMs: number;
	id: string;
};

type SpaceGraphLayoutEdge = {
	source: string;
	target: string;
};

type SpaceGraphLayoutPosition = {
	x: number;
	y: number;
};

interface SpaceGraphLayoutBounds extends SpaceGraphLayoutPosition {
	height: number;
	width: number;
}

type SpaceGraphLayoutComponent = {
	bounds: SpaceGraphLayoutBounds;
	nodeIds: string[];
};

type BuildSpaceGraphLayoutInput = {
	edges: readonly SpaceGraphLayoutEdge[];
	nodeSizes: ReadonlyMap<string, SpaceGraphLayoutNodeSize>;
	nodes: readonly SpaceGraphLayoutNode[];
};

export type SpaceGraphLayout = {
	components: SpaceGraphLayoutComponent[];
	initialFocusNodeIds: string[];
	positions: Map<string, SpaceGraphLayoutPosition>;
};

export function buildSpaceGraphLayout(
	input: BuildSpaceGraphLayoutInput
): SpaceGraphLayout {
	const sortedNodes = [...input.nodes].sort(compareNodes);
	const nodeById = new Map(sortedNodes.map((node) => [node.id, node]));
	const validEdges = input.edges
		.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
		.sort(compareEdges);
	const components = findConnectedComponents(sortedNodes, validEdges, nodeById);
	const positions = new Map<string, SpaceGraphLayoutPosition>();
	const laidOutComponents: SpaceGraphLayoutComponent[] = [];
	let nextComponentY = 0;

	for (const componentNodeIds of components) {
		const component = layoutComponent({
			edges: validEdges.filter(
				(edge) =>
					componentNodeIds.includes(edge.source) &&
					componentNodeIds.includes(edge.target)
			),
			nodeIds: componentNodeIds,
			nodeSizes: input.nodeSizes,
			y: nextComponentY,
		});
		for (const [nodeId, position] of component.positions) {
			positions.set(nodeId, position);
		}
		laidOutComponents.push({
			bounds: component.bounds,
			nodeIds: componentNodeIds,
		});
		nextComponentY =
			component.bounds.y + component.bounds.height + COMPONENT_GAP;
	}

	return {
		components: laidOutComponents,
		initialFocusNodeIds: findLatestComponent(components, nodeById),
		positions,
	};
}

function findLatestComponent(
	components: readonly string[][],
	nodeById: ReadonlyMap<string, SpaceGraphLayoutNode>
): string[] {
	let latestComponent: string[] = [];
	let latestActivityAtMs = Number.NEGATIVE_INFINITY;
	for (const component of components) {
		const componentLatestActivityAtMs = Math.max(
			...component.map((nodeId) => requireNode(nodeById, nodeId).createdAtMs)
		);
		if (componentLatestActivityAtMs > latestActivityAtMs) {
			latestActivityAtMs = componentLatestActivityAtMs;
			latestComponent = component;
		}
	}
	return latestComponent;
}

function findConnectedComponents(
	nodes: readonly SpaceGraphLayoutNode[],
	edges: readonly SpaceGraphLayoutEdge[],
	nodeById: ReadonlyMap<string, SpaceGraphLayoutNode>
): string[][] {
	const neighbors = new Map(nodes.map((node) => [node.id, new Set<string>()]));
	for (const edge of edges) {
		neighbors.get(edge.source)?.add(edge.target);
		neighbors.get(edge.target)?.add(edge.source);
	}

	const visited = new Set<string>();
	const components: string[][] = [];
	for (const node of nodes) {
		if (visited.has(node.id)) {
			continue;
		}
		const pending = [node.id];
		const component: string[] = [];
		visited.add(node.id);
		while (pending.length > 0) {
			const currentNodeId = pending.shift();
			if (!currentNodeId) {
				continue;
			}
			component.push(currentNodeId);
			const sortedNeighbors = [...(neighbors.get(currentNodeId) ?? [])].sort(
				(leftId, rightId) =>
					compareNodes(
						requireNode(nodeById, leftId),
						requireNode(nodeById, rightId)
					)
			);
			for (const neighborId of sortedNeighbors) {
				if (!visited.has(neighborId)) {
					visited.add(neighborId);
					pending.push(neighborId);
				}
			}
		}
		components.push(
			component.sort((leftId, rightId) =>
				compareNodes(
					requireNode(nodeById, leftId),
					requireNode(nodeById, rightId)
				)
			)
		);
	}

	return components.sort((left, right) => {
		const leftNode = requireNode(nodeById, left[0]);
		const rightNode = requireNode(nodeById, right[0]);
		return compareNodes(leftNode, rightNode);
	});
}

function layoutComponent(input: {
	edges: readonly SpaceGraphLayoutEdge[];
	nodeIds: readonly string[];
	nodeSizes: ReadonlyMap<string, SpaceGraphLayoutNodeSize>;
	y: number;
}) {
	const graph = new Graph();
	graph.setDefaultEdgeLabel(() => ({}));
	graph.setGraph({
		marginx: 0,
		marginy: 0,
		nodesep: NODE_GAP,
		rankdir: "LR",
		ranksep: RANK_GAP,
	});
	for (const nodeId of input.nodeIds) {
		const size = requireNodeSize(input.nodeSizes, nodeId);
		graph.setNode(nodeId, { ...size });
	}
	for (const edge of input.edges) {
		graph.setEdge(edge.source, edge.target);
	}
	layout(graph);

	const localPositions = input.nodeIds.map((nodeId) => {
		const size = requireNodeSize(input.nodeSizes, nodeId);
		const node = graph.node(nodeId);
		if (!node) {
			throw new Error(`Space Graph layout did not position ${nodeId}.`);
		}
		return {
			nodeId,
			x: node.x - size.width / 2,
			y: node.y - size.height / 2,
		};
	});
	const minX = Math.min(...localPositions.map((position) => position.x));
	const minY = Math.min(...localPositions.map((position) => position.y));
	const positions = new Map<string, SpaceGraphLayoutPosition>();
	let width = 0;
	let height = 0;
	for (const position of localPositions) {
		const size = requireNodeSize(input.nodeSizes, position.nodeId);
		const normalizedPosition = {
			x: position.x - minX,
			y: position.y - minY + input.y,
		};
		positions.set(position.nodeId, normalizedPosition);
		width = Math.max(width, normalizedPosition.x + size.width);
		height = Math.max(height, normalizedPosition.y - input.y + size.height);
	}

	return {
		bounds: { height, width, x: 0, y: input.y },
		positions,
	};
}

function requireNode(
	nodes: ReadonlyMap<string, SpaceGraphLayoutNode>,
	nodeId: string | undefined
): SpaceGraphLayoutNode {
	const node = nodeId ? nodes.get(nodeId) : undefined;
	if (!node) {
		throw new Error(
			`Space Graph layout is missing node ${nodeId ?? "unknown"}.`
		);
	}
	return node;
}

function requireNodeSize(
	nodeSizes: ReadonlyMap<string, SpaceGraphLayoutNodeSize>,
	nodeId: string
): SpaceGraphLayoutNodeSize {
	const size = nodeSizes.get(nodeId);
	if (!size) {
		throw new Error(`Space Graph layout is missing a size for ${nodeId}.`);
	}
	return size;
}

function compareNodes(
	left: SpaceGraphLayoutNode,
	right: SpaceGraphLayoutNode
): number {
	return (
		left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id)
	);
}

function compareEdges(
	left: SpaceGraphLayoutEdge,
	right: SpaceGraphLayoutEdge
): number {
	return (
		left.source.localeCompare(right.source) ||
		left.target.localeCompare(right.target)
	);
}
