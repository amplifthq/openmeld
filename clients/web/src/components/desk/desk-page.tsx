import { Button } from "@openmeld/ui/components/button";
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
import { DeskSpace } from "./desk-space";
import { useDeskEntrance } from "./use-desk-entrance";
import { useDeskSpace } from "./use-desk-space";
import { useDeskWheel } from "./use-desk-wheel";

type DeskNode = Node<{ kind: "welcome" | "space" }, "desk">;
const nodeTypes = { desk: memo(DeskWindow) };
const edges: [] = [];
const DeskContext = createContext<{
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
	const region = useRef<HTMLElement | null>(null);
	const flow = useRef<ReactFlowInstance<DeskNode> | null>(null);
	const [width, setWidth] = useState(1100);
	const [nodes, setNodes] = useState<DeskNode[]>([]);
	const viewportKey = `openmeld.desk.viewport:${storageScope}:${currentOrganization.id}`;
	const [savedViewport, setSavedViewport] = useState<Viewport | null>(null);
	const [loaded, setLoaded] = useState(false);
	useEffect(() => {
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
	}, [viewportKey]);
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
							style: { width, height: 900 },
							dragHandle: ".desk-title",
						},
					]
				: []),
		]);
	}, [space.spaceId, deleted, width]);
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
			name: selectedHumanProfile?.profileName.split(" ")[0] ?? "",
			spaceId: space.spaceId ?? "",
			profileId: space.profileId ?? "",
			orgSlug: currentOrganization.slug,
			profiles: profilesQuery.data ?? [],
		}),
		[
			selectedHumanProfile,
			space.spaceId,
			space.profileId,
			currentOrganization.slug,
			profilesQuery.data,
		]
	);
	return (
		<AppFullWidthLayout contentLayout="flush" scroll={false}>
			<header className="flex items-center gap-3 border-b px-4 py-3">
				<h1 className="truncate font-medium text-base">
					Desk <span aria-hidden="true" className="mx-2 border-l" />{" "}
					{currentOrganization.name}
				</h1>
			</header>
			<section
				aria-label="Desk workspace"
				className="relative min-h-0 flex-1"
				data-desk-canvas
				onKeyDownCapture={interrupt}
				onPointerDownCapture={interrupt}
				onWheelCapture={interrupt}
				ref={region}
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
				{!(space.error || profilesQuery.isError || (loaded && space.ready)) && (
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
			</section>
		</AppFullWidthLayout>
	);
}

function DeskWindow({ data }: NodeProps<DeskNode>) {
	const context = use(DeskContext);
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
					Your work, together in one place.
				</p>
			</section>
		);
	}
	return (
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
			<div className="nodrag nopan nowheel flex min-h-0 flex-1 flex-col">
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
	);
}
