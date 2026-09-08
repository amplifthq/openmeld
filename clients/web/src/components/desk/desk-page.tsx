import { Button } from "@openmeld/ui/components/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@openmeld/ui/components/context-menu";
import { ArrowsOutSimpleIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { createSpaceInOrganization } from "#/lib/spaces/create-space-in-organization";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import {
	saveWelcomeSpace,
	useWelcomeSpace,
} from "../spaces/welcome-space-state";
import { DeskAddSpace } from "./desk-add-space";
import { DeskSpace } from "./desk-space";
import { DeskTools } from "./desk-tools";
import { useDeskEntrance } from "./use-desk-entrance";
import { useDeskSpace } from "./use-desk-space";
import { useDeskWheel } from "./use-desk-wheel";

type DeskNode = Node<
	{ kind: "welcome" | "space"; spaceId?: string; profileId?: string },
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
	const [addOpen, setAddOpen] = useState(false);
	const layoutKey = `openmeld.desk.windows:${storageScope}:${currentOrganization.id}`;
	const [windows, setWindows] = useState<
		{ spaceId: string; profileId: string }[] | null
	>(null);
	const restoredNodes = useRef<DeskNode[]>([]);
	const index = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: !!selectedHumanProfile,
			profileId: selectedHumanProfile?.openMeldProfileId ?? "",
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
							!item.directMessageProfileIds &&
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
	const sizeKey = `openmeld.desk.size:${storageScope}:${currentOrganization.id}`;
	const savedSize = useRef<{ width: number; height: number } | null>(null);
	const viewportKey = `openmeld.desk.viewport:${storageScope}:${currentOrganization.id}`;
	const [savedViewport, setSavedViewport] = useState<Viewport | null>(null);
	const [loaded, setLoaded] = useState(false);
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
			for (const key of [layoutKey, sizeKey, viewportKey]) {
				localStorage.removeItem(key);
			}
			location.reload();
		},
	});
	useEffect(() => {
		try {
			const saved = JSON.parse(localStorage.getItem(layoutKey) ?? "null");
			if (Array.isArray(saved)) {
				restoredNodes.current = saved.filter(
					(node) =>
						node?.data?.kind === "space" &&
						typeof node.data.spaceId === "string" &&
						typeof node.data.profileId === "string" &&
						Number.isFinite(node.position?.x) &&
						Number.isFinite(node.position?.y)
				);
				setWindows(
					restoredNodes.current.flatMap((node) =>
						node.data.spaceId && node.data.profileId
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
	}, [viewportKey, sizeKey, layoutKey]);
	useEffect(() => {
		if (loaded && windows === null && space.spaceId && space.profileId) {
			setWindows([{ spaceId: space.spaceId, profileId: space.profileId }]);
		}
	}, [loaded, windows, space.spaceId, space.profileId]);
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
			...(windows ?? [])
				.filter((item) => !deletedIds.has(item.spaceId))
				.map((item, index) => {
					const previousNode =
						previous.find((n) => n.data.spaceId === item.spaceId) ??
						restoredNodes.current.find((n) => n.data.spaceId === item.spaceId);
					return {
						...previousNode,
						id: item.spaceId,
						type: "desk" as const,
						position: previousNode?.position ?? {
							x: index * (width + 48),
							y: 200,
						},
						data: { kind: "space" as const, ...item },
						style:
							previousNode?.style ??
							(index === 0 ? savedSize.current : null) ??
							defaultSpaceSize(width, height),
						dragHandle: ".desk-title",
					};
				}),
		]);
	}, [windows, deletedIds, width, height]);
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
			localStorage.setItem(layoutKey, JSON.stringify(spaceNodes));
		} catch {
			/* Optional window preference. */
		}
	}, [nodes, layoutKey, loaded, windows]);
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
		height,
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
			onHide: (spaceId: string) =>
				setWindows(
					(current) => current?.filter((item) => item.spaceId !== spaceId) ?? []
				),
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
		const size = defaultSpaceSize(width, height);
		savedSize.current = null;
		try {
			localStorage.removeItem(sizeKey);
		} catch {
			/* Optional window preference. */
		}
		setNodes((current) =>
			current.map((node, index) => ({
				...node,
				position: {
					x: node.data.kind === "welcome" ? 0 : (index - 1) * (width + 48),
					y: node.data.kind === "welcome" ? 0 : 200,
				},
				width: undefined,
				height: undefined,
				resizing: false,
				style: node.data.kind === "welcome" ? { width, height: 150 } : size,
			}))
		);
		reset();
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
					data-desk-entrance={savedViewport ? "ready" : "pending"}
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
									<>
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
										<Panel position="bottom-left">
											<DeskTools
												onAdd={() => setAddOpen(true)}
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
					{loaded && windows?.length === 0 && (
						<div className="absolute inset-x-6 top-56 text-center">
							<Button onClick={() => setAddOpen(true)} variant="outline">
								<PlusIcon />
								Add Space
							</Button>
						</div>
					)}
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem onClick={() => setAddOpen(true)}>
						Add Space
					</ContextMenuItem>
					<ContextMenuItem onClick={reset}>Reset view</ContextMenuItem>
					<ContextMenuItem onClick={resetLayout}>Reset layout</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>
			<DeskAddSpace
				error={index.isError}
				loading={index.isPending}
				onAdd={(item) => {
					setWindows((current) => [
						...(current ?? []).filter(
							(existing) => existing.spaceId !== item.spaceId
						),
						{ spaceId: item.spaceId, profileId: item.openProfileId },
					]);
					setAddOpen(false);
					const x = (windows?.length ?? 0) * (width + 48);
					flow.current
						?.setViewport({ x: 32 - x, y: 24, zoom: 1 })
						.catch(console.error);
				}}
				onOpenChange={setAddOpen}
				onRetry={() => {
					index.refetch().catch(console.error);
				}}
				open={addOpen}
				orgSlug={currentOrganization.slug}
				shownIds={(windows ?? []).map((item) => item.spaceId)}
				spaces={availableSpaces}
			/>
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
	const spaceId = data.spaceId ?? context?.spaceId ?? "";
	const profileId = data.profileId ?? context?.profileId ?? "";
	if (!context) {
		return null;
	}
	if (data.kind === "welcome") {
		return (
			<section
				className="desk-title flex h-full cursor-grab flex-col items-center justify-center gap-3 text-center"
				data-desk-greeting=""
			>
				<h2 className="font-medium text-3xl">
					Hello{context.name ? `, ${context.name}` : ""}.
				</h2>
				<p className="text-base text-muted-foreground">
					Your work, together in one place.
				</p>
				{welcomeStep === "add" && (
					<svg
						aria-hidden="true"
						className="text-muted-foreground"
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
				data-desk-space-window=""
			>
				<div className="desk-title flex h-8 shrink-0 cursor-grab items-center justify-end border-b px-2">
					<Link
						aria-label="Open Space full screen"
						className="nodrag nopan rounded p-1 hover:bg-muted"
						to={buildOrganizationSpacePath({
							orgSlug: context.orgSlug,
							spaceId,
							search: { profileId, view },
						})}
					>
						<ArrowsOutSimpleIcon />
					</Link>
					<Button
						aria-label="Hide Space from Desk"
						className="nodrag nopan"
						onClick={() => context.onHide(spaceId)}
						size="icon-sm"
						variant="ghost"
					>
						<XIcon />
					</Button>
				</div>
				<div className="nodrag nopan nowheel flex min-h-0 flex-1 select-text flex-col">
					<DeskSpace
						accountProfiles={context.profiles}
						initialView={view}
						onViewChange={setView}
						orgSlug={context.orgSlug}
						profileId={profileId}
						spaceId={spaceId}
					/>
				</div>
			</section>
		</>
	);
}
