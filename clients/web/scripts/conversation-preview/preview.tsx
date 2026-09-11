import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { useSidebar } from "@openmeld/ui/fluid/sidebar-state";
import { UsersThreeIcon } from "@phosphor-icons/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
	useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppContextualSidebarNav } from "../../src/components/app/app-contextual-layout";
import { AppModuleSidebarToggle } from "../../src/components/app/app-module-sidebar";
import { APP_APPLICATION_RAIL_CLASS_NAME } from "../../src/components/app/app-nav-item-style";
import {
	AppRailNavigationGroup,
	buildAppRailGroups,
} from "../../src/components/app/app-rail-navigation";
import { AppSurfaceLayout } from "../../src/components/app/app-surface-layout";
import { ConversationsSidebar } from "../../src/components/spaces/conversations-sidebar";
import "../sidebar-preview/preview.css";

const client = new QueryClient();
const drafts = new Map<string, string>();
function Controls() {
	const { width, setGeometry, state } = useSidebar();
	return (
		<div className="absolute inset-x-0 bottom-0 flex h-12 items-center justify-between gap-3 px-3 text-muted-foreground text-xs">
			<span className="truncate">
				Fictional data · Production layout components
			</span>
			<label className="flex shrink-0 items-center gap-2">
				Width{" "}
				<input
					aria-label="Sidebar width"
					className="w-16 rounded border px-1"
					max={384}
					min={160}
					onChange={(e) =>
						setGeometry({ mode: state, width: Number(e.target.value) })
					}
					type="number"
					value={Number.parseFloat(width)}
				/>
			</label>
		</div>
	);
}
function Preview() {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const isTeam = pathname.includes("/people");
	const draftKey = isTeam ? "team" : "messenger";
	const title = isTeam ? "Maya Chen" : "Product design";
	const [draft, setDraft] = useState(
		drafts.get(draftKey) ?? "Keep this unsent draft"
	);
	useEffect(
		() => setDraft(drafts.get(draftKey) ?? "Keep this unsent draft"),
		[draftKey]
	);
	const [details, setDetails] = useState(false);
	const [dark, setDark] = useState(false);
	const rail = (
		<aside
			className={APP_APPLICATION_RAIL_CLASS_NAME}
			data-slot="app-outer-rail"
		>
			<div className="flex h-20 shrink-0 items-center justify-center">
				<span className="flex size-9 items-center justify-center rounded-xl bg-foreground font-semibold text-background">
					N
				</span>
			</div>
			<div className="flex-1 px-1">
				{buildAppRailGroups({
					orgSlug: "test",
					centerAgentUnreadCount: 0,
					spacesUnreadCount: 3,
					prefetchCenterAgentConversation: () => undefined,
				}).map((group, index) => (
					<AppRailNavigationGroup
						activeDestination={isTeam ? "people" : "directMessages"}
						group={group}
						key={group.id}
						position={index}
						tier="icon"
					/>
				))}
			</div>
			<button
				className="mb-5 px-1 text-xs"
				onClick={() => setDark(!dark)}
				type="button"
			>
				Switch theme
			</button>
		</aside>
	);
	const team = (
		<>
			<h2 className="mb-4 px-1 font-medium text-sm">Team</h2>
			<AppContextualSidebarNav
				activeItemId="maya"
				ariaLabel="People"
				groups={[
					{
						id: "people",
						label: "People",
						ariaLabel: "People",
						items: [
							{
								id: "maya",
								label: "Maya Chen",
								icon: UsersThreeIcon,
								to: "/o/test/people",
							},
							{
								id: "alex",
								label: "Alex Rivera",
								icon: UsersThreeIcon,
								to: "/o/test/people/alex",
							},
						],
					},
				]}
				placement="main"
				title="Team"
			/>
		</>
	);
	return (
		<QueryClientProvider client={client}>
			<TooltipProvider>
				<div className={dark ? "dark" : ""}>
					<AppSurfaceLayout
						globalControls={<Controls />}
						initialModuleSidebarState={{ tier: "expanded", width: "308px" }}
						moduleNavigation={isTeam ? team : <ConversationsSidebar />}
						moduleNavigationKey={isTeam ? "people" : "conversations"}
						moduleNavigationLabel={isTeam ? "Team" : "Messenger"}
						outerRail={rail}
					>
						<section className="flex min-h-0 min-w-0 flex-1 flex-col">
							<header className="flex h-16 shrink-0 items-center gap-3 border-border border-b px-5">
								<AppModuleSidebarToggle />
								<h1 className="flex-1 font-medium text-lg">{title}</h1>
								<button
									aria-label="Toggle details"
									className="rounded px-2 py-1 text-muted-foreground text-xs hover:bg-muted"
									onClick={() => setDetails(!details)}
									type="button"
								>
									Details
								</button>
							</header>
							<div className="relative flex min-h-0 flex-1">
								<div className="flex min-w-0 flex-1 flex-col">
									<div className="min-h-0 flex-1 overflow-auto p-8">
										<p className="mb-8 text-muted-foreground text-xs">
											Interactive presentation preview · Fictional workspace
										</p>
										{isTeam ? (
											<>
												<h2 className="mb-2 text-xl">Maya Chen</h2>
												<p className="text-muted-foreground text-sm">
													Product designer · Northstar
												</p>
												<p className="mt-8 text-sm">
													Team member details appear here. Messenger stays one
													click away.
												</p>
											</>
										) : (
											<>
												<p className="mb-2 font-medium text-sm">
													Maya Chen{" "}
													<span className="ml-2 font-normal text-muted-foreground text-xs">
														9:42 AM
													</span>
												</p>
												<p className="mb-8 max-w-2xl text-sm leading-7">
													The launch page is ready for a final look. Could you
													check the copy and flag anything that might be unclear
													to a new user?
												</p>
												<p className="mb-2 font-medium text-sm">
													Review Agent{" "}
													<span className="ml-2 font-normal text-muted-foreground text-xs">
														9:44 AM
													</span>
												</p>
												<p className="max-w-2xl text-sm leading-7">
													The main story is clear. Lead with what a teammate can
													accomplish in their first conversation, then explain
													when connecting a computer is useful.
												</p>
											</>
										)}
									</div>
									<div className="m-5">
										<textarea
											aria-label="Message draft"
											className="min-h-28 w-full resize-none rounded-xl border bg-background p-4 text-sm"
											onChange={(e) => {
												setDraft(e.target.value);
												drafts.set(draftKey, e.target.value);
											}}
											value={draft}
										/>
									</div>
								</div>
								{details && (
									<aside
										aria-label="Details"
										className="absolute inset-y-0 right-0 w-64 border-l bg-background p-5 shadow-lg xl:static xl:shadow-none"
									>
										<h2 className="mb-5 font-medium">Details</h2>
										<p className="text-muted-foreground text-sm">Maya Chen</p>
										<p className="mt-4 text-muted-foreground text-sm">
											Alex Rivera
										</p>
										<p className="mt-4 text-muted-foreground text-sm">
											Review Agent
										</p>
									</aside>
								)}
							</div>
						</section>
					</AppSurfaceLayout>
				</div>
			</TooltipProvider>
		</QueryClientProvider>
	);
}
const route = createRootRoute({ component: Preview });
const router = createRouter({
	routeTree: route.addChildren([
		createRoute({
			getParentRoute: () => route,
			path: "$",
			component: () => null,
		}),
	]),
});
const root = document.getElementById("root");
if (root) {
	createRoot(root).render(<RouterProvider router={router} />);
}
