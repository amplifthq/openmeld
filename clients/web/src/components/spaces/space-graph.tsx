import {
	Background,
	BackgroundVariant,
	Controls,
	type Edge,
	Handle,
	MarkerType,
	MiniMap,
	type Node,
	type NodeChange,
	type NodeProps,
	Position,
	ReactFlow,
	type ReactFlowInstance,
	type ReactFlowProps,
	useNodesState,
	type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowCounterClockwiseIcon,
	ArrowSquareOutIcon,
	ArrowsOutIcon,
} from "@phosphor-icons/react";
import { useReducedMotion } from "framer-motion";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { OpenMeldSystemIcon } from "./openmeld-system-icon";
import {
	buildSpaceGraphLayout,
	type SpaceGraphLayoutNodeSize,
} from "./space-graph-layout";
import { mergeSpaceGraphNodeState } from "./space-graph-node-state";
import type {
	SpaceGraphEdge,
	SpaceGraphMessageNode,
	SpaceGraphNode,
	SpaceGraphPresentation,
	SpaceGraphWakeNode,
	SpaceGraphWakeStatus,
} from "./space-graph-presentation";
import { SpaceProfileIcon } from "./space-profile-icon";

export type SpaceGraphFocusRequest = {
	requestId: number;
	signalId: string;
};

type SpaceGraphNodeFocusState = "dimmed" | "focused" | "related" | null;

type SpaceFlowNodeData = {
	focusState: SpaceGraphNodeFocusState;
	graphNode: SpaceGraphNode;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
};

type SpaceFlowNode = Node<SpaceFlowNodeData, "spaceGraph">;

const NODE_TYPES = {
	spaceGraph: SpaceGraphNodeCard,
} satisfies NonNullable<ReactFlowProps<SpaceFlowNode>["nodeTypes"]>;

const MESSAGE_NODE_SIZE = { height: 176, width: 288 } as const;
const WAKE_NODE_SIZE = { height: 96, width: 208 } as const;

