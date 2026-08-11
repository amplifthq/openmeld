import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { Edge, Node, ReactFlowProps } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { SpaceGraph } from "./space-graph";
import type {
	SpaceGraphMessageNode,
	SpaceGraphPresentation,
	SpaceGraphWakeNode,
} from "./space-graph-presentation";

const reactFlowState = vi.hoisted(() => ({
	appliedNodeChanges: [] as unknown[][],
	backgroundProps: null as Record<string, unknown> | null,
	fitView: vi.fn(async () => true),
	props: null as ReactFlowProps | null,
}));
const environmentState = vi.hoisted(() => ({
	reduceMotion: false,
	resolvedTheme: "dark" as string | undefined,
}));

vi.mock("next-themes", () => ({
	useTheme: () => ({ resolvedTheme: environmentState.resolvedTheme }),
}));

vi.mock("framer-motion", async (importOriginal) => {
	const actual = await importOriginal<typeof import("framer-motion")>();
	return {
		...actual,
		useReducedMotion: () => environmentState.reduceMotion,
	};
});

vi.mock("@xyflow/react", async () => {
	const React = await import("react");
	return {
		Background: (props: Record<string, unknown>) => {
			reactFlowState.backgroundProps = props;
			return null;
		},
		BackgroundVariant: { Dots: "dots" },
		Controls: () => null,
		Handle: () => null,
		MarkerType: { ArrowClosed: "arrowclosed" },
		MiniMap: () => null,
		Position: { Left: "left", Right: "right" },
		ReactFlow: (props: ReactFlowProps) => {
			reactFlowState.props = props;
			React.useEffect(() => {
				props.onInit?.({ fitView: reactFlowState.fitView } as never);
			}, [props.onInit]);
			return React.createElement(
				"div",
				{ "data-testid": "react-flow" },
				props.children
			);
		},
		useNodesState: (nodes: Node[]) => [
			nodes,
			vi.fn(),
			(changes: unknown[]) => reactFlowState.appliedNodeChanges.push(changes),
		],
	};
});

describe("SpaceGraph", () => {
	beforeEach(() => {
		reactFlowState.appliedNodeChanges = [];
		reactFlowState.backgroundProps = null;
		reactFlowState.fitView.mockClear();
		reactFlowState.props = null;
		environmentState.reduceMotion = false;
		environmentState.resolvedTheme = "dark";
	});

	afterEach(() => {
		cleanup();
	});

	it("keeps the Graph read-only while persisting pointer and keyboard movement", () => {
		const onNodePositionChange = vi.fn();
		render(
			<SpaceGraph
				graph={buildGraph("requested")}
				hasEarlierHistory={false}
				isLoadingEarlierHistory={false}
				nodePositions={new Map()}
				onLoadEarlierHistory={vi.fn()}
				onNodePositionChange={onNodePositionChange}
				onOpenMessageDetails={vi.fn()}
				onResetNodePositions={vi.fn()}
			/>
		);

		const props = requireReactFlowProps();
		expect(props.deleteKeyCode).toBeNull();
		expect(props.nodes?.every((node) => node.deletable === false)).toBe(true);

		act(() => {
			props.onNodesChange?.([{ id: "message:source", type: "remove" }]);
		});
		expect(reactFlowState.appliedNodeChanges).toEqual([[]]);

		act(() => {
			props.onNodesChange?.([
				{
					dragging: false,
					id: "message:source",
					position: { x: 240, y: 120 },
					type: "position",
				},
			]);
		});
		expect(onNodePositionChange).toHaveBeenCalledWith("message:source", {
			x: 240,
			y: 120,
		});
	});

	it("opens the shared Message details view when a message node is clicked", () => {
		const graph = buildGraph("requested");
		const onOpenMessageDetails = vi.fn();
		render(
			<SpaceGraph
				graph={graph}
				hasEarlierHistory={false}
				isLoadingEarlierHistory={false}
				nodePositions={new Map()}
				onLoadEarlierHistory={vi.fn()}
				onNodePositionChange={vi.fn()}
				onOpenMessageDetails={onOpenMessageDetails}
				onResetNodePositions={vi.fn()}
			/>
		);

		const messageNode = requireReactFlowProps().nodes?.find(
			(node) => node.id === "message:source"
		);
		expect(messageNode).toBeTruthy();
		act(() => {
			requireReactFlowProps().onNodeClick?.({} as never, messageNode as Node);
		});

		expect(onOpenMessageDetails).toHaveBeenCalledWith(
			expect.objectContaining({ id: "source" })
		);
		expect(requireReactFlowProps().colorMode).toBe("dark");
	});

	it("uses a visible adaptive canvas surface and dot pattern", () => {
		render(
			<SpaceGraph
				graph={buildGraph("requested")}
				hasEarlierHistory={false}
				isLoadingEarlierHistory={false}
				nodePositions={new Map()}
				onLoadEarlierHistory={vi.fn()}
				onNodePositionChange={vi.fn()}
				onOpenMessageDetails={vi.fn()}
				onResetNodePositions={vi.fn()}
			/>
		);

		const canvas = screen.getByRole("region", { name: "Space Graph" });
		expect(canvas.className).toContain("bg-muted/25");
		expect(reactFlowState.backgroundProps).toEqual(
			expect.objectContaining({
				color: "color-mix(in oklab, var(--foreground) 18%, transparent)",
				gap: 20,
				size: 1.25,
				variant: "dots",
			})
		);
	});

	it("focuses the selected message and its directly connected activity", async () => {
		render(
			<SpaceGraph
				focusRequest={{ requestId: 1, signalId: "source" }}
				graph={buildGraph("working")}
				hasEarlierHistory={false}
				isLoadingEarlierHistory={false}
				nodePositions={new Map()}
				onLoadEarlierHistory={vi.fn()}
				onNodePositionChange={vi.fn()}
				onOpenMessageDetails={vi.fn()}
				onResetNodePositions={vi.fn()}
			/>
		);

		await waitFor(() => {
			expect(reactFlowState.fitView).toHaveBeenCalledWith(
				expect.objectContaining({
					nodes: expect.arrayContaining([
						{ id: "message:source" },
						{ id: "wake:source:codex" },
					]),
				})
			);
		});
		const nodes = requireReactFlowProps().nodes ?? [];
		expect(nodes.find((node) => node.id === "message:source")?.data).toEqual(
			expect.objectContaining({ focusState: "focused" })
		);
		expect(nodes.find((node) => node.id === "wake:source:codex")?.data).toEqual(
			expect.objectContaining({ focusState: "related" })
		);
	});

	it("animates only active Wake requests and honors reduced motion", () => {
		const view = render(
			<SpaceGraph
				graph={buildGraph("requested")}
				hasEarlierHistory={false}
				isLoadingEarlierHistory={false}
				nodePositions={new Map()}
				onLoadEarlierHistory={vi.fn()}
				onNodePositionChange={vi.fn()}
				onOpenMessageDetails={vi.fn()}
				onResetNodePositions={vi.fn()}
			/>
		);
		expect(findWakeEdge(requireReactFlowProps()).animated).toBe(true);

		view.rerender(
			<SpaceGraph
				graph={buildGraph("replied")}
				hasEarlierHistory={false}
				isLoadingEarlierHistory={false}
				nodePositions={new Map()}
				onLoadEarlierHistory={vi.fn()}
				onNodePositionChange={vi.fn()}
				onOpenMessageDetails={vi.fn()}
				onResetNodePositions={vi.fn()}
			/>
		);
		expect(findWakeEdge(requireReactFlowProps()).animated).toBe(false);

		environmentState.reduceMotion = true;
		view.rerender(
			<SpaceGraph
				graph={buildGraph("requested")}
				hasEarlierHistory={false}
				isLoadingEarlierHistory={false}
				nodePositions={new Map()}
				onLoadEarlierHistory={vi.fn()}
				onNodePositionChange={vi.fn()}
				onOpenMessageDetails={vi.fn()}
				onResetNodePositions={vi.fn()}
			/>
		);
		expect(findWakeEdge(requireReactFlowProps()).animated).toBe(false);
	});

	it("hides the React Flow attribution and resets dragged positions", () => {
		const onResetNodePositions = vi.fn();
		render(
			<SpaceGraph
				graph={buildGraph("requested")}
				hasEarlierHistory={false}
				isLoadingEarlierHistory={false}
				nodePositions={new Map([["message:source", { x: 900, y: 700 }]])}
				onLoadEarlierHistory={vi.fn()}
				onNodePositionChange={vi.fn()}
				onOpenMessageDetails={vi.fn()}
				onResetNodePositions={onResetNodePositions}
			/>
		);

		expect(requireReactFlowProps().proOptions).toEqual({
			hideAttribution: true,
		});
		fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
		expect(onResetNodePositions).toHaveBeenCalledTimes(1);
	});
});

