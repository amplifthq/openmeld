import type { XYPosition } from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";

const EMPTY_NODE_POSITIONS: ReadonlyMap<string, XYPosition> = new Map();

export function useSpaceGraphLayout(spaceId: string | undefined): {
	nodePositions: ReadonlyMap<string, XYPosition>;
	onNodePositionChange: (nodeId: string, position: XYPosition) => void;
	onResetNodePositions: () => void;
} {
	const [layout, setLayout] = useState<{
		nodePositions: ReadonlyMap<string, XYPosition>;
		spaceId: string | undefined;
	}>(() => ({ nodePositions: new Map(), spaceId }));

	useEffect(() => {
		setLayout((current) =>
			current.spaceId === spaceId
				? current
				: { nodePositions: new Map(), spaceId }
		);
	}, [spaceId]);

	const onNodePositionChange = useCallback(
		(nodeId: string, position: XYPosition) => {
			setLayout((current) => {
				const nextPositions = new Map(
					current.spaceId === spaceId ? current.nodePositions : undefined
				);
				nextPositions.set(nodeId, position);
				return { nodePositions: nextPositions, spaceId };
			});
		},
		[spaceId]
	);
	const onResetNodePositions = useCallback(() => {
		setLayout({ nodePositions: new Map(), spaceId });
	}, [spaceId]);

	return {
		nodePositions:
			layout.spaceId === spaceId ? layout.nodePositions : EMPTY_NODE_POSITIONS,
		onNodePositionChange,
		onResetNodePositions,
	};
}
