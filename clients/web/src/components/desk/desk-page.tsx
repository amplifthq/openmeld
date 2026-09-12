import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@openmeld/ui/components/context-menu";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import {
	ArrowCounterClockwiseIcon,
	ArrowsOutSimpleIcon,
	CornersOutIcon,
	LayoutIcon,
	PlusIcon,
	TextTIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	applyNodeChanges,
	type Node,
	type NodeProps,
	NodeResizer,
	Panel,
	type ReactFlowInstance,
	useReactFlow,
	type Viewport,
} from "@xyflow/react";
import {
	createContext,
	memo,
	use,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { WorkspaceCanvas } from "#/components/canvas/workspace-canvas";
import type { SpaceAddMembersCandidateSummary } from "#/components/spaces/people-agent-picker-model";
import type { SpaceView } from "#/components/spaces/space-view";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationDirectMessagePath,
	buildOrganizationSpacePath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import { useSelectedHumanProfile } from "#/lib/profiles/use-selected-human-profile";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { createSpaceInOrganization } from "#/lib/spaces/create-space-in-organization";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import { saveWelcomeSpace } from "../spaces/welcome-space-state";
import { DeskAddDialog } from "./desk-add-dialog";
import { DeskEditableLabel } from "./desk-editable-label";
import { findDeskPlacement } from "./desk-placement";
import { DeskSpace } from "./desk-space";
import { DeskTools } from "./desk-tools";
import {
	DeskReadingProvider,
	DeskUnreadNavigation,
	useDeskReading,
} from "./desk-unread";
import {
	type DeskWidget,
	type DeskWidgetKind,
	deskWidgetLabels,
} from "./desk-widget-types";
import { DeskWidgetContent } from "./desk-widgets";
import { useDeskEntrance } from "./use-desk-entrance";
import { useDeskSpace } from "./use-desk-space";
import { useDeskWheel } from "./use-desk-wheel";

type DeskNode = Node<
	{
		kind: "welcome" | "space" | DeskWidgetKind;
		spaceId?: string;
		profileId?: string;
		targetProfileId?: string;
		title?: string;
		text?: string;
	},
	"desk"
>;
const nodeTypes = { desk: memo(DeskWindow) };
const edges: [] = [];
const spaceSizeLimits = {
	minWidth: 720,
	maxWidth: 2400,
	minHeight: 480,
	maxHeight: 1800,
};
function widgetSizeLimits(kind: DeskNode["data"]["kind"]) {
	if (kind === "space") {
		return spaceSizeLimits;
	}
	return {
		minWidth: 280,
		minHeight: kind === "center" || kind === "chat" ? 240 : 64,
		maxWidth: 1800,
		maxHeight: 1400,
	};
}
function defaultWidgetSize(kind: DeskWidgetKind) {
	if (kind === "text") {
		return { width: 320, height: 100 };
	}
	if (kind === "inbox" || kind === "activity") {
		return { width: 400, height: 320 };
	}
	if (kind === "computer") {
		return { width: 400, height: 360 };
	}
	return { width: 480, height: 560 };
}
function defaultWidgetStyle(kind: DeskWidgetKind): DeskNode["style"] {
	if (kind === "text") {
		return { width: "max-content", maxWidth: 520 };
	}
	const size = defaultWidgetSize(kind);
	if (kind === "inbox" || kind === "activity" || kind === "computer") {
		return { width: size.width };
	}
	return size;
}
function defaultSpaceSize(width: number, height: number) {
	return {
		width: Math.min(
			spaceSizeLimits.maxWidth,
			Math.max(spaceSizeLimits.minWidth, width)
		),
		height: Math.max(
			spaceSizeLimits.minHeight,
			Math.min(spaceSizeLimits.maxHeight, height)
		),
	};
}
const DeskContext = createContext<{
	storageScope: string;
	name: string;
	spaceId: string;
	profileId: string;
	orgSlug: string;
	onHide: (spaceId: string) => void;
	spaces: readonly AccountSpaceItem[];
	onWidget: (
		kind: DeskWidgetKind,
		chat?: { spaceId: string; profileId: string; title: string }
	) => void;
	onSpace: (space: AccountSpaceItem) => void;
	onHideGreeting: () => void;
	profiles: NonNullable<
		ReturnType<typeof useSelectedHumanProfile>["profilesQuery"]["data"]
	>;
} | null>(null);

export function DeskPage() {
	const { currentOrganization, storageScope } = useAppOrganization();
	return <Desk key={storageScope + currentOrganization.id} />;
}

function Desk() {
	const { currentOrganization, storageScope } = useAppOrganization();
	const { selectedHumanProfile, profilesQuery } = useSelectedHumanProfile({
		selectDefaultWhenMissing: true,
	});
	const profileId = selectedHumanProfile?.openMeldProfileId ?? "";
	const space = useDeskSpace({
		profile: selectedHumanProfile,
		organizationId: currentOrganization.id,
		storageScope,
	});
	const [addOpen, setAddOpen] = useState(false);
	const layoutKey = `openmeld.desk.windows:${storageScope}:${currentOrganization.id}`;
	const [windows, setWindows] = useState<
		{ spaceId: string; profileId: string }[] | null
	>(null);
	const restoredNodes = useRef<DeskNode[]>([]);
	const index = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: !!selectedHumanProfile,
			profileId,
		})
	);
	const deletedIds = useMemo(
		() =>
			new Set(
				(index.data?.recentlyDeletedItems ?? []).map((item) => item.spaceId)
			),
		[index.data]
	);
	const availableSpaces = useMemo(
		() => [
			...new Map(
				[...(index.data?.pinnedItems ?? []), ...(index.data?.spaceItems ?? [])]
					.filter(
						(item) =>
							item.organizationId === currentOrganization.id &&
							!deletedIds.has(item.spaceId)
					)
					.map((item) => [item.spaceId, item])
			).values(),
		],
		[index.data, currentOrganization.id, deletedIds]
	);
	const region = useRef<HTMLDivElement | null>(null);
	const flow = useRef<ReactFlowInstance<DeskNode> | null>(null);
	const [width, setWidth] = useState(1100);
	const [height, setHeight] = useState(640);
	const [nodes, setNodes] = useState<DeskNode[]>([]);
	const undoStack = useRef<DeskNode[][]>([]);
	const rememberLayout = () => {
		if (JSON.stringify(undoStack.current.at(-1)) === JSON.stringify(nodes)) {
			return;
		}
		undoStack.current = [
			...undoStack.current.slice(-29),
			structuredClone(nodes),
		];
	};
	const undoLayout = () => {
		const previous = undoStack.current.pop();
		if (!previous) {
			return;
		}
		setNodes(previous);
		setWindows(
			previous.flatMap((node) =>
				node.data.kind === "space" && node.data.spaceId && node.data.profileId
					? [{ spaceId: node.data.spaceId, profileId: node.data.profileId }]
					: []
			)
		);
	};
	const sizeKey = `openmeld.desk.size:${storageScope}:${currentOrganization.id}`;
	const savedSize = useRef<{ width: number; height: number } | null>(null);
	const viewportKey = `openmeld.desk.viewport:${storageScope}:${currentOrganization.id}`;
	const [savedViewport, setSavedViewport] = useState<Viewport | null>(null);
	const [loaded, setLoaded] = useState(false);
	const greetingKey = `openmeld.desk.greeting-hidden:${storageScope}:${currentOrganization.id}`;
	const [greetingHidden, setGreetingHidden] = useState(false);
	const resetWelcome = useMutation({
		mutationFn: async () => {
			if (
				!(
					import.meta.env.DEV &&
					location.hostname.endsWith(".localhost") &&
					selectedHumanProfile
				)
			) {
				throw new Error(
					"Welcome reset is only available in a local development lane."
				);
			}
			const created = await createSpaceInOrganization({
				actingProfile: selectedHumanProfile,
				organizationId: currentOrganization.id,
				space: {
					name: "Welcome Space",
					accessMode: "members_only",
					visibility: "private",
				},
			});
			saveWelcomeSpace(storageScope, created.spaceId, "add");
			localStorage.setItem(
				`openmeld.desk.space:${storageScope}:${currentOrganization.id}`,
				created.spaceId
			);
			for (const key of [layoutKey, sizeKey, viewportKey, greetingKey]) {
				localStorage.removeItem(key);
			}
			location.reload();
		},
	});
	useEffect(() => {
		setGreetingHidden(localStorage.getItem(greetingKey) === "true");
		try {
			const saved = JSON.parse(localStorage.getItem(layoutKey) ?? "null");
			if (Array.isArray(saved)) {
				restoredNodes.current = saved.filter(
					(node) =>
						(node?.data?.kind === "welcome" ||
							Object.hasOwn(deskWidgetLabels, node?.data?.kind ?? "") ||
							(node?.data?.kind === "space" &&
								typeof node.data.spaceId === "string" &&
								typeof node.data.profileId === "string")) &&
						Number.isFinite(node.position?.x) &&
						Number.isFinite(node.position?.y)
				);
				restoredNodes.current = restoredNodes.current.filter(
					(node) =>
						node.data.kind !== "people" || Boolean(node.data.targetProfileId)
				);
				restoredNodes.current = restoredNodes.current.map((node) =>
					node.data.kind === "activity" && node.data.title === "Work updates"
						? {
								...node,
								data: { ...node.data, title: deskWidgetLabels.activity },
							}
						: node
				);
				setNodes(restoredNodes.current);
				setWindows(
					restoredNodes.current.flatMap((node) =>
						node.data.kind === "space" &&
						node.data.spaceId &&
						node.data.profileId
							? [{ spaceId: node.data.spaceId, profileId: node.data.profileId }]
							: []
					)
				);
			}
		} catch {
			/* Optional layout preference. */
		}
		try {
			const value = JSON.parse(localStorage.getItem(sizeKey) ?? "null");
			if (
				value &&
				Number.isFinite(value.width) &&
				Number.isFinite(value.height)
			) {
				savedSize.current = {
					width: Math.min(
						spaceSizeLimits.maxWidth,
						Math.max(spaceSizeLimits.minWidth, value.width)
					),
					height: Math.min(
						spaceSizeLimits.maxHeight,
						Math.max(spaceSizeLimits.minHeight, value.height)
					),
				};
			}
		} catch {
			/* Optional window preference. */
		}
		try {
			const raw = localStorage.getItem(viewportKey);
			if (raw) {
				const value = JSON.parse(raw);
				if (
					[value.x, value.y, value.zoom].every(Number.isFinite) &&
					value.zoom >= 0.2 &&
					value.zoom <= 1.8
				) {
					setSavedViewport(value);
				}
			}
		} catch {
			/* A viewport preference never blocks the Space. */
		}
		setLoaded(true);
	}, [viewportKey, sizeKey, layoutKey, greetingKey]);
	useEffect(() => {
		if (loaded && windows === null && space.spaceId && space.profileId) {
			setWindows([{ spaceId: space.spaceId, profileId: space.profileId }]);
		}
	}, [loaded, windows, space.spaceId, space.profileId]);
	useEffect(() => {
		if (
			!(
				loaded &&
				space.spaceId &&
				space.profileId &&
				space.replacedDefaultSpaceId
			)
		) {
			return;
		}
		const replacement = { spaceId: space.spaceId, profileId: space.profileId };
		setWindows(
			(current) =>
				current?.map((item) =>
					item.spaceId === space.replacedDefaultSpaceId ? replacement : item
				) ?? [replacement]
		);
	}, [loaded, space.spaceId, space.profileId, space.replacedDefaultSpaceId]);
	useEffect(() => {
		if (!windows?.some((item) => deletedIds.has(item.spaceId))) {
			return;
		}
		setWindows((current) =>
			current?.some((item) => deletedIds.has(item.spaceId))
				? current.filter((item) => !deletedIds.has(item.spaceId))
				: current
		);
	}, [deletedIds, windows]);
	useEffect(() => {
		const element = region.current;
		if (!element) {
			return;
		}
		const observer = new ResizeObserver(([entry]) => {
			setWidth(Math.max(720, Math.min(2400, entry.contentRect.width - 64)));
			setHeight(Math.max(480, Math.min(1800, entry.contentRect.height - 64)));
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		if (!loaded) {
			return;
		}
		setNodes((previous) => {
			const greeting =
				previous.find((n) => n.id === "welcome") ??
				restoredNodes.current.find((n) => n.id === "welcome");
			return [
				...previous.filter(
					(n) => n.data.kind !== "welcome" && n.data.kind !== "space"
				),
				...(greetingHidden
					? []
					: [
							{
								...greeting,
								id: "welcome",
								type: "desk" as const,
								origin: [0.5, 0] as [number, number],
								position:
									greeting?.origin && greeting.position.y !== 0
										? greeting.position
										: {
												x: width / 2,
												y: 0,
											},
								data: { kind: "welcome" as const },
								width: greeting?.origin ? greeting.width : undefined,
								height: Math.max(190, greeting?.height ?? 190),
								style: greeting?.origin
									? {
											...greeting.style,
											height: Math.max(
												190,
												Number(greeting.style?.height) || 190
											),
										}
									: {
											width: "max-content",
											height: 190,
										},
								dragHandle: ".desk-title",
							},
						]),
				...(windows ?? [])
					.filter((item) => !deletedIds.has(item.spaceId))
					.map((item, index) => {
						const previousNode =
							previous.find((n) => n.data.spaceId === item.spaceId) ??
							restoredNodes.current.find(
								(n) => n.data.spaceId === item.spaceId
							);
						return {
							...previousNode,
							id: item.spaceId,
							type: "desk" as const,
							position: previousNode?.position ?? {
								x: index * (width + 48),
								y: 200,
							},
							data: {
								...previousNode?.data,
								kind: "space" as const,
								...item,
								title:
									previousNode?.data.title ??
									availableSpaces.find((s) => s.spaceId === item.spaceId)
										?.spaceName ??
									"Space",
							},
							style:
								previousNode?.style ??
								(index === 0 ? savedSize.current : null) ??
								defaultSpaceSize(width, height),
							dragHandle: ".desk-title",
						};
					}),
			];
		});
	}, [
		windows,
		deletedIds,
		width,
		height,
		greetingHidden,
		loaded,
		availableSpaces,
	]);
	useEffect(() => {
		const spaceNodes = nodes.filter((node) => node.data.kind === "space");
		if (
			!loaded ||
			windows === null ||
			spaceNodes.length !== windows.length ||
			spaceNodes.some(
				(node) =>
					node.dragging ||
					node.resizing ||
					!windows.some((item) => item.spaceId === node.data.spaceId)
			)
		) {
			return;
		}
		try {
			localStorage.setItem(layoutKey, JSON.stringify(nodes));
		} catch {
			/* Optional window preference. */
		}
	}, [nodes, layoutKey, loaded, windows]);
	const saveViewport = useCallback(
		(viewport: Viewport) => {
			try {
				localStorage.setItem(viewportKey, JSON.stringify(viewport));
			} catch {
				/* Optional preference. */
			}
		},
		[viewportKey]
	);
	const { initialize, reset, interrupt, onMoveEnd, isEntering } =
		useDeskEntrance({
			greetingHidden,
			height,
			region,
			flow,
			width,
			savedViewport,
			saveViewport,
		});
	useDeskWheel(region, flow, isEntering);

	const addWidget = (
		kind: DeskWidgetKind,
		chat?: { spaceId: string; profileId: string; title: string }
	) => {
		// MVP: only text is enabled here; Spaces use their existing add flow.
		// Keep other widget implementations and saved layouts for the next release.
		if (kind !== "text") {
			return;
		}
		rememberLayout();
		const id =
			kind === "text" ? crypto.randomUUID() : (chat?.spaceId ?? `desk-${kind}`);
		const existing = nodes.find((n) => n.id === id);
		setAddOpen(false);
		if (existing) {
			flow.current?.fitView({ nodes: [existing], padding: 0.15, maxZoom: 1 });
			return;
		}
		const bounds = region.current?.getBoundingClientRect();
		const start = flow.current?.screenToFlowPosition({
			x: (bounds?.left ?? 0) + 80,
			y: (bounds?.top ?? 0) + 80,
		}) ?? { x: 0, y: 0 };
		const size = defaultWidgetSize(kind);
		const position = findDeskPlacement(
			start,
			size,
			nodes.map((node) => ({
				x:
					node.position.x -
					(node.origin?.[0] ?? 0) * (node.measured?.width ?? 0),
				y: node.position.y,
				width: node.measured?.width ?? (Number(node.style?.width) || 480),
				height: node.measured?.height ?? (Number(node.style?.height) || 560),
			}))
		);
		setNodes((current) => [
			...current.map((n) => ({ ...n, selected: false })),
			{
				id,
				type: "desk",
				position,
				data: {
					kind,
					title: chat?.title ?? deskWidgetLabels[kind],
					...chat,
					text: kind === "text" ? "" : undefined,
				},
				style: defaultWidgetStyle(kind),
				dragHandle: ".desk-title",
				selected: true,
			},
		]);
		flow.current?.setCenter(
			position.x + size.width / 2,
			position.y + size.height / 2,
			{ zoom: Math.min(1, ((bounds?.height ?? 640) - 64) / size.height) }
		);
	};
	const addSpace = (item: AccountSpaceItem) => {
		rememberLayout();
		if (item.directMessageProfileIds) {
			addWidget("chat", {
				spaceId: item.spaceId,
				profileId: item.openProfileId,
				title: item.spaceName,
			});
			return;
		}
		const existing = nodes.find((n) => n.id === item.spaceId);
		setAddOpen(false);
		if (existing) {
			flow.current?.fitView({ nodes: [existing], padding: 0.1, maxZoom: 1 });
			return;
		}
		setWindows((current) => [
			...(current ?? []),
			{ spaceId: item.spaceId, profileId: item.openProfileId },
		]);
		const x = (windows?.length ?? 0) * (width + 48);
		flow.current?.setViewport({ x: 32 - x, y: 24, zoom: 1 });
	};
	const context = {
		storageScope,
		name: selectedHumanProfile?.profileName.split(" ")[0] ?? "",
		spaceId: space.spaceId ?? "",
		profileId: space.profileId ?? "",
		orgSlug: currentOrganization.slug,
		profiles: profilesQuery.data ?? [],
		spaces: availableSpaces,
		onWidget: addWidget,
		onSpace: addSpace,
		onHideGreeting: () => {
			localStorage.setItem(greetingKey, "true");
			setGreetingHidden(true);
			toast("Greeting hidden. You won’t see it again in this browser.");
		},
		onHide: (id: string) => {
			rememberLayout();
			setWindows(
				(current) => current?.filter((item) => item.spaceId !== id) ?? []
			);
			setNodes((current) => current.filter((n) => n.id !== id));
		},
	};
	const addProfiles = (
		profiles: readonly SpaceAddMembersCandidateSummary[]
	) => {
		rememberLayout();
		const start = flow.current?.screenToFlowPosition({
			x: (region.current?.getBoundingClientRect().left ?? 0) + 40,
			y: (region.current?.getBoundingClientRect().top ?? 0) + 40,
		}) ?? { x: 0, y: 0 };
		setNodes((current) => {
			const next = current.filter(
				(n) => !(n.data.kind === "people" && !n.data.targetProfileId)
			);
			const block = findDeskPlacement(
				start,
				{ width: profiles.length * 432 - 32, height: 320 },
				next.map((n) => ({
					x: n.position.x,
					y: n.position.y,
					width: n.measured?.width ?? 480,
					height: n.measured?.height ?? 560,
				}))
			);
			for (const [profileIndex, profile] of profiles.entries()) {
				const id = `desk-profile-${profile.profileId}`;
				if (next.some((n) => n.id === id)) {
					continue;
				}
				const size = { width: 400 };
				const position = { x: block.x + profileIndex * 432, y: block.y };
				next.push({
					id,
					type: "desk",
					position,
					data: {
						kind: "people",
						targetProfileId: profile.profileId,
						title: profile.profileName,
					},
					style: size,
					dragHandle: ".desk-title",
				});
			}
			return next;
		});
		setAddOpen(false);
		requestAnimationFrame(() =>
			flow.current?.fitView({
				nodes: profiles.map((p) => ({ id: `desk-profile-${p.profileId}` })),
				padding: 0.15,
				maxZoom: 1,
			})
		);
	};
	const resetLayout = () => {
		rememberLayout();
		const size = defaultSpaceSize(width, height);
		const windowOffset = greetingHidden ? 0 : 1;
		savedSize.current = null;
		try {
			localStorage.removeItem(sizeKey);
		} catch {
			/* Optional window preference. */
		}
		setNodes((current) =>
			current.map((node, index) => {
				let style = node.style;
				if (node.data.kind === "welcome") {
					style = { width: "max-content", height: 190 };
				}
				if (node.data.kind === "space") {
					style = size;
				}
				return {
					...node,
					position: {
						x:
							node.data.kind === "welcome"
								? width / 2
								: (index - windowOffset) * (width + 48),
						y: node.data.kind === "welcome" ? 0 : 200,
					},
					width: undefined,
					height: undefined,
					resizing: false,
					style,
				};
			})
		);
		reset();
	};
	return (
		<AppFullWidthLayout contentLayout="flush" scroll={false}>
			<header className="flex items-center gap-3 border-b px-4 py-3">
				<h1 className="flex min-w-0 items-center gap-2 font-medium text-base">
					<span className="shrink-0">Desk</span>
					<Badge className={surfaceClasses(2)} variant="secondary">
						Beta
					</Badge>
					<span aria-hidden="true" className="mx-1 h-5 shrink-0 border-l" />
					<span className="truncate">{currentOrganization.name}</span>
				</h1>
			</header>
			<ContextMenu>
				<ContextMenuTrigger
					aria-label="Desk workspace"
					className="relative min-h-0 flex-1"
					data-desk-canvas
					data-desk-entrance={savedViewport ? "ready" : "pending"}
					onContextMenu={(event) => {
						if (
							event.target instanceof Element &&
							event.target.closest(".nowheel")
						) {
							event.preventBaseUIHandler();
						}
					}}
					onKeyDownCapture={(event) => {
						interrupt();
						if (
							(event.metaKey || event.ctrlKey) &&
							event.key === "z" &&
							!(
								event.target instanceof Element &&
								event.target.closest("input,textarea,[contenteditable=true]")
							)
						) {
							event.preventDefault();
							undoLayout();
						}
					}}
					onPointerDownCapture={(event) => {
						if (
							isEntering.current &&
							!(
								event.target instanceof Element &&
								event.target.closest(
									'button, a, input, textarea, [role="button"], [contenteditable="true"]'
								)
							)
						) {
							event.preventDefault();
							event.stopPropagation();
							return;
						}
						interrupt();
						if (
							event.button === 0 &&
							event.target instanceof Element &&
							event.target.closest(".desk-title, .react-flow__resize-control")
						) {
							rememberLayout();
						}
					}}
					ref={region}
					role="region"
				>
					{(space.error || profilesQuery.isError) && (
						<div className="p-6" role="alert">
							<p>{space.error ?? "Couldn’t load your profile."}</p>
							<Button
								onClick={() => {
									space.retry();
									profilesQuery.refetch().catch(console.error);
								}}
								variant="outline"
							>
								Try again
							</Button>
							<Link
								className="ml-3 underline"
								to={buildOrganizationSpacesPath(currentOrganization.slug)}
							>
								Open Spaces
							</Link>
						</div>
					)}
					{!(space.error || profilesQuery.isError) && loaded && space.ready && (
						<DeskContext value={context}>
							<DeskReadingProvider organizationId={currentOrganization.id}>
								<WorkspaceCanvas<DeskNode>
									controls={
										<>
											<DeskUnreadNavigation />
											{import.meta.env.DEV &&
												location.hostname.endsWith(".localhost") && (
													<Panel position="top-left">
														<Button
															disabled={resetWelcome.isPending}
															onClick={() => resetWelcome.mutate()}
															size="sm"
															variant="outline"
														>
															{resetWelcome.isPending
																? "Resetting…"
																: "Reset Welcome Space (Dev)"}
														</Button>
														{resetWelcome.error && (
															<p
																className="max-w-xs text-destructive text-xs"
																role="alert"
															>
																{resetWelcome.error.message}
															</p>
														)}
													</Panel>
												)}
											<Panel position="bottom-right">
												<Button
													aria-label="Add to Desk"
													onClick={() => setAddOpen(true)}
													size="icon"
													variant="outline"
												>
													<PlusIcon />
												</Button>
											</Panel>
											<Panel position="bottom-left">
												<DeskTools
													onReset={reset}
													onZoomIn={() => flow.current?.zoomIn()}
													onZoomOut={() => flow.current?.zoomOut()}
												/>
											</Panel>
										</>
									}
									defaultViewport={savedViewport ?? { x: 32, y: 24, zoom: 1 }}
									edges={edges}
									nodes={nodes}
									nodeTypes={nodeTypes}
									onInit={initialize}
									onlyRenderVisibleElements={false}
									onMoveEnd={(_, viewport) => onMoveEnd(viewport)}
									onNodesChange={(changes) =>
										setNodes((current) => applyNodeChanges(changes, current))
									}
									zoomOnDoubleClick={false}
								/>
							</DeskReadingProvider>
						</DeskContext>
					)}
					{!(
						space.error ||
						profilesQuery.isError ||
						(loaded && space.ready)
					) && (
						<output className="p-6 text-muted-foreground">
							Preparing your Space…
						</output>
					)}
					{loaded && !nodes.some((node) => node.data.kind !== "welcome") && (
						<div className="absolute inset-x-6 top-56 text-center">
							<Button onClick={() => setAddOpen(true)} variant="outline">
								<PlusIcon />
								Add to Desk
							</Button>
						</div>
					)}
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem
						disabled={undoStack.current.length === 0}
						onClick={undoLayout}
					>
						<ArrowCounterClockwiseIcon aria-hidden="true" />
						Undo
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem onClick={() => setAddOpen(true)}>
						<PlusIcon aria-hidden="true" />
						Add to Desk
					</ContextMenuItem>
					<ContextMenuItem onClick={() => addWidget("text")}>
						<TextTIcon aria-hidden="true" />
						Add text
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem onClick={reset}>
						<CornersOutIcon aria-hidden="true" />
						Restore default view
					</ContextMenuItem>
					<ContextMenuItem onClick={resetLayout}>
						<LayoutIcon aria-hidden="true" />
						Reset positions and sizes
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<DeskAddDialog
				error={index.isError}
				loading={index.isPending}
				onAdd={addSpace}
				onChat={(chat) => addWidget("chat", chat)}
				onOpenChange={setAddOpen}
				onProfiles={addProfiles}
				onRetry={() => {
					index.refetch().catch(console.error);
				}}
				onWidget={addWidget}
				open={addOpen}
				orgSlug={currentOrganization.slug}
				profileId={profileId}
				shownIds={(windows ?? []).map((item) => item.spaceId)}
				shownProfileIds={nodes.flatMap((n) =>
					n.data.kind === "people" && n.data.targetProfileId
						? [n.data.targetProfileId]
						: []
				)}
				spaces={availableSpaces}
			/>
		</AppFullWidthLayout>
	);
}

function DeskWindow({
	id,
	data,
	selected,
	height: nodeHeight,
}: NodeProps<DeskNode>) {
	const context = use(DeskContext);
	const reactFlow = useReactFlow<DeskNode>();
	const [view, setView] = useState<SpaceView>("messages");
	const spaceId = data.spaceId ?? context?.spaceId ?? "";
	const profileId = data.profileId ?? context?.profileId ?? "";
	const reading = useDeskReading(data.spaceId);
	if (!context) {
		return null;
	}
	if (data.kind === "welcome") {
		return (
			<>
				<NodeResizer
					isVisible={selected}
					maxHeight={480}
					maxWidth={2400}
					minHeight={190}
					minWidth={320}
				/>
				<section
					aria-label="Welcome greeting"
					className={`desk-title relative flex h-full min-h-[190px] cursor-grab flex-col items-center justify-center gap-3 rounded-lg border p-6 text-center ${selected ? "border-muted-foreground" : "border-transparent"}`}
					data-desk-greeting=""
				>
					{selected && (
						<Button
							aria-label="Hide greeting"
							className="nodrag nopan absolute top-2 right-2 p-0 max-lg:min-h-6 max-lg:min-w-6"
							onClick={context.onHideGreeting}
							size="icon-xs"
							variant="ghost"
						>
							<XIcon className="size-4" />
						</Button>
					)}
					<h2
						className="max-w-full break-words font-medium leading-tight"
						style={{
							fontSize: Math.max(
								28,
								Math.min(112, ((nodeHeight ?? 190) - 40) * 0.35)
							),
						}}
					>
						Hello{context.name ? `, ${context.name}` : ""}.
					</h2>
					<p className="text-base text-muted-foreground">
						Your team and your agents together in one place.
					</p>
					{
						<svg
							aria-hidden="true"
							className="pointer-events-none shrink-0 text-muted-foreground"
							data-desk-arrow=""
							height="32"
							viewBox="0 0 28 32"
							width="28"
						>
							<path
								d="M5 2 Q24 2 20 27 M13 20 L20 28 L26 20"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
							/>
						</svg>
					}
				</section>
			</>
		);
	}

	if (data.kind === "text") {
		return (
			<DeskText
				data={data}
				id={id}
				onHide={context.onHide}
				selected={selected}
			/>
		);
	}
	const isSpace = data.kind === "space";
	const label = { ...deskWidgetLabels, space: "Space", center: "Chat" }[
		data.kind
	];
	return (
		<>
			<NodeResizer
				{...widgetSizeLimits(data.kind)}
				handleStyle={{
					width: 8,
					height: 8,
					background: "var(--muted-foreground)",
					border: "1px solid var(--background)",
					borderRadius: 2,
				}}
				lineStyle={{ borderColor: "transparent", borderWidth: 4 }}
			/>
			<div className="desk-title absolute inset-x-0 bottom-full flex min-h-9 cursor-grab items-center gap-2 pb-1 text-sm">
				{reading.unreadCount > 0 && (
					<span
						aria-label={`${reading.unreadCount} unread messages`}
						className="size-1.5 shrink-0 rounded-full bg-unread"
						role="img"
					/>
				)}
				<DeskEditableLabel
					label={`Rename ${label} on Desk`}
					onChange={(title) => reactFlow.updateNodeData(id, { title })}
					value={data.title ?? label}
				/>
				<div className="min-w-4 flex-1 self-stretch" />
				{isSpace || data.kind === "chat" ? (
					<Link
						aria-label="Open Space full screen"
						className="nodrag nopan rounded p-1 hover:bg-muted"
						to={(data.kind === "chat"
							? buildOrganizationDirectMessagePath
							: buildOrganizationSpacePath)({
							orgSlug: context.orgSlug,
							spaceId,
							search: { profileId, view },
						})}
					>
						<ArrowsOutSimpleIcon />
					</Link>
				) : null}
				<Button
					aria-label={`Hide ${label} from Desk`}
					className="nodrag nopan p-0 max-lg:min-h-6 max-lg:min-w-6"
					onClick={() => context.onHide(id)}
					size="icon-xs"
					variant="ghost"
				>
					<XIcon className="size-4" />
				</Button>
			</div>
			<section
				aria-label={`Desk ${label}`}
				className="flex h-full cursor-default flex-col overflow-hidden rounded-lg border bg-background"
				data-desk-space-window=""
				style={reading.borderStyle}
			>
				<div
					className="nodrag nopan nowheel flex min-h-0 flex-1 select-text flex-col"
					onFocusCapture={reading.activate}
					onPointerDownCapture={reading.activate}
					ref={reading.ref}
				>
					{isSpace || data.kind === "chat" ? (
						<DeskSpace
							accountProfiles={context.profiles}
							compact={data.kind === "chat"}
							focusSignalId={reading.focusSignalId}
							focusThreadRootSignalId={reading.focusThreadRootSignalId}
							initialView={view}
							onViewChange={setView}
							orgSlug={context.orgSlug}
							profileId={profileId}
							readingEnabled={reading.readable}
							spaceId={spaceId}
						/>
					) : (
						<DeskWidgetContent
							onCenter={() => context.onWidget("center")}
							onChat={(chat) => context.onWidget("chat", chat)}
							onSpace={context.onSpace}
							spaces={context.spaces}
							widget={{ id, ...data, title: data.title ?? label } as DeskWidget}
						/>
					)}
				</div>
			</section>
		</>
	);
}

function DeskText({
	id,
	data,
	selected,
	onHide,
}: {
	id: string;
	data: DeskNode["data"];
	selected: boolean;
	onHide: (id: string) => void;
}) {
	const reactFlow = useReactFlow<DeskNode>();
	const resizedHeight = Number(reactFlow.getNode(id)?.style?.height);

	return (
		<>
			<NodeResizer isVisible={selected} minHeight={32} minWidth={120} />
			<section
				className={`desk-title relative h-full min-w-[120px] cursor-grab rounded-md border ${selected ? "border-muted-foreground" : "border-transparent"}`}
				style={{
					fontSize: Math.max(16, Math.min(96, (resizedHeight || 64) * 0.35)),
				}}
			>
				<div className="absolute right-0 bottom-full flex h-6 justify-end">
					{selected && (
						<Button
							aria-label="Remove text"
							className="nodrag nopan p-0 max-lg:min-h-6 max-lg:min-w-6"
							onClick={() => onHide(id)}
							size="icon-xs"
							variant="ghost"
						>
							<XIcon className="size-4" />
						</Button>
					)}
				</div>
				<DeskEditableLabel
					label="Desk text"
					multiline
					onChange={(text) => reactFlow.updateNodeData(id, { text })}
					value={data.text ?? ""}
				/>
			</section>
		</>
	);
}