function requireReactFlowProps(): ReactFlowProps {
	if (!reactFlowState.props) {
		throw new Error("Expected React Flow to render.");
	}
	return reactFlowState.props;
}

function findWakeEdge(props: ReactFlowProps): Edge {
	const edge = props.edges?.find((candidate) => candidate.id === "wake-edge");
	if (!edge) {
		throw new Error("Expected the Wake edge to render.");
	}
	return edge;
}

function buildGraph(
	status: SpaceGraphWakeNode["status"]
): SpaceGraphPresentation {
	const item = buildTimelineItem();
	const messageNode: SpaceGraphMessageNode = {
		actorName: "Felix",
		actorProfileKind: "human",
		createdAtMs: item.createdAtMs,
		id: "message:source",
		item,
		kind: "message",
		profilePresentation: null,
		text: item.text,
	};
	const wakeNode: SpaceGraphWakeNode = {
		createdAtMs: item.createdAtMs,
		id: "wake:source:codex",
		kind: "wake",
		label: "Codex",
		profilePresentation: null,
		sourceSignalId: item.id,
		status,
		targetProfileId: "codex",
	};
	return {
		edges: [
			{
				id: "wake-edge",
				kind: "wake",
				source: messageNode.id,
				target: wakeNode.id,
			},
		],
		nodes: [messageNode, wakeNode],
	};
}

function buildTimelineItem(): SpaceTimelineItem {
	return {
		actorAgentControllerRef: null,
		actorAvatarImageUrl: null,
		actorControllerDisplay: null,
		actorName: "Felix",
		actorOwnerDisplay: null,
		actorOwnerName: null,
		actorOwnerUserId: null,
		actorProfileId: "felix",
		actorProfileKind: "human",
		actorProfileName: "Felix",
		actorRuntimeDeviceDisplayName: null,
		agentControllerConversationId: null,
		agentWorkspace: null,
		attachments: [],
		clientMessageId: null,
		createdAtMs: Date.UTC(2026, 7, 5, 12),
		deliveryState: "sent",
		id: "source",
		newMessagesDuringComposition: null,
		replyPreviewText: null,
		replyToProfileName: null,
		replyToSignalId: null,
		signalType: "signal.text",
		spaceId: "space-1",
		systemNoticeType: null,
		text: "Review the release.",
		transientActivityPurpose: null,
		wakeClientMessageId: null,
		wakeSourceSignalId: null,
		wakeTargetProfileIds: ["codex"],
	};
}
