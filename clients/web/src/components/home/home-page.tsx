import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { ArrowsOutSimpleIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	applyNodeChanges,
	type Node,
	type NodeProps,
	NodeResizer,
	type ReactFlowInstance,
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
import { resolveSpaceActiveWakePresentation } from "#/components/spaces/space-active-wake-presentation";
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
import { HomeSpacePreview } from "./home-space-preview";

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
const HomeTeam = lazy(() =>
	import("./home-team").then((m) => ({ default: m.HomeTeam }))
);
type HomeNode = Node<{ card: HomeCard }, "home">;
const nodeTypes = { home: memo(HomeCardNode) };
type HomeContextValue = {
	spaces: readonly AccountSpaceItem[];
	profiles: ReturnType<typeof useSelectedHumanProfile>["profilesQuery"]["data"];
	activeId: string | null;
	activate: (id: string) => void;
	remove: (id: string) => void;
	openSpace: (spaceId: string) => void;
	createSpace: () => void;
	loading: boolean;
	error: boolean;
	retry: () => void;
	indicators: ReturnType<typeof useAccountSpaceIndicators>;
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
	const indicators = useAccountSpaceIndicators({
		enabled: !!selectedHumanProfile,
		organizationId: currentOrganization.id,
		profileId: selectedHumanProfile?.openMeldProfileId ?? "",
	});
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
	const [activeId, setActiveId] = useState<string | null>(null);
	const [creatingSpace, setCreatingSpace] = useState(false);
	const [adding, setAdding] = useState(false);
	const instance = useRef<ReactFlowInstance<HomeNode> | null>(null);
	const canvasRegion = useRef<HTMLElement | null>(null);
	const [nodes, setNodes] = useState<HomeNode[]>([]);
	const needsDefaultSpaces = useRef(false);
	useEffect(() => {
		try {
			const saved = parseHomeLayout(localStorage.getItem(storageKey));
			needsDefaultSpaces.current = !saved;
			setLayout(saved ?? createHomeLayout());
		} catch {
			setSaveError(true);
		}
		setRestored(true);
	}, [storageKey]);
	useEffect(() => {
		if (!(restored && spacesQuery.isSuccess && needsDefaultSpaces.current)) {
			return;
		}
		needsDefaultSpaces.current = false;
		const firstSpace = spaces.find((space) => !space.directMessageProfileIds);
		if (!firstSpace) {
			return;
		}
		setLayout((current) => ({
			...current,
			cards: [
				{
					id: `space:${firstSpace.spaceId}`,
					kind: "space",
					spaceId: firstSpace.spaceId,
					x: 0,
					y: 0,
					width: 520,
					height: 560,
				},
				...current.cards.map((card) => ({
					...card,
					x: card.kind === "spaces" ? 904 : 552,
					...(card.kind === "spaces" ? { width: 320 } : {}),
				})),
			],
		}));
	}, [restored, spacesQuery.isSuccess, spaces]);
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
		setActiveId((current) => (current === id ? null : current));
	}, []);
	const focusCard = useCallback((card: HomeCard) => {
		const bounds = canvasRegion.current?.getBoundingClientRect();
		instance.current
			?.setCenter(card.x + card.width / 2, card.y + card.height / 2, {
				zoom: Math.min(
					1,
					((bounds?.height ?? 720) - 64) / card.height,
					((bounds?.width ?? 1024) - 64) / card.width
				),
			})
			.catch(console.error);
	}, []);
	const activate = useCallback(
		(id: string) => {
			setActiveId(id);
			const card = layout.cards.find((item) => item.id === id);
			if (card) {
				const next =
					card.kind === "center-agent"
						? {
								...card,
								width: Math.max(480, card.width),
								height: Math.max(520, card.height),
							}
						: card;
				if (next !== card) {
					setLayout((current) => ({
						...current,
						cards: current.cards.map((item) => (item.id === id ? next : item)),
					}));
				}
				focusCard(next);
			}
		},
		[layout.cards, focusCard]
	);
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
				y: 0,
				width: kind === "space" ? 520 : 360,
				height: kind === "space" ? 560 : 400,
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
			if (kind === "space") {
				setActiveId(id);
			}
		},
		[layout.cards, focusCard]
	);
	const openSpace = useCallback(
		(spaceId: string) => add("space", spaceId),
		[add]
	);
	const context = useMemo<HomeContextValue>(
		() => ({
			spaces,
			indicators,
			profiles: profilesQuery.data,
			activeId,
			activate,
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
			spaces,
			indicators,
			profilesQuery.data,
			activeId,
			activate,
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
			globalControls={{ hideCenterAgent: activeId === "center-agent" }}
			scroll={false}
		>
			<header className="flex items-center justify-between gap-3 border-b px-4 py-3">
				<h1 className="truncate font-medium text-base">
					{currentOrganization.name}
				</h1>
				<div className="flex items-center gap-2">
					<Button
						onClick={() => {
							const first = layout.cards[0];
							if (first) {
								focusCard(first);
							}
						}}
						size="sm"
						variant="ghost"
					>
						Back to start
					</Button>
					<Button
						onClick={() => {
							instance.current
								?.fitView({ maxZoom: 1, padding: 0.15 })
								.catch(console.error);
						}}
						size="sm"
						variant="ghost"
					>
						View all
					</Button>
					<Button onClick={() => setAdding(true)} size="sm" variant="outline">
						<PlusIcon />
						Add to Home
					</Button>
				</div>
			</header>
			{saveError && (
				<p className="px-4 py-2 text-sm" role="alert">
					Your layout couldn’t be saved in this browser.
				</p>
			)}
			<HomeContext value={context}>
				<section
					aria-label="Home workspace"
					className="relative min-h-0 flex-1"
					ref={canvasRegion}
				>
					{restored && (
						<WorkspaceCanvas<HomeNode>
							defaultViewport={layout.viewport ?? { x: 32, y: 32, zoom: 1 }}
							edges={[]}
							nodes={nodes}
							nodeTypes={nodeTypes}
							onInit={(value) => {
								instance.current = value;
							}}
							onMoveEnd={(_event, viewport: Viewport) =>
								setLayout((current) => ({ ...current, viewport }))
							}
							onNodeDragStop={saveGeometry}
							onNodesChange={(changes) => {
								setNodes((current) => applyNodeChanges(changes, current));
								if (
									changes.some(
										(change) =>
											change.type === "dimensions" && change.resizing === false
									)
								) {
									requestAnimationFrame(saveGeometry);
								}
							}}
						/>
					)}
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
					<DialogContent>
						<DialogTitle>Add to Home</DialogTitle>
						<div className="flex flex-wrap gap-2">
							{(["spaces", "team", "center-agent"] as const).map((kind) => (
								<Button
									disabled={layout.cards.some((card) => card.id === kind)}
									key={kind}
									onClick={() => add(kind)}
									variant="outline"
								>
									{CARD_TITLES[kind]}
								</Button>
							))}
						</div>
						<ScrollArea className="max-h-80">
							{spaces.map((space) => (
								<Button
									className="w-full justify-start"
									key={space.spaceId}
									onClick={() => openSpace(space.spaceId)}
									variant="ghost"
								>
									{space.spaceName}
								</Button>
							))}
						</ScrollArea>
					</DialogContent>
				</Dialog>
				<Dialog onOpenChange={setCreatingSpace} open={creatingSpace}>
					<DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-2xl">
						<DialogTitle className="sr-only">Create a Space</DialogTitle>
						<Suspense fallback={<p>Loading…</p>}>
							<WelcomeFirstRun
								initialMode="create"
								offerComputerSetup={false}
								onOpenSpace={(spaceId) => {
									setCreatingSpace(false);
									openSpace(spaceId);
								}}
								showBack={false}
							/>
						</Suspense>
					</DialogContent>
				</Dialog>
			</HomeContext>
		</AppFullWidthLayout>
	);
}

function HomeCardNode({ data, selected }: NodeProps<HomeNode>) {
	const context = use(HomeContext);
	const { currentOrganization } = useAppOrganization();
	if (!context) {
		return null;
	}
	const card = data.card;
	const space = context.spaces.find((item) => item.spaceId === card.spaceId);
	const title = space?.spaceName ?? CARD_TITLES[card.kind];
	const activity =
		space && context.indicators.activeWakeSummaryBySpaceId.get(space.spaceId);
	let href: string | null = null;
	if (card.kind === "center-agent") {
		href = buildOrganizationCenterAgentChatPath(currentOrganization.slug);
	} else if (space) {
		href = buildOrganizationSpacePath({
			orgSlug: currentOrganization.slug,
			spaceId: space.spaceId,
			search: { profileId: space.openProfileId },
		});
	}
	return (
		<section
			aria-label={title}
			className="flex h-full w-full flex-col overflow-hidden rounded-lg border bg-background shadow-sm"
		>
			<NodeResizer
				isVisible={selected}
				maxHeight={1600}
				maxWidth={1600}
				minHeight={240}
				minWidth={280}
			/>
			<header className="home-card-handle flex h-11 shrink-0 cursor-grab items-center gap-2 border-b px-3 active:cursor-grabbing">
				<h2 className="min-w-0 flex-1 truncate font-medium text-sm">{title}</h2>
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
					onClick={() => context.remove(card.id)}
					size="icon-xs"
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
				<HomeCardContent card={card} context={context} space={space} />
			</div>
		</section>
	);
}

const CARD_TITLES: Record<HomeCard["kind"], string> = {
	spaces: "Spaces",
	team: "People and Agents",
	"center-agent": "Center Agent",
	space: "Space",
};

function HomeCardContent({
	card,
	context,
	space,
}: {
	card: HomeCard;
	context: HomeContextValue;
	space?: AccountSpaceItem;
}) {
	const { currentOrganization } = useAppOrganization();
	if (card.kind === "spaces") {
		return <SpacesCard context={context} />;
	}
	if (card.kind === "team") {
		return (
			<Suspense fallback={<p className="p-4">Loading…</p>}>
				<HomeTeam
					onCreateSpace={context.createSpace}
					onOpenSpace={context.openSpace}
				/>
			</Suspense>
		);
	}
	if (card.kind === "center-agent") {
		if (context.activeId === card.id) {
			return (
				<Suspense fallback={<p className="p-4">Loading conversation…</p>}>
					<CenterAgentConversation organizationId={currentOrganization.id} />
				</Suspense>
			);
		}
		return (
			<div className="space-y-3 p-4">
				<p className="text-muted-foreground text-sm">
					Ask a question or get help moving work forward.
				</p>
				<Button onClick={() => context.activate(card.id)} size="sm">
					Chat with Center Agent
				</Button>
			</div>
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
	if (context.activeId === card.id) {
		return (
			<HomeConversation
				accountProfiles={context.profiles ?? []}
				isDirectMessage={
					!!space.directMessageProfileIds && !space.directMessageConvertedAt
				}
				orgSlug={currentOrganization.slug}
				profileId={space.openProfileId}
				spaceId={space.spaceId}
			/>
		);
	}
	return (
		<HomeSpacePreview onReply={() => context.activate(card.id)} space={space} />
	);
}

function SpacesCard({ context }: { context: HomeContextValue }) {
	const [search, setSearch] = useState("");
	return (
		<>
			<div className="p-3">
				<Button onClick={context.createSpace} size="sm" variant="outline">
					<PlusIcon />
					Create a Space
				</Button>
			</div>
			<div className="px-3 pb-2">
				<Input
					aria-label="Search Spaces"
					onChange={(event) => setSearch(event.target.value)}
					placeholder="Search Spaces"
					value={search}
				/>
			</div>
			<ScrollArea className="min-h-0 flex-1">
				<div className="space-y-1 px-2 pb-3">
					<SpaceList context={context} search={search} />
				</div>
			</ScrollArea>
		</>
	);
}

function SpaceList({
	context,
	search,
}: {
	context: HomeContextValue;
	search: string;
}) {
	if (context.error) {
		return (
			<div className="p-3 text-sm" role="alert">
				Couldn’t load Spaces.
				<Button onClick={context.retry} variant="ghost">
					Try again
				</Button>
			</div>
		);
	}
	if (context.loading) {
		return <p className="p-3 text-sm">Loading Spaces…</p>;
	}
	if (!context.spaces.length) {
		return (
			<p className="p-3 text-muted-foreground text-sm">
				Bring people and Agents together in a Space. Messages and replies will
				appear here.
			</p>
		);
	}
	const matches = context.spaces.filter((space) =>
		space.spaceName.toLowerCase().includes(search.trim().toLowerCase())
	);
	if (!matches.length) {
		return (
			<p className="p-3 text-muted-foreground text-sm">No matching Spaces.</p>
		);
	}
	return matches.map((space) => (
		<button
			className="block w-full rounded-md p-3 text-left hover:bg-muted focus-visible:outline-ring"
			key={space.spaceId}
			onClick={() => context.openSpace(space.spaceId)}
			type="button"
		>
			<span className="block truncate font-medium text-sm">
				{space.spaceName}
				{(context.indicators.unreadBySpaceId.get(space.spaceId)?.unreadCount ??
					0) > 0 && (
					<span className="ml-2 text-muted-foreground text-xs">Unread</span>
				)}
			</span>
			<span className="mt-1 line-clamp-2 block text-muted-foreground text-sm">
				{space.messagePreview?.text ?? "Open conversation"}
			</span>
		</button>
	));
}