export function SpaceGraph(input: {
	focusRequest?: SpaceGraphFocusRequest | null;
	graph: SpaceGraphPresentation;
	hasEarlierHistory: boolean;
	isLoadingEarlierHistory: boolean;
	nodePositions: ReadonlyMap<string, XYPosition>;
	onLoadEarlierHistory: () => void;
	onNodePositionChange: (nodeId: string, position: XYPosition) => void;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
	onResetNodePositions: () => void;
}) {
	const { resolvedTheme } = useTheme();
	const shouldReduceMotion = useReducedMotion() === true;
	const reactFlowInstanceRef = useRef<ReactFlowInstance<SpaceFlowNode> | null>(
		null
	);
	const layout = useMemo(
		() =>
			buildSpaceGraphLayout({
				edges: input.graph.edges,
				nodeSizes: buildSpaceGraphNodeSizes(input.graph),
				nodes: input.graph.nodes,
			}),
		[input.graph]
	);
	const focusedNodeIds = useMemo(
		() => resolveFocusedGraphNodeIds(input.graph, input.focusRequest),
		[input.graph, input.focusRequest]
	);
	const focusedNodeId = focusedNodeIds
		? `message:${input.focusRequest?.signalId ?? ""}`
		: null;
	const projectedNodes = buildSpaceFlowNodes({
		focusedNodeId,
		focusedNodeIds,
		graph: input.graph,
		layoutPositions: layout.positions,
		nodePositions: input.nodePositions,
		onOpenMessageDetails: input.onOpenMessageDetails,
	});
	const [nodes, setNodes, applyNodesChange] = useNodesState(projectedNodes);
	const edges = useMemo(
		() => buildSpaceFlowEdges(input.graph, shouldReduceMotion, focusedNodeIds),
		[focusedNodeIds, input.graph, shouldReduceMotion]
	);
	const onNodesChange = useCallback(
		(changes: NodeChange<SpaceFlowNode>[]) => {
			const readOnlyChanges = changes.filter(
				(change) => change.type !== "remove"
			);
			applyNodesChange(readOnlyChanges);
			for (const change of readOnlyChanges) {
				if (
					change.type === "position" &&
					change.position &&
					change.dragging !== true
				) {
					input.onNodePositionChange(change.id, change.position);
				}
			}
		},
		[applyNodesChange, input.onNodePositionChange]
	);
	const onResetLayout = () => {
		input.onResetNodePositions();
		const canonicalNodes = buildSpaceFlowNodes({
			focusedNodeId,
			focusedNodeIds,
			graph: input.graph,
			layoutPositions: layout.positions,
			nodePositions: new Map(),
			onOpenMessageDetails: input.onOpenMessageDetails,
		});
		setNodes((currentNodes) =>
			mergeSpaceGraphNodeState({ currentNodes, projectedNodes: canonicalNodes })
		);
		requestAnimationFrame(() => {
			const instance = reactFlowInstanceRef.current;
			if (!instance) {
				return;
			}
			instance
				.fitView({
					maxZoom: 1,
					nodes: layout.initialFocusNodeIds.map((id) => ({ id })),
					padding: 0.2,
				})
				.catch((error) => {
					console.error("Space Graph could not reset its viewport.", error);
				});
		});
	};

	useEffect(() => {
		const nextNodes = buildSpaceFlowNodes({
			focusedNodeId,
			focusedNodeIds,
			graph: input.graph,
			layoutPositions: layout.positions,
			nodePositions: input.nodePositions,
			onOpenMessageDetails: input.onOpenMessageDetails,
		});
		setNodes((currentNodes) =>
			mergeSpaceGraphNodeState({ currentNodes, projectedNodes: nextNodes })
		);
	}, [
		focusedNodeId,
		focusedNodeIds,
		input.graph,
		input.nodePositions,
		input.onOpenMessageDetails,
		layout.positions,
		setNodes,
	]);

	useEffect(() => {
		if (!(input.focusRequest && focusedNodeIds)) {
			return;
		}
		const frameId = window.requestAnimationFrame(() => {
			fitGraphFocus({
				focusedNodeIds,
				instance: reactFlowInstanceRef.current,
			});
		});
		return () => window.cancelAnimationFrame(frameId);
	}, [focusedNodeIds, input.focusRequest]);

	if (nodes.length === 0) {
		return (
			<section
				aria-label="Space Graph"
				className="flex min-h-0 flex-1 items-center justify-center bg-muted/25 px-6 text-center"
			>
				<div className="max-w-sm">
					<p className="font-medium text-sm">Nothing to graph yet</p>
					<p className="mt-1 text-muted-foreground text-sm leading-6">
						Messages, replies, and Wake activity will appear here as they
						happen.
					</p>
					{input.hasEarlierHistory ? (
						<LoadEarlierGraphActivityButton
							className="mt-3"
							isLoading={input.isLoadingEarlierHistory}
							onClick={input.onLoadEarlierHistory}
						/>
					) : null}
				</div>
			</section>
		);
	}

	return (
		<section
			aria-label="Space Graph"
			className="relative min-h-0 flex-1 overflow-hidden bg-muted/25"
		>
			<div className="absolute top-3 left-3 z-10 flex items-center gap-2 rounded-lg border border-border/70 bg-background/90 px-2 py-1.5 text-muted-foreground text-xs shadow-sm backdrop-blur-sm">
				<ArrowsOutIcon aria-hidden="true" className="size-3.5" />
				<span>Drag cards to arrange</span>
				<Button
					aria-label="Reset layout"
					className="nodrag nopan text-foreground"
					onClick={onResetLayout}
					size="xs"
					type="button"
					variant="ghost"
				>
					<ArrowCounterClockwiseIcon aria-hidden="true" />
					Reset
				</Button>
				{input.hasEarlierHistory ? (
					<LoadEarlierGraphActivityButton
						isLoading={input.isLoadingEarlierHistory}
						onClick={input.onLoadEarlierHistory}
					/>
				) : null}
			</div>
			<ReactFlow<SpaceFlowNode>
				colorMode={
					resolvedTheme === "light" || resolvedTheme === "dark"
						? resolvedTheme
						: "system"
				}
				deleteKeyCode={null}
				disableKeyboardA11y={false}
				edges={edges}
				edgesFocusable={true}
				fitView={true}
				fitViewOptions={{
					maxZoom: 1,
					nodes: layout.initialFocusNodeIds.map((id) => ({ id })),
					padding: 0.2,
				}}
				maxZoom={1.8}
				minZoom={0.2}
				nodes={nodes}
				nodesConnectable={false}
				nodesDraggable={true}
				nodesFocusable={true}
				nodeTypes={NODE_TYPES}
				onError={(code, message) => {
					console.error("Space Graph could not render an element.", {
						code,
						message,
					});
				}}
				onInit={(instance) => {
					reactFlowInstanceRef.current = instance;
					if (focusedNodeIds) {
						fitGraphFocus({ focusedNodeIds, instance });
					}
				}}
				onlyRenderVisibleElements={true}
				onNodeClick={(_event, node) => {
					const graphNode = node.data.graphNode;
					if (graphNode.kind === "message") {
						input.onOpenMessageDetails(graphNode.item);
					}
				}}
				onNodesChange={onNodesChange}
				onPaneClick={() => {
					document.activeElement instanceof HTMLElement &&
						document.activeElement.blur();
				}}
				panOnScroll={true}
				proOptions={{ hideAttribution: true }}
				selectionOnDrag={false}
			>
				<Background
					color="color-mix(in oklab, var(--foreground) 18%, transparent)"
					gap={20}
					size={1.25}
					variant={BackgroundVariant.Dots}
				/>
				<Controls position="bottom-left" showInteractive={false} />
				{nodes.length > 6 ? (
					<MiniMap
						className="!border !border-border !bg-background/90"
						maskColor="color-mix(in oklab, var(--background) 72%, transparent)"
						pannable={true}
						position="bottom-right"
						zoomable={true}
					/>
				) : null}
			</ReactFlow>
		</section>
	);
}

