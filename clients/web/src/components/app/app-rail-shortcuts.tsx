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
import { FluidContextMenu } from "@openmeld/ui/fluid/context-menu";
import {
	BooksIcon,
	FolderIcon,
	PushPinIcon,
	PuzzlePieceIcon,
	RobotIcon,
	TimerIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { type ReactElement, useState } from "react";
import {
	SIDEBAR_SHORTCUT_IDS,
	type SidebarShortcutId,
} from "#/lib/appearance/sidebar-shortcuts";
import {
	buildOrganizationAgentsPath,
	buildOrganizationFilesPath,
	buildOrganizationPeoplePath,
	buildOrganizationPluginsPath,
	buildOrganizationRoutinesPath,
	buildOrganizationSkillsPath,
} from "#/lib/organizations/organization-routes";
import { useAppNavigationPresentation } from "./app-navigation-presentation";
import { CollapsedRailTooltip } from "./app-rail-navigation";
import { ObjectMenuItems } from "./object-menu-items";

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

export function buildPinnedRailDestinations(
	pinned: SidebarShortcutId[],
	orgSlug: string
) {
	return pinned.map((id) => {
		const item = SHORTCUTS[id];
		return {
			id,
			label: item.label,
			to: item.path(orgSlug),
			icon: <item.icon aria-hidden="true" className="size-5" />,
		};
	});
}

export function AppTeamShortcutsPopover(input: {
	orgSlug: string;
	pinned: SidebarShortcutId[];
	toggle: (id: SidebarShortcutId) => void;
	trigger: ReactElement;
}) {
	const [open, setOpen] = useState(false);
	const { dismiss } = useAppNavigationPresentation();
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<FluidContextMenu
				target={
					<PopoverTrigger
						delay={0}
						nativeButton={false}
						onClick={(event) => {
							event.preventBaseUIHandler();
							setOpen(false);
						}}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown" || event.key === " ") {
								event.preventDefault();
								event.preventBaseUIHandler();
								setOpen(true);
							}
						}}
						openOnHover
						render={input.trigger}
						role="link"
					/>
				}
			>
				<ObjectMenuItems href={buildOrganizationPeoplePath(input.orgSlug)} />
			</FluidContextMenu>
			<PopoverContent
				align="start"
				aria-label="Team resources"
				className="w-52 animate-none! gap-0 rounded-lg p-1"
				side="right"
				sideOffset={8}
			>
				<FluidActionList gapClick={false}>
					{SIDEBAR_SHORTCUT_IDS.map((id, index) => {
						const item = SHORTCUTS[id];
						const pinned = input.pinned.includes(id);
						return (
							<div className="relative" key={id}>
								<FluidActionListItem
									className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md pr-9 pl-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
										className="absolute top-0.5 right-0.5 z-20 size-7 text-muted-foreground hover:bg-transparent dark:hover:bg-transparent"
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
	);
}
