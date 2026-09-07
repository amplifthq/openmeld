import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	ArrowsOutSimpleIcon,
	ChatCircleTextIcon,
	CornersOutIcon,
	HashIcon,
	MinusIcon,
	PlusIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	applyNodeChanges,
	type Edge,
	type Node,
	type NodeProps,
	NodeResizer,
	Panel,
	type ReactFlowInstance,
	useStore,
	type Viewport,
} from "@xyflow/react";
import {
	createContext,
	lazy,
	memo,
	Suspense,
	use,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { WorkspaceCanvas } from "#/components/canvas/workspace-canvas";
import { CenterAgentIntroContext } from "#/components/spaces/center-agent-intro-context";
import { resolveSpaceActiveWakePresentation } from "#/components/spaces/space-active-wake-presentation";
import { SpaceReadTrackingContext } from "#/components/spaces/space-read-tracking-context";
import type { SpaceView } from "#/components/spaces/space-view";
import { useAccountSpaceIndicators } from "#/components/spaces/use-account-space-indicators";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import { useSelectedHumanProfile } from "#/lib/profiles/use-selected-human-profile";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import { HomeConversation } from "./home-conversation";
import {
	createHomeLayout,
	type HomeCard,
	type HomeLayout,
	homeLayoutStorageKey,
	parseHomeLayout,
} from "./home-layout";
import { useHomeWheelZoom } from "./use-home-wheel-zoom";
import { useHomeWindowVisibility } from "./use-home-window-visibility";

const WelcomeFirstRun = lazy(() =>
	import("#/components/welcome/welcome-first-run").then((m) => ({
		default: m.WelcomeFirstRun,
	}))
);
const CenterAgentConversation = lazy(() =>
	import("#/components/organizations/center-agent-compact-conversation").then(
		(m) => ({ default: m.CenterAgentCompactConversation })
	)
);
type HomeNode = Node<{ card: HomeCard }, "home">;
const nodeTypes = { home: memo(HomeCardNode) };
const NO_EDGES: Edge[] = [];
type HomeContextValue = {
	focusedId: string | null;
	focus: (id: string) => void;
	spaces: readonly AccountSpaceItem[];
	profiles: ReturnType<typeof useSelectedHumanProfile>["profilesQuery"]["data"];
	remove: (id: string) => void;
	openSpace: (spaceId: string) => void;
	createSpace: () => void;
	loading: boolean;
	error: boolean;
	retry: () => void;
	indicators: Pick<
		ReturnType<typeof useAccountSpaceIndicators>,
		"activeWakeSummaryBySpaceId" | "unreadBySpaceId"
	>;
};
const HomeContext = createContext<HomeContextValue | null>(null);

export function HomePage() {
	const { currentOrganization, storageScope } = useAppOrganization();
	return <HomeWorkspace key={`${storageScope}:${currentOrganization.id}`} />;
}

function HomeWorkspace() {
	const { currentOrganization, storageScope } = useAppOrganization();
	const { selectedHumanProfile, profilesQuery } = useSelectedHumanProfile({
		selectDefaultWhenMissing: true,
	});
	const spacesQuery = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: !!selectedHumanProfile,
			profileId: selectedHumanProfile?.openMeldProfileId ?? "",
		})
	);
	const { activeWakeSummaryBySpaceId, unreadBySpaceId } =
		useAccountSpaceIndicators({
			enabled: !!selectedHumanProfile,
			organizationId: currentOrganization.id,
			profileId: selectedHumanProfile?.openMeldProfileId ?? "",
		});
	const indicators = useMemo(
		() => ({ activeWakeSummaryBySpaceId, unreadBySpaceId }),
		[activeWakeSummaryBySpaceId, unreadBySpaceId]
	);
	const spaces = useMemo(() => {
		const entries = [
			...(spacesQuery.data?.pinnedItems ?? []),
			...(spacesQuery.data?.spaceItems ?? []),
		];
		return [
			...new Map(
				entries
					.filter((space) => space.organizationId === currentOrganization.id)
					.map((space) => [space.spaceId, space])
			).values(),
		];
	}, [spacesQuery.data, currentOrganization.id]);
	const storageKey = homeLayoutStorageKey(storageScope, currentOrganization.id);
	const [layout, setLayout] = useState<HomeLayout>(createHomeLayout);
	const [restored, setRestored] = useState(false);
	const [saveError, setSaveError] = useState(false);
	const [creatingSpace, setCreatingSpace] = useState(false);
	const [adding, setAdding] = useState(false);
	const [focusedId, setFocusedId] = useState<string | null>(null);
	const [cardSearch, setCardSearch] = useState("");
	const [previewId, setPreviewId] = useState("center-agent");
	const instance = useRef<ReactFlowInstance<HomeNode> | null>(null);
	const viewportSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (viewportSaveTimer.current) {
				clearTimeout(viewportSaveTimer.current);
			}
		},
		[]
	);
	const saveViewport = useCallback((viewport: Viewport) => {
		if (viewportSaveTimer.current) {
			clearTimeout(viewportSaveTimer.current);
		}
		viewportSaveTimer.current = setTimeout(
			() => setLayout((current) => ({ ...current, viewport })),
			180
		);
	}, []);
	const canvasRegion = useRef<HTMLElement | null>(null);
	useHomeWheelZoom(canvasRegion, instance);
	const [nodes, setNodes] = useState<HomeNode[]>([]);
	useEffect(() => {
		if (
			restored ||
			!(spacesQuery.isSuccess || spacesQuery.isError || profilesQuery.isError)
		) {
			return;
		}
		let saved: HomeLayout | null = null;
		try {
			saved = parseHomeLayout(localStorage.getItem(storageKey));
		} catch {
			setSaveError(true);
		}
		const initial = saved ?? createHomeLayout();
		if (!saved) {
			const firstSpace = spaces.find((space) => !space.directMessageProfileIds);
			if (firstSpace) {
				initial.cards.push({
					id: `space:${firstSpace.spaceId}`,
					kind: "space",
					spaceId: firstSpace.spaceId,
					x: 680,
					y: 280,
					width: 760,
					height: 640,
				});
			} else {
				initial.cards = initial.cards.map((card) =>
					card.kind === "welcome" ? { ...card, x: 0, width: 620 } : card
				);
			}
		}
		setLayout(initial);
		setRestored(true);
	}, [
		restored,
		spacesQuery.isSuccess,
		spacesQuery.isError,
		profilesQuery.isError,
		spaces,
		storageKey,
	]);
	useEffect(() => {
		setNodes((previous) =>
			layout.cards.map((card) => {
				const old = previous.find((node) => node.id === card.id);
				return {
					...old,
					id: card.id,
					type: "home",
					position: { x: card.x, y: card.y },
					data: { card },
					style: { width: card.width, height: card.height },
					dragHandle: ".home-card-handle",
				};
			})
		);
	}, [layout.cards]);
	useEffect(() => {
		if (!restored) {
			return;
		}
		try {
			localStorage.setItem(storageKey, JSON.stringify(layout));
			setSaveError(false);
		} catch {
			setSaveError(true);
		}
	}, [layout, restored, storageKey]);
	const remove = useCallback((id: string) => {
		setLayout((current) => ({
			...current,
			cards: current.cards.filter((card) => card.id !== id),
		}));
	}, []);
	const focusCard = useCallback((card: HomeCard) => {
		const bounds = canvasRegion.current?.getBoundingClientRect();
		let focusedCard = card;
		if (bounds && bounds.width < 640) {
			focusedCard = {
				...card,
				width: Math.max(280, bounds.width - 32),
				height: Math.min(card.height, Math.max(300, bounds.height - 48)),
			};
			setLayout((current) => ({
				...current,
				cards: current.cards.map((item) =>
					item.id === focusedCard.id ? focusedCard : item
				),
			}));
		}
		instance.current
			?.setCenter(
				focusedCard.x + focusedCard.width / 2,
				focusedCard.y + focusedCard.height / 2,
				{
					zoom: Math.min(
						1,
						((bounds?.height ?? 720) - 32) / focusedCard.height,
						((bounds?.width ?? 1024) - 32) / focusedCard.width
					),
				}
			)
			.catch(console.error);
	}, []);
	const add = useCallback(
		(kind: HomeCard["kind"], spaceId?: string) => {
			const id = kind === "space" ? `space:${spaceId}` : kind;
			const existing = layout.cards.find((card) => card.id === id);
			const card: HomeCard = existing ?? {
				id,
				kind,
				spaceId,
				x: layout.cards.reduce(
					(right, item) => Math.max(right, item.x + item.width + 32),
					0
				),
				y: 280,
				width: kind === "space" ? 760 : 620,
				height: kind === "welcome" ? 240 : 640,
			};
			setLayout((current) =>
				current.cards.some((card) => card.id === id)
					? current
					: {
							...current,
							cards: [...current.cards, card],
						}
			);
			setAdding(false);
			focusCard(card);
		},
		[layout.cards, focusCard]
	);
	const openSpace = useCallback(
		(spaceId: string) => add("space", spaceId),
		[add]
	);
	const context = useMemo<HomeContextValue>(
		() => ({
			focusedId,
			focus: setFocusedId,
			spaces,
			indicators,
			profiles: profilesQuery.data,
			remove,
			openSpace,
			createSpace: () => setCreatingSpace(true),
			loading: spacesQuery.isPending || profilesQuery.isPending,
			error: spacesQuery.isError || profilesQuery.isError,
			retry: () => {
				spacesQuery.refetch();
				profilesQuery.refetch();
			},
		}),
		[
			focusedId,
			spaces,
			indicators,
			profilesQuery.data,
			remove,
			openSpace,
			spacesQuery.isPending,
			profilesQuery.isPending,
			spacesQuery.isError,
			profilesQuery.isError,
			spacesQuery.refetch,
			profilesQuery.refetch,
		]
	);
	const saveGeometry = () => {
		const currentNodes = instance.current?.getNodes();
		if (!currentNodes) {
			return;
		}
		setLayout((current) => ({
			...current,
			cards: current.cards.map((card) => {
				const node = currentNodes.find((entry) => entry.id === card.id);
				return node
					? {
							...card,
							...node.position,
							width: node.measured?.width ?? card.width,
							height: node.measured?.height ?? card.height,
						}
					: card;
			}),
		}));
	};
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			globalControls={{
				hideCenterAgent: layout.cards.some(
					(card) => card.kind === "center-agent"
				),
			}}
			scroll={false}
		>
			<header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:flex-nowrap">
				<h1 className="w-full truncate font-medium text-base sm:w-auto">
					{currentOrganization.name}
				</h1>
				<nav
					aria-label="Home widgets"
					className="flex min-w-0 items-center gap-1 overflow-x-auto"
				>
					{layout.cards
						.filter((card) => card.kind !== "welcome")
						.map((card) => (
							<Button
								className="max-w-48 shrink-0 truncate"
								key={card.id}
								onClick={() => focusCard(card)}
								size="sm"
								variant="ghost"
							>
								{spaces.find((space) => space.spaceId === card.spaceId)
									?.spaceName ?? CARD_TITLES[card.kind]}
							</Button>
						))}
				</nav>
			</header>
			{saveError && (
				<p className="px-4 py-2 text-sm" role="alert">
					Your layout couldn’t be saved in this browser.
				</p>
			)}
			<CenterAgentIntroContext value="home">
				<HomeContext value={context}>
					<section
						aria-label="Home workspace"
						className="relative min-h-0 flex-1"
						data-home-canvas
						ref={canvasRegion}
					>
						{restored && (
							<WorkspaceCanvas<HomeNode>
								controls={
									<Panel position="bottom-left">
										<div className="flex items-center gap-1 rounded-md border bg-background p-1">
											<Button
												aria-label="Zoom out"
												onClick={() => instance.current?.zoomOut()}
												size="icon-sm"
												variant="ghost"
											>
												<MinusIcon />
											</Button>
											<Button
												aria-label="Zoom in"
												onClick={() => instance.current?.zoomIn()}
												size="icon-sm"
												variant="ghost"
											>
												<PlusIcon />
											</Button>
											<Button
												onClick={() =>
													instance.current?.fitView({
														maxZoom: 1,
														padding: 0.04,
													})
												}
												size="sm"
												variant="ghost"
											>
												<CornersOutIcon />
												Reset view
											</Button>
										</div>
									</Panel>
								}
								defaultViewport={
									layout.viewport ?? { x: 40, y: 24, zoom: 0.85 }
								}
								edges={NO_EDGES}
								nodes={nodes}
								nodeTypes={nodeTypes}
								onInit={(value) => {
									instance.current = value;
									if (!layout.viewport && canvasRegion.current) {
										const bounds = canvasRegion.current.getBoundingClientRect();
										const right = Math.max(
											620,
											...layout.cards.map((card) => card.x + card.width)
										);
										const bottom = Math.max(
											640,
											...layout.cards.map((card) => card.y + card.height)
										);
										const zoom = Math.max(
											0.2,
											Math.min(
												1,
												(bounds.width - 64) / right,
												(bounds.height - 80) / bottom
											)
										);
										value
											.setViewport({
												x: (bounds.width - right * zoom) / 2,
												y: 56,
												zoom,
											})
											.catch(console.error);
									}
								}}
								onlyRenderVisibleElements={false}
								onMoveEnd={(_event, viewport: Viewport) =>
									saveViewport(viewport)
								}
								onNodeDragStop={saveGeometry}
								onNodesChange={(changes) => {
									setNodes((current) => applyNodeChanges(changes, current));
									if (
										changes.some(
											(change) =>
												change.type === "dimensions" &&
												change.resizing === false
										)
									) {
										requestAnimationFrame(saveGeometry);
									}
								}}
								zoomOnDoubleClick={false}
							/>
						)}
						{restored && !layout.hintsDismissed && (
							<aside
								aria-label="Canvas tips"
								className="absolute top-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm"
							>
								<p>
									Drag a window by its title to arrange your desk. Use ↗ to open
									the full page.
								</p>
								<Button
									aria-label="Dismiss canvas tips"
									onClick={() =>
										setLayout((current) => ({
											...current,
											hintsDismissed: true,
										}))
									}
									size="icon-sm"
									variant="ghost"
								>
									<XIcon />
								</Button>
							</aside>
						)}
						<Button
							aria-label="Add widget"
							className="absolute right-5 bottom-5 size-12 rounded-full shadow-sm"
							onClick={() => setAdding(true)}
						>
							<PlusIcon className="size-6" />
						</Button>
						{restored && !layout.cards.length && (
							<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
								<Button
									className="pointer-events-auto"
									onClick={() => setAdding(true)}
								>
									Add your first card
								</Button>
							</div>
						)}
					</section>
					<Dialog onOpenChange={setAdding} open={adding}>
						<DialogContent className="h-[min(760px,85dvh)] grid-rows-[auto_auto_minmax(0,1fr)] sm:max-w-5xl">
							<DialogTitle>Add a widget</DialogTitle>
							<DialogDescription>
								Keep a conversation on your Home. Preview it here, then add it
								to your desk.
							</DialogDescription>
							<div className="grid min-h-0 grid-cols-[160px_minmax(0,1fr)] gap-4 sm:grid-cols-[220px_minmax(0,1fr)]">
								<div className="flex min-h-0 flex-col gap-2">
									<Button
										className="justify-start"
										onClick={() => setPreviewId("center-agent")}
										variant={
											previewId === "center-agent" ? "secondary" : "ghost"
										}
									>
										<ChatCircleTextIcon />
										Center Agent
									</Button>
									<Input
										aria-label="Find a Space"
										onChange={(event) => setCardSearch(event.target.value)}
										placeholder="Find a Space"
										value={cardSearch}
									/>
									<ScrollArea className="min-h-0 flex-1">
										{spaces
											.filter(
												(space) =>
													!space.directMessageProfileIds &&
													space.spaceName
														.toLowerCase()
														.includes(cardSearch.trim().toLowerCase())
											)
											.map((space) => (
												<Button
													className="w-full justify-start"
													key={space.spaceId}
													onClick={() => setPreviewId(space.spaceId)}
													variant={
														previewId === space.spaceId ? "secondary" : "ghost"
													}
												>
													<HashIcon />
													<span className="truncate">{space.spaceName}</span>
												</Button>
											))}
									</ScrollArea>
									<Button
										onClick={() => {
											setAdding(false);
											setCreatingSpace(true);
										}}
										variant="outline"
									>
										<PlusIcon />
										Create a Space
									</Button>
								</div>
								<div className="flex min-h-0 flex-col gap-3">
									<SpaceReadTrackingContext value={false}>
										<div
											className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border"
											inert
										>
											{previewId === "center-agent" ? (
												<Suspense
													fallback={<p className="p-4">Loading preview…</p>}
												>
													<CenterAgentConversation
														organizationId={currentOrganization.id}
													/>
												</Suspense>
											) : (
												(() => {
													const space = spaces.find(
														(item) => item.spaceId === previewId
													);
													return space ? (
														<HomeConversation
															accountProfiles={profilesQuery.data ?? []}
															key={space.spaceId}
															orgSlug={currentOrganization.slug}
															profileId={space.openProfileId}
															spaceId={space.spaceId}
														/>
													) : (
														<p className="p-4">
															Choose a Space to preview its conversation.
														</p>
													);
												})()
											)}
										</div>
									</SpaceReadTrackingContext>
									<Button
										onClick={() =>
											previewId === "center-agent"
												? add("center-agent")
												: openSpace(previewId)
										}
									>
										<PlusIcon />
										{layout.cards.some(
											(card) =>
												card.id ===
												(previewId === "center-agent"
													? previewId
													: `space:${previewId}`)
										)
											? "Show on Home"
											: "Add to Home"}
									</Button>
								</div>
							</div>
						</DialogContent>
					</Dialog>
					<Dialog onOpenChange={setCreatingSpace} open={creatingSpace}>
						<DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-3xl">
							<DialogTitle className="sr-only">Create a Space</DialogTitle>
							<Suspense fallback={<p>Loading…</p>}>
								<WelcomeFirstRun
									initialMode="create"
									offerComputerSetup={false}
									onOpenSpace={(spaceId) => {
										setCreatingSpace(false);
										openSpace(spaceId);
									}}
									presentation="dialog"
									showBack={false}
								/>
							</Suspense>
						</DialogContent>
					</Dialog>
				</HomeContext>
			</CenterAgentIntroContext>
		</AppFullWidthLayout>
	);
}

