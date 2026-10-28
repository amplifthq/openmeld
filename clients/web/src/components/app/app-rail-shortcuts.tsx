import { Button } from "@openmeld/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@openmeld/ui/components/popover";
import { Separator } from "@openmeld/ui/components/separator";
import {
	FluidActionList,
	FluidActionListItem,
} from "@openmeld/ui/fluid/action-list";
import { FluidContextMenu } from "@openmeld/ui/fluid/context-menu";
import {
	BooksIcon,
	ChatCircleDotsIcon,
	ChatCircleTextIcon,
	CompassIcon,
	FolderIcon,
	PlusIcon,
	PushPinIcon,
	PuzzlePieceIcon,
	RobotIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { type ReactElement, useState } from "react";
import {
	SIDEBAR_SHORTCUT_IDS,
	type SidebarShortcutId,
} from "#/lib/appearance/sidebar-shortcuts";
import {
	buildOrganizationAgentCreationPath,
	buildOrganizationAgentsPath,
	buildOrganizationFilesPath,
	buildOrganizationNewSpacePath,
	buildOrganizationPeoplePath,
	buildOrganizationPluginsPath,
	buildOrganizationSkillsPath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import { useAppNavigationPresentation } from "./app-navigation-presentation";
import { CollapsedRailTooltip } from "./app-rail-navigation";
import { ObjectMenuItems } from "./object-menu-items";

const SHORTCUTS = {
	messages: {
		label: "Direct messages",
		icon: ChatCircleDotsIcon,
		path: (orgSlug: string) =>
			`${buildOrganizationSpacesPath(orgSlug)}?view=messages`,
	},
	discover: {
		label: "Discover",
		icon: CompassIcon,
		path: (orgSlug: string) =>
			`${buildOrganizationSpacesPath(orgSlug)}?view=discover`,
	},
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
} as const;

export type RailShortcutGroup = "spaces" | "team";
const SHORTCUT_GROUPS = {
	spaces: {
		label: "Spaces",
		primaryLabel: "Chats",
		icon: ChatCircleTextIcon,
		path: buildOrganizationSpacesPath,
		ids: ["messages", "discover"],
	},
	team: {
		label: "Team",
		primaryLabel: "People",
		icon: UsersThreeIcon,
		path: buildOrganizationPeoplePath,
		ids: ["agents", "files", "skills", "plugins"],
	},
} as const;

export function visibleSidebarShortcuts(
	ids: readonly SidebarShortcutId[],
	isPersonal: boolean
) {
	return ids.filter((id) => !(isPersonal && id === "discover"));
}

export function resolveActiveSidebarShortcut(
	pathname: string,
	orgSlug: string,
	searchStr = ""
) {
	return SIDEBAR_SHORTCUT_IDS.find((id) => {
		const path = SHORTCUTS[id].path(orgSlug);
		if (id === "messages" || id === "discover") {
			return (
				pathname === buildOrganizationSpacesPath(orgSlug) &&
				new URLSearchParams(searchStr).get("view") === id
			);
		}
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
			label: id === "messages" ? "DMs" : item.label,
			to: item.path(orgSlug),
			icon: <item.icon aria-hidden="true" className="size-5" />,
		};
	});
}

export function AppRailShortcutsPopover(input: {
	group: RailShortcutGroup;
	isPersonal: boolean;
	onNewMessage: () => void;
	orgSlug: string;
	pinned: SidebarShortcutId[];
	toggle: (id: SidebarShortcutId) => void;
	trigger: ReactElement;
}) {
	const [open, setOpen] = useState(false);
	const { dismiss } = useAppNavigationPresentation();
	const group = SHORTCUT_GROUPS[input.group];
	const creation =
		input.group === "spaces"
			? {
					label: "New Space",
					path: buildOrganizationNewSpacePath(input.orgSlug),
				}
			: {
					label: "New Agent",
					path: buildOrganizationAgentCreationPath(input.orgSlug),
				};
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<FluidContextMenu
				target={
					<PopoverTrigger
						data-sidebar-hover-preview
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
				<ObjectMenuItems href={group.path(input.orgSlug)} />
			</FluidContextMenu>
			<PopoverContent
				align="start"
				aria-label={`${group.label} resources`}
				className="w-48 animate-none! gap-0 rounded-lg p-1 opacity-100 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:duration-100"
				side="right"
				sideOffset={8}
			>
				<FluidActionList gapClick={false}>
					<FluidActionListItem
						className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
						index={0}
						render={
							<Link
								onClick={() => {
									setOpen(false);
									dismiss();
								}}
								to={group.path(input.orgSlug)}
							/>
						}
					>
						<group.icon aria-hidden="true" className="size-4" />
						{group.primaryLabel}
					</FluidActionListItem>
					{visibleSidebarShortcuts(group.ids, input.isPersonal).map(
						(id, index) => {
							const item = SHORTCUTS[id];
							const pinned = input.pinned.includes(id);
							return (
								<div className="relative" key={id}>
									<FluidActionListItem
										className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md pr-9 pl-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
										index={index + 1}
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
						}
					)}
				</FluidActionList>
				<Separator className="my-1" />
				<FluidActionList gapClick={false}>
					{input.group === "spaces" && (
						<FluidActionListItem
							className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
							index={0}
							onClick={() => {
								setOpen(false);
								input.onNewMessage();
							}}
						>
							<ChatCircleTextIcon aria-hidden="true" className="size-4" />
							New message
						</FluidActionListItem>
					)}
					<FluidActionListItem
						className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
						index={input.group === "spaces" ? 1 : 0}
						render={
							<Link
								onClick={() => {
									setOpen(false);
									dismiss();
								}}
								to={creation.path}
							/>
						}
					>
						<PlusIcon aria-hidden="true" className="size-4" />
						{creation.label}
					</FluidActionListItem>
				</FluidActionList>
			</PopoverContent>
		</Popover>
	);
}
