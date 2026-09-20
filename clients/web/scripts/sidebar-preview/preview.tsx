import { Button } from "@openmeld/ui/components/button";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentProfileSidebarItemComponent } from "../../src/components/agents/agent-profile-sidebar-item";
import { SidebarListSkeleton } from "../../src/components/app/sidebar-list-skeleton";
import { HumanProfileItem } from "../../src/components/directory/human-profile-item";
import { ConversationSidebarRow } from "../../src/components/spaces/conversation-sidebar-row";
import { agentScenarios, peopleScenarios, spaceScenarios } from "./scenarios";
import "./preview.css";

function Preview() {
	const [loading, setLoading] = useState(
		new URLSearchParams(window.location.search).has("loading")
	);
	const [dark, setDark] = useState(!loading);
	const [width, setWidth] = useState(280);
	const [selected, setSelected] = useState<string | null>(null);
	const [pins, setPins] = useState<Record<string, boolean>>({});
	return (
		<div className={dark ? "dark" : ""}>
			<main className="min-h-screen bg-background p-6 text-foreground">
				<header className="mb-6 flex flex-wrap items-center gap-4">
					<div>
						<h1 className="font-medium">Sidebar state preview</h1>
						<p className="text-muted-foreground text-sm">
							Simulated UI states · No account or runtime changes
						</p>
					</div>
					<Button onClick={() => setDark(!dark)} variant="outline">
						Switch theme
					</Button>
					<Button onClick={() => setLoading(!loading)} variant="outline">
						{loading ? "Show populated rows" : "Show loading rows"}
					</Button>
					<label className="text-sm">
						Width {width}px{" "}
						<input
							aria-label="Sidebar width"
							max="420"
							min="180"
							onChange={(event) => setWidth(Number(event.target.value))}
							type="range"
							value={width}
						/>
					</label>
					<span className="text-muted-foreground text-sm">
						Selected: {selected ?? "none"}
					</span>
				</header>
				{loading ? (
					<div className="flex flex-wrap items-start gap-6">
						{[
							{
								title: "Center Agent",
								label: "Loading Center Agent chats",
								rowCount: 2,
								showPreview: true,
							},
							{
								title: "Chats",
								label: "Loading chats",
								showPreview: true,
								rowCount: 2,
							},
							{ title: "Spaces", label: "Loading Spaces", showPreview: false },
							{ title: "Team", label: "Loading people", showPreview: true },
						].map(({ title, ...props }) => (
							<section
								className="min-h-80 rounded-lg bg-[var(--app-canvas)] p-2"
								key={title}
								style={{ width }}
							>
								<h2 className="px-2 py-3 text-sm">{title}</h2>
								<SidebarListSkeleton {...props} />
							</section>
						))}
					</div>
				) : (
					<div className="flex flex-wrap items-start gap-6">
						<Column
							onSelect={setSelected}
							selected={selected}
							title="Spaces"
							width={width}
						>
							{spaceScenarios.map((scenario, index) => {
								const pinned =
									pins[scenario.item.spaceId] ??
									Boolean(scenario.item.pinnedAt);
								return (
									<ConversationSidebarRow
										activeWakeSummary={scenario.activeWakeSummary}
										archived={false}
										attentionTone={null}
										conversation={{
											kind: "space",
											item: {
												...scenario.item,
												pinnedAt: pinned ? "2026-09-01T00:00:00Z" : null,
											},
											spaceId: scenario.item.spaceId,
											title: scenario.item.spaceName,
											activity: scenario.item.messagePreview?.timestamp ?? 0,
											profileId: "viewer",
											url: scenario.routePath,
										}}
										disabled={false}
										groups={[]}
										index={index}
										key={scenario.item.spaceId}
										onMove={() =>
											setPins({ ...pins, [scenario.item.spaceId]: true })
										}
										onUnpin={() =>
											setPins({ ...pins, [scenario.item.spaceId]: false })
										}
										profileId="viewer"
										section={pinned ? "pinned" : "spaces"}
										selected={selected === scenario.item.spaceId}
										title={scenario.item.spaceName}
										unreadCount={scenario.unreadCount}
										url={scenario.routePath}
									/>
								);
							})}
						</Column>
						<Column selected={selected} title="People" width={width}>
							{peopleScenarios.map((scenario, index) => (
								<HumanProfileItem
									key={scenario.member.id}
									{...scenario}
									index={index}
									isActive={selected === scenario.member.id}
									onSelect={setSelected}
								/>
							))}
						</Column>
						<Column selected={selected} title="Agents" width={width}>
							{agentScenarios.map((scenario, index) => (
								<AgentProfileSidebarItemComponent
									key={scenario.profile.openMeldProfileId}
									{...scenario}
									index={index}
									isActive={selected === scenario.profile.openMeldProfileId}
									onSelectProfile={setSelected}
								/>
							))}
						</Column>
					</div>
				)}
			</main>
		</div>
	);
}

function Column({
	title,
	width,
	selected,
	children,
	onSelect,
}: {
	title: string;
	width: number;
	selected: string | null;
	children: ReactNode;
	onSelect?: (value: string) => void;
}) {
	return (
		<section
			className="flex h-[75vh] flex-col rounded-lg border bg-sidebar p-2"
			style={{ width }}
		>
			<h2 className="shrink-0 px-2 py-3 text-muted-foreground text-sm">
				{title}
			</h2>
			<ScrollArea className="min-h-0 flex-1">
				<FluidNavMenu
					activeValue={selected}
					aria-label={title}
					onClick={(event) => {
						if (
							!(event.target instanceof Element && event.target.closest("a"))
						) {
							return;
						}
						const row = event.target.closest<HTMLElement>(
							"[data-fluid-nav-value]"
						);
						if (row?.dataset.fluidNavValue) {
							onSelect?.(row.dataset.fluidNavValue);
						}
					}}
				>
					{children}
				</FluidNavMenu>
			</ScrollArea>
		</section>
	);
}

const rootRoute = createRootRoute({ component: Preview });
const page = createRoute({ getParentRoute: () => rootRoute, path: "/" });
const router = createRouter({ routeTree: rootRoute.addChildren([page]) });
const root = document.getElementById("root");
if (!root) {
	throw new Error("Missing preview root");
}
createRoot(root).render(
	<QueryClientProvider client={new QueryClient()}>
		<TooltipProvider>
			<RouterProvider router={router} />
		</TooltipProvider>
	</QueryClientProvider>
);
