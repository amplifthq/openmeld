import { Button } from "@openmeld/ui/components/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@openmeld/ui/components/context-menu";
import {
	ArrowsOutSimpleIcon,
	CornersOutIcon,
	MinusIcon,
	PlusIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	applyNodeChanges,
	type Node,
	type NodeProps,
	NodeResizer,
	Panel,
	type ReactFlowInstance,
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
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { WorkspaceCanvas } from "#/components/canvas/workspace-canvas";
import type { SpaceView } from "#/components/spaces/space-view";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationSpacePath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import { useSelectedHumanProfile } from "#/lib/profiles/use-selected-human-profile";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import {
	resumeWelcomeSpace,
	useWelcomeSpace,
} from "../spaces/welcome-space-state";
import { DeskSpace } from "./desk-space";
import { useDeskEntrance } from "./use-desk-entrance";
import { useDeskSpace } from "./use-desk-space";
import { useDeskWheel } from "./use-desk-wheel";

type DeskNode = Node<{ kind: "welcome" | "space" }, "desk">;
const nodeTypes = { desk: memo(DeskWindow) };
const edges: [] = [];
const spaceSizeLimits = {
	minWidth: 720,
	maxWidth: 2400,
	minHeight: 480,
	maxHeight: 1800,
};
function defaultSpaceSize(width: number) {
	return {
		width: Math.min(
			spaceSizeLimits.maxWidth,
			Math.max(spaceSizeLimits.minWidth, width)
		),
		height: 900,
	};
}
const DeskContext = createContext<{
	storageScope: string;
	name: string;
	spaceId: string;
	profileId: string;
	orgSlug: string;
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
	const space = useDeskSpace({
		profile: selectedHumanProfile,
		organizationId: currentOrganization.id,
		storageScope,
	});
	const welcomeStep = useWelcomeSpace(storageScope, space.spaceId ?? "");
	const index = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: !!selectedHumanProfile,
			profileId: selectedHumanProfile?.openMeldProfileId ?? "",
		})
	);
	const deleted =
		!!space.spaceId &&
		index.isSuccess &&
		(index.data.recentlyDeletedItems ?? []).some(
			(item) => item.spaceId === space.spaceId
		);
	const region = useRef<HTMLDivElement | null>(null);
	const flow = useRef<ReactFlowInstance<DeskNode> | null>(null);
	const [width, setWidth] = useState(1100);
	const [nodes, setNodes] = useState<DeskNode[]>([]);
	const sizeKey = `openmeld.desk.size:${storageScope}:${currentOrganization.id}`;
	const savedSize = useRef<{ width: number; height: number } | null>(null);
	const viewportKey = `openmeld.desk.viewport:${storageScope}:${currentOrganization.id}`;
	const [savedViewport, setSavedViewport] = useState<Viewport | null>(null);
	const [loaded, setLoaded] = useState(false);
	useEffect(() => {
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
	}, [viewportKey, sizeKey]);
	useEffect(() => {
		const element = region.current;
		if (!element) {
			return;
		}
		const observer = new ResizeObserver(([entry]) =>
			setWidth(Math.max(320, entry.contentRect.width - 64))
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		setNodes((previous) => [
			{
				id: "welcome",
				type: "desk",
				position: previous.find((n) => n.id === "welcome")?.position ?? {
					x: 0,
					y: 0,
				},
				data: { kind: "welcome" },
				style: { width, height: 150 },
				dragHandle: ".desk-title",
			},
			...(!deleted && space.spaceId
				? [
						{
							id: "space",
							type: "desk" as const,
							position: previous.find((n) => n.id === "space")?.position ?? {
								x: 0,
								y: 200,
							},
							data: { kind: "space" as const },
							style: savedSize.current ?? defaultSpaceSize(width),
							dragHandle: ".desk-title",
						},
					]
				: []),
		]);
	}, [space.spaceId, deleted, width]);
	useEffect(() => {
		const node = nodes.find((item) => item.id === "space");
		if (!(node?.width && node.height) || node.resizing) {
			return;
		}
		if (
			savedSize.current?.width === node.width &&
			savedSize.current?.height === node.height
		) {
			return;
		}
		// React Flow sets explicit dimensions when the user resizes the window.
		savedSize.current = { width: node.width, height: node.height };
		try {
			localStorage.setItem(sizeKey, JSON.stringify(savedSize.current));
		} catch {
			/* Optional window preference. */
		}
	}, [nodes, sizeKey]);
	useDeskWheel(region, flow);
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
	const { initialize, reset, interrupt, onMoveEnd } = useDeskEntrance({
		region,
		flow,
		width,
		savedViewport,
		saveViewport,
	});
	const context = useMemo(
		() => ({
			storageScope,
			name: selectedHumanProfile?.profileName.split(" ")[0] ?? "",
			spaceId: space.spaceId ?? "",
			profileId: space.profileId ?? "",
			orgSlug: currentOrganization.slug,
			profiles: profilesQuery.data ?? [],
		}),
		[
			storageScope,
			selectedHumanProfile,
			space.spaceId,
			space.profileId,
			currentOrganization.slug,
			profilesQuery.data,
		]
	);
	const resetLayout = () => {
		const size = defaultSpaceSize(width);
		savedSize.current = null;
		try {
			localStorage.removeItem(sizeKey);
		} catch {
			/* Optional window preference. */
		}
		setNodes((current) =>
			current.map((node) => ({
				...node,
				position: { x: 0, y: node.data.kind === "welcome" ? 0 : 200 },
				width: undefined,
				height: undefined,
				resizing: false,
				style: node.data.kind === "welcome" ? { width, height: 150 } : size,
			}))
		);
		reset();
	};
	const restartTutorial = () => {
		space.restart().then(resetLayout).catch(console.error);
	};
	return (
		<AppFullWidthLayout contentLayout="flush" scroll={false}>
			<header className="flex items-center gap-3 border-b px-4 py-3">
				<h1 className="truncate font-medium text-base">
					Desk <span aria-hidden="true" className="mx-2 border-l" />{" "}
					{currentOrganization.name}
				</h1>
			</header>
			<ContextMenu>
				<ContextMenuTrigger
					aria-label="Desk workspace"
					className="relative min-h-0 flex-1"
					data-desk-canvas
					onContextMenu={(event) => {
						if (
							event.target instanceof Element &&
							event.target.closest(".nowheel")
						) {
							event.preventBaseUIHandler();
						}
					}}
					onKeyDownCapture={interrupt}
					onPointerDownCapture={interrupt}
					onWheelCapture={interrupt}
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
							<WorkspaceCanvas<DeskNode>
								controls={
									<Panel position="bottom-left">
										<div className="flex items-center gap-1 rounded-md border bg-background p-1">
											<Button
												aria-label="Zoom out"
												onClick={() => flow.current?.zoomOut()}
												size="icon-sm"
												variant="ghost"
											>
												<MinusIcon />
											</Button>
											<Button
												aria-label="Zoom in"
												onClick={() => flow.current?.zoomIn()}
												size="icon-sm"
												variant="ghost"
											>
												<PlusIcon />
											</Button>
											<Button onClick={reset} size="sm" variant="ghost">
												<CornersOutIcon />
												Reset view
											</Button>
											<Button
												disabled={space.isRestarting}
												onClick={() => {
													if (
														welcomeStep &&
														welcomeStep !== "done" &&
														space.spaceId
													) {
														resumeWelcomeSpace(storageScope, space.spaceId);
														reset();
													} else {
														restartTutorial();
													}
												}}
												size="sm"
												variant="ghost"
											>
												{welcomeStep === "done"
													? "New Welcome Space"
													: "Welcome tutorial"}
											</Button>
										</div>
									</Panel>
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
					{deleted && (
						<div className="absolute inset-x-6 top-56 text-center">
							<Link to={buildOrganizationSpacesPath(currentOrganization.slug)}>
								Open Spaces
							</Link>
						</div>
					)}
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem onClick={reset}>Reset view</ContextMenuItem>
					<ContextMenuItem onClick={resetLayout}>Reset layout</ContextMenuItem>
					<ContextMenuItem
						disabled={space.isRestarting}
						onClick={restartTutorial}
					>
						Start a new Welcome Space
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
		</AppFullWidthLayout>
	);
}

function DeskWindow({ data }: NodeProps<DeskNode>) {
	const context = use(DeskContext);
	const welcomeStep = useWelcomeSpace(
		context?.storageScope ?? "",
		context?.spaceId ?? ""
	);
	const [view, setView] = useState<SpaceView>("messages");
	if (!context) {
		return null;
	}
	if (data.kind === "welcome") {
		return (
			<section className="desk-title flex h-full cursor-grab flex-col items-center justify-center gap-3 text-center">
				<h2 className="font-medium text-3xl">
					Hello{context.name ? `, ${context.name}` : ""}.
				</h2>
				<p className="text-base text-muted-foreground">
					{welcomeStep === "add" || welcomeStep === "send"
						? "Your Welcome Space is ready."
						: "Your work, together in one place."}
				</p>
				{welcomeStep === "add" && (
					<svg
						aria-hidden="true"
						className="text-muted-foreground"
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
				)}
			</section>
		);
	}
	return (
		<>
			<NodeResizer
				{...spaceSizeLimits}
				handleStyle={{
					width: 8,
					height: 8,
					background: "var(--muted-foreground)",
					border: "1px solid var(--background)",
					borderRadius: 2,
				}}
				lineStyle={{ borderColor: "transparent", borderWidth: 4 }}
			/>
			<section
				aria-label="Desk Space"
				className="flex h-full flex-col overflow-hidden rounded-lg border bg-background"
			>
				<div className="desk-title flex h-8 shrink-0 cursor-grab items-center justify-end border-b px-2">
					<Link
						aria-label="Open Space full screen"
						className="nodrag nopan rounded p-1 hover:bg-muted"
						to={buildOrganizationSpacePath({
							orgSlug: context.orgSlug,
							spaceId: context.spaceId,
							search: { profileId: context.profileId, view },
						})}
					>
						<ArrowsOutSimpleIcon />
					</Link>
				</div>
				<div className="nodrag nopan nowheel flex min-h-0 flex-1 select-text flex-col">
					<DeskSpace
						accountProfiles={context.profiles}
						initialView={view}
						onViewChange={setView}
						orgSlug={context.orgSlug}
						profileId={context.profileId}
						spaceId={context.spaceId}
					/>
				</div>
			</section>
		</>
	);
}