function LoadEarlierGraphActivityButton(input: {
	className?: string;
	isLoading: boolean;
	onClick: () => void;
}) {
	return (
		<button
			className={cn(
				"nodrag nopan rounded-md border border-border bg-background px-2 py-1 font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none",
				input.className
			)}
			disabled={input.isLoading}
			onClick={input.onClick}
			type="button"
		>
			{input.isLoading ? "Loading earlier…" : "Load earlier"}
		</button>
	);
}

function SpaceGraphNodeCard({ data, selected }: NodeProps<SpaceFlowNode>) {
	const graphNode = data.graphNode;
	if (graphNode.kind === "wake") {
		return (
			<SpaceGraphWakeNodeCard
				focusState={data.focusState}
				node={graphNode}
				selected={selected}
			/>
		);
	}

	const isSystemNotice = graphNode.item.signalType === "signal.system_notice";
	return (
		<div
			className={cn(
				"group relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-[border-color,box-shadow,opacity] motion-reduce:transition-none",
				selected || data.focusState === "focused"
					? "border-ring shadow-md ring-2 ring-ring/15"
					: "border-border hover:border-foreground/20 hover:shadow-md",
				data.focusState === "related" && "border-foreground/20",
				data.focusState === "dimmed" && "opacity-35",
				isSystemNotice && "border-destructive/30"
			)}
		>
			<Handle
				className="!size-2 !border-background !bg-muted-foreground/65"
				position={Position.Left}
				type="target"
			/>
			<div className="flex min-w-0 items-center justify-between gap-3 border-border/70 border-b px-3.5 py-2.5">
				<div className="flex min-w-0 items-center gap-2.5">
					<SpaceGraphMessageActorIcon node={graphNode} />
					<div className="min-w-0">
						<p className="truncate font-medium text-xs">
							{graphNode.actorName}
						</p>
						<p className="mt-0.5 text-[11px] text-muted-foreground">
							{resolveMessageKindLabel(graphNode.item)}
						</p>
					</div>
				</div>
				<time className="shrink-0 text-[11px] text-muted-foreground">
					{formatGraphNodeTime(graphNode.createdAtMs)}
				</time>
			</div>
			<p className="line-clamp-3 min-h-0 flex-1 whitespace-pre-wrap px-3.5 py-3 text-sm leading-6">
				{graphNode.text || "No message text"}
			</p>
			<button
				className="nodrag nopan flex w-full items-center justify-between border-border/70 border-t px-3.5 py-2.5 text-left font-medium text-muted-foreground text-xs outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none"
				onClick={(event) => {
					event.stopPropagation();
					data.onOpenMessageDetails(graphNode.item);
				}}
				type="button"
			>
				<span>Open details</span>
				<ArrowSquareOutIcon aria-hidden="true" className="size-3.5" />
			</button>
			<Handle
				className="!size-2 !border-background !bg-muted-foreground/65"
				position={Position.Right}
				type="source"
			/>
		</div>
	);
}