function HomeCardNode({ data, selected }: NodeProps<HomeNode>) {
	const [spaceView, setSpaceView] = useState<SpaceView>("messages");
	const [hasUnsavedFileChanges, setHasUnsavedFileChanges] = useState(false);
	const { ref, visible } = useHomeWindowVisibility();
	const readableZoom = useStore((state) => state.transform[2] >= 0.45);
	const context = use(HomeContext);
	const { currentOrganization } = useAppOrganization();
	if (!context) {
		return null;
	}
	const card = data.card;
	const space = context.spaces.find((item) => item.spaceId === card.spaceId);
	const title = space?.spaceName ?? CARD_TITLES[card.kind];
	if (card.kind === "welcome") {
		return <HomeWelcome />;
	}
	const activity =
		space && context.indicators.activeWakeSummaryBySpaceId.get(space.spaceId);
	let href: string | null = null;
	if (card.kind === "center-agent") {
		href = buildOrganizationCenterAgentChatPath(currentOrganization.slug);
	} else if (space) {
		href = buildOrganizationSpacePath({
			orgSlug: currentOrganization.slug,
			spaceId: space.spaceId,
			search: { profileId: space.openProfileId, view: spaceView },
		});
	}
	return (
		<>
			<div className="pointer-events-none absolute -top-12 left-5 flex items-center gap-2 text-muted-foreground text-sm">
				<svg
					aria-hidden="true"
					fill="none"
					height="42"
					viewBox="0 0 36 42"
					width="36"
				>
					<path
						d="M3 3C25 3 28 17 28 36M21 29l7 8 6-9"
						stroke="currentColor"
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth="1.5"
					/>
				</svg>
				{card.kind === "center-agent"
					? "Start here — ask for help with your work"
					: "A Space — chat and work with your team"}
			</div>
			<section
				aria-label={title}
				className="flex h-full w-full flex-col overflow-hidden rounded-lg border bg-background shadow-sm"
				onFocusCapture={() => context.focus(card.id)}
				onPointerDownCapture={() => context.focus(card.id)}
				ref={ref}
			>
				<NodeResizer
					isVisible={selected}
					maxHeight={1600}
					maxWidth={1600}
					minHeight={240}
					minWidth={280}
				/>
				<header className="home-card-handle flex h-11 shrink-0 cursor-grab items-center gap-2 border-b px-3 active:cursor-grabbing">
					<h2 className="min-w-0 flex-1 truncate font-medium text-sm">
						{card.kind === "space" ? `Space · ${title}` : title}
					</h2>
					{href && (
						<Link
							aria-label={`Open ${title} full screen`}
							className="nodrag nopan rounded p-1.5 hover:bg-muted"
							to={href}
						>
							<ArrowsOutSimpleIcon />
						</Link>
					)}
					<Button
						aria-label={`Remove ${title} from Home`}
						className="nodrag nopan"
						disabled={hasUnsavedFileChanges}
						onClick={() => context.remove(card.id)}
						size="icon-xs"
						title={
							hasUnsavedFileChanges
								? "Save or discard your file changes before removing this window."
								: undefined
						}
						variant="ghost"
					>
						<XIcon />
					</Button>
				</header>
				{activity && (
					<p className="shrink-0 border-b px-3 py-2 text-muted-foreground text-xs">
						{resolveSpaceActiveWakePresentation(activity).label}
					</p>
				)}
				<div className="nodrag nopan nowheel flex min-h-0 flex-1 flex-col overflow-hidden">
					<SpaceReadTrackingContext value={context.focusedId === card.id}>
						{(visible && readableZoom) || hasUnsavedFileChanges ? (
							<HomeCardContent
								card={card}
								context={context}
								initialView={spaceView}
								onUnsavedFileChangesChange={setHasUnsavedFileChanges}
								onViewChange={setSpaceView}
								space={space}
							/>
						) : (
							<p className="p-5 text-muted-foreground">
								{space?.messagePreview?.text ??
									(card.kind === "center-agent"
										? "Ask Center Agent for help with your work."
										: "Messages, files, and your team, together in one Space.")}
							</p>
						)}
					</SpaceReadTrackingContext>
				</div>
			</section>
		</>
	);
}

