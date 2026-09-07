import {
	Background,
	BackgroundVariant,
	Controls,
	type Edge,
	type Node,
	ReactFlow,
	type ReactFlowProps,
	ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";

/** Shared viewport mechanics. Product surfaces own nodes, edges and persistence. */
export function WorkspaceCanvas<N extends Node, E extends Edge = Edge>({
	children,
	controls,
	...props
}: ReactFlowProps<N, E> & { controls?: import("react").ReactNode }) {
	const { resolvedTheme } = useTheme();
	return (
		<ReactFlowProvider>
			<ReactFlow<N, E>
				colorMode={resolvedTheme === "dark" ? "dark" : "light"}
				deleteKeyCode={null}
				maxZoom={1.8}
				minZoom={0.2}
				nodesConnectable={false}
				onlyRenderVisibleElements
				panOnScroll
				proOptions={{ hideAttribution: true }}
				selectionOnDrag={false}
				{...props}
			>
				<Background
					color="color-mix(in oklab, var(--foreground) 18%, transparent)"
					gap={20}
					size={1.25}
					variant={BackgroundVariant.Dots}
				/>
				{controls ?? (
					<Controls position="bottom-left" showInteractive={false} />
				)}
				{children}
			</ReactFlow>
		</ReactFlowProvider>
	);
}
