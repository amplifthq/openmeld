import { Button } from "@openmeld/ui/components/button";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentProfileSidebarItemComponent } from "../../src/components/agents/agent-profile-sidebar-item";
import { HumanProfileSidebarItem } from "../../src/components/directory/human-profile-sidebar-item";
import { SpaceSidebarMenuItem } from "../../src/components/spaces/space-sidebar-menu-item";
import { agentScenarios, peopleScenarios, spaceScenarios } from "./scenarios";
import "./preview.css";

function Preview() {
	const [dark, setDark] = useState(true);
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
				<div className="flex flex-wrap items-start gap-6">
					<Column
						onSelect={setSelected}
						selected={selected}
						title="Spaces"
						width={width}
					>
						{spaceScenarios.map((scenario, index) => {
							const pinned =
								pins[scenario.item.spaceId] ?? Boolean(scenario.item.pinnedAt);
							return (
								<SpaceSidebarMenuItem
									key={scenario.item.spaceId}
									{...scenario}
									index={index}
									isActive={selected === scenario.item.spaceId}
									item={{
										...scenario.item,
										pinnedAt: pinned ? "2026-09-01T00:00:00Z" : null,
									}}
									onOpenSpace={() => setSelected(scenario.item.spaceId)}
									onTogglePinned={() =>
										setPins({ ...pins, [scenario.item.spaceId]: !pinned })
									}
								/>
							);
						})}
					</Column>
					<Column selected={selected} title="People" width={width}>
						{peopleScenarios.map((scenario, index) => (
							<HumanProfileSidebarItem
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
	<TooltipProvider>
		<RouterProvider router={router} />
	</TooltipProvider>
);