function SpaceGraphWakeNodeCard(input: {
	focusState: SpaceGraphNodeFocusState;
	node: SpaceGraphWakeNode;
	selected: boolean;
}) {
	const status = WAKE_STATUS_PRESENTATION[input.node.status];
	return (
		<div
			className={cn(
				"relative h-full w-full rounded-xl border bg-card px-3.5 py-3 text-card-foreground shadow-sm transition-[border-color,box-shadow,opacity] motion-reduce:transition-none",
				input.selected || input.focusState === "focused"
					? "border-ring shadow-md ring-2 ring-ring/15"
					: "border-border hover:border-foreground/20 hover:shadow-md",
				input.focusState === "related" && "border-foreground/20",
				input.focusState === "dimmed" && "opacity-35"
			)}
		>
			<Handle
				className="!size-2 !border-background !bg-muted-foreground/65"
				position={Position.Left}
				type="target"
			/>
			<div className="flex min-w-0 items-center gap-2.5">
				<SpaceGraphWakeActorIcon node={input.node} />
				<div className="min-w-0">
					<p className="truncate font-medium text-sm">{input.node.label}</p>
					<p className="text-[11px] text-muted-foreground">Agent activity</p>
				</div>
			</div>
			<div className="mt-2 flex items-center gap-2 text-xs">
				<span
					aria-hidden="true"
					className={cn("status-dot", status.indicatorClassName)}
				/>
				<span className={status.textClassName}>{status.label}</span>
			</div>
			<Handle
				className="!size-2 !border-background !bg-muted-foreground/65"
				position={Position.Right}
				type="source"
			/>
		</div>
	);
}

function SpaceGraphMessageActorIcon(input: { node: SpaceGraphMessageNode }) {
	const profile = input.node.profilePresentation;
	if (profile) {
		return (
			<SpaceProfileIcon
				agentControllerRef={profile.agentControllerRef}
				avatarImageUrl={profile.avatarImageUrl}
				isCenterAgent={profile.isCenterAgent}
				profileId={profile.profileId}
				profileKind={profile.profileKind}
				profileName={profile.profileName}
				size="sm"
			/>
		);
	}
	const actorProfileKind = input.node.actorProfileKind;
	if (actorProfileKind === "system") {
		return (
			<span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
				<OpenMeldSystemIcon />
			</span>
		);
	}
	const actorProfileId =
		(input.node.item.actorProfileKind === "system"
			? input.node.item.systemNoticeTargetProfileId
			: null) ?? input.node.item.actorProfileId;
	return (
		<SpaceProfileIcon
			agentControllerRef={input.node.item.actorAgentControllerRef}
			avatarImageUrl={input.node.item.actorAvatarImageUrl}
			isCenterAgent={false}
			profileId={actorProfileId}
			profileKind={actorProfileKind}
			profileName={input.node.actorName}
			size="sm"
		/>
	);
}

function SpaceGraphWakeActorIcon(input: { node: SpaceGraphWakeNode }) {
	const profile = input.node.profilePresentation;
	return (
		<SpaceProfileIcon
			agentControllerRef={profile?.agentControllerRef ?? null}
			avatarImageUrl={profile?.avatarImageUrl ?? null}
			isCenterAgent={profile?.isCenterAgent ?? false}
			profileId={profile?.profileId ?? input.node.targetProfileId}
			profileKind={profile?.profileKind ?? "agent"}
			profileName={profile?.profileName ?? input.node.label}
			size="sm"
		/>
	);
}

const WAKE_STATUS_PRESENTATION: Record<
	SpaceGraphWakeStatus,
	{ indicatorClassName: string; label: string; textClassName: string }
