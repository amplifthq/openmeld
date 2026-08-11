type PositionedGraphNode = {
	id: string;
	position: { x: number; y: number };
	selected?: boolean;
};

/**
 * React Flow positions remain stable while the same graph is updating. When
 * history changes the node set, every node adopts the newly computed layout
 * in one pass so old coordinates cannot overlap newly added nodes.
 */
export function mergeSpaceGraphNodeState<T extends PositionedGraphNode>(input: {
	currentNodes: readonly T[];
	projectedNodes: readonly T[];
}): T[] {
	const currentById = new Map(
		input.currentNodes.map((node) => [node.id, node])
	);
	const topologyIsUnchanged =
		input.currentNodes.length === input.projectedNodes.length &&
		input.projectedNodes.every((node) => currentById.has(node.id));

	return input.projectedNodes.map((node) => {
		const currentNode = currentById.get(node.id);
		if (!currentNode) {
			return node;
		}
		return {
			...node,
			position: topologyIsUnchanged ? currentNode.position : node.position,
			selected: currentNode.selected,
		};
	});
}