const CARD_TITLES: Record<HomeCard["kind"], string> = {
	welcome: "Welcome",
	"center-agent": "Center Agent",
	space: "Space",
};

const HomeCardContent = memo(function HomeCardContent({
	initialView,
	card,
	context,
	space,
	onViewChange,
	onUnsavedFileChangesChange,
}: {
	card: HomeCard;
	initialView: SpaceView;
	context: HomeContextValue;
	space?: AccountSpaceItem;
	onViewChange: (view: SpaceView) => void;
	onUnsavedFileChangesChange: (hasChanges: boolean) => void;
}) {
	const { currentOrganization } = useAppOrganization();
	if (card.kind === "welcome") {
		return <HomeWelcome />;
	}
	if (card.kind === "center-agent") {
		return (
			<Suspense fallback={<p className="p-4">Loading conversation…</p>}>
				<CenterAgentConversation organizationId={currentOrganization.id} />
			</Suspense>
		);
	}
	if (!space) {
		if (context.error) {
			return (
				<div className="p-4 text-sm" role="alert">
					Couldn’t load this Space.
					<Button onClick={context.retry} variant="ghost">
						Try again
					</Button>
				</div>
			);
		}
		return (
			<p className="p-4 text-muted-foreground text-sm">
				{context.loading
					? "Loading Space…"
					: "This Space is no longer available. You can remove this card."}
			</p>
		);
	}
	return (
		<HomeConversation
			accountProfiles={context.profiles ?? []}
			initialView={initialView}
			isDirectMessage={
				!!space.directMessageProfileIds && !space.directMessageConvertedAt
			}
			onUnsavedFileChangesChange={onUnsavedFileChangesChange}
			onViewChange={onViewChange}
			orgSlug={currentOrganization.slug}
			profileId={space.openProfileId}
			spaceId={space.spaceId}
			width={card.width}
		/>
	);
});

function HomeWelcome() {
	const { currentOrganization } = useAppOrganization();
	const { selectedHumanProfile } = useSelectedHumanProfile({
		selectDefaultWhenMissing: true,
	});
	return (
		<section
			aria-label="Welcome to Home"
			className="home-card-handle flex h-full cursor-grab flex-col items-center justify-center gap-3 text-center active:cursor-grabbing"
		>
			<p className="text-base text-muted-foreground">
				{currentOrganization.name} · Home
			</p>
			<h2 className="font-medium text-4xl">
				Hello
				{selectedHumanProfile?.profileName
					? `, ${selectedHumanProfile.profileName.split(" ")[0]}`
					: ""}
				.
			</h2>
			<p className="max-w-2xl text-lg text-muted-foreground">
				Your work, together in one place.
				<br />
				Ask Center Agent for help, or chat with people and Agents in a Space.
			</p>
		</section>
	);
}