> = {
	awaiting_outcome: {
		indicatorClassName: "bg-amber-500",
		label: "Updating status",
		textClassName: "text-amber-700 dark:text-amber-300",
	},
	blocked: {
		indicatorClassName: "bg-amber-500",
		label: "Blocked",
		textClassName: "text-amber-700 dark:text-amber-300",
	},
	done: {
		indicatorClassName: "bg-emerald-500",
		label: "Done",
		textClassName: "text-emerald-700 dark:text-emerald-300",
	},
	failed: {
		indicatorClassName: "bg-destructive",
		label: "Failed",
		textClassName: "text-destructive",
	},
	handoff: {
		indicatorClassName: "bg-sky-500",
		label: "Handed off",
		textClassName: "text-sky-700 dark:text-sky-300",
	},
	needs_input: {
		indicatorClassName: "bg-amber-500",
		label: "Needs input",
		textClassName: "text-amber-700 dark:text-amber-300",
	},
	posting: {
		indicatorClassName: "bg-sky-500",
		label: "Posting reply",
		textClassName: "text-sky-700 dark:text-sky-300",
	},
	replied: {
		indicatorClassName: "bg-emerald-500",
		label: "Replied",
		textClassName: "text-emerald-700 dark:text-emerald-300",
	},
	requested: {
		indicatorClassName: "bg-muted-foreground",
		label: "Requested",
		textClassName: "text-muted-foreground",
	},
	silent: {
		indicatorClassName: "bg-sky-500",
		label: "Chose not to reply",
		textClassName: "text-sky-700 dark:text-sky-300",
	},
	stopped: {
		indicatorClassName: "bg-muted-foreground",
		label: "Stopped",
		textClassName: "text-muted-foreground",
	},
	working: {
		indicatorClassName: "bg-sky-500",
		label: "Working",
		textClassName: "text-sky-700 dark:text-sky-300",
	},
};

function buildSpaceFlowNodes(input: {
	focusedNodeId: string | null;
	focusedNodeIds: ReadonlySet<string> | null;
	graph: SpaceGraphPresentation;
	layoutPositions: ReadonlyMap<string, XYPosition>;
	nodePositions: ReadonlyMap<string, XYPosition>;
	onOpenMessageDetails: (item: SpaceTimelineItem) => void;
}): SpaceFlowNode[] {
	return input.graph.nodes.map((graphNode) => ({
		ariaLabel: buildGraphNodeAriaLabel(graphNode),
		data: {
			focusState: resolveGraphNodeFocusState({
				focusedNodeId: input.focusedNodeId,
				focusedNodeIds: input.focusedNodeIds,
				nodeId: graphNode.id,
			}),
			graphNode,
			onOpenMessageDetails: input.onOpenMessageDetails,
		},
		draggable: true,
		deletable: false,
		id: graphNode.id,
		position: input.nodePositions.get(graphNode.id) ??
			input.layoutPositions.get(graphNode.id) ?? { x: 0, y: 0 },
		style: resolveSpaceGraphNodeSize(graphNode),
		type: "spaceGraph",
	}));
}

function buildSpaceGraphNodeSizes(
	graph: SpaceGraphPresentation
): ReadonlyMap<string, SpaceGraphLayoutNodeSize> {
	return new Map(
		graph.nodes.map((node) => [node.id, resolveSpaceGraphNodeSize(node)])
	);
}

function resolveSpaceGraphNodeSize(
	node: SpaceGraphNode
): SpaceGraphLayoutNodeSize {
	return node.kind === "wake" ? WAKE_NODE_SIZE : MESSAGE_NODE_SIZE;
}

function buildSpaceFlowEdges(
	graph: SpaceGraphPresentation,
	shouldReduceMotion: boolean,
	focusedNodeIds: ReadonlySet<string> | null
): Edge[] {
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	return graph.edges.map((edge) => ({
		animated:
			!shouldReduceMotion &&
			edge.kind === "wake" &&
			isActiveWakeNode(nodesById.get(edge.target)),
		ariaLabel: resolveEdgeLabel(edge.kind),
		id: edge.id,
		markerEnd: {
			color: "var(--muted-foreground)",
			type: MarkerType.ArrowClosed,
		},
		source: edge.source,
		style: {
			stroke: "var(--muted-foreground)",
			strokeOpacity: resolveGraphEdgeOpacity(edge, focusedNodeIds),
			strokeWidth: 1.25,
		},
		target: edge.target,
		type: "smoothstep",
	}));
}

