import { Button } from "@openmeld/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@openmeld/ui/components/popover";
import {
	FluidActionList,
	FluidActionListItem,
} from "@openmeld/ui/fluid/action-list";
import type { SidebarMode } from "@openmeld/ui/fluid/sidebar-state";
import {
	BooksIcon,
	DotsThreeIcon,
	FolderIcon,
	PushPinIcon,
	PuzzlePieceIcon,
	RobotIcon,
	TimerIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
	SIDEBAR_SHORTCUT_IDS,
	type SidebarShortcutId,
} from "#/lib/appearance/sidebar-shortcuts";
import {
	buildOrganizationAgentsPath,
	buildOrganizationFilesPath,
	buildOrganizationPluginsPath,
	buildOrganizationRoutinesPath,
	buildOrganizationSkillsPath,
} from "#/lib/organizations/organization-routes";
import { useAppNavigationPresentation } from "./app-navigation-presentation";
import {
	AppRailNavigationGroup,
	CollapsedRailTooltip,
} from "./app-rail-navigation";

const SHORTCUTS = {
	agents: {
		label: "Agents",
		icon: RobotIcon,
		path: buildOrganizationAgentsPath,
	},
	plugins: {
		label: "Plugins",
		icon: PuzzlePieceIcon,
		path: buildOrganizationPluginsPath,
	},
	skills: {
		label: "Skills",
		icon: BooksIcon,
		path: buildOrganizationSkillsPath,
	},
	files: { label: "Files", icon: FolderIcon, path: buildOrganizationFilesPath },
	routines: {
		label: "Routines",
		icon: TimerIcon,
		path: buildOrganizationRoutinesPath,
	},
} as const;

export function resolveActiveSidebarShortcut(
	pathname: string,
	orgSlug: string
) {
	return SIDEBAR_SHORTCUT_IDS.find((id) => {
		const path = SHORTCUTS[id].path(orgSlug);
		return pathname === path || pathname.startsWith(`${path}/`);
	});
}

export function AppRailShortcuts(input: {
	orgSlug: string;
	pinned: SidebarShortcutId[];
	toggle: (id: SidebarShortcutId) => void;
	active?: SidebarShortcutId;
	tier: SidebarMode;
}) {
	const [open, setOpen] = useState(false);
	const { dismiss } = useAppNavigationPresentation();
	return (
		<>
			<div className="mt-1 flex justify-center">
				<Popover onOpenChange={setOpen} open={open}>
					<PopoverTrigger
						delay={0}
						openOnHover
						render={
							<Button
								aria-label="More navigation"
								className="size-9"
								size="icon"
								variant="ghost"
							/>
						}
					>
						<DotsThreeIcon className="size-5" />
					</PopoverTrigger>
					<PopoverContent
						align="start"
						aria-label="More navigation"
						className="w-52 animate-none! gap-0 rounded-lg p-1"
						side="right"
						sideOffset={8}
					>
						<FluidActionList gapClick={false}>
							{SIDEBAR_SHORTCUT_IDS.map((id, index) => {
								const item = SHORTCUTS[id];
								const pinned = input.pinned.includes(id);
								return (
									<div className="group/shortcut flex items-center" key={id}>
										<FluidActionListItem
											className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
											index={index}
											render={
												<Link
													onClick={() => {
														setOpen(false);
														dismiss();
													}}
													to={item.path(input.orgSlug)}
												/>
											}
										>
											<item.icon aria-hidden="true" className="size-4" />
											{item.label}
										</FluidActionListItem>
										<CollapsedRailTooltip
											label={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
											side="top"
										>
											<Button
												aria-label={`${pinned ? "Unpin" : "Pin"} ${item.label} ${pinned ? "from" : "to"} sidebar`}
												aria-pressed={pinned}
												className="size-7 shrink-0 text-muted-foreground"
												onClick={() => input.toggle(id)}
												size="icon-sm"
												variant="ghost"
											>
												<PushPinIcon
													aria-hidden="true"
													className="size-3.5"
													weight={pinned ? "fill" : "regular"}
												/>
											</Button>
										</CollapsedRailTooltip>
									</div>
								);
							})}
						</FluidActionList>
					</PopoverContent>
				</Popover>
			</div>
			{input.pinned.length > 0 && (
				<>
					<div aria-hidden="true" className="mx-auto my-2 h-px w-5 bg-border" />
					<AppRailNavigationGroup
						activeDestination={input.active ?? null}
						group={{
							id: "pinned",
							label: "Pinned shortcuts",
							destinations: input.pinned.map((id) => {
								const item = SHORTCUTS[id];
								return {
									id,
									label: item.label,
									to: item.path(input.orgSlug),
									icon: <item.icon aria-hidden="true" className="size-5" />,
								};
							}),
						}}
						position={0}
						standaloneSelection
						tier={input.tier}
					/>
				</>
			)}
		</>
	);
}