function resolveGraphNodeFocusState(input: {
	focusedNodeId: string | null;
	focusedNodeIds: ReadonlySet<string> | null;
	nodeId: string;
}): SpaceGraphNodeFocusState {
	if (!input.focusedNodeIds) {
		return null;
	}
	if (!input.focusedNodeIds.has(input.nodeId)) {
		return "dimmed";
	}
	return input.nodeId === input.focusedNodeId ? "focused" : "related";
}

function resolveGraphEdgeOpacity(
	edge: SpaceGraphEdge,
	focusedNodeIds: ReadonlySet<string> | null
): number {
	if (!focusedNodeIds) {
		return edge.kind === "wake" ? 0.7 : 0.5;
	}
	return focusedNodeIds.has(edge.source) && focusedNodeIds.has(edge.target)
		? 0.8
		: 0.12;
}

function isActiveWakeNode(node: SpaceGraphNode | undefined): boolean {
	return (
		node?.kind === "wake" &&
		(node.status === "requested" ||
			node.status === "working" ||
			node.status === "posting" ||
			node.status === "awaiting_outcome")
	);
}

function resolveFocusedGraphNodeIds(
	graph: SpaceGraphPresentation,
	focusRequest: SpaceGraphFocusRequest | null | undefined
): ReadonlySet<string> | null {
	if (!focusRequest) {
		return null;
	}
	const focusedNodeId = `message:${focusRequest.signalId}`;
	if (!graph.nodes.some((node) => node.id === focusedNodeId)) {
		return null;
	}
	const focusedNodeIds = new Set<string>([focusedNodeId]);
	for (const edge of graph.edges) {
		if (edge.source === focusedNodeId) {
			focusedNodeIds.add(edge.target);
		}
		if (edge.target === focusedNodeId) {
			focusedNodeIds.add(edge.source);
		}
	}
	return focusedNodeIds;
}

function fitGraphFocus(input: {
	focusedNodeIds: ReadonlySet<string>;
	instance: ReactFlowInstance<SpaceFlowNode> | null;
}) {
	if (!input.instance) {
		return;
	}
	input.instance
		.fitView({
			maxZoom: 1.15,
			nodes: [...input.focusedNodeIds].map((id) => ({ id })),
			padding: 0.28,
		})
		.catch((error) => {
			console.error("Space Graph could not focus the selected message.", error);
		});
}

function buildGraphNodeAriaLabel(node: SpaceGraphNode): string {
	if (node.kind === "wake") {
		return `${node.label} Wake: ${WAKE_STATUS_PRESENTATION[node.status].label}`;
	}
	return `${node.actorName}: ${node.text || "No message text"}`;
}

function resolveMessageKindLabel(item: SpaceTimelineItem): string {
	if (item.signalType === "signal.status") {
		return item.spaceStatus === "done" ? "Done" : "Status update";
	}
	if (item.signalType === "signal.system_notice") {
		switch (item.systemNoticeType) {
			case "terminal_failure":
			case "policy_blocked":
				return "Failed";
			case "wake_stopped":
				return "Stopped";
			case "stay_silent":
				return "No reply";
			default:
				return "Update";
		}
	}
	if (item.actorProfileKind === "human") {
		return "Message";
	}
	return "Reply";
}

function resolveEdgeLabel(kind: SpaceGraphEdge["kind"]): string {
	switch (kind) {
		case "reply":
			return "Reply relationship";
		case "result":
			return "Wake result";
		case "wake":
			return "Wake request";
		default:
			return "Graph relationship";
	}
}

const GRAPH_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	hour: "numeric",
	minute: "2-digit",
});

function formatGraphNodeTime(createdAtMs: number): string {
	return GRAPH_TIME_FORMATTER.format(new Date(createdAtMs));
}
